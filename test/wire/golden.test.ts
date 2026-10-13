import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { M03, bytesHash, canonicalBytes, parsePinnedRegistry, parseWire, payloadHash, settlementSchema, strictJson, verifyArtifactChain } from '../../src/wire/index.ts';
import type { CanonicalBytes, ParseWire, PayloadHash, PreparationConfig, ResolveQuestion, SealedBundle, VerifyCitations, VerifyEnvelope, WireKind } from '../../src/wire/index.ts';
import { resolveQuestion, verifyCitations, verifyEnvelope } from '../../src/wire/index.ts';
import { parseAnswerMap } from '../../src/common/index.ts';
import { prepareAnswer, validatePublicBundle } from '../../src/seller/index.ts';
import { goldenOutputs, makeGolden, readGolden } from './golden-fixture.ts';
const directory = new URL('../../fixtures/wire/', import.meta.url);
// Compile-time downstream callable compatibility, including frozen generic ports.
const ports: [CanonicalBytes, PayloadHash, ParseWire, ResolveQuestion, VerifyCitations, VerifyEnvelope] = [canonicalBytes, payloadHash, parseWire, resolveQuestion, verifyCitations, verifyEnvelope];
void ports;
test('public golden exact files and every wire parser round trip; publisher/seller/buyer use the same bytes', () => {
  const sums = strictJson(readFileSync(new URL('SHA256SUMS.json', directory))) as Record<string, string>;
  const actual = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => relative(fileURLToPath(directory), join(entry.parentPath, entry.name))).filter((path) => path !== 'SHA256SUMS.json');
  assert.deepEqual(actual.sort(), Object.keys(sums).sort(), 'no stale or unlisted public fixture files');
  for (const [path, expected] of Object.entries(sums)) assert.equal(bytesHash(readFileSync(new URL(path, directory))), expected, path);
  const kinds: WireKind[] = ['registry', 'manifest', 'quote', 'arm', 'answer', 'proof', 'receipt', 'question_policy', 'consult_input', 'quote_request', 'arm_request', 'outcome'];
  for (const kind of kinds) {
    const raw = readFileSync(new URL(`${kind}.json`, directory));
    assert.deepEqual(Buffer.from(canonicalBytes(parseWire(kind, raw))), raw, kind);
  }
  const chain = readGolden(); verifyArtifactChain(chain);
  assert.deepEqual(settlementSchema.parse(strictJson(readFileSync(new URL('settlement.json', directory)))), chain.settlement);
  assert.deepEqual(parseWire('listing', canonicalBytes(chain.registry.listings[0])), chain.registry.listings[0]);
  // Publisher inventory check: every listed public file is present and exact.
  for (const file of chain.manifest.payload.files) {
    const raw = readFileSync(new URL(`bundle/${file.path}`, directory));
    assert.equal(raw.length, file.size_bytes); assert.equal(bytesHash(raw), file.sha256);
  }
  // Seller precommit and buyer reveal agree; salt appears only in the answer envelope.
  assert.equal(payloadHash(chain.answer.payload), chain.quote.payload.answer_sha256);
  for (const kind of ['registry', 'quote', 'arm', 'proof'] as const) assert.equal(JSON.stringify(chain[kind]).includes(chain.answer.payload.commitment_salt), false);
  const registry = readFileSync(new URL('registry.json', directory));
  assert.deepEqual(parsePinnedRegistry(registry, chain.registryHash), chain.registry);
  const mutated = structuredClone(chain.registry); (mutated.listings[0] as { display_name: string }).display_name += '!';
  assert.throws(() => parsePinnedRegistry(canonicalBytes(mutated), chain.registryHash), /REGISTRY_PIN_MISMATCH/);
  assert.deepEqual(parsePinnedRegistry(registry, chain.registryHash), chain.registry);
});

