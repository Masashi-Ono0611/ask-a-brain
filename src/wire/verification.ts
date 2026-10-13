import type { Answer, ApprovedQuestion, Arm, ConsultInput, Id, Manifest, ProofLocator, QuestionPolicy, Quote, Receipt, Registry, SettlementEvidence, Sha256, Signed } from './contracts.ts';
import { M03 } from './constants.ts';
import { bytesHash, canonicalBytes, payloadHash, requireWire, utf8Text } from './json.ts';
import { parseWire, settlementSchema, validateWire } from './schemas.ts';
import { verifyEnvelope } from './crypto.ts';

export function parsePinnedRegistry(bytes: Uint8Array, pinnedHash: Sha256): Registry {
  const registry = parseWire('registry', bytes);
  requireWire(bytesHash(bytes) === pinnedHash, 'REGISTRY_PIN_MISMATCH'); return registry;
}
/** Exact-byte provenance only. Caller verifies signatures and current eligibility separately. */
export function verifyCitations(answerEnvelope: Signed<Answer>, manifestEnvelope: Signed<Manifest>, pages: ReadonlyMap<Id, Uint8Array>): void {
  const a = validateWire('answer', answerEnvelope).payload;
  const m = validateWire('manifest', manifestEnvelope).payload;
  requireWire(a.manifest_sha256 === payloadHash(m) && a.seller_id === m.seller_id && a.slice_id === m.slice_id, 'MANIFEST_BINDING');
  let fetched = 0;
  for (const bytes of pages.values()) {
    requireWire(bytes.length <= M03.citedPageMax.value * 1024, 'PAGE_LIMIT'); fetched += bytes.length;
  }
  requireWire(fetched <= M03.citationFetchTotalMax.value * 1024, 'FETCH_LIMIT');
  // validateWire already enforces the union-of-source-spans scalar budget.
  // Here we establish correspondence to whole, hash-matching published pages.
  for (const c of a.citations) {
    const page = m.pages.find((p) => p.page_id === c.page_id); const bytes = pages.get(c.page_id);
    requireWire(page !== undefined && bytes !== undefined, 'MISSING_PAGE');
    requireWire(bytes.length === page.size_bytes && bytesHash(bytes) === page.content_sha256 && c.content_sha256 === page.content_sha256, 'PAGE_HASH_MISMATCH');
    utf8Text(bytes); // validate whole page, including bytes outside the cited range
    requireWire(c.byte_start < c.byte_end && c.byte_end <= bytes.length, 'SPAN_BOUNDS');
    const boundary = (offset: number): boolean => offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80;
    requireWire(boundary(c.byte_start) && boundary(c.byte_end), 'SPAN_UTF8_BOUNDARY');
    requireWire(utf8Text(bytes.subarray(c.byte_start, c.byte_end)) === c.excerpt, 'SPAN_EXCERPT_MISMATCH');
  }
}
export function verifyAnswerCommitment(quoteEnvelope: Signed<Quote>, answerEnvelope: Signed<Answer>): void {
  const q = validateWire('quote', quoteEnvelope).payload; const a = validateWire('answer', answerEnvelope).payload;
  requireWire(q.answer_sha256 === payloadHash(a), 'ANSWER_COMMITMENT');
  for (const field of ['quote_id', 'seller_id', 'buyer_id', 'question_sha256', 'slice_id', 'manifest_sha256'] as const) requireWire(q[field] === a[field], 'ANSWER_BINDING');
  requireWire(Date.parse(a.created_at) <= Date.parse(q.issued_at), 'ANSWER_NOT_PRECOMMITTED');
}
export function resolveQuestion(policy: QuestionPolicy, input: ConsultInput): ApprovedQuestion {
  const p = validateWire('question_policy', policy); const i = validateWire('consult_input', input);
  const templateHash = payloadHash(i.template_values ?? {});
  const found = p.questions.find((q) => q.question_id === i.question_id && payloadHash(q.template_values) === templateHash);
  requireWire(found !== undefined && found.allowed_networks.includes(i.max_price.network), 'QUESTION_NOT_APPROVED');
  return found;
}
/** Additional T1 adapter, not a change to frozen T0 ports. No RPC/fetch/authorization implied. */
export interface ArtifactChain {
  readonly registry: Registry; readonly registryHash: Sha256; readonly manifest: Signed<Manifest>;
  readonly quote: Signed<Quote>; readonly arm: Signed<Arm>; readonly answer: Signed<Answer>;
  readonly proof: ProofLocator; readonly settlement: SettlementEvidence; readonly receipt: Receipt;
  readonly questionPolicy: QuestionPolicy; readonly pages: ReadonlyMap<Id, Uint8Array>;
}
/** Validates an archived chain's byte compatibility. Settlement remains caller-supplied evidence,
 * never live-chain proof; revocation, approval, RPC and storage are separate service gates. */
