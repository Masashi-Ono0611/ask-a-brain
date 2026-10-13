/** Offline founder-operated composition. No private-source traversal, key reader,
 * network, activation, approval generation or registry writer. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BundleInput, PublicDeployment, SealedBundle, SellerPublicKey, SellerSealSigner, Sha256 } from '../../src/wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, parseWire, payloadHash, strictJson, validatePayload } from '../../src/wire/index.ts';
import { SystemClock } from '../../src/common/index.ts';
import { createBundleScanner, createGitleaksEngine, createPublisher, createReviewPacket, inertText, readInventory, regularBytes, stageBundle, writeExclusive } from '../../src/publish/index.ts';
import type { ReviewRow, ScannerPins } from '../../src/publish/index.ts';

function fail(ok: unknown): asserts ok { if (!ok) throw new Error('OPERATOR_INPUT_REJECTED'); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  fail(value && typeof value === 'object' && !Array.isArray(value)); const row = value as Record<string, unknown>;
  fail(Object.keys(row).length === keys.length && keys.every((k) => Object.hasOwn(row, k))); return row;
}
function bytes(path: string): Uint8Array { return regularBytes(resolve(path), M03.sealedPayloadMax.value * 1024 * 1024); }
function json(path: string): unknown { return strictJson(bytes(path), { integerNumbersOnly: true }); }
function pinned(path: string, digest: string): unknown { const value = bytes(path); fail(/^[a-f0-9]{64}$/.test(digest) && bytesHash(value) === digest); return strictJson(value, { integerNumbersOnly: true }); }
function input(manifestPath: string, projection: string): BundleInput {
  const manifest = validatePayload('manifest', json(manifestPath)); return { manifest, files: readInventory(resolve(projection), manifest.files) };
}
export function scannerFromPins(path: string, digest: string) {
  const pins = object(pinned(path, digest), ['executable', 'executableSha256', 'version', 'config', 'configSha256']);
  fail(Object.values(pins).every((v) => typeof v === 'string'));
  return createBundleScanner(createGitleaksEngine(pins as unknown as ScannerPins), new SystemClock());
}
function context(jobPath: string, digest: string) {
  const job = object(pinned(jobPath, digest), ['manifest', 'projection', 'worksheet', 'scanner_pins', 'scanner_pins_sha256', 'approval', 'approval_sha256', 'signing_key', 'deployment', 'seal_actor']);
  for (const key of ['manifest', 'projection', 'worksheet', 'scanner_pins', 'scanner_pins_sha256', 'approval', 'approval_sha256']) fail(typeof job[key] === 'string');
  fail(job.seal_actor === 'human'); // automated test signers are API-only, no CLI bypass
  const data = input(String(job.manifest), String(job.projection)); const rows = json(String(job.worksheet)); fail(Array.isArray(rows));
  const publisher = createPublisher({ authority: { approvalBytesSha256: job.approval_sha256 as Sha256, read: () => bytes(String(job.approval)) }, worksheet: rows as ReviewRow[],
    scanner: scannerFromPins(String(job.scanner_pins), String(job.scanner_pins_sha256)), signingKey: job.signing_key as SellerPublicKey, clock: new SystemClock(), sealActor: 'human' });
  return { data, publisher, deployment: job.deployment as PublicDeployment };
}
/** Sealed artifact references the separately mounted exact projection. No base64
 * archive that could hide extra files; loader re-inventories the directory. */
function sealedFile(path: string, data: BundleInput): SealedBundle {
  const row = object(json(path), ['manifest', 'approval', 'scans']); const manifest = parseWire('manifest', canonicalBytes(row.manifest));
  fail(payloadHash(manifest.payload) === payloadHash(data.manifest));
  return { manifest, approval: row.approval as SealedBundle['approval'], scans: row.scans as SealedBundle['scans'], files: data.files };
}
export async function runOperator(args: readonly string[]): Promise<void> {
  const [command, ...values] = args; const a = (n: number): string => { const value = values[n]; fail(value); return value; };
  if (command === 'review') {
    fail(values.length === 5); const data = input(a(0), a(1)); const rows = json(a(2)); fail(Array.isArray(rows));
    const staged = stageBundle(data, resolve(a(3))); const packet = createReviewPacket(staged, rows as ReviewRow[]);
    writeExclusive(resolve(a(4)), inertText(packet));
    console.log(JSON.stringify({ state: 'review-only', manifest_sha256: payloadHash(staged.manifest), inventory_sha256: payloadHash(staged.manifest.files), review_sha256: payloadHash(packet) })); return;
  }
  if (command === 'scan') {
    fail(values.length === 5); const data = input(a(2), a(3)); const scans = scannerFromPins(a(0), a(1)).scan(data.files, data.manifest.files);
    writeExclusive(resolve(a(4)), canonicalBytes(scans)); console.log('SCAN_PASSED_NOT_APPROVAL'); return;
  }
  if (command === 'seal') {
    fail(values.length === 4); const ctx = context(a(0), a(1)); const envelope = parseWire('manifest', bytes(a(2)));
    // Human helper signs elsewhere. This adapter only consumes and verifies its
    // returned typed envelope; it never opens any private signing key.
    const signer: SellerSealSigner = { async sign(kind, payload, authorization) {
      fail(kind === 'manifest' && payloadHash(payload) === authorization.payloadHash && payloadHash(envelope.payload) === authorization.payloadHash);
      return envelope as never;
    } };
    const sealed = await ctx.publisher.sealBundle(ctx.publisher.scanAndValidate(ctx.data), signer);
    writeExclusive(resolve(a(3)), canonicalBytes({ manifest: sealed.manifest, approval: sealed.approval, scans: sealed.scans })); console.log('SEALED_INACTIVE'); return;
  }
  if (command === 'list') {
    fail(values.length === 4); const ctx = context(a(0), a(1)); const proposal = ctx.publisher.proposeListing(sealedFile(a(2), ctx.data), ctx.deployment);
    writeExclusive(resolve(a(3)), inertText(proposal)); console.log('SUSPENDED_PROPOSAL_REQUIRES_FOUNDER_REPIN'); return;
  }
  throw new Error('USAGE: review MANIFEST PROJECTION WORKSHEET EMPTY_STAGE REVIEW_TXT | scan PINS PINS_SHA256 MANIFEST STAGE SCAN_JSON | seal JOB JOB_SHA256 SIGNED_MANIFEST SEALED_JSON | list JOB JOB_SHA256 SEALED_JSON PROPOSAL_TXT');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runOperator(process.argv.slice(2)); }
  catch { console.error('PUBLISH_FAILED_CLOSED'); process.exitCode = 1; }
}
