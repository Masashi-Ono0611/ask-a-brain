import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Address, AnswerMap, BundleInput, Id, IsoTime, PublicDeployment, QuestionPolicy, SellerSealSigner, Sha256 } from '../../src/wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, encodeBase58, payloadHash, signEnvelope } from '../../src/wire/index.ts';
import { FixedClock } from '../../src/common/index.ts';
import { buildManifest, createBundleScanner, createPublisher, createReviewPacket } from '../../src/publish/index.ts';
import type { PublisherApproval, ReviewRow, ScanResult, ScannerEngine } from '../../src/publish/index.ts';
export const at = '2026-10-09T00:00:00.000Z' as IsoTime;
export const id = (s: string): Id => s as Id;
export const h = (s: string): Sha256 => bytesHash(Buffer.from(s));
export const clock = () => new FixedClock(at);
export function temporary(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'aab-publish-test-')); t.after(() => rmSync(dir, { force: true, recursive: true })); return dir;
}
export function fixture(): BundleInput {
  const files = new Map<string, Uint8Array>(); const questions: QuestionPolicy['questions'][number][] = []; const entries: AnswerMap['entries'][number][] = [];
  for (let n = 1; n <= M03.slicePagesMin.value; n++) {
    const pageId = id(`p${n}`); const text = `# Synthetic lesson ${n}\n\nTrigger: A toy task stalls.\nFailure mode: A process exists without finishing.\nFix: Check the toy result.\nEvidence: A synthetic assertion passes.\nLimits: No historical or independent buyer evidence.\n日本語の合成例。\n`;
    files.set(`pages/${pageId}.md`, Buffer.from(text)); const question = `What verifies toy task ${n}?`;
    questions.push({ question_id: id(`q${n}`), text: question, question_sha256: h(question), template_values: {}, topic: 'toy-checks', allowed_origins: ['https://seller.example'], allowed_networks: ['devnet'], approval_sha256: h('synthetic-question-approval') });
    entries.push({ question_id: id(`q${n}`), question_sha256: h(question), support: 'supported', spans: [{ page_id: pageId, byte_start: 0, byte_end: Buffer.byteLength(text) }] });
  }
  const policy: QuestionPolicy = { v: 1, policy_id: id('policy'), approved_at: at, approval_sha256: h('synthetic-question-policy-approval'), questions };
  files.set('question-policy.json', canonicalBytes(policy)); files.set('answer-map.json', canonicalBytes({ v: 1, engine_version: 'extract-v1', entries }));
  return buildManifest({ seller_id: id('seller'), slice_id: id('slice'), created_at: at, gate_version: id('gate2'), approval_id: id('approval'), version: 1, previous_manifest_hash: null }, files);
}
export function worksheet(input: BundleInput): ReviewRow[] {
  return input.manifest.pages.map((p) => ({ page_id: p.page_id, visibility: 'public', origin: 'synthetic', sensitivity: 'none', review_status: 'approved', derived_from: 'founder-private-map', reviewer: id('synthetic-founder'), last_reviewed: at, license: 'CC BY 4.0', right_to_sell: id('synthetic-rights') }));
}
export function approvalFor(input: BundleInput): PublisherApproval {
  return { v: 1, approval: { approval_id: input.manifest.approval_id, payload_sha256: payloadHash(input.manifest), approved_at: at, actor: 'human' }, review_sha256: payloadHash(createReviewPacket(input, worksheet(input))), whole_page_download: true, rights_confirmed: true, origins_unchanged: true, originals_scan_passed: true, lineage_complete: true, withdrawn: false, acknowledged_at: at };
}
/** Protocol simulator only. Never reported as real Gitleaks detection evidence. */
export function fakeEngine(transform?: (bytes: Uint8Array, result: ScanResult) => ScanResult): ScannerEngine {
  return { version: '0.0.0-test', sha256: h('synthetic-scanner'), scan(bytes) {
    const findings: { rule: string; line: number }[] = [];
    new TextDecoder().decode(bytes).split('\n').forEach((line, i) => {
      if (line.includes('api_key =')) findings.push({ rule: 'generic-api-key', line: i + 1 });
      if (line.startsWith('AAB_SCAN_START_')) findings.push({ rule: 'aab-coverage-start', line: i + 1 });
      if (line.startsWith('AAB_SCAN_END_')) findings.push({ rule: 'aab-coverage-end', line: i + 1 });
    });
    const result = { status: findings.length ? 17 : 0, findings }; return transform ? transform(bytes, result) : result;
  } };
}
export function writeProjection(dir: string, input: BundleInput): void {
  mkdirSync(dir, { recursive: true });
  for (const [p, bytes] of input.files) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), bytes); }
}
export function harness(input = fixture()) {
  const pair = generateKeyPairSync('ed25519'); const publicBytes = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const signingKey = { id: id('test-seal'), algorithm: 'Ed25519' as const, public_key: encodeBase58(publicBytes) as Address };
  let bytes: Uint8Array = canonicalBytes(approvalFor(input)); const fixed = clock(); let calls = 0;
  const authority = { approvalBytesSha256: bytesHash(bytes), read: () => Uint8Array.from(bytes) };
  const publisher = createPublisher({ authority, worksheet: worksheet(input), scanner: createBundleScanner(fakeEngine(), fixed), signingKey, clock: fixed, sealActor: 'test' });
  const signer: SellerSealSigner = { async sign(kind, payload, authorization) { calls++; return signEnvelope(kind, payload, signingKey.id, pair.privateKey, authorization); } };
  const address = (n: number): Address => encodeBase58(Uint8Array.from({ length: 32 }, () => n)) as Address;
  const deployment: PublicDeployment = { endpoint: 'https://seller.example', operator_id: id('founder'), listing_kind: 'demo', signing_key: signingKey,
    payment: { rail: 'solana-split-v1', network: 'devnet', genesis_hash: address(8), asset: 'TEST', mint: address(1), decimals: M03.tokenDecimals.value,
      token_program: address(2), total_atomic: String(M03.totalAtomic.value) as PublicDeployment['payment']['total_atomic'], seller_owner: address(3), seller_token_account: address(4), marketplace_owner: address(5), marketplace_token_account: address(6), fee_bps: M03.marketplaceFeeBps.value } };
  return { input, publisher, signer, signingKey, deployment, clock: fixed, calls: () => calls, changeApproval: (newBytes: Uint8Array) => { bytes = newBytes; }, authority };
}
