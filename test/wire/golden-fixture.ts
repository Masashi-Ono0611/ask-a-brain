/** Synthetic format-only chain. Private KeyObjects exist only for this process.
 * Explicit regeneration: node test/wire/golden-fixture.ts --write-public-fixture
 * Fixed inputs and one in-memory key reproduce identical signatures/file hashes.
 * A new process rotates the discarded key; no deterministic secret seed is stored.
 */
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AnswerMap, ArtifactChain, Id, Manifest, SignedKind, WireKind } from '../../src/wire/index.ts';
import { M03, bytesHash, canonicalBytes, encodeBase58, parseWire, payloadHash, renderAnswer, signEnvelope, validatePayload, validateWire, verifyArtifactChain } from '../../src/wire/index.ts';
const directory = new URL('../../fixtures/wire/', import.meta.url);
const at = '2026-10-09T00:00:00Z';
const id = (s: string): Id => s as Id;
const hash = (s: string) => bytesHash(Buffer.from(s));
const publicAddress = (label: string) => encodeBase58(Buffer.from(hash(`SYNTHETIC PUBLIC IDENTIFIER: ${label}`), 'hex'));
const names = ['registry', 'manifest', 'quote', 'arm', 'answer', 'proof', 'receipt', 'question_policy', 'consult_input', 'quote_request', 'arm_request', 'outcome'] as const;