test('golden bundle uses frozen entries and opaque pages; common and seller admit the same bytes', () => {
  const chain = readGolden();
  const files = new Map(chain.manifest.payload.files.map((file) => [file.path, readFileSync(new URL(`bundle/${file.path}`, directory))]));
  const map = parseAnswerMap(files.get('answer-map.json')!);
  assert.equal(map.engine_version, chain.answer.payload.engine_version);
  assert.equal(map.entries[0]?.question_sha256, chain.answer.payload.question_sha256);
  assert.deepEqual(map.entries[0]?.spans, chain.answer.payload.citations.map(({ page_id, byte_start, byte_end }) => ({ page_id, byte_start, byte_end })));
  for (const page of chain.manifest.payload.pages) {
    assert.match(page.page_id, /^[A-Za-z0-9_-]+$/);
    assert.ok(files.has(`pages/${page.page_id}.md`));
  }
  // Synthetic approval/scanner records satisfy the pure structural checker only;
  // they do not claim an actual human approval or scanner execution.
  const bundle: SealedBundle = { manifest: chain.manifest, files,
    approval: { approval_id: chain.manifest.payload.approval_id, payload_sha256: payloadHash(chain.manifest.payload), approved_at: chain.manifest.payload.created_at, actor: 'human' },
    scans: { bundle_sha256: payloadHash(chain.manifest.payload.files), scanner_version: 'synthetic-not-executed', scanner_sha256: bytesHash(Buffer.from('synthetic scanner')), scanned_at: chain.manifest.payload.created_at, passed: true } };
  const config: PreparationConfig = { origin: chain.registry.listings[0]!.endpoint, limits: M03,
    wire: { parse: parseWire, canonical: canonicalBytes, hash: payloadHash, verify: verifyEnvelope, citations: verifyCitations, json: strictJson } };
  const clean = (): void => {
    validatePublicBundle(bundle, config);
    const { quote_id, buyer_id, created_at, commitment_salt } = chain.answer.payload;
    const prepared = prepareAnswer(bundle, chain.questionPolicy.questions[0]!, { quote_id, buyer_id, created_at, commitment_salt }, config);
    assert.ok('answer' in prepared);
    // Compare structured extraction. Seller's current plain-text renderer remains
    // a separate integration issue; do not rewrite or bless its final wire output.
    assert.deepEqual(prepared.answer.citations, chain.answer.payload.citations);
    assert.deepEqual(prepared.answer.claims, chain.answer.payload.claims);
    assert.equal(prepared.answer.engine_version, chain.answer.payload.engine_version);
  };
  clean();
  const badFiles = new Map(files); badFiles.set('answer-map.json', Buffer.from('{}'));
  assert.throws(() => validatePublicBundle({ ...bundle, files: badFiles }, config), /NOT_READY/); clean();
  const missing = new Map(files); missing.delete(`pages/${chain.manifest.payload.pages[0]!.page_id}.md`);
  assert.throws(() => validatePublicBundle({ ...bundle, files: missing }, config), /NOT_READY/); clean();
  assert.throws(() => parseAnswerMap(canonicalBytes({ v: 1, synthetic: true, questions: [] })), /INVALID_INPUT/); clean();
});

test('golden regeneration is deterministic for fixed inputs and one ephemeral key', () => {
  const privateKey = generateKeyPairSync('ed25519').privateKey;
  const first = goldenOutputs(makeGolden(privateKey));
  const hashes = (files: ReadonlyMap<string, Uint8Array>) => Object.fromEntries([...files].map(([name, bytes]) => [name, bytesHash(bytes)]));
  const second = goldenOutputs(makeGolden(privateKey));
  assert.deepEqual(second, first);
  assert.deepEqual(hashes(second), hashes(first));
  const rotated = goldenOutputs(makeGolden());
  assert.notDeepEqual(rotated.get('registry.json'), first.get('registry.json'));
  for (const kind of ['manifest', 'quote', 'arm', 'answer'] as const) {
    const original = parseWire(kind, first.get(`${kind}.json`)!);
    const changedKey = parseWire(kind, rotated.get(`${kind}.json`)!);
    assert.notEqual(original.signature.value, changedKey.signature.value);
  }
  assert.deepEqual(goldenOutputs(makeGolden(privateKey)), first);
});
