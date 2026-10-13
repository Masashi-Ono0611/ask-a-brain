import { assertRpcOrigins } from '../chain/index.ts';
import { FoundationError, decodeAmount, encodeUtf8 } from '../common/index.ts';
import type { ApprovedQuestion, BrokerDeps, BuyerContext, ConsultInput, Eligibility, Listing, Quote, Signed } from '../wire/contracts.ts';
import type { BrokerPorts } from './ports.ts';
import { digest, json } from './journal.ts';

export function requireThat(condition: unknown, code: ConstructorParameters<typeof FoundationError>[0] = 'POLICY_DENIED'): asserts condition {
  if (!condition) throw new FoundationError(code);
}
export function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'INVALID_INPUT');
  requireThat(Object.keys(value).every((key) => allowed.includes(key)), 'INVALID_INPUT');
}
function losslessJson(value: unknown): void {
  if (typeof value === 'string') { encodeUtf8(value); return; }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  requireThat(typeof value === 'object' && value !== null, 'INVALID_INPUT');
  requireThat(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'INVALID_INPUT');
  for (const [key, child] of Object.entries(value)) { encodeUtf8(key); losslessJson(child); }
}
export function contextAllowed(deps: BrokerDeps, context: BuyerContext): void {
  exactKeys(context, ['buyer_id', 'payer', 'session_id']);
  requireThat(context.buyer_id === deps.policy.buyer.buyer_id && context.payer === deps.policy.buyer.payer && context.session_id === deps.policy.buyer.session_id, 'UNAUTHORIZED');
}
export function boot(deps: BrokerDeps, ports: BrokerPorts): void {
  assertRpcOrigins(deps.primaryRpc, deps.secondaryRpc, ports.rpcOrigins);
  requireThat(ports.payloadHash(json(deps.registry)) === deps.policy.registry_sha256, 'VERIFICATION_FAILED');
  requireThat(ports.payloadHash(json(deps.questionPolicy)) === deps.policy.question_policy_sha256, 'VERIFICATION_FAILED');
  requireThat(ports.payer.payer === deps.policy.buyer.payer && ports.payer.tokenAccount !== ports.payer.payer);
  const l = ports.limits;
  requireThat(decodeAmount(deps.policy.principal_per_call) <= l.devnetPrincipalPerCall.value);
  requireThat(decodeAmount(deps.policy.principal_per_day) <= l.devnetPrincipalPerDay.value);
  requireThat(decodeAmount(deps.policy.fee_per_call) <= l.feePerPurchaseMax.value);
  requireThat(decodeAmount(deps.policy.fee_per_day) <= l.devnetFeePerDayMax.value);
  requireThat(new Set(deps.registry.listings.map((listing) => listing.seller_id)).size === deps.registry.listings.length);
  for (const listing of deps.registry.listings) {
    const url = new URL(listing.endpoint);
    requireThat(url.origin === listing.endpoint && url.username === '' && url.password === '' && ['https:', 'http:'].includes(url.protocol));
    // HTTP is a protected exact enrollment decision; no URL supplied by the model.
    requireThat(listing.payment.fee_bps === l.marketplaceFeeBps.value);
  }
  for (const origin of ports.rpcOrigins) requireThat(new URL(origin).origin === origin);
  requireThat(ports.rpcOrigins[0] !== ports.rpcOrigins[1]);
}
export function admit(deps: BrokerDeps, ports: BrokerPorts, value: ConsultInput | Uint8Array): { input: ConsultInput; question: ApprovedQuestion } {
  let bytes: Uint8Array;
  if (value instanceof Uint8Array) bytes = value;
  else {
    exactKeys(value, ['request_id', 'question_id', 'template_values', 'max_price']);
    exactKeys(value.max_price, ['network', 'asset_id', 'amount_atomic']);
    // T1 serialization must not erase undefined, invalid scalars or unknown fields.
    losslessJson(value);
    bytes = encodeUtf8(JSON.stringify(value));
  }
  requireThat(bytes.length <= ports.limits.ingressBodyMax.value * 1024, 'INVALID_INPUT');
  const input = ports.parseWire('consult_input', bytes);
  const question = ports.resolveQuestion(deps.questionPolicy, input);
  const approved = deps.questionPolicy.questions.find((q) => q.question_id === input.question_id && ports.payloadHash(json(q.template_values)) === ports.payloadHash(json(input.template_values ?? {})));
  requireThat(approved && ports.payloadHash(json(approved)) === ports.payloadHash(json(question)));
  const text = encodeUtf8(question.text);
  requireThat(text.length <= ports.limits.questionBytesMax.value * 1024 && [...question.text].length <= ports.limits.questionScalarsMax.value, 'INVALID_INPUT');
  requireThat(digest(text) === question.question_sha256, 'VERIFICATION_FAILED');
  requireThat(deps.policy.networks.includes(input.max_price.network) && question.allowed_networks.includes(input.max_price.network), 'NETWORK_MISMATCH');
  requireThat(input.max_price.network !== 'mainnet-beta' || deps.policy.mainnet_enabled);
  const max = decodeAmount(input.max_price.amount_atomic);
  requireThat(max > 0n && max <= decodeAmount(deps.policy.principal_per_call), 'BUDGET_EXCEEDED');
  return { input, question };
}
export function candidates(deps: BrokerDeps, ports: BrokerPorts, input: ConsultInput, question: ApprovedQuestion): readonly Listing[] {
  return deps.registry.listings.filter((l) => l.status === 'active' && l.topics.includes(question.topic) && question.allowed_origins.includes(l.endpoint) && l.payment.network === input.max_price.network && l.payment.mint === input.max_price.asset_id && decodeAmount(l.payment.total_atomic) <= decodeAmount(input.max_price.amount_atomic))
    .sort((a, b) => a.seller_id < b.seller_id ? -1 : a.seller_id > b.seller_id ? 1 : 0).slice(0, ports.limits.checksPerConsultMax.value);
}
export function quoteAllowed(deps: BrokerDeps, ports: BrokerPorts, input: ConsultInput, question: ApprovedQuestion, listing: Listing, signed: Signed<Quote>): Signed<Quote> {
  const bytes = ports.canonicalBytes(json(signed));
  requireThat(bytes.length <= ports.limits.signedEnvelopeMax.value * 1024, 'VERIFICATION_FAILED');
  const quote = ports.parseWire('quote', bytes); ports.verifyEnvelope('quote', quote, listing.signing_key);
  const q = quote.payload; const p = listing.payment; const l = ports.limits;
  for (const field of ['rail', 'network', 'genesis_hash', 'asset', 'mint', 'decimals', 'token_program', 'total_atomic', 'seller_owner', 'seller_token_account', 'marketplace_owner', 'marketplace_token_account'] as const) requireThat(q[field] === p[field], 'PAYMENT_INVALID');
  requireThat(q.request_id === input.request_id && q.buyer_id === deps.policy.buyer.buyer_id && q.payer === deps.policy.buyer.payer && q.seller_id === listing.seller_id && q.registry_version === deps.registry.registry_version && q.question_sha256 === question.question_sha256 && q.slice_id === listing.slice.id && q.manifest_sha256 === listing.slice.manifest_sha256, 'VERIFICATION_FAILED');
  requireThat(q.network === input.max_price.network && q.mint === input.max_price.asset_id, 'NETWORK_MISMATCH');
  requireThat(decodeAmount(q.total_atomic) <= decodeAmount(input.max_price.amount_atomic) && decodeAmount(q.total_atomic) <= decodeAmount(deps.policy.principal_per_call), 'BUDGET_EXCEEDED');
  requireThat(decodeAmount(q.total_atomic) === l.totalAtomic.value && decodeAmount(q.seller_atomic) === l.sellerAtomic.value && decodeAmount(q.fee_atomic) === l.marketplaceAtomic.value && decodeAmount(q.total_atomic) === decodeAmount(q.seller_atomic) + decodeAmount(q.fee_atomic) && q.decimals === l.tokenDecimals.value, 'PAYMENT_INVALID');
  requireThat(new Set([q.payer, q.seller_owner, q.marketplace_owner]).size === 3 && new Set([ports.payer.tokenAccount, q.seller_token_account, q.marketplace_token_account]).size === 3, 'PAYMENT_INVALID');
  requireThat(q.memo === `aab:v1:${q.quote_id}:${q.nonce}` && q.delivery === 'immutable-answer-after-finalized' && q.refund_terms === 'aab-prototype-refund-v1', 'PAYMENT_INVALID');
  const now = Date.parse(deps.clock.now()), issued = Date.parse(q.issued_at), expires = Date.parse(q.expires_at);
  requireThat(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now + l.clockSkewMax.value * 1000 && expires > now && expires > issued && expires - issued <= l.quoteTtl.value * 1000, 'QUOTE_EXPIRED');
  return quote;
}
export function armTime(deps: BrokerDeps, ports: BrokerPorts, quote: Signed<Quote>): void {
  requireThat(Date.parse(quote.payload.expires_at) - Date.parse(deps.clock.now()) >= ports.limits.armRemainingMin.value * 1000, 'QUOTE_EXPIRED');
}
export function eligibilityAllowed(deps: BrokerDeps, ports: BrokerPorts, listing: Listing, value: Eligibility, recovery = false): void {
  requireThat(value.slice_id === listing.slice.id && value.manifest_sha256 === listing.slice.manifest_sha256 && Number.isSafeInteger(value.generation) && value.generation >= 0, 'VERIFICATION_FAILED');
  requireThat(value.state !== 'revoked', 'CONTENT_REVOKED');
  requireThat(value.state === 'eligible' || (recovery && value.state === 'superseded'), 'NOT_READY');
  const now = Date.parse(deps.clock.now());
  const age = now - Date.parse(value.acknowledged_at); const checkedAge = now - Date.parse(value.checked_at);
  requireThat(age >= -ports.limits.clockSkewMax.value * 1000 && age <= ports.limits.lineageAcknowledgementMaxAge.value * 3600000 && Math.abs(checkedAge) <= ports.limits.clockSkewMax.value * 1000, 'NOT_READY');
}