export function makeGolden(privateKey: KeyObject = generateKeyPairSync('ed25519').privateKey) {
  const publicKey = createPublicKey(privateKey);
  const key = { id: id('synthetic-seal-1'), algorithm: 'Ed25519' as const, public_key: publicAddress('unused') };
  key.public_key = encodeBase58(Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url'));
  function seal<K extends SignedKind>(kind: K, input: unknown) {
    const payload = validatePayload(kind, input);
    return signEnvelope(kind, payload, key.id, privateKey, { kind, payloadHash: payloadHash(payload), approvalId: kind === 'manifest' ? (payload as Manifest).approval_id : id('synthetic-approval'), actor: 'test' });
  }
  const pageText = '架空の公開教材です。\n完了を報告する前に、残件を確認する。🧠\nこれは実験用の例であり、実際の事故記録ではありません。\n';
  const pages = new Map<Id, Uint8Array>();
  for (let n = 1; n <= M03.slicePagesMin.value; n++) pages.set(id(`p${String(n).padStart(3, '0')}`), Buffer.from(`${pageText}教材 ${n}\n`));
  const questionText = '完了を報告する前に何を確認しますか？';
  const questionPolicy = validateWire('question_policy', { v: 1, policy_id: 'synthetic-policy-1', approved_at: at, approval_sha256: hash('synthetic approval only'), questions: [{ question_id: 'completion-check', text: questionText, question_sha256: hash(questionText), template_values: {}, topic: 'completion', allowed_origins: ['https://seller.example.invalid'], allowed_networks: ['devnet'], approval_sha256: hash('synthetic question approval only') }] });
  const excerpt = '完了を報告する前に、残件を確認する。🧠';
  const start = Buffer.byteLength('架空の公開教材です。\n');
  const citation = { id: 'c1', page_id: id('p001'), content_sha256: bytesHash(pages.get(id('p001'))!), byte_start: start, byte_end: start + Buffer.byteLength(excerpt), excerpt, source_url: 'https://seller.example.invalid/v1/slices/synthetic-slice-1/pages/p001' };
  const answerMap = { v: 1, engine_version: id('synthetic-extractive-map-1'), entries: [{ question_id: questionPolicy.questions[0]!.question_id, question_sha256: hash(questionText), support: 'supported', spans: [{ page_id: citation.page_id, byte_start: citation.byte_start, byte_end: citation.byte_end }] }] } satisfies AnswerMap;
  const files = new Map<string, Uint8Array>([...pages].map(([pageId, bytes]) => [`pages/${pageId}.md`, bytes]));
  files.set('question-policy.json', canonicalBytes(questionPolicy)); files.set('answer-map.json', canonicalBytes(answerMap));
  const manifest = seal('manifest', { v: 1, seller_id: 'synthetic-a', slice_id: 'synthetic-slice-1', created_at: at, gate_version: 'synthetic-gate-1', approval_id: 'synthetic-approval', version: 1, previous_manifest_hash: null, policy_sha256: payloadHash(questionPolicy), pages: [...pages].map(([page_id, bytes]) => ({ page_id, content_sha256: bytesHash(bytes), size_bytes: bytes.length })), files: [...files].map(([path, bytes]) => ({ path, size_bytes: bytes.length, sha256: bytesHash(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1) });
  const payment = { rail: 'solana-split-v1', network: 'devnet', genesis_hash: publicAddress('synthetic genesis'), asset: 'TEST', mint: publicAddress('synthetic mint'), decimals: M03.tokenDecimals.value, token_program: publicAddress('synthetic token program'), total_atomic: String(M03.totalAtomic.value), seller_owner: publicAddress('seller'), seller_token_account: publicAddress('seller account'), marketplace_owner: publicAddress('marketplace'), marketplace_token_account: publicAddress('marketplace account') };
  const listing = { seller_id: 'synthetic-a', display_name: 'Synthetic public format fixture — no live payment', operator_id: 'synthetic-operator', listing_kind: 'demo', status: 'active', endpoint: 'https://seller.example.invalid', topics: ['completion'], signing_key: key, slice: { id: 'synthetic-slice-1', manifest_sha256: payloadHash(manifest.payload), manifest_url: 'https://seller.example.invalid/v1/slices/synthetic-slice-1/manifest', approved_at: at }, payment: { ...payment, fee_bps: M03.marketplaceFeeBps.value } };
  const registry = validateWire('registry', { v: 1, registry_version: 'synthetic-registry-1', listings: [listing, { ...listing, seller_id: 'synthetic-b', display_name: 'Synthetic free-decline fixture', endpoint: 'https://decline.example.invalid', signing_key: { ...key, id: 'synthetic-seal-2', public_key: publicAddress('second seal public identifier') }, slice: { ...listing.slice, id: 'synthetic-slice-2', manifest_sha256: hash('separate unavailable synthetic slice'), manifest_url: 'https://decline.example.invalid/v1/slices/synthetic-slice-2/manifest' } }] });
  const requestId = '00000000-0000-4000-8000-000000000001';
  const claims = [{ text: excerpt, citation_ids: [id('c1')] }];
  const answer = seal('answer', { v: 1, quote_id: 'synthetic-quote-1', seller_id: listing.seller_id, buyer_id: 'synthetic-buyer', question_sha256: hash(questionText), slice_id: manifest.payload.slice_id, manifest_sha256: payloadHash(manifest.payload), commitment_salt: Buffer.from('public-salt-0001').toString('base64url'), created_at: at, answer: renderAnswer(claims), claims, citations: [citation], abstain: false, engine_version: answerMap.engine_version });
  const nonce = Buffer.from('public-nonce-001').toString('base64url');
  const quote = seal('quote', { v: 1, ...payment, quote_id: answer.payload.quote_id, nonce, request_id: requestId, buyer_id: answer.payload.buyer_id, payer: publicAddress('payer'), seller_id: listing.seller_id, registry_version: registry.registry_version, question_sha256: answer.payload.question_sha256, slice_id: manifest.payload.slice_id, manifest_sha256: payloadHash(manifest.payload), answer_sha256: payloadHash(answer.payload), issued_at: at, expires_at: new Date(Date.parse(at) + M03.quoteTtl.value * 1000).toISOString(), seller_atomic: String(M03.sellerAtomic.value), fee_atomic: String(M03.marketplaceAtomic.value), memo: `aab:v1:${answer.payload.quote_id}:${nonce}`, delivery: 'immutable-answer-after-finalized', refund_terms: 'aab-prototype-refund-v1' });
  const message = Buffer.from('FORMAT FIXTURE ONLY: not a Solana transaction');
  const armRequest = validateWire('arm_request', { quote_id: quote.payload.quote_id, message_base64: message.toString('base64'), message_sha256: bytesHash(message), recent_blockhash: publicAddress('blockhash'), last_valid_block_height: 100 });
  const { message_base64: _message, ...armFields } = armRequest;
  const arm = seal('arm', { v: 1, ...armFields, buyer_id: answer.payload.buyer_id, quote_sha256: payloadHash(quote.payload), armed_at: at });
  const transactionSignature = encodeBase58(Buffer.alloc(64, 1)); // Public synthetic locator, never signed or broadcast.
  const proof = validateWire('proof', { v: 1, consult_id: 'synthetic-consult-1', quote_id: quote.payload.quote_id, quote_sha256: payloadHash(quote.payload), arm_ticket_sha256: payloadHash(arm.payload), network: quote.payload.network, genesis_hash: quote.payload.genesis_hash, transaction_signature: transactionSignature, message_sha256: arm.payload.message_sha256 });
  const settlement = { genesis: quote.payload.genesis_hash, signature: proof.transaction_signature, quote_id: quote.payload.quote_id, message_sha256: arm.payload.message_sha256, slot: 100, observed_at: quote.payload.issued_at, commitment: 'finalized' as const, meta_err: null, actual_fee: '5000' as import('../../src/wire/contracts.ts').Lamports, payer_debit: quote.payload.total_atomic, seller_credit: quote.payload.seller_atomic, marketplace_credit: quote.payload.fee_atomic, transaction_sha256: hash('SYNTHETIC evidence: no actual chain transaction') };
  const consultInput = validateWire('consult_input', { request_id: requestId, question_id: 'completion-check', max_price: { network: 'devnet', asset_id: quote.payload.mint, amount_atomic: quote.payload.total_atomic } });
  const quoteRequest = validateWire('quote_request', { v: 1, request_id: requestId, request_nonce: nonce, buyer_id: quote.payload.buyer_id, payer: quote.payload.payer, seller_id: quote.payload.seller_id, registry_version: registry.registry_version, slice_id: quote.payload.slice_id, network: 'devnet', question: questionText, max_total_atomic: quote.payload.total_atomic });
  const artifacts = { registry, manifest, quote, arm, answer, proof, settlement, question_policy: questionPolicy };
  const receipt = validateWire('receipt', { v: 1, approval_ref: null, receipt_id: proof.consult_id, request_id: requestId, buyer_id: quote.payload.buyer_id, seller_id: quote.payload.seller_id, classification: 'technical_verification', question: questionText, question_policy_sha256: payloadHash(questionPolicy), quote_id: quote.payload.quote_id, quote_sha256: payloadHash(quote.payload), answer_sha256: payloadHash(answer.payload), registry_sha256: payloadHash(registry), manifest_sha256: payloadHash(manifest.payload), arm_ticket_sha256: payloadHash(arm.payload), dispositions: [{ seller_id: 'synthetic-a', status: 'ready', quote_id: quote.payload.quote_id, code: null }, { seller_id: 'synthetic-b', status: 'declined', quote_id: null, code: null }], network: 'devnet', asset: 'TEST', total_atomic: quote.payload.total_atomic, seller_atomic: quote.payload.seller_atomic, fee_atomic: quote.payload.fee_atomic, network_fee_lamports: settlement.actual_fee, transaction_signature: transactionSignature, finalized_slot: settlement.slot, explorer_url: null, settlement, verified: { chain: true, seller_signature: true, answer_commitment: true, source_hashes: true }, artifact_refs: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, payloadHash(artifact)])), refund: { status: 'none', returned_atomic: '0', transactions: [] }, latency_ms: { precheck: null, finality: null, delivery: null }, gbrain: { page_id: null, sync_state: 'import_pending' }, payment_state: 'payment_finalized', content_state: 'eligible', delivery_state: 'delivered', refund_state: 'none', import_state: 'import_pending', feedback_state: 'none' });
  const outcome = validateWire('outcome', { v: 1, feedback_id: 'synthetic-feedback-1', consult_id: proof.consult_id, quote_id: quote.payload.quote_id, answer_sha256: payloadHash(answer.payload), buyer_id: quote.payload.buyer_id, seller_id: quote.payload.seller_id, source: 'agent', useful: true, reason_code: 'prevented_missed_check', transaction_signature: transactionSignature, classification: 'technical_verification', eligible_for_trust: false, exclusion_reason: 'synthetic_fixture', recorded_at: at, corrects: null });
  const wire = { ...artifacts, receipt, consult_input: consultInput, quote_request: quoteRequest, arm_request: armRequest, outcome };
  const chain: ArtifactChain = { ...artifacts, registryHash: payloadHash(registry), receipt, questionPolicy, pages };
  verifyArtifactChain(chain);
  return { chain, wire, files, seal };
}
export function readGolden(): ArtifactChain {
  const read = <K extends WireKind>(kind: K) => parseWire(kind, readFileSync(new URL(`${kind}.json`, directory)));
  const manifest = read('manifest');
  const pages = new Map(manifest.payload.pages.map((p) => [p.page_id, readFileSync(new URL(`bundle/pages/${p.page_id}.md`, directory))]));
  const registry = read('registry');
  return { registry, registryHash: payloadHash(registry), manifest, quote: read('quote'), arm: read('arm'), answer: read('answer'), proof: read('proof'), settlement: read('receipt').settlement!, receipt: read('receipt'), questionPolicy: read('question_policy'), pages };
}
export function goldenOutputs(fixture: ReturnType<typeof makeGolden>) {
  const outputs = new Map<string, Uint8Array>();
  for (const name of names) outputs.set(`${name}.json`, canonicalBytes(fixture.wire[name]));
  outputs.set('settlement.json', canonicalBytes(fixture.chain.settlement));
  for (const [path, bytes] of fixture.files) outputs.set(`bundle/${path}`, bytes);
  outputs.set('fixture-info.json', canonicalBytes({ v: 1, evidence: 'synthetic-format-only; no RPC, live payment, finality, human approval or publication evidence', content: 'New synthetic text; CC BY 4.0; author Ask a Brain implementation fixture', key_handling: 'One ephemeral node:crypto Ed25519 private KeyObject generated in memory and discarded. Only public key/signatures persisted. No stored or derived deterministic seed.', regeneration: 'node test/wire/golden-fixture.ts --write-public-fixture', determinism: 'Two builds with the same in-memory key must produce identical canonical bytes, Ed25519 signatures and hashes before writing. New invocations rotate the discarded key and dependent hashes.', bundle_layout: 'Frozen AnswerMap entries with engine_version and question hash; opaque pages/{page_id}.md', approval_ref: 'null: synthetic fixture has no human approval evidence', hashes: 'SHA256SUMS.json names exact file bytes. Dedicated *_sha256 bindings hash JCS payloads; receipt artifact_refs hash complete canonical files.', rendering: 'claims.map(c => c.text + " [" + c.citation_ids.join(",") + "]").join("\\n")' }));
  return outputs;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--write-public-fixture') {
  const privateKey = generateKeyPairSync('ed25519').privateKey;
  const fixture = makeGolden(privateKey);
  const outputs = goldenOutputs(fixture);
  assert.deepEqual(outputs, goldenOutputs(makeGolden(privateKey)), 'fixed-input regeneration must be byte-identical');
  for (const [path, bytes] of outputs) { const destination = new URL(path, directory); mkdirSync(fileURLToPath(new URL('.', destination)), { recursive: true }); writeFileSync(destination, bytes); }
  const hashes = Object.fromEntries([...outputs].map(([name, bytes]) => [name, bytesHash(bytes)]));
  writeFileSync(new URL('SHA256SUMS.json', directory), canonicalBytes(hashes));
  console.log(JSON.stringify({ files: outputs.size, registry_payload: fixture.chain.registryHash, manifest_payload: payloadHash(fixture.chain.manifest.payload), quote_payload: payloadHash(fixture.chain.quote.payload), arm_payload: payloadHash(fixture.chain.arm.payload), answer_payload: payloadHash(fixture.chain.answer.payload), sums_file: bytesHash(canonicalBytes(hashes)) }, null, 2));
}
