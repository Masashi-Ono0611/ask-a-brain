/** Founder-only offline composition. CLI always uses /dev/tty and the fixed
 * protected-path policy. Injectable ports are for synthetic in-process tests;
 * there is no CLI flag, environment switch or stdin approval bypass. */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IsoTime, ScanAttestation, SellerPublicKey } from '../../src/wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, encodeBase58, payloadHash, sellerPublicKeySchema, signEnvelope, strictJson, validatePayload, verifyEnvelope } from '../../src/wire/index.ts';
import { controllingTerminal } from '../../src/chain/index.ts';
import type { HumanTerminal } from '../../src/chain/index.ts';
import { createReviewPacket, inertText, readInventory, regularBytes, validateBundle } from '../../src/publish/index.ts';
import type { PublisherApproval, ReviewRow } from '../../src/publish/index.ts';

function requireHelper(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
const repository = fileURLToPath(new URL('../../', import.meta.url));
function within(path: string, root: string): boolean {
  const suffix = relative(resolve(root), path);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}
function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Any .git ancestor catches ordinary repos and linked worktrees, including
 * other projects. No git command, private tree traversal or home lookup. */
export function protectedLocation(path: string, temporaryRoots: readonly string[] = ['/tmp', '/private/tmp', realpathSync(tmpdir())]): string {
  requireHelper(isAbsolute(path) && resolve(path) === path, 'CANONICAL_ABSOLUTE_PATH_REQUIRED');
  requireHelper(!within(path, repository), 'REPOSITORY_PATH_FORBIDDEN');
  const parent = dirname(path);
  requireHelper(realpathSync(parent) === parent, 'DIRECTORY_LINK');
  for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
    requireHelper(!exists(join(ancestor, '.git')), 'REPOSITORY_PATH_FORBIDDEN');
    if (dirname(ancestor) === ancestor) break;
  }
  requireHelper(!temporaryRoots.some((root) => within(path, root)), 'TEMPORARY_PATH_FORBIDDEN');
  const stat = lstatSync(parent);
  requireHelper(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700, 'PROTECTED_DIRECTORY_REQUIRED');
  return path;
}
function newOutput(path: string, protect: (path: string) => string): string {
  const checked = protect(path);
  requireHelper(!exists(checked), 'OUTPUT_EXISTS');
  return checked;
}
function writeProtected(path: string, bytes: Uint8Array, protect: (path: string) => string): void {
  newOutput(path, protect);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, bytes); fsyncSync(fd); }
  finally { closeSync(fd); }
  const parent = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
