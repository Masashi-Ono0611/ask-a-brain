import { z } from 'zod';
import type { Answer, SignedKind, SignedTypes, WireKind, WireTypes } from './contracts.ts';
import { M03 } from './constants.ts';
import { assertJson, bytesHash, canonicalBytes, payloadHash, requireWire, strictJson, WireError } from './json.ts';
import { address, atomic, chainSignature, count, genesis, hash, id, issue, lamports, network, nonce, nonempty, origin, path, question, sealSignature, sorted, templateValues, text, time, unique, url, uuid } from './primitives.ts';
export interface RuntimeSchema<T> { parse(input: unknown): T }
export type WireSchemas = { readonly [K in WireKind]: RuntimeSchema<WireTypes[K]> };
export type SignedPayloadSchemas = { readonly [K in SignedKind]: RuntimeSchema<SignedTypes[K]> };
export type { WireKind, WireTypes, SignedKind, SignedTypes } from './contracts.ts';
const v = z.literal(1);
export const sellerPublicKeySchema = z.object({ id, algorithm: z.literal('Ed25519'), public_key: address }).strict();
const paymentFields = {
  rail: z.literal('solana-split-v1'), network, genesis_hash: genesis, asset: z.enum(['TEST', 'USDC']), mint: address,
  decimals: z.literal(M03.tokenDecimals.value), token_program: address, total_atomic: atomic,
  seller_owner: address, seller_token_account: address, marketplace_owner: address, marketplace_token_account: address,
};
function paymentCheck(p: z.infer<ReturnType<typeof paymentObject>>, ctx: z.RefinementCtx): void {
  issue(ctx, p.asset === (p.network === 'devnet' ? 'TEST' : 'USDC'), 'ASSET_NETWORK_MISMATCH');
  issue(ctx, p.total_atomic === String(M03.totalAtomic.value), 'PRICE_MISMATCH');
  issue(ctx, unique([p.seller_owner, p.marketplace_owner, p.seller_token_account, p.marketplace_token_account]), 'PAYEE_COLLISION');
}
function paymentObject() { return z.object(paymentFields).strict(); }
const listing = z.object({
  seller_id: id, display_name: nonempty, operator_id: id, listing_kind: z.enum(['independent', 'founder', 'demo']),
  status: z.enum(['active', 'suspended']), endpoint: origin, topics: z.array(nonempty).nonempty().refine(unique), signing_key: sellerPublicKeySchema,
  slice: z.object({ id, manifest_sha256: hash, manifest_url: url, approved_at: time }).strict(),
  payment: z.object({ ...paymentFields, fee_bps: z.literal(M03.marketplaceFeeBps.value) }).strict().superRefine(paymentCheck),
}).strict().superRefine((p, ctx) => {
  issue(ctx, p.slice.manifest_url === `${p.endpoint}/v1/slices/${encodeURIComponent(p.slice.id)}/manifest`, 'MANIFEST_URL_MISMATCH');
  issue(ctx, ![p.payment.seller_owner, p.payment.marketplace_owner].includes(p.signing_key.public_key), 'SEAL_KEY_IS_PAYMENT_KEY');
});
const registry = z.object({ v, registry_version: id, listings: z.array(listing) }).strict().superRefine((p, ctx) => {
  // Delisting may leave zero active entries; fan-out is a consult cap, not a file-size limit.
  issue(ctx, sorted(p.listings.map((l) => l.seller_id)), 'REGISTRY_ORDER');
});
const manifest = z.object({
  v, seller_id: id, slice_id: id, created_at: time, gate_version: id, approval_id: id, version: count.min(1), previous_manifest_hash: hash.nullable(), policy_sha256: hash,
  pages: z.array(z.object({ page_id: id, content_sha256: hash, size_bytes: count.max(M03.pageMax.value * 1024) }).strict()).min(M03.slicePagesMin.value).max(M03.slicePagesMax.value),
  files: z.array(z.object({ path, size_bytes: count.max(M03.sealedPayloadMax.value * 1024 * 1024), sha256: hash }).strict()).nonempty(),
}).strict().superRefine((p, ctx) => {
  issue(ctx, (p.version === 1) === (p.previous_manifest_hash === null), 'MANIFEST_HISTORY');
  issue(ctx, sorted(p.pages.map((x) => x.page_id)) && sorted(p.files.map((x) => x.path)), 'INVENTORY_ORDER');
  issue(ctx, p.files.reduce((n, f) => n + f.size_bytes, 0) <= M03.sealedPayloadMax.value * 1024 * 1024, 'PAYLOAD_LIMIT');
  issue(ctx, p.files.every((f) => !/^(manifest|envelope)([.-]|$)/i.test(f.path.split('/').at(-1)!)), 'MANIFEST_SELF_INVENTORY');
  issue(ctx, p.pages.every((page) => p.files.some((file) => file.sha256 === page.content_sha256 && file.size_bytes === page.size_bytes)), 'PAGE_NOT_IN_INVENTORY');
  issue(ctx, p.files.some((file) => file.sha256 === p.policy_sha256), 'POLICY_NOT_IN_INVENTORY');
});
const quote = z.object({
  v, ...paymentFields, quote_id: id, nonce, request_id: uuid, buyer_id: id, payer: address, seller_id: id, registry_version: id,
  question_sha256: hash, slice_id: id, manifest_sha256: hash, answer_sha256: hash, issued_at: time, expires_at: time,
  seller_atomic: atomic, fee_atomic: atomic, memo: nonempty, delivery: z.literal('immutable-answer-after-finalized'), refund_terms: z.literal('aab-prototype-refund-v1'),
}).strict().superRefine((p, ctx) => {
  paymentCheck(p, ctx);
  issue(ctx, p.seller_atomic === String(M03.sellerAtomic.value) && p.fee_atomic === String(M03.marketplaceAtomic.value), 'SPLIT_MISMATCH');
  issue(ctx, ![p.seller_owner, p.marketplace_owner, p.seller_token_account, p.marketplace_token_account].includes(p.payer), 'PAYER_COLLISION');
  issue(ctx, Date.parse(p.expires_at) - Date.parse(p.issued_at) === M03.quoteTtl.value * 1000, 'QUOTE_TTL');
  issue(ctx, p.memo === `aab:v1:${p.quote_id}:${p.nonce}`, 'MEMO_MISMATCH');
});
const armFields = { quote_id: id, message_sha256: hash, recent_blockhash: address, last_valid_block_height: count };
const arm = z.object({ v, ...armFields, buyer_id: id, quote_sha256: hash, armed_at: time }).strict();
const citation = z.object({ id, page_id: id, content_sha256: hash, byte_start: count, byte_end: count.max(M03.citedPageMax.value * 1024), excerpt: nonempty, source_url: url }).strict().superRefine((p, ctx) => {
  issue(ctx, p.byte_end > p.byte_start && Buffer.byteLength(p.excerpt) === p.byte_end - p.byte_start, 'SPAN_LENGTH');
});
/** Frozen deterministic connective syntax; no free-form assertion outside claims. */
export function renderAnswer(claims: Answer['claims']): string { return claims.map((c) => `${c.text} [${c.citation_ids.join(',')}]`).join('\n'); }
/** Count unique source bytes before signing, without needing fetched pages. Overlapping
 * citations must agree byte-for-byte; whole-page correspondence is verifyCitations' job. */
