import test from 'node:test';
import assert from 'node:assert/strict';
import type { WireKind } from '../../src/wire/index.ts';
import { M03, canonicalBytes, encodeBase58, parseWire, payloadHash, resolveQuestion, validatePayload, validateWire } from '../../src/wire/index.ts';
import { makeGolden } from './golden-fixture.ts';
const fixture = makeGolden();
const records = { ...fixture.wire,
  quote_disposition: { status: 'ready', quote: fixture.chain.quote },
  answer_disposition: { status: 'ready', answer: fixture.chain.answer },
  payment_view: { payment_state: 'payment_finalized', delivery_state: 'pending', evidence: fixture.chain.settlement },
  eligibility: { slice_id: fixture.chain.quote.payload.slice_id, manifest_sha256: fixture.chain.quote.payload.manifest_sha256, state: 'eligible', generation: 0, acknowledged_at: fixture.chain.quote.payload.issued_at, checked_at: fixture.chain.quote.payload.issued_at },
};
function input(kind: WireKind): unknown { return structuredClone(kind === 'listing' ? fixture.chain.registry.listings[0] : records[kind]); }
function set(value: unknown, path: string, replacement: unknown): void {
  const segments = path.split('.'); let current = value as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) current = current[segment] as Record<string, unknown>;
  current[segments.at(-1)!] = replacement;
}
for (const kind of ['quote_disposition', 'answer_disposition', 'payment_view', 'eligibility', 'registry', 'listing', 'manifest', 'quote', 'arm', 'answer', 'proof', 'receipt', 'outcome', 'question_policy', 'consult_input', 'quote_request', 'arm_request'] as const) {
  test(`${kind}: rejects unknown fields, restores valid record`, () => {
    const clean = input(kind); const bad = input(kind); set(bad, 'unexpected', true);
    assert.throws(() => parseWire(kind, canonicalBytes(bad)));
    assert.deepEqual(parseWire(kind, canonicalBytes(clean)), clean);
  });
}
const cases: [WireKind, string, unknown][] = [
  ['registry', 'v', 2], ['registry', 'listings.0.trust', {}], ['registry', 'listings', [...fixture.chain.registry.listings].reverse()], ['registry', 'listings', [fixture.chain.registry.listings[0], fixture.chain.registry.listings[0]]],
  ['listing', 'status', 'pending'], ['listing', 'listing_kind', 'unknown'], ['listing', 'slice.extra', 1], ['listing', 'payment.extra', 1], ['listing', 'signing_key.extra', 1], ['listing', 'signing_key.algorithm', 'RSA'],
  ['listing', 'endpoint', 'http://public.example.invalid'], ['listing', 'endpoint', 'https://seller.example.invalid/'], ['listing', 'slice.manifest_url', 'https://attacker.example.invalid/v1/slices/synthetic-slice-1/manifest'],
  ['listing', 'payment.fee_bps', M03.marketplaceFeeBps.value + 1], ['listing', 'topics', []], ['listing', 'topics', ['x', 'x']], ['listing', 'signing_key.public_key', fixture.chain.quote.payload.seller_owner],
  ['manifest', 'payload.v', 2], ['manifest', 'payload.unexpected', 1], ['manifest', 'signature.unexpected', 1], ['manifest', 'payload.version', 0], ['manifest', 'payload.version', 2],
  ['manifest', 'payload.pages', fixture.chain.manifest.payload.pages.slice(1)], ['manifest', 'payload.pages', Array.from({ length: M03.slicePagesMax.value + 1 }, () => fixture.chain.manifest.payload.pages[0])],
  ['manifest', 'payload.pages.0.extra', true], ['manifest', 'payload.pages.0.size_bytes', M03.pageMax.value * 1024 + 1], ['manifest', 'payload.pages.0.content_sha256', 'a'.repeat(64)],
  ['manifest', 'payload.files.0.path', '../secret'], ['manifest', 'payload.files.0.path', '/absolute'], ['manifest', 'payload.files.0.path', '.hidden'], ['manifest', 'payload.files.0.path', 'a\\b'], ['manifest', 'payload.files.0.path', 'a/%2e%2e'],
  ['manifest', 'payload.files.0.path', 'manifest.json'], ['manifest', 'payload.files.0.path', 'envelope.json'], ['manifest', 'payload.files.0.size_bytes', M03.sealedPayloadMax.value * 1024 * 1024 + 1], ['manifest', 'payload.policy_sha256', 'a'.repeat(64)], ['manifest', 'payload.files.0.extra', 1],
  ['quote', 'payload.v', 2], ['quote', 'payload.total_atomic', '010000'], ['quote', 'payload.seller_atomic', String(M03.sellerAtomic.value + 1n)], ['quote', 'payload.fee_atomic', String(M03.marketplaceAtomic.value + 1n)],
  ['quote', 'payload.total_atomic', String(M03.totalAtomic.value + 1n)], ['quote', 'payload.asset', 'USDC'], ['quote', 'payload.decimals', M03.tokenDecimals.value + 1], ['quote', 'payload.rail', 'native-sol'],
  ['quote', 'payload.payer', fixture.chain.quote.payload.seller_owner], ['quote', 'payload.marketplace_owner', fixture.chain.quote.payload.seller_owner], ['quote', 'payload.seller_token_account', fixture.chain.quote.payload.marketplace_token_account],
  ['quote', 'payload.memo', 'wrong'], ['quote', 'payload.nonce', 'short'], ['quote', 'payload.expires_at', '2026-10-09T00:05:01Z'], ['quote', 'payload.issued_at', '2026-02-30T00:00:00Z'],
  ['quote', 'payload.question_sha256', 'A'.repeat(64)], ['quote', 'payload.request_id', 'invalid'], ['quote', 'payload.payer', '111'], ['quote', 'payload.delivery', 'after-confirmed'], ['quote', 'payload.refund_terms', 'other'],
  ['arm', 'payload.v', 2], ['arm', 'payload.last_valid_block_height', -1], ['arm', 'payload.last_valid_block_height', Number.MAX_SAFE_INTEGER + 1], ['arm', 'payload.message_base64', 'eA=='],
  ['answer', 'payload.v', 2], ['answer', 'payload.abstain', true], ['answer', 'payload.commitment_salt', 'too-short'], ['answer', 'payload.answer', 'Uncited generated assertion'],
  ['answer', 'payload.claims.0.extra', 1], ['answer', 'payload.claims.0.text', 'uncited'], ['answer', 'payload.claims.0.citation_ids', ['unknown']], ['answer', 'payload.claims.0.citation_ids', ['c1', 'c1']], ['answer', 'payload.claims', []],
  ['answer', 'payload.citations', []], ['answer', 'payload.citations.0.extra', 1], ['answer', 'payload.citations.0.byte_start', -1], ['answer', 'payload.citations.0.byte_end', 0], ['answer', 'payload.citations.0.byte_end', M03.citedPageMax.value * 1024 + 1],
  ['answer', 'payload.citations.0.source_url', 'file:///tmp/a'], ['answer', 'payload.citations.0.source_url', 'https://example.invalid/a/../b'], ['answer', 'payload.citations.0.source_url', 'https://user:secret@example.invalid/a'], ['answer', 'payload.citations.0.source_url', 'https://example.invalid/a#x'],
  ['proof', 'v', 2], ['proof', 'transaction_signature', '111'], ['proof', 'network', 'testnet'],
  ['receipt', 'v', 2], ['receipt', 'settlement.extra', 1], ['receipt', 'settlement.commitment', 'confirmed'], ['receipt', 'settlement.meta_err', {}], ['receipt', 'settlement.seller_credit', '1'],
  ['receipt', 'settlement.signature', encodeBase58(Buffer.alloc(64, 2))], ['receipt', 'settlement.quote_id', 'other'], ['receipt', 'settlement.slot', 101], ['receipt', 'settlement.actual_fee', '1'], ['receipt', 'settlement', null],
  ['receipt', 'refund.extra', 1], ['receipt', 'verified.extra', 1], ['receipt', 'latency_ms.extra', 1], ['receipt', 'gbrain.extra', 1], ['receipt', 'dispositions.0.extra', 1],
  ['receipt', 'dispositions.0.quote_id', null], ['receipt', 'dispositions.1.seller_id', 'synthetic-a'], ['receipt', 'dispositions', Array.from({ length: M03.checksPerConsultMax.value + 1 }, () => fixture.chain.receipt.dispositions[0])],
  ['receipt', 'verified.chain', false], ['receipt', 'verified.source_hashes', false], ['receipt', 'network', 'mainnet-beta'], ['receipt', 'total_atomic', '1'], ['receipt', 'refund_state', 'refunded'], ['receipt', 'refund.returned_atomic', '1'], ['receipt', 'gbrain.page_id', 'unexpected'],
  ['receipt', 'payment_state', 'payment_pending'], ['receipt', 'import_state', 'metadata_only'], ['receipt', 'latency_ms.precheck', 0.5],
  ['outcome', 'v', 2], ['outcome', 'eligible_for_trust', true], ['outcome', 'exclusion_reason', null], ['outcome', 'source', 'unknown'], ['outcome', 'corrects', 'synthetic-feedback-1'],
  ['question_policy', 'v', 2], ['question_policy', 'questions.0.extra', 1], ['question_policy', 'questions.0.question_sha256', 'a'.repeat(64)], ['question_policy', 'questions', [fixture.chain.questionPolicy.questions[0], fixture.chain.questionPolicy.questions[0]]], ['question_policy', 'questions.0.allowed_origins', []],
  ['consult_input', 'question', 'raw question'], ['consult_input', 'max_price.extra', 1], ['consult_input', 'request_id', '00000000-0000-0000-0000-000000000000'], ['consult_input', 'template_values', { constructor: 'bad' }],
  ['quote_request', 'v', 2], ['quote_request', 'request_nonce', 'short'], ['quote_request', 'question', ''], ['arm_request', 'message_base64', 'not base64'], ['arm_request', 'message_sha256', 'a'.repeat(64)],
];
for (const [kind, path, replacement] of cases) test(`${kind}: reject ${path} = ${JSON.stringify(replacement).slice(0, 50)}; clean counterpart passes`, () => {
  const bad = input(kind); set(bad, path, replacement);
  assert.throws(() => parseWire(kind, canonicalBytes(bad)));
  assert.doesNotThrow(() => parseWire(kind, canonicalBytes(input(kind))));
});
test('canonical amounts admit u64 endpoints; reject floats, signs, zero padding and overflow', () => {
  for (const good of ['0', '1', String((1n << 64n) - 1n)]) assert.doesNotThrow(() => validateWire('quote_request', { ...fixture.wire.quote_request, max_total_atomic: good }));
  for (const bad of [1, 1.5, '-1', '+1', '00', '01', '1.0', '1e3', '', ' 1', String(1n << 64n)]) {
    assert.throws(() => validateWire('quote_request', { ...fixture.wire.quote_request, max_total_atomic: bad }));
    assert.doesNotThrow(() => validateWire('quote_request', fixture.wire.quote_request));
  }
});
test('question UTF-8 and scalar cap bad/control pairs at their exact boundaries', () => {
  const check = (question: string) => validateWire('quote_request', { ...fixture.wire.quote_request, question });
  assert.doesNotThrow(() => check('a'.repeat(M03.questionScalarsMax.value)));
  assert.throws(() => check('a'.repeat(M03.questionScalarsMax.value + 1)));
  const capped = '日'.repeat(Math.floor(M03.questionBytesMax.value * 1024 / 3)) + 'a';
  assert.equal(Buffer.byteLength(capped), M03.questionBytesMax.value * 1024);
  assert.doesNotThrow(() => check(capped)); assert.throws(() => check(capped + 'a')); assert.doesNotThrow(() => check(capped));
});
test('raw body and envelope size checked before parse, with exact-limit positive controls', () => {
  for (const [kind, cap] of [['quote_request', M03.ingressBodyMax.value * 1024], ['answer', M03.signedEnvelopeMax.value * 1024]] as const) {
    const raw = Buffer.from(canonicalBytes(input(kind))); const atLimit = Buffer.concat([raw, Buffer.alloc(cap - raw.length, 32)]);
    assert.doesNotThrow(() => parseWire(kind, atLimit)); assert.throws(() => parseWire(kind, Buffer.concat([atLimit, Buffer.from(' ')])), /LIMIT/); assert.doesNotThrow(() => parseWire(kind, atLimit));
  }
});
test('registry requires exact JCS; suspended/empty snapshots remain parseable for delisting', () => {
  assert.throws(() => parseWire('registry', Buffer.from(JSON.stringify(fixture.chain.registry, null, 2))), /REGISTRY_NOT_JCS/);
  assert.doesNotThrow(() => parseWire('registry', canonicalBytes(fixture.chain.registry)));
  assert.doesNotThrow(() => parseWire('registry', canonicalBytes({ ...fixture.chain.registry, listings: [] })));
  assert.doesNotThrow(() => validateWire('listing', { ...fixture.chain.registry.listings[0], status: 'suspended' }));
});
test('finite question resolution rejects arbitrary/extra slots and network; reordered approved expansion passes', () => {
  const policy = fixture.chain.questionPolicy; const input = fixture.wire.consult_input;
  assert.equal(resolveQuestion(policy, input).text, fixture.chain.receipt.question);
  for (const bad of [{ ...input, question_id: 'unknown' }, { ...input, template_values: { free: 'arbitrary' } }, { ...input, max_price: { ...input.max_price, network: 'mainnet-beta' } }]) {
    assert.throws(() => resolveQuestion(policy, bad as typeof input), /QUESTION_NOT_APPROVED/); assert.equal(resolveQuestion(policy, input).text, fixture.chain.receipt.question);
  }
  const templated = validateWire('question_policy', { ...policy, questions: [{ ...policy.questions[0], template_values: { first: 'a', second: 'b' } }] });
  assert.equal(resolveQuestion(templated, { ...input, template_values: { second: 'b', first: 'a' } }).text, fixture.chain.receipt.question);
});
test('manifest version history, sorted inventory and sealed payload total cap pairs', () => {
  const m = fixture.chain.manifest.payload;
  assert.doesNotThrow(() => validatePayload('manifest', { ...m, version: 2, previous_manifest_hash: payloadHash(m) }));
  assert.throws(() => validatePayload('manifest', { ...m, version: 1, previous_manifest_hash: payloadHash(m) }));
  assert.doesNotThrow(() => validatePayload('manifest', m));
  for (const files of [[...m.files].reverse(), [...m.files, m.files.at(-1)]]) {
    assert.throws(() => validatePayload('manifest', { ...m, files })); assert.doesNotThrow(() => validatePayload('manifest', m));
  }
  const occupied = m.files.reduce((n, f) => n + f.size_bytes, 0);
  const filler = { path: 'zz-padding.txt', size_bytes: M03.sealedPayloadMax.value * 1024 * 1024 - occupied, sha256: 'a'.repeat(64) };
  assert.doesNotThrow(() => validatePayload('manifest', { ...m, files: [...m.files, filler] }));
  assert.throws(() => validatePayload('manifest', { ...m, files: [...m.files, { ...filler, size_bytes: filler.size_bytes + 1 }] }));
});
test('declined receipt records zero and not_applicable; pending and refunded states preserve evidence', () => {
  const clean = { ...fixture.chain.receipt, seller_id: null, quote_id: null, quote_sha256: null, answer_sha256: null, manifest_sha256: null, arm_ticket_sha256: null, transaction_signature: null, finalized_slot: null, explorer_url: null, settlement: null, total_atomic: '0', seller_atomic: '0', fee_atomic: '0', network_fee_lamports: '0', verified: { chain: 'not_applicable', seller_signature: 'not_applicable', answer_commitment: 'not_applicable', source_hashes: 'not_applicable' }, payment_state: 'not_applicable', delivery_state: 'not_applicable', dispositions: [{ seller_id: 'synthetic-b', status: 'declined', quote_id: null, code: null }], artifact_refs: {} };
  for (const patch of [{ total_atomic: '1' }, { total_atomic: null }, { quote_id: 'bad' }, { verified: { ...clean.verified, chain: true } }]) {
    assert.throws(() => validateWire('receipt', { ...clean, ...patch })); assert.doesNotThrow(() => validateWire('receipt', clean));
  }
  const refunded = { ...fixture.chain.receipt, refund_state: 'refunded', refund: { status: 'refunded', returned_atomic: fixture.chain.quote.payload.total_atomic, transactions: [fixture.chain.proof.transaction_signature] } };
  assert.doesNotThrow(() => validateWire('receipt', refunded));
  assert.throws(() => validateWire('receipt', { ...refunded, refund: { ...refunded.refund, returned_atomic: '1' } }));
  const partial = { ...refunded, refund_state: 'partial_refund', refund: { ...refunded.refund, status: 'partial_refund', returned_atomic: '1' } };
  assert.doesNotThrow(() => validateWire('receipt', partial));
  assert.throws(() => validateWire('receipt', { ...partial, refund: { ...partial.refund, returned_atomic: '0' } }));
});

