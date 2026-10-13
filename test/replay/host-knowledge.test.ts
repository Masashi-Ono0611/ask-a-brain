import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Address, Id, SealedBundle, SellerPublicKey } from '../../src/wire/contracts.ts';
import { bytesHash, canonicalBytes, encodeBase58, parseWire, payloadHash, signEnvelope, strictJson } from '../../src/wire/index.ts';
import { createKnowledge, loadSeal } from '../../scripts/replay/host-knowledge.ts';
import { createSupervisor } from '../../scripts/replay/host-supervisor.ts';
import { lessonHashes } from '../../fixtures/eval/approved/knowledge.ts';
import { clock, fixture } from './host-support.ts';
import { privateSkip } from './private-fixtures.ts';
const questions = readFileSync(new URL('./approved-questions.json', import.meta.url));
const skipReason = privateSkip();
const sourceMap = skipReason ? Buffer.alloc(0) : readFileSync(new URL('./approved-answer-map.json', import.meta.url));
function bundle() {
  const key = generateKeyPairSync('ed25519');
  const publicKey: SellerPublicKey = { id: 'ephemeral' as Id, algorithm: 'Ed25519', public_key: encodeBase58(key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)) as Address };
  const source = strictJson(questions) as unknown as { id: string; text: string; sha256_of_utf8_text: string }[];
  const map = strictJson(sourceMap) as unknown as Record<string, { page: string; start_byte: number; end_byte: number }[]>;
  const policy = parseWire('question_policy', canonicalBytes({ v: 1, policy_id: 'policy', approved_at: clock.now(), approval_sha256: bytesHash(questions), questions: source.map((q) => ({
    question_id: q.id, text: q.text, question_sha256: q.sha256_of_utf8_text, topic: 'harness', template_values: { version: '1' }, allowed_origins: ['https://seller.example.invalid'], allowed_networks: ['devnet'], approval_sha256: bytesHash(questions) })) }));
  const files = new Map<string, Uint8Array>();
  for (const lesson of Object.keys(lessonHashes)) files.set(`pages/${lesson}.md`, readFileSync(new URL(`../../fixtures/eval/approved/lessons/${lesson}.md`, import.meta.url)));
  files.set('question-policy.json', canonicalBytes(policy));
  files.set('answer-map.json', canonicalBytes({ v: 1, engine_version: 'extractive-test', entries: source.map((q) => ({ question_id: q.id, question_sha256: q.sha256_of_utf8_text, support: 'supported',
    spans: map[q.id]!.map((s) => ({ page_id: s.page.slice('lessons/'.length, -3), byte_start: s.start_byte, byte_end: s.end_byte })) })) }));
  const manifest = { v: 1 as const, seller_id: 'seller' as Id, slice_id: 'slice' as Id, created_at: clock.now(), gate_version: 'test' as Id, approval_id: 'test-only-attestation' as Id, version: 1, previous_manifest_hash: null,
    policy_sha256: payloadHash(policy), pages: Object.keys(lessonHashes).map((id) => ({ page_id: id as Id, size_bytes: files.get(`pages/${id}.md`)!.length, content_sha256: bytesHash(files.get(`pages/${id}.md`)!) })),
    files: [...files].map(([path, bytes]) => ({ path, size_bytes: bytes.length, sha256: bytesHash(bytes) })).sort((a, b) => a.path.localeCompare(b.path)) };
  const result: SealedBundle = { manifest: signEnvelope('manifest', manifest, publicKey.id, key.privateKey, { kind: 'manifest', payloadHash: payloadHash(manifest), approvalId: manifest.approval_id, actor: 'test' }), files,
    approval: { approval_id: manifest.approval_id, payload_sha256: payloadHash(manifest), approved_at: clock.now(), actor: 'human' },
    scans: { bundle_sha256: payloadHash(manifest.files), scanner_version: 'test-only', scanner_sha256: bytesHash(Buffer.from('test')), scanned_at: clock.now(), passed: true } };
  return { result, publicKey };
}
test('real seller extraction: approved B/C spans identical; hidden resolution never enters either knowledge return', { skip: skipReason }, async () => {
  const { result, publicKey } = bundle();
  const sealedBytes = canonicalBytes({ manifest: result.manifest, approval: result.approval, scans: result.scans });
  const sealed = loadSeal(sealedBytes, result.files, publicKey);
  const knowledge = createKnowledge(sealed, questions, sourceMap, 'https://seller.example.invalid');
  for (const arm of ['B', 'C'] as const) {
    const events: unknown[] = []; const c = createSupervisor({ ...fixture(), arm, clock, knowledge, journal: (e) => events.push(e), exhausted() {} });
    const data = await c.call(canonicalBytes({ tool: arm === 'B' ? 'read_checklist' : 'consult', input: { question_id: 'Q01' } }));
    const text = JSON.stringify(data); assert.equal(text.includes('HIDDEN_RESOLUTION_NEVER_KNOWLEDGE'), false); assert.equal(text.includes('pass_predicates'), false);
    assert.ok(text.includes('Turn each acceptance condition'));
    if (arm === 'C') { assert.ok(text.includes('SIMULATED')); await assert.rejects(c.call(canonicalBytes({ tool: 'consult', input: { question_id: 'Q01' } }))); }
  }
  for (const q of (strictJson(questions) as unknown as { id: Id }[])) {
    const free = knowledge.checklist(q.id) as { pages: { page_id: string; text: string }[]; selection: { spans: { page_id: string; byte_start: number; byte_end: number }[] } };
    const consult = knowledge.consult(q.id) as { claims: { text: string }[]; live_paid: boolean };
    assert.equal(consult.live_paid, false);
    assert.deepEqual(consult.claims.map((c) => c.text), free.selection.spans.map((s) => Buffer.from(free.pages.find((p) => p.page_id === s.page_id)!.text).subarray(s.byte_start, s.byte_end).toString('utf8')));
  }
  assert.throws(() => knowledge.consult('hidden-resolution' as Id), /QUESTION_DENIED/);
  assert.ok(knowledge.consult('Q01' as Id));
});
test('sealed and source mutations fail closed; exact approved source and signature restored pass', { skip: skipReason }, () => {
  const { result, publicKey } = bundle(), origin = 'https://seller.example.invalid';
  const data = { manifest: result.manifest, approval: result.approval, scans: result.scans };
  assert.throws(() => loadSeal(canonicalBytes({ ...data, extra: true }), result.files, publicKey));
  assert.throws(() => loadSeal(canonicalBytes({ ...data, manifest: { ...data.manifest, payload: { ...data.manifest.payload, version: 2 } } }), result.files, publicKey));
  const changed = new Map(result.files); changed.set('pages/L1.md', Buffer.from('HIDDEN_RESOLUTION'));
  assert.throws(() => createKnowledge({ ...result, files: changed }, questions, sourceMap, origin));
  assert.throws(() => createKnowledge(result, Buffer.from('[]'), sourceMap, origin), /SOURCE_APPROVAL/);
  assert.throws(() => createKnowledge(result, questions, Buffer.from('{}'), origin), /SOURCE_APPROVAL/);
  const clean = loadSeal(canonicalBytes(data), result.files, publicKey);
  assert.ok(createKnowledge(clean, questions, sourceMap, origin).checklist('Q01' as Id));
});