function quotedScalars(citations: readonly z.infer<typeof citation>[]): number | null {
  const pages = new Map<string, Map<number, number>>();
  const hashes = new Map<string, string>();
  let scalars = 0;
  for (const c of citations) {
    if (hashes.has(c.page_id) && hashes.get(c.page_id) !== c.content_sha256) return null;
    hashes.set(c.page_id, c.content_sha256);
    const seen = pages.get(c.page_id) ?? new Map<number, number>(); pages.set(c.page_id, seen);
    const bytes = Buffer.from(c.excerpt);
    for (let i = 0; i < bytes.length; i++) {
      const offset = c.byte_start + i; const byte = bytes[i]!;
      if (seen.has(offset)) { if (seen.get(offset) !== byte) return null; }
      else { seen.set(offset, byte); if ((byte & 0xc0) !== 0x80) scalars++; }
    }
  }
  return scalars;
}
const answer = z.object({
  v, quote_id: id, seller_id: id, buyer_id: id, question_sha256: hash, slice_id: id, manifest_sha256: hash, commitment_salt: z.union([nonce, text.refine((s) => Buffer.from(s, 'base64url').length === 32 && Buffer.from(s, 'base64url').toString('base64url') === s, 'INVALID_SALT')]), created_at: time,
  answer: nonempty.refine((s) => [...s].length <= M03.answerScalarsMax.value, 'ANSWER_LIMIT'),
  claims: z.array(z.object({ text: nonempty, citation_ids: z.array(id).nonempty().refine(unique) }).strict()).min(1).max(M03.sectionsMax.value),
  citations: z.array(citation).min(M03.citationsMin.value).max(M03.citationsMax.value), abstain: z.literal(false), engine_version: id,
}).strict().superRefine((p, ctx) => {
  const quoted = quotedScalars(p.citations);
  issue(ctx, quoted !== null && quoted <= M03.quotedScalarsMax.value, 'QUOTED_SCALAR_LIMIT');
  issue(ctx, unique(p.citations.map((c) => c.id)), 'DUPLICATE_CITATION');
  issue(ctx, p.claims.every((claim) => claim.citation_ids.every((ref) => p.citations.some((c) => c.id === ref))), 'UNKNOWN_CITATION');
  issue(ctx, p.citations.every((c) => p.claims.some((claim) => claim.citation_ids.includes(c.id))), 'UNUSED_CITATION');
  issue(ctx, p.claims.every((claim) => claim.text === claim.citation_ids.map((ref) => p.citations.find((c) => c.id === ref)?.excerpt).join('\n')), 'CLAIM_NOT_EXTRACT');
  issue(ctx, p.answer === renderAnswer(p.claims), 'ANSWER_NOT_RENDERED');
  // M03 preparation evidence budget belongs to the worker; the entire emitted
  // signed envelope is already bounded below that budget by signed().
});
const signature = z.object({ key_id: id, algorithm: z.literal('Ed25519'), value: sealSignature }).strict();
function signed<S extends z.ZodTypeAny>(payload: S) {
  return z.object({ payload, signature }).strict().superRefine((p, ctx) => issue(ctx, canonicalBytes(p).length <= M03.signedEnvelopeMax.value * 1024, 'ENVELOPE_LIMIT'));
}
const proof = z.object({ v, consult_id: id, quote_id: id, quote_sha256: hash, arm_ticket_sha256: hash, network, genesis_hash: genesis, transaction_signature: chainSignature, message_sha256: hash }).strict();
const approvedQuestion = z.object({ question_id: id, text: question, question_sha256: hash, template_values: templateValues, topic: nonempty, allowed_origins: z.array(origin).nonempty().refine(unique), allowed_networks: z.array(network).nonempty().refine(unique), approval_sha256: hash }).strict().superRefine((p, ctx) => issue(ctx, bytesHash(Buffer.from(p.text)) === p.question_sha256, 'QUESTION_HASH'));
const questionPolicy = z.object({ v, policy_id: id, approved_at: time, approval_sha256: hash, questions: z.array(approvedQuestion).nonempty() }).strict().superRefine((p, ctx) => issue(ctx, unique(p.questions.map((q) => `${q.question_id}:${payloadHash(q.template_values)}`)), 'DUPLICATE_QUESTION'));
const price = z.object({ network, asset_id: address, amount_atomic: atomic }).strict();
const consultInput = z.object({ request_id: uuid, question_id: id, template_values: templateValues.optional(), max_price: price }).strict().transform(({ template_values, ...rest }) => template_values === undefined ? rest : { ...rest, template_values });
const quoteRequest = z.object({ v, request_id: uuid, request_nonce: nonce, buyer_id: id, payer: address, seller_id: id, registry_version: id, slice_id: id, network, question, max_total_atomic: atomic }).strict();
const armRequest = z.object({ ...armFields, renewal: z.object({ previous_arm_sha256: hash, unsigned_message_sha256: hash }).strict().optional(), message_base64: nonempty.refine((s) => Buffer.from(s, 'base64').toString('base64') === s, 'INVALID_BASE64') }).strict().superRefine((p, ctx) => issue(ctx, bytesHash(Buffer.from(p.message_base64, 'base64')) === p.message_sha256, 'MESSAGE_HASH'));
const errorCode = z.enum(['INVALID_INPUT', 'UNAUTHORIZED', 'UNKNOWN_SELLER', 'POLICY_DENIED', 'BUDGET_EXCEEDED', 'APPROVAL_REQUIRED', 'RATE_LIMITED', 'QUOTE_EXPIRED', 'IDEMPOTENCY_CONFLICT', 'NETWORK_MISMATCH', 'PAYMENT_UNCERTAIN', 'PAYMENT_INVALID', 'SELLER_UNAVAILABLE', 'VERIFICATION_FAILED', 'RECEIPT_STORE_UNAVAILABLE', 'INTERNAL_ERROR', 'CONTENT_REVOKED', 'NOT_READY', 'STATE_CONFLICT', 'BUDGET_EXHAUSTED', 'EXPIRED_BEFORE_APPROVAL']);
const disposition = z.object({ seller_id: id, status: z.enum(['ready', 'declined', 'unavailable']), quote_id: id.nullable(), code: errorCode.nullable() }).strict().superRefine((p, ctx) => issue(ctx, (p.status === 'ready') === (p.quote_id !== null), 'DISPOSITION_QUOTE'));
const paymentState = z.enum(['not_applicable', 'payment_pending', 'payment_finalized', 'payment_failed', 'underpaid', 'overpaid']);
const refundState = z.enum(['none', 'refund_pending', 'partial_refund', 'refunded']);
const importState = z.enum(['not_applicable', 'import_pending', 'quoted', 'metadata_only']);
const classification = z.enum(['technical_verification', 'replay', 'independent']);
const verification = z.union([z.boolean(), z.literal('not_applicable')]);
export const settlementSchema = z.object({ genesis, signature: chainSignature, quote_id: id, message_sha256: hash, slot: count, observed_at: time, commitment: z.literal(M03.finality.value), meta_err: z.null(), actual_fee: lamports, payer_debit: atomic, seller_credit: atomic, marketplace_credit: atomic, transaction_sha256: hash }).strict().superRefine((p, ctx) => issue(ctx, BigInt(p.payer_debit) === BigInt(p.seller_credit) + BigInt(p.marketplace_credit), 'DELTA_MISMATCH'));
const receipt = z.object({
  approval_ref: id.nullable().optional(), content_redacted_at: time.optional(),
  v, receipt_id: id, request_id: uuid, buyer_id: id, seller_id: id.nullable(), classification, question: z.union([question, z.literal('')]), question_policy_sha256: hash,
  quote_id: id.nullable(), quote_sha256: hash.nullable(), answer_sha256: hash.nullable(), registry_sha256: hash, manifest_sha256: hash.nullable(), arm_ticket_sha256: hash.nullable(),
  dispositions: z.array(disposition).max(M03.checksPerConsultMax.value), network, asset: z.enum(['TEST', 'USDC']),
  total_atomic: atomic.nullable(), seller_atomic: atomic.nullable(), fee_atomic: atomic.nullable(), network_fee_lamports: lamports.nullable(),
  transaction_signature: chainSignature.nullable(), finalized_slot: count.nullable(), explorer_url: url.nullable(), settlement: settlementSchema.nullable(),
  verified: z.object({ chain: verification, seller_signature: verification, answer_commitment: verification, source_hashes: verification }).strict(),
  artifact_refs: z.record(nonempty.refine((s) => !['__proto__', 'constructor', 'prototype'].includes(s)), hash), refund: z.object({ status: refundState, returned_atomic: atomic, transactions: z.array(chainSignature).refine(unique) }).strict(),
  latency_ms: z.object({ precheck: count.nullable(), finality: count.nullable(), delivery: count.nullable() }).strict(),
  gbrain: z.object({ page_id: id.nullable(), sync_state: importState }).strict(),
  payment_state: paymentState, content_state: z.enum(['eligible', 'superseded', 'revoked', 'unknown']),
  delivery_state: z.enum(['not_applicable', 'pending', 'delivered', 'delivery_failed', 'verification_failed', 'recovery_required']),
  refund_state: refundState, import_state: importState, feedback_state: z.enum(['none', 'recorded']),
}).strict().superRefine((p, ctx) => {
  issue(ctx, p.asset === (p.network === 'devnet' ? 'TEST' : 'USDC'), 'ASSET_NETWORK_MISMATCH');
  issue(ctx, p.question !== '' || p.content_redacted_at !== undefined, 'EMPTY_QUESTION');
  if (p.content_redacted_at !== undefined) issue(ctx, p.question === '' && Object.keys(p.artifact_refs).length === 0 && p.delivery_state !== 'delivered', 'REDACTED_CONTENT');
  issue(ctx, unique(p.dispositions.map((d) => d.seller_id)), 'DUPLICATE_DISPOSITION');
  issue(ctx, p.refund_state === p.refund.status && p.import_state === p.gbrain.sync_state, 'STATE_MISMATCH');
  issue(ctx, (p.import_state === 'quoted' || p.import_state === 'metadata_only') === (p.gbrain.page_id !== null), 'IMPORT_REFERENCE');
  if (p.total_atomic !== null && p.seller_atomic !== null && p.fee_atomic !== null) issue(ctx, BigInt(p.total_atomic) === BigInt(p.seller_atomic) + BigInt(p.fee_atomic), 'SPLIT_MISMATCH');
  if (p.payment_state === 'not_applicable') {
    issue(ctx, [p.transaction_signature, p.finalized_slot, p.explorer_url, p.settlement].every((x) => x === null), 'UNPAID_ARTIFACT');
    issue(ctx, [p.total_atomic, p.seller_atomic, p.fee_atomic, p.network_fee_lamports].every((x) => x === '0'), 'UNPAID_AMOUNT');
    issue(ctx, p.delivery_state === 'not_applicable', 'UNPAID_DELIVERY');
    if (p.quote_id === null) {
      issue(ctx, [p.seller_id, p.quote_sha256, p.answer_sha256, p.manifest_sha256, p.arm_ticket_sha256].every((x) => x === null), 'DECLINE_BINDING');
      issue(ctx, Object.values(p.verified).every((x) => x === 'not_applicable'), 'UNPAID_VERIFICATION');
    } else {
      issue(ctx, [p.seller_id, p.quote_sha256, p.answer_sha256, p.manifest_sha256].every((x) => x !== null), 'SELECTED_BINDING');
      issue(ctx, p.verified.chain === false && p.verified.answer_commitment === false && p.verified.source_hashes === false, 'UNPAID_VERIFICATION');
    }
  }
  if (p.payment_state === 'payment_finalized') {
    issue(ctx, p.settlement !== null && p.verified.chain === true, 'MISSING_SETTLEMENT');
    issue(ctx, [p.seller_id, p.quote_id, p.quote_sha256, p.manifest_sha256, p.arm_ticket_sha256].every((x) => x !== null), 'MISSING_PAYMENT_BINDING');
  }
  if (p.verified.chain === true) issue(ctx, p.settlement !== null, 'MISSING_SETTLEMENT');
  if (p.settlement !== null) {
    const s = p.settlement;
    issue(ctx, ['payment_finalized', 'underpaid', 'overpaid'].includes(p.payment_state), 'SETTLEMENT_STATE');
    issue(ctx, s.signature === p.transaction_signature && s.quote_id === p.quote_id && s.slot === p.finalized_slot && s.actual_fee === p.network_fee_lamports && s.payer_debit === p.total_atomic && s.seller_credit === p.seller_atomic && s.marketplace_credit === p.fee_atomic, 'SETTLEMENT_MISMATCH');
  }
  if (p.delivery_state === 'delivered') issue(ctx, p.payment_state === 'payment_finalized' && p.answer_sha256 !== null && Object.values(p.verified).every((x) => x === true), 'DELIVERY_NOT_VERIFIED');
  if (p.total_atomic !== null) issue(ctx, BigInt(p.refund.returned_atomic) <= BigInt(p.total_atomic), 'REFUND_OVERFLOW');
  if (p.refund_state === 'none') issue(ctx, p.refund.returned_atomic === '0' && p.refund.transactions.length === 0, 'REFUND_STATE');
  if (p.refund_state === 'refunded') issue(ctx, p.total_atomic !== null && p.total_atomic !== '0' && p.refund.returned_atomic === p.total_atomic && p.refund.transactions.length > 0, 'REFUND_STATE');
  if (p.refund_state === 'partial_refund') issue(ctx, p.total_atomic !== null && BigInt(p.refund.returned_atomic) > 0n && BigInt(p.refund.returned_atomic) < BigInt(p.total_atomic) && p.refund.transactions.length > 0, 'REFUND_STATE');
}).transform(({ approval_ref, content_redacted_at, ...rest }) => ({ ...rest, ...(approval_ref === undefined ? {} : { approval_ref }), ...(content_redacted_at === undefined ? {} : { content_redacted_at }) }));
const outcome = z.object({ v, feedback_id: id, consult_id: id, quote_id: id.nullable(), answer_sha256: hash.nullable(), buyer_id: id, seller_id: id, source: z.enum(['agent', 'human', 'task_check', 'replay', 'service_failure']), useful: z.boolean().nullable(), verdict: z.enum(['pass', 'fail', 'unknown']).optional(), run_sha256: hash.nullable().optional(), reason_code: z.enum(['prevented_missed_check', 'unblocked_task', 'already_known', 'incorrect', 'not_actionable', 'other']), transaction_signature: chainSignature.nullable(), classification, eligible_for_trust: z.boolean(), exclusion_reason: text.nullable(), recorded_at: time, corrects: id.nullable() }).strict().superRefine((p, ctx) => {
  // M09 hackathon admission has zero eligible independent outcomes; auth still belongs to broker.
  issue(ctx, !p.eligible_for_trust && p.exclusion_reason !== null && p.exclusion_reason.length > 0, 'INELIGIBLE_OUTCOME');
  issue(ctx, p.corrects !== p.feedback_id, 'SELF_CORRECTION');
  issue(ctx, p.verdict === undefined ? p.useful !== null : p.useful === (p.verdict === 'unknown' ? null : p.verdict === 'pass'), 'VERDICT_MISMATCH');
  if (p.source === 'task_check' || p.source === 'replay') {
    if (p.verdict !== undefined) issue(ctx, p.run_sha256 != null, 'RUN_EVIDENCE_REQUIRED');
  } else issue(ctx, p.run_sha256 == null && p.useful !== null, 'RUN_SOURCE');
});