test('unknown kinds and prototype record keys reject; known kind and ordinary record keys pass', () => {
  assert.throws(() => parseWire('unknown' as WireKind, Buffer.from('{}')), /UNKNOWN_WIRE_KIND/);
  assert.throws(() => validatePayload('unknown' as 'answer', {}), /UNKNOWN_SIGNED_KIND/);
  assert.doesNotThrow(() => parseWire('answer', canonicalBytes(fixture.chain.answer)));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const values = JSON.parse(`{"${key}":"x"}`) as unknown;
    assert.throws(() => validateWire('consult_input', { ...fixture.wire.consult_input, template_values: values }));
    assert.doesNotThrow(() => validateWire('consult_input', { ...fixture.wire.consult_input, template_values: { slot: 'x' } }));
    const refs = JSON.parse(`{"${key}":"${'a'.repeat(64)}"}`) as unknown;
    assert.throws(() => validateWire('receipt', { ...fixture.chain.receipt, artifact_refs: refs }));
    assert.doesNotThrow(() => validateWire('receipt', fixture.chain.receipt));
  }
});
test('URL syntax admits exact loopback origins but rejects non-loopback HTTP and URL tricks', () => {
  const listing = fixture.chain.registry.listings[0]!;
  for (const endpoint of ['http://127.0.0.1:8080', 'http://[::1]:8080', 'http://localhost:8080']) {
    assert.doesNotThrow(() => validateWire('listing', { ...listing, endpoint, slice: { ...listing.slice, manifest_url: `${endpoint}/v1/slices/${listing.slice.id}/manifest` } }));
  }
  for (const endpoint of ['http://192.168.0.1', 'http://example.invalid', 'https://user@example.invalid', 'https://example.invalid/path', 'https://EXAMPLE.invalid', 'https://127.1', 'https://example.invalid?x=1']) {
    assert.throws(() => validateWire('listing', { ...listing, endpoint })); assert.doesNotThrow(() => validateWire('listing', listing));
  }
});
test('genesis identifiers retain RPC shortened base58 shape; keys still require full 32 bytes', () => {
  const q = fixture.chain.quote;
  for (const genesis_hash of ['EtWTRABZaYq6iMfeYKouRu166VU2xqa1', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']) {
    assert.doesNotThrow(() => validateWire('quote', { ...q, payload: { ...q.payload, genesis_hash } }));
    assert.throws(() => validateWire('quote', { ...q, payload: { ...q.payload, payer: genesis_hash } }));
  }
  for (const genesis_hash of ['1', '0'.repeat(32), '1'.repeat(45)]) {
    assert.throws(() => validateWire('quote', { ...q, payload: { ...q.payload, genesis_hash } })); assert.doesNotThrow(() => validateWire('quote', q));
  }
});

test('numeric wire tokens cannot round a fractional/overflow version into an admitted integer', () => {
  const original = Buffer.from(canonicalBytes(fixture.wire.quote_request)).toString();
  for (const token of ['1.00000000000000001', '1.0', '1e0', '-0', '9007199254740993']) {
    assert.throws(() => parseWire('quote_request', Buffer.from(original.replace('"v":1', `"v":${token}`))), /INVALID_INTEGER_TOKEN/);
    assert.doesNotThrow(() => parseWire('quote_request', Buffer.from(original)));
  }
});