export function verifyArtifactChain(chain: ArtifactChain): void {
  const r = validateWire('registry', chain.registry);
  requireWire(payloadHash(r) === chain.registryHash, 'REGISTRY_PIN_MISMATCH');
  const q = validateWire('quote', chain.quote).payload;
  const listing = r.listings.find((l) => l.seller_id === q.seller_id);
  requireWire(listing !== undefined && r.registry_version === q.registry_version, 'REGISTRY_BINDING');
  const key = listing.signing_key;
  verifyEnvelope('manifest', chain.manifest, key); verifyEnvelope('quote', chain.quote, key);
  verifyEnvelope('arm', chain.arm, key); verifyEnvelope('answer', chain.answer, key);
  const m = chain.manifest.payload; const a = chain.arm.payload; const proof = validateWire('proof', chain.proof);
  const settlement = settlementSchema.parse(chain.settlement); const receipt = validateWire('receipt', chain.receipt);
  const policy = validateWire('question_policy', chain.questionPolicy);
  requireWire(m.seller_id === listing.seller_id && m.slice_id === listing.slice.id && q.slice_id === m.slice_id && payloadHash(m) === listing.slice.manifest_sha256 && q.manifest_sha256 === payloadHash(m), 'MANIFEST_BINDING');
  for (const field of ['rail', 'network', 'genesis_hash', 'asset', 'mint', 'decimals', 'token_program', 'total_atomic', 'seller_owner', 'seller_token_account', 'marketplace_owner', 'marketplace_token_account'] as const) requireWire(q[field] === listing.payment[field], 'PAYMENT_BINDING');
  requireWire(![q.payer, q.seller_owner, q.marketplace_owner].includes(key.public_key), 'SEAL_KEY_IS_PAYMENT_KEY');
  requireWire(a.quote_id === q.quote_id && a.buyer_id === q.buyer_id && a.quote_sha256 === payloadHash(q), 'ARM_BINDING');
  requireWire(Date.parse(a.armed_at) >= Date.parse(q.issued_at) && Date.parse(q.expires_at) - Date.parse(a.armed_at) >= M03.armRemainingMin.value * 1000, 'ARM_TIME');
  verifyAnswerCommitment(chain.quote, chain.answer); verifyCitations(chain.answer, chain.manifest, chain.pages);
  for (const c of chain.answer.payload.citations) requireWire(c.source_url === `${listing.endpoint}/v1/slices/${encodeURIComponent(m.slice_id)}/pages/${encodeURIComponent(c.page_id)}`, 'CITATION_URL_BINDING');
  requireWire(proof.quote_id === q.quote_id && proof.quote_sha256 === payloadHash(q) && proof.arm_ticket_sha256 === payloadHash(a) && proof.message_sha256 === a.message_sha256 && proof.genesis_hash === q.genesis_hash && proof.network === q.network, 'PROOF_BINDING');
  requireWire(settlement.quote_id === q.quote_id && settlement.genesis === q.genesis_hash && settlement.signature === proof.transaction_signature && settlement.message_sha256 === a.message_sha256 && settlement.payer_debit === q.total_atomic && settlement.seller_credit === q.seller_atomic && settlement.marketplace_credit === q.fee_atomic, 'SETTLEMENT_BINDING');
  requireWire(payloadHash(receipt.settlement) === payloadHash(settlement), 'RECEIPT_SETTLEMENT');
  requireWire(receipt.receipt_id === proof.consult_id && receipt.quote_id === q.quote_id && receipt.request_id === q.request_id && receipt.buyer_id === q.buyer_id && receipt.seller_id === q.seller_id && receipt.network === q.network && receipt.asset === q.asset, 'RECEIPT_BINDING');
  requireWire(receipt.registry_sha256 === chain.registryHash && receipt.quote_sha256 === payloadHash(q) && receipt.manifest_sha256 === payloadHash(m) && receipt.arm_ticket_sha256 === payloadHash(a) && receipt.answer_sha256 === payloadHash(chain.answer.payload), 'RECEIPT_HASH');
  requireWire(receipt.question_policy_sha256 === payloadHash(policy) && bytesHash(Buffer.from(receipt.question)) === q.question_sha256 && policy.questions.some((question) => question.text === receipt.question && question.question_sha256 === q.question_sha256 && question.allowed_origins.includes(listing.endpoint) && question.allowed_networks.includes(q.network)), 'QUESTION_BINDING');
  requireWire(receipt.dispositions.some((d) => d.status === 'ready' && d.quote_id === q.quote_id && d.seller_id === q.seller_id), 'SELECTED_DISPOSITION');
  // artifact_refs name raw canonical files; the dedicated *_sha256 fields name payloads.
  for (const [name, artifact] of Object.entries({ registry: r, manifest: chain.manifest, quote: chain.quote, arm: chain.arm, answer: chain.answer, proof, settlement, question_policy: policy })) requireWire(receipt.artifact_refs[name] === bytesHash(canonicalBytes(artifact)), 'ARTIFACT_REFERENCE');
}