const inputLimit = M03.sealedPayloadMax.value * 1024 * 1024;
function bytes(path: string): Uint8Array {
  const absolute = resolve(path);
  requireHelper(realpathSync(dirname(absolute)) === dirname(absolute), 'DIRECTORY_LINK');
  return regularBytes(absolute, inputLimit);
}
function json(data: Uint8Array): unknown { return strictJson(data, { integerNumbersOnly: true }); }
function publicIdentity(key: KeyObject): { key: SellerPublicKey; sha256: string } {
  const raw = Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url');
  const sha256 = bytesHash(raw);
  return { key: sellerPublicKeySchema.parse({ id: `seller-${sha256}`, algorithm: 'Ed25519', public_key: encodeBase58(raw) }), sha256 };
}
function loadKey(path: string, protect: (path: string) => string): KeyObject {
  protect(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let secret: Buffer | undefined;
  try {
    const stat = fstatSync(fd);
    requireHelper(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600 && stat.size <= inputLimit, 'PROTECTED_KEY_REQUIRED');
    secret = readFileSync(fd);
    const after = fstatSync(fd);
    requireHelper(secret.length === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs && after.nlink === 1, 'KEY_CHANGED');
    const key = createPrivateKey({ key: secret, type: 'pkcs8', format: 'der' });
    requireHelper(key.type === 'private' && key.asymmetricKeyType === 'ed25519', 'ED25519_KEY_REQUIRED');
    const canonical = key.export({ type: 'pkcs8', format: 'der' });
    try { requireHelper(secret.equals(canonical), 'NONCANONICAL_KEY'); }
    finally { canonical.fill(0); }
    return key;
  } finally { secret?.fill(0); closeSync(fd); }
}
const acknowledgments = [
  ['review', 'I have read every exact public byte and metadata in the inert review; these manifest and review hashes are approved.'],
  ['originals', 'I ran the required secret and business-marker scans on the selected original inputs outside AI sessions; all passed without skipped bytes or unresolved findings.'],
  ['lineage', 'My private lineage map is complete; every origin is eligible personal-public material (or explicitly synthetic), with no prohibited or ambiguous origin.'],
  ['rights', 'I checked the current source hashes, rights and withdrawal state for this session: origins are unchanged, rights are confirmed, and nothing is withdrawn.'],
  ['download', 'I authorize whole-page public download and understand that copied public bytes cannot be recalled.'],
  ['cc-by', 'I authorize CC BY 4.0 for every public page and confirm my right to license and sell this material.'],
] as const;

function approvalSnapshot(projection: string, manifestPath: string, reviewPath: string, scanPath: string) {
  const manifestBytes = bytes(manifestPath), reviewBytes = bytes(reviewPath), scanBytes = bytes(scanPath);
  const manifest = validatePayload('manifest', json(manifestBytes));
  const input = { manifest, files: readInventory(resolve(projection), manifest.files) };
  const review = json(reviewBytes);
  requireHelper(review !== null && typeof review === 'object' && !Array.isArray(review) && 'worksheet' in review && Array.isArray(review.worksheet), 'INVALID_REVIEW');
  // Reconstruction validates worksheet fields, every inventory hash, exact text,
  // metadata, and all packet fields. Extra/missing/changed fields cannot survive.
  const packet = createReviewPacket(input, review.worksheet as ReviewRow[]);
  requireHelper(payloadHash(review) === payloadHash(packet), 'REVIEW_MISMATCH');
  const now = new Date().toISOString() as IsoTime;
  const approval = { approval_id: manifest.approval_id, payload_sha256: payloadHash(manifest), approved_at: now, actor: 'human' as const };
  const scans = json(scanBytes) as ScanAttestation;
  validateBundle(input, approval, scans);
  const displayed = {
    manifest_sha256: payloadHash(manifest), manifest_file_sha256: bytesHash(manifestBytes),
    review_sha256: payloadHash(packet), review_file_sha256: bytesHash(reviewBytes),
    inventory_sha256: payloadHash(manifest.files), scan_file_sha256: bytesHash(scanBytes),
    // The command has no scanner binary/pins: display the supplied verdict, not
    // its unrecomputed executable fingerprint. Raw scan-file hash binds it all.
    scan_attestation: { passed: scans.passed, scanned_at: scans.scanned_at, scanner_version: scans.scanner_version },
  };
  return { manifest, packet, displayed, fingerprint: payloadHash(displayed) };
}

/** Trusted composition ports; tests implement scripted terminals and temp-only
 * path policy inside test/publish. The executable entrypoint accepts neither. */
export interface FounderHelperPorts {
  readonly terminal: HumanTerminal;
  readonly protectPath: (path: string) => string;
  readonly report: (line: string) => void;
}
export async function runFounderHelper(args: readonly string[], ports: FounderHelperPorts): Promise<void> {
  const { terminal, protectPath, report } = ports;
  requireHelper(terminal.isTTY(), 'FOUNDER_TTY_REQUIRED');
  const [command, ...values] = args;
  const a = (n: number): string => { const value = values[n]; requireHelper(value, 'INVALID_ARGUMENTS'); return value; };
  async function confirm(display: string, phrase: string, unchanged: () => void): Promise<void> {
    requireHelper(terminal.isTTY(), 'FOUNDER_TTY_REQUIRED');
    const answer = await terminal.approve(`${display}\nType exactly: ${phrase}\n`);
    requireHelper(terminal.isTTY(), 'FOUNDER_TTY_REQUIRED');
    requireHelper(answer === phrase, 'EXACT_PHRASE_REQUIRED');
    unchanged();
  }
  if (command === 'init-key') {
    requireHelper(values.length === 1, 'INVALID_ARGUMENTS');
    const path = newOutput(a(0), protectPath);
    const { privateKey } = generateKeyPairSync('ed25519');
    const secret = privateKey.export({ type: 'pkcs8', format: 'der' });
    try { writeProtected(path, secret, protectPath); }
    finally { secret.fill(0); }
    const identity = publicIdentity(privateKey);
    report(JSON.stringify({ public_key: identity.key.public_key, sha256: identity.sha256 }));
    return;
  }
  if (command === 'approve') {
    requireHelper(values.length === 5, 'INVALID_ARGUMENTS');
    const out = newOutput(a(4), protectPath);
    const snapshot = () => approvalSnapshot(a(0), a(1), a(2), a(3));
    const frozen = snapshot();
    const unchanged = () => requireHelper(snapshot().fingerprint === frozen.fingerprint, 'INPUT_CHANGED');
    const summary = Buffer.from(inertText(frozen.displayed)).toString('utf8');
    for (const [code, acknowledgment] of acknowledgments) {
      await confirm(`${summary}\nScan attestation is supplied evidence; seal reruns the pinned scanner.\n${acknowledgment}`, `yes ${code}`, unchanged);
    }
    const now = new Date().toISOString() as IsoTime;
    const approval: PublisherApproval = { v: 1,
      approval: { approval_id: frozen.manifest.approval_id, payload_sha256: frozen.displayed.manifest_sha256, approved_at: now, actor: 'human' },
      review_sha256: frozen.displayed.review_sha256, whole_page_download: true, rights_confirmed: true,
      origins_unchanged: true, originals_scan_passed: true, lineage_complete: true, withdrawn: false, acknowledged_at: now };
    unchanged();
    const encoded = canonicalBytes(approval);
    writeProtected(out, encoded, protectPath);
    report(JSON.stringify({ approval_file_sha256: bytesHash(encoded) }));
    return;
  }
  if (command === 'sign') {
    requireHelper(values.length === 3, 'INVALID_ARGUMENTS');
    const out = newOutput(a(2), protectPath);
    protectPath(a(0));
    const frozenBytes = bytes(a(1));
    const manifest = validatePayload('manifest', json(frozenBytes));
    const hash = payloadHash(manifest);
    const unchanged = () => requireHelper(bytesHash(bytes(a(1))) === bytesHash(frozenBytes), 'INPUT_CHANGED');
    await confirm(`Manifest SHA-256(JCS): ${hash}\nManifest file SHA-256: ${bytesHash(frozenBytes)}\nI authorize this exact manifest signature.`, `sign ${hash}`, unchanged);
    const key = loadKey(a(0), protectPath); // Open the secret only after exact approval.
    unchanged();
    const identity = publicIdentity(key);
    const envelope = signEnvelope('manifest', manifest, identity.key.id, key, { kind: 'manifest', payloadHash: hash, approvalId: manifest.approval_id, actor: 'human' });
    verifyEnvelope('manifest', envelope, identity.key);
    unchanged();
    writeProtected(out, canonicalBytes(envelope), protectPath);
    report(JSON.stringify({ manifest_sha256: hash, signing_key: identity.key }));
    return;
  }
  throw new Error('INVALID_ARGUMENTS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runFounderHelper(process.argv.slice(2), { terminal: controllingTerminal(), protectPath: protectedLocation, report: (line) => console.log(line) }); }
  catch { console.error('FOUNDER_HELPER_FAILED_CLOSED'); process.exitCode = 1; }
}