const quoteDisposition = z.union([
  z.object({ status: z.literal('declined'), abstain: z.literal(true), quote: z.null(), charged_atomic: atomic.refine((s) => s === '0'), reason: z.literal('unavailable') }).strict(),
  z.object({ status: z.literal('ready'), quote: signed(quote) }).strict(),
]);
const answerDisposition = z.union([
  z.object({ status: z.literal('ready'), answer: signed(answer) }).strict(),
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('withheld'), code: errorCode }).strict(),
]);
const eligibility = z.object({ slice_id: id, manifest_sha256: hash, state: z.enum(['eligible', 'superseded', 'revoked', 'unknown']), generation: count, acknowledged_at: time, checked_at: time }).strict();
const paymentView = z.object({ payment_state: paymentState, delivery_state: z.enum(['not_applicable', 'pending', 'delivered', 'delivery_failed', 'verification_failed', 'recovery_required']), evidence: settlementSchema.nullable() }).strict().superRefine((p, ctx) => {
  issue(ctx, (p.payment_state === 'payment_finalized') === (p.evidence !== null), 'PAYMENT_EVIDENCE');
});

// Checked output types: no `as WireTypes` cast conceals schema/contract drift.
export const signedPayloadSchemas = { manifest, quote, arm, answer } satisfies SignedPayloadSchemas;
export const wireSchemas = { quote_disposition: quoteDisposition, answer_disposition: answerDisposition, payment_view: paymentView, eligibility, registry, listing, manifest: signed(manifest), quote: signed(quote), arm: signed(arm), answer: signed(answer), proof, receipt, outcome, question_policy: questionPolicy, consult_input: consultInput, quote_request: quoteRequest, arm_request: armRequest } satisfies WireSchemas;
export function validateWire<K extends WireKind>(kind: K, input: unknown): WireTypes[K] {
  requireWire(Object.hasOwn(wireSchemas, kind), 'UNKNOWN_WIRE_KIND'); assertJson(input);
  const schema: RuntimeSchema<WireTypes[K]> = (wireSchemas as WireSchemas)[kind];
  try { return schema.parse(input); } catch { throw new WireError('INVALID_WIRE_RECORD'); }
}
export function validatePayload<K extends SignedKind>(kind: K, input: unknown): SignedTypes[K] {
  requireWire(Object.hasOwn(signedPayloadSchemas, kind), 'UNKNOWN_SIGNED_KIND'); assertJson(input);
  const schema: RuntimeSchema<SignedTypes[K]> = (signedPayloadSchemas as SignedPayloadSchemas)[kind];
  try { return schema.parse(input); } catch { throw new WireError('INVALID_SIGNED_PAYLOAD'); }
}
export function parseWire<K extends WireKind>(kind: K, bytes: Uint8Array): WireTypes[K] {
  requireWire(bytes.length <= M03.ingressBodyMax.value * 1024, 'BODY_LIMIT');
  if (Object.hasOwn(signedPayloadSchemas, kind)) requireWire(bytes.length <= M03.signedEnvelopeMax.value * 1024, 'ENVELOPE_LIMIT');
  const result = validateWire(kind, strictJson(bytes, { integerNumbersOnly: true }));
  if (kind === 'registry') requireWire(Buffer.from(canonicalBytes(result)).equals(Buffer.from(bytes)), 'REGISTRY_NOT_JCS');
  return result;
}
