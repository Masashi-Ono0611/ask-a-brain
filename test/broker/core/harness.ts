import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import canonicalize from 'canonicalize';
import { parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import { FixedClock, openStore, decodeUtf8, FoundationError, atomicFromBigint, lamportsFromBigint } from '../../../src/common/index.ts';
import { M03 } from '../../../src/wire/constants.ts';
import type { Address, Arm, Atomic, BrokerDeps, BuyerContext, ConsultInput, Eligibility, Id, IsoTime, JsonValue, Lamports, Listing, ParseWire, Quote, Reconciliation, Registry, SellerClient, Sha256, Signature, Signed, SignRequest, SignResult, Store, Uuid, WireKind, WireTypes } from '../../../src/wire/contracts.ts';
import type { BrokerPorts } from '../../../src/broker/index.ts';
import { bindBroker } from '../../../src/broker/index.ts';

export const id = (s: string): Id => s as Id;
export const address = (s: string): Address => s as Address;
export const sha = (s: string | Uint8Array): Sha256 => createHash('sha256').update(s).digest('hex') as Sha256;
export const hash = (v: unknown): Sha256 => sha(canonicalize(v)!);
export const amount = atomicFromBigint, fee = lamportsFromBigint;
export const iso = (v: string): IsoTime => v as IsoTime;
export const buyer: BuyerContext = { buyer_id: id('buyer'), payer: address('payer'), session_id: id('session') };
export const uuid = (n: number): Uuid => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}` as Uuid;
export const maxPrice = { network: 'devnet' as const, asset_id: address('mint'), amount_atomic: amount(M03.totalAtomic.value) };
export function input(n = 1): ConsultInput { return { request_id: uuid(n), question_id: id('question'), max_price: maxPrice }; }
const consultSchema = z.object({ request_id: z.string().uuid(), question_id: z.string().min(1), template_values: z.record(z.string()).optional(), max_price: z.object({ network: z.enum(['devnet', 'mainnet-beta']), asset_id: z.string(), amount_atomic: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict() }).strict();
function duplicate(node: JsonNode): void {
  if (node.type === 'object') { const names = new Set<string>(); for (const property of node.children ?? []) { const name = property.children![0]!.value as string; if (names.has(name)) throw new FoundationError('INVALID_INPUT'); names.add(name); } }
  for (const child of node.children ?? []) duplicate(child);
}
/** ONLY a test stub: strict syntax/input schema; signed artifacts are synthetic.
 * This does not claim T1 schemas/signatures or T2 Solana verification pass.
 */
export const parse: ParseWire = <K extends WireKind>(kind: K, bytes: Uint8Array): WireTypes[K] => {
  const text = decodeUtf8(bytes), errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) throw new FoundationError('INVALID_INPUT'); duplicate(tree);
  const parsed: unknown = JSON.parse(text);
  return (kind === 'consult_input' ? consultSchema.parse(parsed) : parsed) as WireTypes[K];
};
export interface Harness {
  dir: string; path: string; store: Store; clock: FixedClock; deps: BrokerDeps; ports: BrokerPorts;
  counts: { quote: number; arm: number; sign: number; recover: number; broadcast: number; approval: number; eligibility: number; answer: number };
  requests: { listing: string; question: string; nonce: string }[]; broadcastBytes: string[];
  behavior: { quote: Map<string, 'ready' | 'declined' | 'throw'>; mutateQuote: ((q: Signed<Quote>) => Signed<Quote>) | null; mutateArm: ((a: Signed<Arm>) => Signed<Arm>) | null; signer: 'normal' | 'lost' | 'denied' | 'substitute'; approval: 'approved' | 'denied'; eligibility: 'eligible' | 'revoked' | 'unknown'; feeEstimate: Lamports | null; reconciliation: Reconciliation; beforeSign: (() => void) | null; beforeApproval: (() => void) | null; beforeBroadcast: (() => void) | null; reveal: 'valid' | 'corrupt' | 'pending' };
  signatures: Map<string, SignResult>; quotes: Map<string, Signed<Quote>>;
  api(): ReturnType<ReturnType<typeof bindBroker>['createBroker']>;
  reopen(): void; cleanup(): void; settle(success?: boolean, actualFee?: bigint): void;
}
export function harness(existingDirectory?: string): Harness {
  const dir = existingDirectory ?? mkdtempSync(join(tmpdir(), 'aab-t3-')), path = join(dir, 'broker.db');
  const store = openStore(path), clock = new FixedClock('2026-10-09T23:59:00.000Z');
  const counts = { quote: 0, arm: 0, sign: 0, recover: 0, broadcast: 0, approval: 0, eligibility: 0, answer: 0 };
  const requests: Harness['requests'] = [], broadcastBytes: string[] = [], quotes = new Map<string, Signed<Quote>>(), signatures = new Map<string, SignResult>();
  const behavior: Harness['behavior'] = { quote: new Map([['a', 'declined'], ['b', 'ready']]), mutateQuote: null, mutateArm: null, signer: 'normal', approval: 'approved', eligibility: 'eligible', feeEstimate: fee(1n), reconciliation: { status: 'pending', reason: 'PAYMENT_UNCERTAIN' }, beforeSign: null, beforeApproval: null, beforeBroadcast: null, reveal: 'valid' };
  const listing = (seller: string): Listing => ({ seller_id: id(seller), display_name: seller, operator_id: id('founder'), listing_kind: 'founder', status: 'active', endpoint: `https://${seller}.invalid`, topics: ['topic'], signing_key: { id: id('seal'), algorithm: 'Ed25519', public_key: address('seal-public') }, slice: { id: id(`slice-${seller}`), manifest_sha256: hash({ v: 1, seller }), manifest_url: `https://${seller}.invalid/manifest`, approved_at: clock.now() }, payment: { rail: 'solana-split-v1', network: 'devnet', genesis_hash: address('genesis'), asset: 'TEST', mint: address('mint'), decimals: M03.tokenDecimals.value, token_program: address('token-program'), total_atomic: amount(M03.totalAtomic.value), seller_owner: address('seller-owner'), seller_token_account: address('seller-token'), marketplace_owner: address('market-owner'), marketplace_token_account: address('market-token'), fee_bps: M03.marketplaceFeeBps.value } });
  const registry: Registry = { v: 1, registry_version: id('registry'), listings: [listing('a'), listing('b')] };
  const question = { question_id: id('question'), text: 'Which completion evidence is needed?', question_sha256: sha('Which completion evidence is needed?'), template_values: {}, topic: 'topic', allowed_origins: registry.listings.map((l) => l.endpoint), allowed_networks: ['devnet' as const], approval_sha256: sha('approval') };
  const questionPolicy = { v: 1 as const, policy_id: id('questions'), approved_at: clock.now(), approval_sha256: sha('approval'), questions: [question] };
  const seal = <T>(payload: T): Signed<T> => ({ payload, signature: { key_id: id('seal'), algorithm: 'Ed25519', value: 'synthetic-envelope' } });
  const sellers = new Map<string, SellerClient>();
  for (const l of registry.listings) sellers.set(l.endpoint, {
    async quote(context, request) {
      counts.quote++; requests.push({ listing: l.seller_id, question: request.question, nonce: request.request_nonce });
      const state = behavior.quote.get(l.seller_id);
      if (state === 'throw') throw new Error('synthetic outage');
      if (state === 'declined') return { status: 'declined', abstain: true, quote: null, charged_atomic: amount(0n), reason: 'unavailable' };
      const quote: Quote = { ...l.payment, v: 1, quote_id: id(`q-${l.seller_id}-${request.request_id}`), nonce: request.request_nonce, request_id: request.request_id, buyer_id: context.buyer_id, payer: context.payer, seller_id: l.seller_id, registry_version: registry.registry_version, question_sha256: question.question_sha256, slice_id: l.slice.id, manifest_sha256: l.slice.manifest_sha256, answer_sha256: sha('placeholder'), issued_at: clock.now(), expires_at: iso(new Date(Date.parse(clock.now()) + M03.quoteTtl.value * 1000).toISOString()), seller_atomic: amount(M03.sellerAtomic.value), fee_atomic: amount(M03.marketplaceAtomic.value), memo: `aab:v1:q-${l.seller_id}-${request.request_id}:${request.request_nonce}`, delivery: 'immutable-answer-after-finalized', refund_terms: 'aab-prototype-refund-v1' };
      // fee_bps is listing-only; real T1 would reject it on a quote.
      delete (quote as unknown as Record<string, unknown>).fee_bps;
      const signed = seal({ ...quote, answer_sha256: hash(answer(quote)) });
      const result = behavior.mutateQuote?.(signed) ?? signed; quotes.set(result.payload.quote_id, result); return { status: 'ready', quote: result };
    },
    async arm(context, request) {
      counts.arm++;
      const quote = quotes.get(request.quote_id)!;
      const arm = seal({ v: 1 as const, quote_id: request.quote_id, buyer_id: context.buyer_id, quote_sha256: hash(quote.payload), message_sha256: request.message_sha256, recent_blockhash: request.recent_blockhash, last_valid_block_height: request.last_valid_block_height, armed_at: clock.now() });
      return behavior.mutateArm?.(arm) ?? arm;
    },
    async eligibility(slice_id, manifest_sha256): Promise<Eligibility> { counts.eligibility++; return { slice_id, manifest_sha256, state: behavior.eligibility, generation: behavior.eligibility === 'revoked' ? 2 : 1, acknowledged_at: clock.now(), checked_at: clock.now() }; },
    async payment() { return { payment_state: 'payment_finalized', delivery_state: 'pending', evidence: null }; },
    async answer(_context, quoteId) { counts.answer++; if (behavior.reveal === 'pending') return { status: 'pending' }; const payload = answer(quotes.get(quoteId)!.payload); return { status: 'ready', answer: seal(behavior.reveal === 'corrupt' ? { ...payload, answer: 'changed' } : payload) }; },
    async manifest() { return seal({ v: 1, seller: l.seller_id }) as unknown as Signed<import('../../../src/wire/contracts.ts').Manifest>; },
    async page() { return Buffer.from('public evidence'); },
  });
  function answer(q: Quote): import('../../../src/wire/contracts.ts').Answer {
    return { v: 1, quote_id: q.quote_id, seller_id: q.seller_id, buyer_id: q.buyer_id, question_sha256: q.question_sha256, slice_id: q.slice_id, manifest_sha256: q.manifest_sha256, commitment_salt: 'synthetic', created_at: q.issued_at, answer: 'public evidence', claims: [], citations: [{ id: id('citation'), page_id: id('page'), content_sha256: sha('public evidence'), byte_start: 0, byte_end: 15, excerpt: 'public evidence', source_url: `${registry.listings.find((l) => l.seller_id === q.seller_id)!.endpoint}/page` }], abstain: false, engine_version: id('extractive-test') };
  }
  const rpc: BrokerDeps['primaryRpc'] = {
    async genesis() { return address('genesis'); }, async latestBlockhash() { return { blockhash: address('blockhash'), lastValidBlockHeight: 100, observedAt: clock.now() }; },
    async finalizedHeight() { return 50; }, async feeForMessage() { return behavior.feeEstimate; }, async accounts() { return { slot: 1, observedAt: clock.now(), accounts: [] }; },
    async signatureStatus(signature) { return { signature, status: 'absent', slot: null, err: null, observedAt: clock.now() }; },
    async finalizedTransaction(signature) { return transaction(signature, false, 1n); },
    async broadcastIdentical(bytes) { behavior.beforeBroadcast?.(); counts.broadcast++; const encoded = Buffer.from(bytes).toString('base64'); broadcastBytes.push(encoded); return JSON.parse(Buffer.from(bytes).toString()).signature as Signature; },
  };
  function transaction(signature: Signature, failed: boolean, actualFee: bigint): import('../../../src/wire/contracts.ts').FinalizedTransaction {
    const row = h.store.scan('signed_transactions', { where: { signature }, limit: 1 })[0]!.value;
    const raw = Buffer.from(row.transaction_base64, 'base64'), parsed = JSON.parse(raw.toString()) as { message: string };
    return { genesis: address('genesis'), signature, transaction: raw, message: Buffer.from(parsed.message, 'base64'), slot: 1, commitment: 'finalized', observedAt: clock.now(), accountKeys: [], instructions: [], meta: { err: failed ? { InstructionError: [1, 'fixture'] } : null, fee: fee(actualFee), preTokenBalances: [], postTokenBalances: [] } };
  }
  const deps: BrokerDeps = { policy: { policy_id: id('policy'), registry_sha256: hash(registry), question_policy_sha256: hash(questionPolicy), buyer, networks: ['devnet'], principal_per_call: amount(M03.devnetPrincipalPerCall.value), principal_per_day: amount(M03.devnetPrincipalPerDay.value), fee_per_call: fee(M03.feePerPurchaseMax.value), fee_per_day: fee(M03.devnetFeePerDayMax.value), mainnet_enabled: false }, registry, questionPolicy, store, clock, sellers,
    signer: { async publicKey() { return buyer.payer; }, async sign(request) {
      behavior.beforeSign?.(); counts.sign++;
      const result: SignResult = behavior.signer === 'denied' ? { status: 'denied', reason: 'POLICY_DENIED' } : { status: 'signed', messageHash: request.messageHash, publicKey: buyer.payer, signature: `signature-${request.requestId}` as Signature, approvalRef: id('signed-approval') };
      signatures.set(request.requestId, result);
      if (behavior.signer === 'lost') throw new Error('lost wallet response');
      if (behavior.signer === 'substitute' && result.status === 'signed') return { ...result, messageHash: sha('substituted') };
      return result;
    }, async recover(request) { counts.recover++; return signatures.get(request) ?? null; } },
    offerApproval: { async review(offer) { behavior.beforeApproval?.(); counts.approval++; return { status: behavior.approval, reviewedHash: offer.quoteHash, actor: 'test', at: clock.now(), approvalRef: id('offer-approval') }; } },
    primaryRpc: Object.assign(rpc, { origin: 'https://rpc-one.invalid' }), secondaryRpc: { ...rpc, origin: 'https://rpc-two.invalid' } as typeof rpc, receiptImporter: { async importReceipt() { return { status: 'import_pending', code: 'NOT_READY' }; }, async readback() { return null; } },
  };
  const ports: BrokerPorts = {
    async validatePaymentAccounts() { /* Synthetic core fixture; real validator pairs live in integration/t3b.test.ts. */ },
    limits: M03, parseWire: parse, canonicalBytes: (v: JsonValue) => Buffer.from(canonicalize(v)!), payloadHash: hash,
    resolveQuestion(policy, value) { const q = policy.questions.find((q) => q.question_id === value.question_id && hash(q.template_values) === hash(value.template_values ?? {})); if (!q) throw new FoundationError('POLICY_DENIED'); return q; },
    verifyEnvelope(_kind, value) { if (value.signature.value !== 'synthetic-envelope') throw new FoundationError('VERIFICATION_FAILED'); },
    verifyCitations(value, _manifest, pages) { assert.equal(value.payload.citations[0]?.excerpt, decodeUtf8(pages.get(id('page'))!)); },
    payer: { payer: buyer.payer, tokenAccount: address('payer-token') }, rpcOrigins: ['https://rpc-one.invalid', 'https://rpc-two.invalid'],
    buildLegacyPayment(quote, payer, blockhash) { const message = Buffer.from(canonicalize({ quote: quote.payload.quote_id, payer: payer.payer, blockhash: blockhash.blockhash })!), messageHash = sha(message); const expected = { quote, payer, blockhash, messageHash }; return { message, messageHash, expected, decoded: ports.validateLegacyMessage(message, expected) }; },
    validateLegacyMessage(message, expected) { assert.equal(sha(message), expected.messageHash); const parsed = JSON.parse(Buffer.from(message).toString()); assert.equal(parsed.quote, expected.quote.payload.quote_id); assert.equal(parsed.payer, expected.payer.payer); assert.equal(parsed.blockhash, expected.blockhash.blockhash); return { payer: expected.payer, accountKeys: [], instructions: [], recentBlockhash: expected.blockhash.blockhash, memo: expected.quote.payload.memo }; },
    attachSignature(payment, signed) { assert.equal(signed.status, 'signed'); if (signed.status !== 'signed') throw new Error('unreachable'); return { signature: signed.signature, messageHash: payment.messageHash, transaction: Buffer.from(JSON.stringify({ message: Buffer.from(payment.message).toString('base64'), signature: signed.signature })) }; },
    async reconcilePayment() { return behavior.reconciliation; }, verifyFinalizedPayment() { assert.equal(behavior.reconciliation.status, 'finalized_success'); if (behavior.reconciliation.status !== 'finalized_success') throw new Error('unreachable'); return behavior.reconciliation.evidence; },
    persistReceipt(tx, receipt) { const old = tx.read('receipts', receipt.receipt_id); if (old) tx.compareAndSet('receipts', receipt.receipt_id, old.version, receipt); else tx.insert('receipts', receipt.receipt_id, receipt); return receipt.receipt_id; },
  };
  const h: Harness = { dir, path, store, clock, deps, ports, counts, behavior, requests, broadcastBytes, quotes, signatures,
    api() { return bindBroker(h.ports).createBroker(h.deps); },
    reopen() { h.store.close(); h.store = openStore(path); h.deps = { ...h.deps, store: h.store }; },
    cleanup() { h.store.close(); rmSync(dir, { recursive: true, force: true }); },
    settle(success = true, actualFee = 1n) { const signed = h.store.scan('signed_transactions', { limit: 1 })[0]!.value, q = quotes.get(signed.quote_id)!.payload;
      behavior.reconciliation = success ? { status: 'finalized_success', evidence: { genesis: q.genesis_hash, signature: signed.signature, quote_id: q.quote_id, message_sha256: signed.message_sha256, slot: 1, observed_at: clock.now(), commitment: 'finalized', meta_err: null, actual_fee: fee(actualFee), payer_debit: q.total_atomic, seller_credit: q.seller_atomic, marketplace_credit: q.fee_atomic, transaction_sha256: sha(Buffer.from(signed.transaction_base64, 'base64')) } } : { status: 'finalized_failure', actualFee: fee(actualFee), transaction: transaction(signed.signature, true, actualFee) };
    },
  };
  return h;
}
