import { assertRpcOrigins } from '../chain/index.ts';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AnswerDisposition, ArmRequest, BuyerContext, ConsultRow, ExpectedPayment, Id, IsoTime, PaymentView, ProofLocator, Quote, QuoteDisposition, QuoteRequest, Revocation, SellerClient, Signed, Arm, SignedKind, SignedTypes, SellerCallOptions } from '../wire/contracts.ts';
import { FoundationError, decodeAmount, withDeadline } from '../common/index.ts';
import { Admission } from './admission.ts';
import { EligibilityGate, revokeSlice, sellerLock } from './eligibility.ts';
import { decline, digest, opaque, pagePath, validatePublicBundle } from './preparation.ts';
import { jsonValue } from './ports.ts';
import type { SellerArmRow, SellerDependencies, SellerQuoteRow, SellerRequestRecord, SellerConfig } from './ports.ts';

type RequestRow = ConsultRow & SellerRequestRecord;
export class SellerController implements SellerClient {
  readonly #deps: SellerDependencies; readonly #gate: EligibilityGate; readonly #admission: Admission;
  #started = false;
  #inflight = new Map<string, { body: string; result: Promise<QuoteDisposition> }>();
  constructor(deps: SellerDependencies) {
    assertRpcOrigins(deps.primaryRpc, deps.secondaryRpc, (deps.config as SellerConfig).rpcOrigins);
    // Injected functions stay capabilities; copy all mutable public configuration/bytes.
    this.#deps = { ...deps, bundle: structuredClone(deps.bundle), config: { ...deps.config,
      listing: structuredClone(deps.config.listing), invitations: structuredClone(deps.config.invitations) } };
    this.#gate = new EligibilityGate(this.#deps);
    this.#admission = new Admission(deps.store, deps.clock, deps.config.limits, deps.bundle.manifest.payload.seller_id);
  }
  async start(): Promise<void> {
    await sellerLock(this.#deps.store).run(async () => {
      this.#started = false;
      const { bundle, config: c } = this.#deps; const p = c.listing.payment;
      if (new URL(c.origin).origin !== c.origin || c.listing.endpoint !== c.origin || c.listing.seller_id !== bundle.manifest.payload.seller_id || c.listing.slice.id !== bundle.manifest.payload.slice_id || c.listing.slice.manifest_sha256 !== c.wire.hash(jsonValue(bundle.manifest.payload))) throw new FoundationError('NOT_READY');
      if (decodeAmount(p.total_atomic) !== c.limits.totalAtomic.value || p.decimals !== c.limits.tokenDecimals.value || p.fee_bps !== c.limits.marketplaceFeeBps.value) throw new FoundationError('NOT_READY');
      if (p.network === 'mainnet-beta' && (c.sealActor !== 'human' || c.listing.listing_kind !== 'founder')) throw new FoundationError('NOT_READY');
      for (const invitation of c.invitations) {
        if (invitation.origin !== c.origin || !/^[a-f0-9]{64}$/.test(invitation.token_sha256) || invitation.buyer.payer === p.seller_owner || invitation.buyer.payer === p.marketplace_owner) throw new FoundationError('NOT_READY');
      }
      if (p.seller_owner === p.marketplace_owner || p.seller_token_account === p.marketplace_token_account) throw new FoundationError('NOT_READY');
      validatePublicBundle(bundle, c); c.wire.verify('manifest', bundle.manifest, c.listing.signing_key);
      await this.#gate.start(); this.#markRevokedLiabilities(); this.#started = true;
    });
  }
  authenticate(origin: string, token: string): BuyerContext {
    const hash = Buffer.from(digest(token), 'hex');
    const invitation = this.#deps.config.invitations.find((i) => i.origin === origin && origin === this.#deps.config.origin && timingSafeEqual(hash, Buffer.from(i.token_sha256, 'hex')));
    if (!invitation) throw new FoundationError('UNAUTHORIZED'); return structuredClone(invitation.buyer);
  }
  #buyer(context: BuyerContext): void {
    if (!this.#deps.config.invitations.some((i) => i.buyer.buyer_id === context.buyer_id && i.buyer.payer === context.payer && i.buyer.session_id === context.session_id)) throw new FoundationError('UNAUTHORIZED');
  }
  #owned(context: BuyerContext, id: Id): SellerQuoteRow {
    this.#buyer(context); const row = this.#deps.store.read('quotes', id)?.value as SellerQuoteRow | undefined;
    if (!row || row.quote.payload.buyer_id !== context.buyer_id || row.quote.payload.payer !== context.payer) throw new FoundationError('UNAUTHORIZED'); return row;
  }
  #rows(): SellerQuoteRow[] {
    const rows: SellerQuoteRow[] = []; let cursor: string | undefined;
    for (;;) {
      const row = this.#deps.store.scan('quotes', { limit: 1, ...(cursor ? { cursor } : {}) })[0]?.value as SellerQuoteRow | undefined;
      if (!row) return rows; rows.push(row); cursor = row.quote.payload.quote_id;
    }
  }
  #markRevokedLiabilities(): void {
    for (const row of this.#rows()) {
      const q = row.quote.payload;
      if (row.payment_state === 'payment_finalized' && this.#deps.store.read('tombstones', `${q.slice_id}:${q.manifest_sha256}`) && row.refund_state !== 'refund_pending') {
        this.#save({ ...row, delivery_state: 'recovery_required', refund_state: 'refund_pending', requested_recovery_atomic: q.total_atomic }, 'REVOKED_LIABILITY');
      }
    }
  }
  #save(row: SellerQuoteRow, code: string): void {
    const { store, clock } = this.#deps; const id = row.quote.payload.quote_id;
    store.transaction((tx) => {
      const current = tx.read('quotes', id); if (!current) throw new FoundationError('STATE_CONFLICT');
      tx.compareAndSet('quotes', id, current.version, row);
      tx.append({ event_id: randomUUID() as Id, consult_id: id, code, recorded_at: clock.now(), counters: {} });
    });
  }
  async #sign<K extends SignedKind>(kind: K, payload: SignedTypes[K]): Promise<Signed<SignedTypes[K]>> {
    const { signer, bundle, config: c } = this.#deps;
    const envelope = await signer.sign(kind, payload, { kind, payloadHash: c.wire.hash(jsonValue(payload)), approvalId: bundle.approval.approval_id, actor: c.sealActor });
    if (c.wire.hash(jsonValue(envelope.payload)) !== c.wire.hash(jsonValue(payload))) throw new FoundationError('VERIFICATION_FAILED');
    c.wire.verify(kind, envelope, c.listing.signing_key);
    if (c.wire.canonical(jsonValue(envelope)).length > c.limits.signedEnvelopeMax.value * 1024) throw new FoundationError('VERIFICATION_FAILED');
    return envelope;
  }
  async ready(): Promise<boolean> {
    try { await sellerLock(this.#deps.store).run(() => this.#gate.check(true)); return true; } catch { return false; }
  }
  async quote(context: BuyerContext, input: QuoteRequest, ip = 'protected-local-port', options?: SellerCallOptions): Promise<QuoteDisposition> {
    return withDeadline(this.#deps.clock, this.#deps.config.limits.precheckMax.value * 1000, (call) => this.#quote(context, input, ip, call.signal), options);
  }
  async #quote(context: BuyerContext, input: QuoteRequest, ip: string, signal: AbortSignal): Promise<QuoteDisposition> {
    this.#buyer(context); const { config: c, clock, store } = this.#deps;
    input = c.wire.parse('quote_request', c.wire.canonical(jsonValue(input)));
    const key = `${context.buyer_id}:${input.request_id}`; const body = c.wire.hash(jsonValue(input));
    const existing = this.#inflight.get(key);
    if (existing) {
      if (existing.body !== body) throw new FoundationError('IDEMPOTENCY_CONFLICT');
      const started = clock.monotonicMs(); const result = await existing.result;
      const padding = c.limits.readyDeclineResponseMin.value * 1000 - (clock.monotonicMs() - started);
      if (padding > 0) await clock.sleep(Math.ceil(padding), signal);
      signal.throwIfAborted();
      await sellerLock(store).run(() => this.#gate.check(true)); return structuredClone(result);
    }
    const result = this.#quoteInternal(context, input, ip, signal); this.#inflight.set(key, { body, result });
    try { return await result; } finally { this.#inflight.delete(key); }
  }
  async #quoteInternal(context: BuyerContext, input: QuoteRequest, ip: string, signal: AbortSignal): Promise<QuoteDisposition> {
    this.#buyer(context); const { config: c, clock, store, bundle } = this.#deps;
    const started = clock.monotonicMs();
    // Even typed callers re-enter the shared runtime schema boundary.
    input = c.wire.parse('quote_request', c.wire.canonical(jsonValue(input)));
    if (input.buyer_id !== context.buyer_id || input.payer !== context.payer) throw new FoundationError('UNAUTHORIZED');
    if (input.seller_id !== c.listing.seller_id || input.slice_id !== c.listing.slice.id || input.registry_version !== c.registryVersion || input.network !== c.listing.payment.network) throw new FoundationError('POLICY_DENIED');
    const key = `${context.buyer_id}:${input.request_id}`;
    const body = c.wire.hash(jsonValue(input)); let release: (() => void) | undefined;
    const abort = new AbortController();
    const cancel = (): void => abort.abort(signal.reason);
    signal.throwIfAborted(); signal.addEventListener('abort', cancel, { once: true });
    const operation = async (): Promise<QuoteDisposition> => {
      const cached = await sellerLock(store).run(() => {
        this.#gate.check(true);
        const previous = store.read('consults', key)?.value as RequestRow | undefined;
        if (previous) {
          if (previous.body_sha256 !== body) throw new FoundationError('IDEMPOTENCY_CONFLICT');
          return previous.quote_id ? { status: 'ready' as const, quote: this.#owned(context, previous.quote_id).quote } : previous.disposition!;
        }
        if (this.#rows().some((r) => r.refund_state === 'refund_pending')) throw new FoundationError('NOT_READY');
        this.#admission.reserve(context, ip); return null;
      });
      if (cached) return cached;
      release = await this.#admission.enter(context.buyer_id); abort.signal.throwIfAborted();
      const policy = c.wire.parse('question_policy', bundle.files.get('question-policy.json')!);
      const qhash = digest(new TextEncoder().encode(input.question));
      const question = policy.questions.find((q) => q.text === input.question && q.question_sha256 === qhash && q.allowed_origins.includes(c.origin) && q.allowed_networks.includes(input.network));
      const dedup = c.wire.hash(jsonValue([context.buyer_id, context.payer, c.listing.seller_id, qhash, c.listing.slice.manifest_sha256, bundle.manifest.payload.policy_sha256]));
      await sellerLock(store).run(() => {
        this.#gate.check(true);
        const rows = this.#rows();
        const same = rows.find((r) => r.dedup_sha256 === dedup && Date.parse(clock.now()) - Date.parse(r.quote.payload.issued_at) <= c.limits.dedupWindow.value * 60000);
        // A new request must never silently inherit a different request's payable quote.
        if (same) throw new FoundationError('IDEMPOTENCY_CONFLICT');
        const unarmed = rows.filter((r) => r.quote.payload.buyer_id === context.buyer_id && Date.parse(r.quote.payload.expires_at) > Date.parse(clock.now()) && !store.read('arms', r.quote.payload.quote_id));
        if (unarmed.length >= c.limits.buyerSellerUnarmedReadyMax.value) throw new FoundationError('RATE_LIMITED');
        return;
      });
      if (!question || decodeAmount(input.max_total_atomic) < c.limits.totalAtomic.value) return this.#persistDecline(key, body, context, input);
      const quoteId = randomUUID() as Id; const now = clock.now();
      const answerContext = { quote_id: quoteId, buyer_id: context.buyer_id, created_at: now, commitment_salt: randomBytes(32).toString('base64url') };
      const prepared = await c.worker.prepare(question, answerContext, abort.signal);
      abort.signal.throwIfAborted();
      if ('status' in prepared) return this.#persistDecline(key, body, context, input);
      // Controller verifies untrusted worker output against a fresh pure reconstruction.
      const { prepareAnswer } = await import('./preparation.ts');
      const expected = prepareAnswer(bundle, question, answerContext, c);
      if ('status' in expected || expected.answer_sha256 !== prepared.answer_sha256 || c.wire.hash(jsonValue(prepared.answer)) !== expected.answer_sha256) throw new FoundationError('VERIFICATION_FAILED');
      await c.scanOutput(prepared.answer); abort.signal.throwIfAborted();
      const answer = await this.#sign('answer', prepared.answer); abort.signal.throwIfAborted();
      c.wire.citations(answer, bundle.manifest, new Map(bundle.manifest.payload.pages.map((p) => [p.page_id, bundle.files.get(pagePath(p.page_id))!])));
      const nonce = randomBytes(16).toString('base64url'); const { fee_bps: _fee, ...payment } = c.listing.payment;
      const quote: Quote = { ...payment, v: 1, quote_id: quoteId, nonce, request_id: input.request_id, buyer_id: context.buyer_id, payer: context.payer,
        seller_id: c.listing.seller_id, registry_version: c.registryVersion, question_sha256: qhash, slice_id: c.listing.slice.id, manifest_sha256: c.listing.slice.manifest_sha256,
        answer_sha256: prepared.answer_sha256, issued_at: now, expires_at: new Date(Date.parse(now) + c.limits.quoteTtl.value * 1000).toISOString() as IsoTime,
        seller_atomic: c.limits.sellerAtomic.value.toString() as Quote['seller_atomic'], fee_atomic: c.limits.marketplaceAtomic.value.toString() as Quote['fee_atomic'],
        memo: `aab:v1:${quoteId}:${nonce}`, delivery: 'immutable-answer-after-finalized', refund_terms: 'aab-prototype-refund-v1' };
      const signed = await this.#sign('quote', quote); abort.signal.throwIfAborted();
      await sellerLock(store).run(() => {
        abort.signal.throwIfAborted(); this.#gate.check(true);
        const row: SellerQuoteRow = { seller_request_key: key, quote: signed, answer, body_sha256: body, dedup_sha256: dedup, payment_state: 'not_applicable', delivery_state: 'pending', refund_state: 'none', requested_recovery_atomic: '0', proof: null };
        const request: RequestRow = { buyer_id: context.buyer_id, request_id: input.request_id, body_sha256: body, view: null, quote_id: quoteId, disposition: null };
        store.transaction((tx) => {
          tx.insert('quotes', quoteId, row); tx.insert('consults', key, request);
          tx.append({ event_id: randomUUID() as Id, consult_id: quoteId, code: 'ANSWER_QUOTE_COMMITTED', recorded_at: clock.now(), counters: {} });
        });
      });
      return { status: 'ready', quote: signed };
    };
    const timeout = clock.sleep(c.limits.precheckMax.value * 1000, abort.signal).then(() => { abort.abort(); throw new FoundationError('SELLER_UNAVAILABLE'); });
    try {
      const running = operation().finally(() => release?.());
      const result = await Promise.race([running, timeout]);
      const padding = c.limits.readyDeclineResponseMin.value * 1000 - (clock.monotonicMs() - started);
      if (padding > 0) await clock.sleep(Math.ceil(padding), signal);
      signal.throwIfAborted();
      // Padding/slow sign/scan must not create a revocation bypass.
      await sellerLock(store).run(() => this.#gate.check(true)); return structuredClone(result);
    } finally { abort.abort(); signal.removeEventListener('abort', cancel); }
  }
  async #persistDecline(key: string, body: RequestRow['body_sha256'], context: BuyerContext, input: QuoteRequest): Promise<QuoteDisposition> {
    return sellerLock(this.#deps.store).run(() => {
      this.#gate.check(true); const result = decline();
      const row: RequestRow = { buyer_id: context.buyer_id, request_id: input.request_id, body_sha256: body, view: null, quote_id: null, disposition: result };
      this.#deps.store.transaction((tx) => tx.insert('consults', key, row)); return result;
    });
  }
  #callAllowed(options?: SellerCallOptions): void {
    options?.signal?.throwIfAborted();
    if (options?.deadline !== undefined && !(Date.parse(options.deadline) > Date.parse(this.#deps.clock.now()))) throw new FoundationError('SELLER_UNAVAILABLE');
  }
  async arm(context: BuyerContext, input: ArmRequest, options?: SellerCallOptions): Promise<Signed<Arm>> {
    this.#callAllowed(options);
    const { config: c, store, clock } = this.#deps;
    input = c.wire.parse('arm_request', c.wire.canonical(jsonValue(input)));
    return sellerLock(store).run(async () => {
      this.#callAllowed(options); this.#gate.check(true); const row = this.#owned(context, input.quote_id);
      const oldVersion = store.read('arms', input.quote_id);
      const old = oldVersion?.value as SellerArmRow | undefined;
      const message = Buffer.from(input.message_base64, 'base64');
      if (message.toString('base64') !== input.message_base64 || digest(message) !== input.message_sha256) throw new FoundationError('PAYMENT_INVALID');
      if (old && old.message_sha256 === input.message_sha256) {
        if (old.arm.payload.recent_blockhash !== input.recent_blockhash || old.arm.payload.last_valid_block_height !== input.last_valid_block_height ||
            (input.renewal && c.wire.hash(jsonValue(input.renewal)) !== c.wire.hash(jsonValue(old.renewal ?? null)))) throw new FoundationError('IDEMPOTENCY_CONFLICT');
        return structuredClone(old.arm);
      }
      if (old) {
        if (!input.renewal || input.renewal.previous_arm_sha256 !== c.wire.hash(jsonValue(old.arm.payload)) || input.renewal.unsigned_message_sha256 !== old.message_sha256) throw new FoundationError('IDEMPOTENCY_CONFLICT');
        // CONTRACT REQUEST: M03.messageRenewalsMax; missing configuration is offline.
        const cap = (c.limits as typeof c.limits & { messageRenewalsMax?: { value: number } }).messageRenewalsMax?.value;
        if (cap === undefined || !Number.isSafeInteger(cap) || cap < 0) throw new FoundationError('NOT_READY');
        if ((old.renewalCount ?? 0) >= cap) throw new FoundationError('BUDGET_EXCEEDED');
        if (row.proof || row.payment_state !== 'payment_pending' || store.scan('signed_transactions', { where: { quote_id: input.quote_id }, limit: 1 }).length) throw new FoundationError('PAYMENT_UNCERTAIN');
        const observations = await Promise.all([this.#deps.primaryRpc, this.#deps.secondaryRpc].map(async rpc => ({ genesis: await rpc.genesis(), height: await rpc.finalizedHeight() })));
        if (!observations.every(o => o.genesis === row.quote.payload.genesis_hash && Number.isSafeInteger(o.height) && o.height > old.arm.payload.last_valid_block_height) ||
            input.recent_blockhash === old.arm.payload.recent_blockhash || input.last_valid_block_height <= Math.max(...observations.map(o => o.height))) throw new FoundationError('PAYMENT_UNCERTAIN');
      } else if (input.renewal) throw new FoundationError('STATE_CONFLICT');
      if (this.#rows().some((r) => r.refund_state === 'refund_pending')) throw new FoundationError('NOT_READY');
      if (Date.parse(row.quote.payload.expires_at) - Date.parse(clock.now()) < c.limits.armRemainingMin.value * 1000) throw new FoundationError('QUOTE_EXPIRED');
      const expected: ExpectedPayment = { quote: row.quote, payer: c.payerAccounts(context), messageHash: input.message_sha256,
        blockhash: { blockhash: input.recent_blockhash, lastValidBlockHeight: input.last_valid_block_height, observedAt: clock.now() } };
      if (expected.payer.payer !== context.payer) throw new FoundationError('PAYMENT_INVALID');
      c.validateMessage(message, expected);
      const payload: Arm = { v: 1, quote_id: input.quote_id, buyer_id: context.buyer_id, quote_sha256: c.wire.hash(jsonValue(row.quote.payload)), message_sha256: input.message_sha256, recent_blockhash: input.recent_blockhash, last_valid_block_height: input.last_valid_block_height, armed_at: clock.now() };
      const signed = await this.#sign('arm', payload); this.#callAllowed(options); this.#gate.check(true);
      if (Date.parse(row.quote.payload.expires_at) - Date.parse(clock.now()) < c.limits.armRemainingMin.value * 1000) throw new FoundationError('QUOTE_EXPIRED');
      const value: SellerArmRow = { quote_id: input.quote_id, message_sha256: input.message_sha256, arm: signed, expected, ...(input.renewal ? { renewal: input.renewal, renewalCount: (old?.renewalCount ?? 0) + 1 } : {}) };
      store.transaction((tx) => {
        if (old && oldVersion) {
          const bytes = c.wire.canonical(jsonValue(old)), sha256 = digest(bytes);
          if (!tx.read('artifacts', sha256)) tx.insert('artifacts', sha256, { sha256, bytes_base64: Buffer.from(bytes).toString('base64') });
          tx.compareAndSet('arms', input.quote_id, oldVersion.version, value);
        } else tx.insert('arms', input.quote_id, value);
        const current = tx.read('quotes', input.quote_id)!;
        const pending: SellerQuoteRow = { ...row, payment_state: 'payment_pending' };
        tx.compareAndSet('quotes', input.quote_id, current.version, pending);
        tx.append({ event_id: randomUUID() as Id, consult_id: input.quote_id, code: 'ARM_COMMITTED', recorded_at: clock.now(), counters: {} }); });
      return structuredClone(signed);
    });
  }
  async payment(context: BuyerContext, proof: ProofLocator, options?: SellerCallOptions): Promise<PaymentView> {
    this.#callAllowed(options);
    const { config: c, store, primaryRpc, secondaryRpc, clock } = this.#deps;
    proof = c.wire.parse('proof', c.wire.canonical(jsonValue(proof)));
    const expected = await sellerLock(store).run(() => {
      if (!this.#started) throw new FoundationError('NOT_READY');
      const row = this.#owned(context, proof.quote_id); const arm = store.read('arms', proof.quote_id)?.value as SellerArmRow | undefined;
      if (!arm || proof.quote_sha256 !== c.wire.hash(jsonValue(row.quote.payload)) || proof.arm_ticket_sha256 !== c.wire.hash(jsonValue(arm.arm.payload)) || proof.message_sha256 !== arm.message_sha256 || proof.network !== row.quote.payload.network || proof.genesis_hash !== row.quote.payload.genesis_hash) throw new FoundationError('PAYMENT_INVALID');
      if (row.proof && c.wire.hash(jsonValue(row.proof)) !== c.wire.hash(jsonValue(proof))) throw new FoundationError('IDEMPOTENCY_CONFLICT');
      if (!row.proof) this.#save({ ...row, proof }, 'PROOF_LOCATOR_RECORDED'); return arm.expected;
    });
    // Locator is never evidence. These are controller-owned, independently configured RPCs.
    let result;
    try { result = await c.reconcile(expected, proof.transaction_signature, primaryRpc, secondaryRpc); }
    catch { return this.#paymentView(context, proof.quote_id); }
    return sellerLock(store).run(() => {
      const row = this.#owned(context, proof.quote_id);
      if (row.payment_state === 'payment_finalized') return this.#paymentView(context, proof.quote_id);
      if (result.status === 'finalized_success') {
        const e = result.evidence; const q = row.quote.payload;
        if (e.signature !== proof.transaction_signature || e.quote_id !== q.quote_id || e.genesis !== q.genesis_hash || e.message_sha256 !== proof.message_sha256 || e.commitment !== 'finalized' || e.meta_err !== null || e.payer_debit !== q.total_atomic || e.seller_credit !== q.seller_atomic || e.marketplace_credit !== q.fee_atomic) throw new FoundationError('PAYMENT_INVALID');
        const key = `${e.genesis}:${e.signature}`; const existing = store.read('settlements', key);
        if (existing && existing.value.quote_id !== q.quote_id) throw new FoundationError('PAYMENT_INVALID');
        let safe = true; try { this.#callAllowed(options); this.#gate.check(); } catch { safe = false; }
        const updated: SellerQuoteRow = { ...row, payment_state: 'payment_finalized', delivery_state: safe ? 'pending' : 'recovery_required', refund_state: safe ? 'none' : 'refund_pending', requested_recovery_atomic: safe ? '0' : q.total_atomic };
        store.transaction((tx) => {
          if (!existing) tx.insert('settlements', key, e);
          const current = tx.read('quotes', q.quote_id)!; tx.compareAndSet('quotes', q.quote_id, current.version, updated);
          tx.append({ event_id: randomUUID() as Id, consult_id: q.quote_id, code: 'PAYMENT_FINALIZED', recorded_at: clock.now(), counters: {} });
        });
      } else if (result.status === 'finalized_failure' || result.status === 'expired') {
        // Retain full content-free failure/expiry evidence without pretending fee is zero.
        const bytes = c.wire.canonical(jsonValue(result.status === 'finalized_failure' ? { status: result.status, actualFee: result.actualFee, signature: result.transaction.signature, slot: result.transaction.slot } : result));
        const hash = digest(bytes);
        const updated: SellerQuoteRow = { ...row, payment_state: 'payment_failed', failure_evidence_sha256: hash };
        store.transaction((tx) => {
          if (!tx.read('artifacts', hash)) tx.insert('artifacts', hash, { sha256: hash, bytes_base64: Buffer.from(bytes).toString('base64') });
          const current = tx.read('quotes', proof.quote_id)!; tx.compareAndSet('quotes', proof.quote_id, current.version, updated);
          tx.append({ event_id: randomUUID() as Id, consult_id: proof.quote_id, code: result.status === 'expired' ? 'PAYMENT_EXPIRED' : 'PAYMENT_FAILED', recorded_at: clock.now(), counters: {} });
        });
      }
      return this.#paymentView(context, proof.quote_id);
    });
  }
  #paymentView(context: BuyerContext, id: Id): PaymentView {
    const row = this.#owned(context, id);
    const evidence = row.proof ? this.#deps.store.read('settlements', `${row.proof.genesis_hash}:${row.proof.transaction_signature}`)?.value ?? null : null;
    return { payment_state: row.payment_state, delivery_state: row.delivery_state, evidence };
  }
  async answer(context: BuyerContext, quoteId: Id, options?: SellerCallOptions): Promise<AnswerDisposition> {
    this.#callAllowed(options);
    return sellerLock(this.#deps.store).run(() => {
      const row = this.#owned(context, quoteId); const { config: c, bundle } = this.#deps;
      try { this.#callAllowed(options); this.#gate.check(); }
      catch (error) {
        if (row.payment_state === 'payment_finalized') this.#save({ ...row, delivery_state: 'recovery_required', refund_state: 'refund_pending', requested_recovery_atomic: row.quote.payload.total_atomic }, 'DISCLOSURE_WITHHELD');
        return { status: 'withheld', code: error instanceof FoundationError ? error.code : 'NOT_READY' };
      }
      if (row.payment_state !== 'payment_finalized') return { status: 'pending' };
      // A returned share cannot be silently undone by late answer recovery.
      if (row.refund_state === 'partial_refund' || row.refund_state === 'refunded') return { status: 'withheld', code: 'NOT_READY' };
      try {
        if (!row.answer) throw new FoundationError('VERIFICATION_FAILED');
        c.wire.verify('answer', row.answer, c.listing.signing_key);
        if (c.wire.hash(jsonValue(row.answer.payload)) !== row.quote.payload.answer_sha256) throw new FoundationError('VERIFICATION_FAILED');
        c.wire.citations(row.answer, bundle.manifest, new Map(bundle.manifest.payload.pages.map((p) => [p.page_id, bundle.files.get(pagePath(p.page_id))!])));
      } catch {
        this.#save({ ...row, delivery_state: 'delivery_failed', refund_state: 'refund_pending', requested_recovery_atomic: row.quote.payload.total_atomic }, 'CACHED_ANSWER_INVALID');
        return { status: 'withheld', code: 'VERIFICATION_FAILED' };
      }
      // Exact verified recovery satisfies the current obligation in the same commit
      // as disclosure; NON_DELIVERY / CACHED_ANSWER_INVALID history stays append-only.
      this.#save({ ...row, delivery_state: 'delivered', refund_state: 'none', requested_recovery_atomic: '0' }, 'DELIVERY_AUTHORIZED');
      // This is the disclosure linearization point, under the same lock as revokeSlice.
      if (!row.answer) throw new FoundationError('VERIFICATION_FAILED');
      return { status: 'ready', answer: structuredClone(row.answer) };
    });
  }
  async manifest(sliceId: Id, options?: SellerCallOptions) {
    this.#callAllowed(options);
    return sellerLock(this.#deps.store).run(() => { this.#callAllowed(options); this.#gate.check(); this.#slice(sliceId); return structuredClone(this.#deps.bundle.manifest); });
  }
  async page(sliceId: Id, pageId: Id, options?: SellerCallOptions): Promise<Uint8Array> {
    this.#callAllowed(options);
    return sellerLock(this.#deps.store).run(() => {
      this.#callAllowed(options); this.#gate.check(); this.#slice(sliceId); opaque(pageId);
      if (!this.#deps.bundle.manifest.payload.pages.some((p) => p.page_id === pageId)) throw new FoundationError('INVALID_INPUT');
      return Uint8Array.from(this.#deps.bundle.files.get(pagePath(pageId))!);
    });
  }
  #slice(sliceId: Id): void { if (sliceId !== this.#deps.bundle.manifest.payload.slice_id) throw new FoundationError('INVALID_INPUT'); }
  async eligibility(sliceId: Id, manifestHash: Quote['manifest_sha256'], options?: SellerCallOptions) {
    this.#callAllowed(options);
    return sellerLock(this.#deps.store).run(() => { this.#slice(sliceId); if (manifestHash !== this.#deps.config.listing.slice.manifest_sha256) throw new FoundationError('NOT_READY'); this.#callAllowed(options); return this.#gate.check(); });
  }
  async revoke(revocation: Revocation): Promise<void> {
    await revokeSlice(this.#deps.store, revocation, this.#deps.tombstones);
    await sellerLock(this.#deps.store).run(() => {
      for (const row of this.#rows()) if (row.quote.payload.slice_id === revocation.slice_id && row.quote.payload.manifest_sha256 === revocation.manifest_sha256 && row.payment_state === 'payment_finalized') this.#save({ ...row, delivery_state: 'recovery_required', refund_state: 'refund_pending', requested_recovery_atomic: row.quote.payload.total_atomic }, 'REVOKED_LIABILITY');
    });
  }
  /** Host scheduler calls at M03 sellerReconciliationInterval; no public admin route. */
  async reconcilePending(): Promise<void> {
    for (const row of this.#rows()) {
      const buyer = this.#deps.config.invitations.find((i) => i.buyer.buyer_id === row.quote.payload.buyer_id)?.buyer;
      if (!buyer) continue;
      if (row.proof) await this.payment(buyer, row.proof);
      const current = this.#deps.store.read('quotes', row.quote.payload.quote_id)?.value as SellerQuoteRow;
      const evidence = this.#paymentView(buyer, row.quote.payload.quote_id).evidence;
      if (current.payment_state === 'payment_finalized' && current.delivery_state === 'pending' && evidence && Date.parse(this.#deps.clock.now()) - Date.parse(evidence.observed_at) >= this.#deps.config.limits.nonDeliveryAfterFinality.value * 60000) {
        await sellerLock(this.#deps.store).run(() => {
          const fresh = this.#owned(buyer, row.quote.payload.quote_id);
          if (fresh.delivery_state === 'pending') this.#save({ ...fresh, delivery_state: 'recovery_required', refund_state: 'refund_pending', requested_recovery_atomic: fresh.quote.payload.total_atomic }, 'NON_DELIVERY');
        });
      }
    }
  }
}
export function createSellerService(deps: SellerDependencies): SellerController { return new SellerController(deps); }
