import { atomicFromBigint, decodeAmount, FoundationError, lamportsFromBigint, encodeUtf8, withDeadline } from '../common/index.ts';
import type { Arm, BrokerDeps, ConsultInput, ConsultView, CreateBroker, Id, Lamports, ListingDisposition, MarketApi, Receipt, RecoverySummary, ResumePending, Sha256, Signed, SignResult, StoreTx, UnsignedPayment, SellerCallOptions } from '../wire/contracts.ts';
import type { BoundBroker, BrokerPorts, BrokerRuntimeDeps } from './ports.ts';
import { artifact, consultKey, digest, journals, json, readJournal, snapshotArtifacts, update, updateTx } from './journal.ts';
import type { BrokerRow, BrokerSignedRow } from './journal.ts';
import { admit, armTime, boot, candidates, contextAllowed, eligibilityAllowed, exactKeys, quoteAllowed, requireThat } from './policy.ts';
import { armedCheck, finishCheck, takeChecks } from './admission.ts';
import { reserve, resolveReservation } from './reservations.ts';
import { validatePaymentAccounts } from '../chain/index.ts';

// Missing dispatch metadata on legacy rows allows only an identical resend.
type DispatchRow = BrokerSignedRow;

const zero = atomicFromBigint(0n), zeroFee = lamportsFromBigint(0n);
/** Cancel seller transport work while retaining uncertain payment reservations. */
export async function bounded<T>(deps: BrokerDeps, ms: number, action: (options: SellerCallOptions) => Promise<T>, parent?: SellerCallOptions): Promise<T> {
  return withDeadline(deps.clock, ms, action, parent);
}
function view(id: Id): ConsultView {
  return { consult_id: id, receipt_id: `r_${id}` as Id, consult_state: 'precheck_running', dispositions: [], payment_state: 'not_applicable', content_state: 'unknown', delivery_state: 'not_applicable', refund_state: 'none', import_state: 'not_applicable', feedback_state: 'none', purchase_amount_atomic: zero, network_fee_lamports: zeroFee, answer: null, message: 'precheck running' };
}

class BrokerCore {
  readonly deps: BrokerDeps; readonly ports: BrokerPorts & { readonly validatePaymentAccounts: typeof validatePaymentAccounts };
  constructor(deps: BrokerDeps, ports: BrokerPorts) {
    // Caller-owned config objects cannot mutate an active broker's policy.
    this.deps = { ...deps, policy: structuredClone(deps.policy), registry: structuredClone(deps.registry), questionPolicy: structuredClone(deps.questionPolicy), sellers: new Map(deps.sellers) };
    this.ports = { ...ports, validatePaymentAccounts: ports.validatePaymentAccounts ?? validatePaymentAccounts, limits: structuredClone(ports.limits), payer: structuredClone(ports.payer), rpcOrigins: [...ports.rpcOrigins] };
    boot(this.deps, this.ports);
  }
  api(): MarketApi {
    return {
      find: async (context, input) => {
        contextAllowed(this.deps, context); exactKeys(input, ['topic']); requireThat(typeof input.topic === 'string', 'INVALID_INPUT');
        requireThat(encodeUtf8(input.topic).length <= this.ports.limits.questionBytesMax.value * 1024, 'INVALID_INPUT');
        return { listings: this.deps.registry.listings.filter((l) => l.status === 'active' && l.topics.includes(input.topic)).map((l) => ({ seller_id: l.seller_id, label: l.display_name, kind: l.listing_kind, topics: l.topics, price: { network: l.payment.network, asset_id: l.payment.mint, amount_atomic: l.payment.total_atomic }, trust_display: 'unrated until 3 independent buyers' })) };
      },
      consult: async (context, input, options) => { contextAllowed(this.deps, context); return this.consult(input, options); },
      status: async (context, input, options) => {
        options?.signal?.throwIfAborted();
        contextAllowed(this.deps, context); exactKeys(input, ['consult_id']); requireThat(typeof input.consult_id === 'string', 'INVALID_INPUT');
        const row = readJournal(this.deps.store, input.consult_id).value; requireThat(row.buyer_id === context.buyer_id, 'UNAUTHORIZED');
        // Status never re-enters quote, offer approval, arm, or initial signing.
        if (['signing', 'signed', 'settled'].includes(row.broker.stage)) await this.recover(input.consult_id, options);
        return this.visible(input.consult_id, options);
      },
      feedback: async (context, input) => { contextAllowed(this.deps, context); requireThat(this.ports.feedback, 'NOT_READY'); return this.ports.feedback(context, input); },
      report: async (context, input) => { contextAllowed(this.deps, context); requireThat(this.ports.report, 'NOT_READY'); return this.ports.report(context, input); },
    };
  }
  async consult(raw: ConsultInput, options?: SellerCallOptions): Promise<ConsultView> {
    const d = this.deps, p = this.ports;
    options?.signal?.throwIfAborted();
    const { input, question } = admit(d, p, raw); const id = consultKey(d.policy.buyer.buyer_id, input.request_id);
    const bodyHash = p.payloadHash(json(input)); const listings = candidates(d, p, input, question);
    const created = d.store.transaction((tx) => {
      const existing = tx.read('consults', id);
      if (existing) { requireThat(existing.value.body_sha256 === bodyHash, 'IDEMPOTENCY_CONFLICT'); return readJournal(tx, id).value.broker.aliasOf ?? id; }
      const reusable = journals(tx).find((r) => {
        const j = r.broker;
        if (r.buyer_id !== d.policy.buyer.buyer_id || !j.quote || j.registryHash !== d.policy.registry_sha256 || j.policyHash !== d.policy.question_policy_sha256 || j.question.question_sha256 !== question.question_sha256 || j.input.max_price.network !== input.max_price.network || j.input.max_price.asset_id !== input.max_price.asset_id) return false;
        if (j.stage === 'closed' || r.view.payment_state === 'payment_failed') return false;
        // A new UUID never replaces a pending purchase, even after midnight or
        // the cache window. Settled/selected cache reuse never refreshes expiry.
        return r.view.payment_state === 'payment_pending' || Date.parse(d.clock.now()) - Date.parse(j.createdAt) < p.limits.dedupWindow.value * 60000;
      });
      if (reusable) {
        requireThat(decodeAmount(input.max_price.amount_atomic) >= decodeAmount(reusable.broker.quote!.payload.total_atomic), 'BUDGET_EXCEEDED');
        const alias: BrokerRow = { ...reusable, request_id: input.request_id, body_sha256: bodyHash, view: { ...reusable.view, answer: null }, broker: { ...reusable.broker, stage: 'closed', aliasOf: reusable.view.consult_id, input } };
        tx.insert('consults', id, alias); return reusable.view.consult_id;
      }
      takeChecks(tx, d, p, id, listings);
      const row: BrokerRow = { buyer_id: d.policy.buyer.buyer_id, request_id: input.request_id, body_sha256: bodyHash, view: view(id), broker: { v: 1, stage: 'precheck', aliasOf: null, input, question, createdAt: d.clock.now(), registryHash: d.policy.registry_sha256, policyHash: d.policy.question_policy_sha256, listing: null, quote: null, approval: null, messageBase64: null, messageHash: null, blockhash: null, estimatedFee: null, finalizedAt: null, revealAttempts: 0, answerArtifact: null, manifestArtifact: null, pageArtifacts: [] } };
      snapshotArtifacts(tx, d, p); tx.insert('consults', id, row); return null;
    });
    if (created !== null) return this.visible(created, options);
    const results = await Promise.all(listings.map(async (listing) => {
      let inFlight = false, timedOut = false;
      const lateCompletion = (result: import('../wire/contracts.ts').QuoteDisposition | null): void => {
        if (!timedOut) return;
        let expires: string | null = null;
        try { if (result?.status === 'ready') expires = quoteAllowed(d, p, input, question, listing, result.quote).payload.expires_at; } catch { /* Invalid late offers never become payable. */ }
        // A noncooperative legacy transport must keep the active lease
        // until the original call actually settles; quarantine a late ready
        // quote until expiry. Storage failure leaves the lease held.
        try { d.store.transaction((tx) => finishCheck(tx, d, p, id, listing.seller_id, expires)); } catch { /* fail closed */ }
      };
      try {
        const seller = d.sellers.get(listing.endpoint); requireThat(seller, 'SELLER_UNAVAILABLE');
        inFlight = true;
        // T1 wire nonce is exactly 16 bytes, encoded canonically. Derivation stays
        // stable per buyer request and seller across retries and restarts.
        const nonce = Buffer.from(digest(`${id}\n${listing.seller_id}`), 'hex').subarray(0, 16).toString('base64url');
        const result = await bounded(d, p.limits.precheckMax.value * 1000, (call) => seller.quote(d.policy.buyer, { v: 1, request_id: input.request_id, request_nonce: nonce, buyer_id: d.policy.buyer.buyer_id, payer: d.policy.buyer.payer, seller_id: listing.seller_id, registry_version: d.registry.registry_version, slice_id: listing.slice.id, network: input.max_price.network, question: question.text, max_total_atomic: input.max_price.amount_atomic }, undefined, call).then((result) => { inFlight = false; lateCompletion(result); return result; }, (error: unknown) => { inFlight = false; lateCompletion(null); throw error; }), options);
        if (result.status === 'declined') {
          exactKeys(result, ['status', 'abstain', 'quote', 'charged_atomic', 'reason']);
          requireThat(result.abstain === true && result.quote === null && result.charged_atomic === zero && result.reason === 'unavailable', 'VERIFICATION_FAILED');
          return { listing, quote: null, inFlight: false, disposition: { seller_id: listing.seller_id, status: 'declined', quote_id: null, code: null } satisfies ListingDisposition };
        }
        exactKeys(result, ['status', 'quote']); requireThat(result.status === 'ready', 'VERIFICATION_FAILED');
        const quote = quoteAllowed(d, p, input, question, listing, result.quote);
        return { listing, quote, inFlight: false, disposition: { seller_id: listing.seller_id, status: 'ready', quote_id: quote.payload.quote_id, code: null } satisfies ListingDisposition };
      } catch (error) {
        timedOut = inFlight;
        return { listing, quote: null, inFlight, disposition: { seller_id: listing.seller_id, status: 'unavailable', quote_id: null, code: error instanceof FoundationError ? error.code : 'SELLER_UNAVAILABLE' } satisfies ListingDisposition };
      }
    }));
    const ready = results.filter((r) => r.quote !== null && (input.max_price.network !== 'mainnet-beta' || r.listing.listing_kind === 'founder'));
    ready.sort((a, b) => {
      const delta = decodeAmount(a.quote!.payload.total_atomic) - decodeAmount(b.quote!.payload.total_atomic);
      return delta < 0n ? -1 : delta > 0n ? 1 : a.listing.seller_id < b.listing.seller_id ? -1 : 1;
    });
    const selected = ready[0];
    d.store.transaction((tx) => {
      for (const result of results) if (!result.inFlight) finishCheck(tx, d, p, id, result.listing.seller_id, result.quote?.payload.expires_at ?? null);
      updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, stage: selected ? 'selected' : 'closed', listing: selected?.listing ?? null, quote: selected?.quote ?? null }, view: { ...r.view, dispositions: results.map((r) => r.disposition), consult_state: selected ? 'quote_issued' : results.length > 0 && results.every((r) => r.disposition.status === 'declined') ? 'declined' : 'precheck_failed', content_state: selected ? 'eligible' : 'unknown', message: selected ? 'offer selected' : 'no purchase' } }), 'precheck');
      if (selected) artifact(tx, p.canonicalBytes(json(selected.quote)));
      this.receipt(tx, id);
    });
    if (selected && !options?.signal?.aborted) await this.purchase(id, options);
    else if (selected) this.closeUnsent(id, 'cancelled');
    return this.visible(id, options);
  }
  async eligible(id: Id, recovery = false, options?: SellerCallOptions): Promise<void> {
    const d = this.deps, p = this.ports; const row = readJournal(d.store, id).value; const listing = row.broker.listing!;
    // A learned revocation is sticky even if an older seller backup says eligible.
    const old = d.store.read('eligibility', digest(`${listing.slice.id}\n${listing.slice.manifest_sha256}`));
    requireThat(old?.value.state !== 'revoked' && row.view.content_state !== 'revoked', 'CONTENT_REVOKED');
    const seller = d.sellers.get(listing.endpoint); requireThat(seller, 'SELLER_UNAVAILABLE');
    const current = await bounded(d, p.limits.precheckMax.value * 1000, (call) => seller.eligibility(listing.slice.id, listing.slice.manifest_sha256, call), options);
    requireThat(current.slice_id === listing.slice.id && current.manifest_sha256 === listing.slice.manifest_sha256, 'VERIFICATION_FAILED');
    requireThat(!old || current.generation >= old.value.generation, 'NOT_READY');
    d.store.transaction((tx) => {
      const key = digest(`${listing.slice.id}\n${listing.slice.manifest_sha256}`), prior = tx.read('eligibility', key);
      requireThat(!prior || (prior.value.state !== 'revoked' && current.generation >= prior.value.generation), 'CONTENT_REVOKED');
      if (prior) tx.compareAndSet('eligibility', key, prior.version, current); else tx.insert('eligibility', key, current);
    });
    eligibilityAllowed(d, p, listing, current, recovery);
  }
  async purchase(id: Id, options?: SellerCallOptions): Promise<void> {
    const d = this.deps, p = this.ports;
    try {
      let row = readJournal(d.store, id).value;
      if (row.broker.stage === 'selected') {
        armTime(d, p, row.broker.quote!);
        update(d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'reviewing' }, view: { ...r.view, consult_state: 'approval_required' } }), 'selected');
        const approval = await d.offerApproval.review({ quote: row.broker.quote!, quoteHash: p.payloadHash(json(row.broker.quote!.payload)), terms: 'One atomic seller and marketplace split. Network fees may be charged on failure.' });
        requireThat(approval.status === 'approved', 'POLICY_DENIED');
        requireThat(approval.reviewedHash === p.payloadHash(json(row.broker.quote!.payload)), 'VERIFICATION_FAILED');
        requireThat(row.broker.quote!.payload.network !== 'mainnet-beta' || approval.actor === 'human');
        armTime(d, p, row.broker.quote!);
        update(d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'approved', approval } }), 'reviewing');
      }
      // No signer request exists in these stages, even after a lost arm response.
      row = readJournal(d.store, id).value;
      if (row.broker.stage === 'arming' || row.broker.stage === 'armed') armTime(d, p, row.broker.quote!);
      await this.eligible(id, false, options);
      row = readJournal(d.store, id).value;
      if (row.broker.stage === 'approved') { reserve(d, p, id); d.store.transaction((tx) => this.receipt(tx, id)); }
      row = readJournal(d.store, id).value;
      if (row.broker.stage === 'reserved') {
        armTime(d, p, row.broker.quote!);
        requireThat(await d.signer.publicKey() === d.policy.buyer.payer, 'UNAUTHORIZED');
        requireThat(await d.primaryRpc.genesis() === row.broker.quote!.payload.genesis_hash, 'NETWORK_MISMATCH');
        const blockhash = await d.primaryRpc.latestBlockhash();
        requireThat(Math.abs(Date.parse(d.clock.now()) - Date.parse(blockhash.observedAt)) <= p.limits.clockSkewMax.value * 1000, 'NOT_READY');
        const payment = p.buildLegacyPayment(row.broker.quote!, p.payer, blockhash);
        requireThat(digest(payment.message) === payment.messageHash, 'PAYMENT_INVALID');
        p.validateLegacyMessage(payment.message, { quote: row.broker.quote!, payer: p.payer, blockhash, messageHash: payment.messageHash });
        const estimatedFee = await d.primaryRpc.feeForMessage(payment.message);
        requireThat(estimatedFee !== null && decodeAmount(estimatedFee) <= decodeAmount(d.policy.fee_per_call), 'BUDGET_EXCEEDED');
        armTime(d, p, row.broker.quote!);
        update(d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'arming', messageBase64: Buffer.from(payment.message).toString('base64'), messageHash: payment.messageHash, blockhash, estimatedFee } }), 'reserved');
      }
      row = readJournal(d.store, id).value;
      if (row.broker.stage === 'arming') {
        await this.eligible(id, false, options); armTime(d, p, row.broker.quote!);
        const arm = await bounded(d, p.limits.precheckMax.value * 1000, (call) => d.sellers.get(row.broker.listing!.endpoint)!.arm(d.policy.buyer, { quote_id: row.broker.quote!.payload.quote_id, message_base64: row.broker.messageBase64!, message_sha256: row.broker.messageHash!, recent_blockhash: row.broker.blockhash!.blockhash, last_valid_block_height: row.broker.blockhash!.lastValidBlockHeight, ...(row.broker.renewal ? { renewal: row.broker.renewal } : {}) }, call), options);
        this.checkArm(row, arm);
        d.store.transaction((tx) => {
          const previous = tx.read('arms', id);
          const next = { quote_id: row.broker.quote!.payload.quote_id, message_sha256: row.broker.messageHash!, arm };
          if (row.broker.renewal) {
            requireThat(previous && p.payloadHash(json(previous.value.arm.payload)) === row.broker.renewal.previous_arm_sha256, 'STATE_CONFLICT');
            tx.compareAndSet('arms', id, previous.version, next);
          } else tx.insert('arms', id, next);
          artifact(tx, p.canonicalBytes(json(arm))); armedCheck(tx, d, id, row.broker.listing!.seller_id);
          updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'armed' } }), 'arming');
          this.receipt(tx, id);
        });
      }
      row = readJournal(d.store, id).value;
      if (row.broker.stage === 'armed') {
        await this.eligible(id, false, options); armTime(d, p, row.broker.quote!);
        const payment = this.payment(row); const arm = d.store.read('arms', id)!.value.arm;
        // Use current account evidence in the core boundary, including resumed
        // armed requests. A failure leaves the arm/reservation held without IPC.
        await p.validatePaymentAccounts(payment.expected, d.primaryRpc);
        const height = await d.primaryRpc.finalizedHeight();
        requireThat(Number.isSafeInteger(height) && height >= 0, 'NOT_READY');
        requireThat(height <= payment.expected.blockhash.lastValidBlockHeight, 'QUOTE_EXPIRED');
        // Durable intent precedes wallet IPC. Recovery NEVER calls sign again.
        options?.signal?.throwIfAborted();
        requireThat(options?.deadline === undefined || Date.parse(options.deadline) > Date.parse(d.clock.now()), 'SELLER_UNAVAILABLE');
        update(d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'signing' } }), 'armed');
        const signed = await d.signer.sign({ requestId: row.request_id, quoteId: row.broker.quote!.payload.quote_id, network: row.broker.quote!.payload.network, genesis: row.broker.quote!.payload.genesis_hash, message: payment.message, messageHash: payment.messageHash, expectedPayer: d.policy.buyer.payer, quote: row.broker.quote!, arm, manifestHash: row.broker.quote!.payload.manifest_sha256, registryHash: row.broker.registryHash, questionPolicyHash: row.broker.policyHash, reservationId: id, estimatedFee: row.broker.estimatedFee as Lamports, maximumFee: d.store.read('reservations', id)!.value.maximum_fee, blockhash: payment.expected.blockhash, offerApproval: row.broker.approval! });
        if (signed.status === 'denied' && signed.reason === 'EXPIRED_BEFORE_APPROVAL') { requireThat(signed.messageHash === row.broker.messageHash, 'PAYMENT_INVALID'); throw new FoundationError('EXPIRED_BEFORE_APPROVAL'); }
        if (signed.status === 'denied') { this.closeUnsent(id, 'cancelled', 'signing_refused'); return; }
        this.saveSignature(id, signed);
      }
      await this.recover(id, options);
    } catch (error) {
      const row = readJournal(d.store, id).value;
      // Any uncertain arm/sign/broadcast boundary keeps both reservations.
      if (['selected', 'reviewing', 'approved', 'reserved'].includes(row.broker.stage)) this.closeUnsent(id, error instanceof FoundationError && error.code === 'QUOTE_EXPIRED' ? 'quote_expired' : 'cancelled');
      else if (['arming', 'armed'].includes(row.broker.stage) && error instanceof FoundationError && error.code === 'QUOTE_EXPIRED') this.closeUnsent(id, 'quote_expired');
      else if (error instanceof FoundationError && error.code === 'CONTENT_REVOKED') this.withhold(id, true);
      else if (error instanceof Error && error.message === 'EXPIRED_BEFORE_APPROVAL') update(d, id, (r) => ({ ...r, view: { ...r.view, message: 'EXPIRED_BEFORE_APPROVAL: retain this run; fresh message approval required' } }));
      else update(d, id, (r) => ({ ...r, view: { ...r.view, message: 'payment status unknown—do not pay again' } }));
    }
  }
  /** Protected operator action. Status polling never grants a fresh signing attempt. */
  async renew(id: Id, previousArmHash: Sha256): Promise<ConsultView> {
    const d = this.deps, p = this.ports;
    let row = readJournal(d.store, id).value;
    // Resume the exact persisted replacement after a lost seller response.
    if (row.broker.stage === 'arming' && row.broker.renewal?.previous_arm_sha256 === previousArmHash) {
      await this.purchase(id); return this.visible(id);
    }
    requireThat(['armed', 'signing'].includes(row.broker.stage), 'PAYMENT_UNCERTAIN');
    const old = d.store.read('arms', id); requireThat(old, 'NOT_READY');
    requireThat(p.payloadHash(json(old.value.arm.payload)) === previousArmHash && old.value.message_sha256 === row.broker.messageHash, 'STATE_CONFLICT');
    // CONTRACT REQUEST: M03.messageRenewalsMax. No fallback cap grants authority.
    const cap = (p.limits as typeof p.limits & { messageRenewalsMax?: { value: number } }).messageRenewalsMax?.value;
    requireThat(cap !== undefined && Number.isSafeInteger(cap) && cap >= 0, 'NOT_READY');
    requireThat((row.broker.renewalCount ?? 0) < cap, 'BUDGET_EXCEEDED');
    requireThat(!d.store.scan('signed_transactions', { where: { quote_id: row.broker.quote!.payload.quote_id }, limit: 1 }).length, 'PAYMENT_UNCERTAIN');
    const result = await d.signer.recover(row.request_id, row.broker.messageHash!);
    if (row.broker.stage === 'signing') requireThat(result?.status === 'denied' && result.reason === 'EXPIRED_BEFORE_APPROVAL' && result.messageHash === row.broker.messageHash, 'PAYMENT_UNCERTAIN');
    else requireThat(result === null || (result.status === 'denied' && result.reason === 'EXPIRED_BEFORE_APPROVAL' && result.messageHash === row.broker.messageHash), 'PAYMENT_UNCERTAIN');
    const observations = await Promise.all([d.primaryRpc, d.secondaryRpc].map(async rpc => ({ genesis: await rpc.genesis(), height: await rpc.finalizedHeight() })));
    requireThat(observations.every(o => o.genesis === row.broker.quote!.payload.genesis_hash && Number.isSafeInteger(o.height) && o.height > row.broker.blockhash!.lastValidBlockHeight), 'PAYMENT_UNCERTAIN');
    await this.eligible(id); armTime(d, p, row.broker.quote!);
    const blockhash = await d.primaryRpc.latestBlockhash();
    requireThat(blockhash.blockhash !== row.broker.blockhash!.blockhash && blockhash.lastValidBlockHeight > Math.max(...observations.map(o => o.height)) && Math.abs(Date.parse(d.clock.now()) - Date.parse(blockhash.observedAt)) <= p.limits.clockSkewMax.value * 1000, 'NOT_READY');
    const payment = p.buildLegacyPayment(row.broker.quote!, p.payer, blockhash);
    requireThat(payment.messageHash !== row.broker.messageHash && digest(payment.message) === payment.messageHash, 'PAYMENT_INVALID');
    p.validateLegacyMessage(payment.message, payment.expected);
    const estimatedFee = await d.primaryRpc.feeForMessage(payment.message);
    const held = d.store.read('reservations', id)!;
    requireThat(held.value.status === 'held' && estimatedFee !== null && decodeAmount(estimatedFee) <= decodeAmount(held.value.maximum_fee) && decodeAmount(estimatedFee) <= decodeAmount(d.policy.fee_per_call), 'BUDGET_EXCEEDED');
    armTime(d, p, row.broker.quote!);
    d.store.transaction(tx => {
      const current = readJournal(tx, id).value;
      requireThat(current.broker.stage === row.broker.stage && current.broker.messageHash === row.broker.messageHash && !tx.read('signed_transactions', id), 'STATE_CONFLICT');
      // Immutable archive includes the signed old arm AND exact old message.
      artifact(tx, p.canonicalBytes(json({ arm: old.value.arm, messageBase64: row.broker.messageBase64, blockhash: row.broker.blockhash })));
      artifact(tx, p.canonicalBytes(json(old.value.arm)));
      updateTx(tx, d, id, r => ({ ...r, broker: { ...r.broker, stage: 'arming', renewalCount: (r.broker.renewalCount ?? 0) + 1,
        renewal: { previous_arm_sha256: previousArmHash, unsigned_message_sha256: row.broker.messageHash! },
        messageBase64: Buffer.from(payment.message).toString('base64'), messageHash: payment.messageHash, blockhash, estimatedFee },
        view: { ...r.view, message: 'Fresh message requires a new exact approval' } }));
    });
    await this.purchase(id); return this.visible(id);
  }
  checkArm(row: BrokerRow, value: Signed<Arm>): void {
    const p = this.ports; const bytes = p.canonicalBytes(json(value)); requireThat(bytes.length <= p.limits.signedEnvelopeMax.value * 1024, 'VERIFICATION_FAILED');
    const arm = p.parseWire('arm', bytes); p.verifyEnvelope('arm', arm, row.broker.listing!.signing_key);
    const a = arm.payload, j = row.broker;
    requireThat(a.quote_id === j.quote!.payload.quote_id && a.buyer_id === row.buyer_id && a.quote_sha256 === p.payloadHash(json(j.quote!.payload)) && a.message_sha256 === j.messageHash && a.recent_blockhash === j.blockhash!.blockhash && a.last_valid_block_height === j.blockhash!.lastValidBlockHeight, 'VERIFICATION_FAILED');
    requireThat(Math.abs(Date.parse(this.deps.clock.now()) - Date.parse(a.armed_at)) <= p.limits.clockSkewMax.value * 1000, 'QUOTE_EXPIRED');
  }
  payment(row: BrokerRow): UnsignedPayment {
    const j = row.broker; requireThat(j.messageBase64 && j.messageHash && j.blockhash && j.quote, 'NOT_READY');
    const message = Uint8Array.from(Buffer.from(j.messageBase64, 'base64'));
    requireThat(digest(message) === j.messageHash, 'VERIFICATION_FAILED');
    const expected = { quote: j.quote, payer: this.ports.payer, blockhash: j.blockhash, messageHash: j.messageHash };
    return { message, messageHash: j.messageHash, expected, decoded: this.ports.validateLegacyMessage(message, expected) };
  }
  saveSignature(id: Id, result: SignResult): void {
    const d = this.deps, p = this.ports, row = readJournal(d.store, id).value;
    requireThat(result.status === 'signed' && result.messageHash === row.broker.messageHash && result.publicKey === d.policy.buyer.payer, 'PAYMENT_INVALID');
    const signed = p.attachSignature(this.payment(row), result);
    requireThat(signed.messageHash === row.broker.messageHash && signed.signature === result.signature, 'PAYMENT_INVALID');
    d.store.transaction((tx) => {
      const transaction: BrokerSignedRow = { broadcastAttempted: false, request_id: row.request_id, quote_id: row.broker.quote!.payload.quote_id, genesis: row.broker.quote!.payload.genesis_hash, signature: signed.signature, message_sha256: signed.messageHash, transaction_base64: Buffer.from(signed.transaction).toString('base64'), transaction_sha256: digest(signed.transaction), approval_ref: result.approvalRef };
      tx.insert('signed_transactions', id, transaction);
      artifact(tx, signed.transaction); artifact(tx, p.canonicalBytes(json(result)));
      updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'signed' } }), 'signing');
      this.receipt(tx, id);
    });
  }
  closeUnsent(id: Id, state: 'cancelled' | 'quote_expired' | 'precheck_failed', message = 'no payment submitted'): void {
    const d = this.deps;
    d.store.transaction((tx) => {
      if (tx.read('reservations', id)?.value.status === 'held') resolveReservation(tx, id, zero, zeroFee, d.clock.now());
      updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'closed' }, view: { ...r.view, consult_state: state, payment_state: 'not_applicable', delivery_state: 'not_applicable', purchase_amount_atomic: zero, network_fee_lamports: zeroFee, message } }));
      this.receipt(tx, id);
    });
  }
  async recover(id: Id, options?: SellerCallOptions): Promise<void> {
    const d = this.deps, p = this.ports;
    let row = readJournal(d.store, id).value;
    if (row.broker.stage === 'signing') {
      const result = await d.signer.recover(row.request_id, row.broker.messageHash!);
      if (result?.status === 'signed') this.saveSignature(id, result);
      else if (result?.status === 'denied' && result.reason === 'EXPIRED_BEFORE_APPROVAL') {
        requireThat(result.messageHash === row.broker.messageHash, 'PAYMENT_INVALID');
        update(d, id, r => ({ ...r, view: { ...r.view, message: 'EXPIRED_BEFORE_APPROVAL: retain this run; fresh message approval required' } })); return;
      }
      else if (result?.status === 'denied') this.closeUnsent(id, 'cancelled', 'signing_refused');
      else return; // Missing wallet response is NOT evidence of non-signing.
    }
    row = readJournal(d.store, id).value;
    if (row.broker.stage === 'signed') {
      const signed = d.store.read('signed_transactions', id)!.value as DispatchRow, payment = this.payment(row);
      requireThat(digest(Buffer.from(signed.transaction_base64, 'base64')) === signed.transaction_sha256, 'VERIFICATION_FAILED');
      requireThat(signed.message_sha256 === payment.messageHash && signed.request_id === row.request_id && signed.quote_id === row.broker.quote!.payload.quote_id && signed.genesis === row.broker.quote!.payload.genesis_hash, 'VERIFICATION_FAILED');
      const checked = p.attachSignature(payment, { status: 'signed', messageHash: signed.message_sha256, publicKey: d.policy.buyer.payer, signature: signed.signature, approvalRef: signed.approval_ref });
      requireThat(Buffer.from(checked.transaction).toString('base64') === signed.transaction_base64 && checked.signature === signed.signature && checked.messageHash === signed.message_sha256, 'PAYMENT_INVALID');
      const broadcast = async (): Promise<void> => {
        // Verified bytes have committed to FULL/WAL storage before dispatch.
        // A send error is ambiguous; retain the exact signature and reservation.
        try { requireThat(await d.primaryRpc.broadcastIdentical(checked.transaction) === signed.signature, 'PAYMENT_INVALID'); }
        catch { update(d, id, (r) => ({ ...r, view: { ...r.view, message: 'BROADCAST_UNCONFIRMED: payment status unknown—do not pay again' } })); }
        // Write AFTER dispatch. A crash before this commit repeats identical
        // bytes immediately, never waits for a secondary before the first send.
        d.store.transaction(tx => {
          const current = tx.read('signed_transactions', id)!;
          const next: DispatchRow = { ...current.value as BrokerSignedRow, broadcastAttempted: true };
          tx.compareAndSet('signed_transactions', id, current.version, next);
        });
      };
      // M05.4: first send must not wait for slow/throttled secondary reads.
      // This also covers a signature just recovered from a lost helper reply.
      if (signed.broadcastAttempted !== true) { await broadcast(); return; }
      let reconciled;
      try { reconciled = await p.reconcilePayment(payment.expected, signed.signature, d.primaryRpc, d.secondaryRpc); } catch { return; }
      if (reconciled.status === 'pending') {
        // Resend exactly the journaled transaction; never refresh blockhash.
        await broadcast();
        return;
      }
      let principal = zero, fee = zeroFee;
      if (reconciled.status === 'finalized_success') {
        const tx = await d.primaryRpc.finalizedTransaction(signed.signature); if (!tx) return;
        const verified = p.verifyFinalizedPayment(tx, payment.expected);
        // Observation time describes the read, not the finalized transaction.
        // Keep it in the stored evidence, excluding only it from this comparison.
        const { observed_at: verifiedAt, ...verifiedFacts } = verified;
        const { observed_at: reconciledAt, ...reconciledFacts } = reconciled.evidence;
        requireThat(p.payloadHash(json(verifiedFacts)) === p.payloadHash(json(reconciledFacts)), 'PAYMENT_INVALID');
        requireThat(verified.genesis === signed.genesis && verified.signature === signed.signature && verified.quote_id === row.broker.quote!.payload.quote_id && verified.message_sha256 === row.broker.messageHash && verified.payer_debit === row.broker.quote!.payload.total_atomic && verified.seller_credit === row.broker.quote!.payload.seller_atomic && verified.marketplace_credit === row.broker.quote!.payload.fee_atomic, 'PAYMENT_INVALID');
        principal = verified.payer_debit; fee = verified.actual_fee;
      } else if (reconciled.status === 'finalized_failure') {
        const tx = reconciled.transaction;
        requireThat(tx.commitment === 'finalized' && tx.meta.err !== null && tx.genesis === signed.genesis && tx.signature === signed.signature && digest(tx.message) === signed.message_sha256 && Buffer.from(tx.transaction).toString('base64') === signed.transaction_base64 && tx.meta.fee === reconciled.actualFee, 'PAYMENT_INVALID');
        requireThat(p.payloadHash(json(tx.meta.preTokenBalances)) === p.payloadHash(json(tx.meta.postTokenBalances)), 'PAYMENT_INVALID');
        fee = reconciled.actualFee;
      } else {
        const observations = reconciled.observations;
        requireThat(observations.length === 2 && new Set(observations.map((o) => o.origin)).size === 2 && observations.every((o) => p.rpcOrigins.includes(o.origin) && o.genesis === signed.genesis && Number.isSafeInteger(o.finalizedHeight) && o.finalizedHeight > payment.expected.blockhash.lastValidBlockHeight && o.signature.signature === signed.signature && o.signature.status === 'absent' && o.signature.err === null && o.signature.slot === null), 'PAYMENT_UNCERTAIN');
      }
      const success = reconciled.status === 'finalized_success'; const result = reconciled;
      d.store.transaction((tx) => {
        requireThat(readJournal(tx, id).value.broker.stage === 'signed', 'STATE_CONFLICT');
        resolveReservation(tx, id, principal, fee, d.clock.now());
        if (result.status === 'finalized_success') tx.insert('settlements', id, result.evidence);
        updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, stage: success ? 'settled' : 'closed', finalizedAt: success ? d.clock.now() : null }, view: { ...r.view, payment_state: success ? 'payment_finalized' : 'payment_failed', purchase_amount_atomic: principal, network_fee_lamports: fee, delivery_state: success ? 'pending' : 'not_applicable', message: success ? 'payment finalized; delivery pending' : 'payment resolved without principal transfer' } }), 'signed');
        this.receipt(tx, id);
      });
    }
    if (readJournal(d.store, id).value.broker.stage === 'settled') await this.deliver(id, options);
  }
  withhold(id: Id, revoked: boolean, temporary = false): void {
    this.deps.store.transaction((tx) => {
      if (revoked) {
        const listing = readJournal(tx, id).value.broker.listing!;
        const key = digest(`${listing.slice.id}\n${listing.slice.manifest_sha256}`), prior = tx.read('eligibility', key);
        // An HTTP error has no generation attestation. Preserve the last known
        // generation and make revocation sticky; never invent a newer one.
        if (prior && prior.value.state !== 'revoked') tx.compareAndSet('eligibility', key, prior.version, { ...prior.value, state: 'revoked', checked_at: this.deps.clock.now() });
      }
      if (temporary) {
        updateTx(tx, this.deps, id, (r) => {
          const overdue = r.view.answer === null && r.view.payment_state === 'payment_finalized' && r.broker.finalizedAt !== null &&
            Date.parse(this.deps.clock.now()) - Date.parse(r.broker.finalizedAt) >= this.ports.limits.nonDeliveryAfterFinality.value * 60000;
          return { ...r, view: { ...r.view, content_state: 'unknown', delivery_state: overdue ? 'delivery_failed' : r.view.delivery_state,
            refund_state: overdue ? 'refund_pending' : r.view.refund_state, message: 'content withheld until eligibility is confirmed' } };
        });
        this.receipt(tx, id); return;
      }
      updateTx(tx, this.deps, id, (r) => ({ ...r, view: { ...r.view, content_state: revoked ? 'revoked' : 'unknown', answer: null, delivery_state: 'recovery_required', refund_state: r.view.payment_state === 'payment_finalized' ? 'refund_pending' : r.view.refund_state, message: 'content withheld; recovery required' } }));
      this.receipt(tx, id);
    });
  }
  async deliver(id: Id, options?: SellerCallOptions): Promise<void> {
    const d = this.deps, p = this.ports; let row = readJournal(d.store, id).value;
    try { await this.eligible(id, true, options); } catch (error) { const revoked = error instanceof FoundationError && error.code === 'CONTENT_REVOKED'; this.withhold(id, revoked, !revoked); return; }
    if (row.broker.contentRedactedAt || row.view.answer !== null) return;
    const elapsed = Date.parse(d.clock.now()) - Date.parse(row.broker.finalizedAt!);
    if (row.broker.revealAttempts > p.limits.revealRetriesMax.value || elapsed > p.limits.revealRetryWindow.value * 1000) {
      update(d, id, (r) => ({ ...r, view: { ...r.view, delivery_state: elapsed >= p.limits.nonDeliveryAfterFinality.value * 60000 ? 'delivery_failed' : 'recovery_required', refund_state: elapsed >= p.limits.nonDeliveryAfterFinality.value * 60000 ? 'refund_pending' : r.view.refund_state, message: 'delivery recovery required; do not purchase again' } }));
      d.store.transaction((tx) => this.receipt(tx, id)); return;
    }
    row = update(d, id, (r) => ({ ...r, broker: { ...r.broker, revealAttempts: r.broker.revealAttempts + 1 } }), 'settled');
    const seller = d.sellers.get(row.broker.listing!.endpoint)!; const quote = row.broker.quote!;
    try {
      const delivered = await bounded(d, p.limits.revealAttemptMax.value * 1000, async (call) => {
        const signed = d.store.read('signed_transactions', id)!.value; const arm = d.store.read('arms', id)!.value.arm;
        await seller.payment(d.policy.buyer, { v: 1, consult_id: id, quote_id: quote.payload.quote_id, quote_sha256: p.payloadHash(json(quote.payload)), arm_ticket_sha256: p.payloadHash(json(arm.payload)), network: quote.payload.network, genesis_hash: quote.payload.genesis_hash, transaction_signature: signed.signature, message_sha256: signed.message_sha256 }, call);
        const result = await seller.answer(d.policy.buyer, quote.payload.quote_id, call);
        if (result.status !== 'ready') throw new FoundationError(result.status === 'withheld' ? result.code : 'NOT_READY');
        const bytes = p.canonicalBytes(json(result.answer)); requireThat(bytes.length <= p.limits.signedEnvelopeMax.value * 1024, 'VERIFICATION_FAILED');
        const answer = p.parseWire('answer', bytes); p.verifyEnvelope('answer', answer, row.broker.listing!.signing_key);
        requireThat(p.payloadHash(json(answer.payload)) === quote.payload.answer_sha256 && answer.payload.quote_id === quote.payload.quote_id && answer.payload.buyer_id === row.buyer_id && answer.payload.seller_id === quote.payload.seller_id && answer.payload.question_sha256 === quote.payload.question_sha256 && answer.payload.manifest_sha256 === quote.payload.manifest_sha256 && answer.payload.slice_id === quote.payload.slice_id, 'VERIFICATION_FAILED');
        const manifest = await seller.manifest(quote.payload.slice_id, call); p.verifyEnvelope('manifest', manifest, row.broker.listing!.signing_key);
        requireThat(p.payloadHash(json(manifest.payload)) === quote.payload.manifest_sha256, 'VERIFICATION_FAILED');
        const pages = new Map<Id, Uint8Array>(); let total = 0;
        for (const citation of answer.payload.citations) if (!pages.has(citation.page_id)) {
          const page = await seller.page(quote.payload.slice_id, citation.page_id, call); total += page.length;
          requireThat(page.length <= p.limits.citedPageMax.value * 1024 && total <= p.limits.citationFetchTotalMax.value * 1024, 'VERIFICATION_FAILED'); pages.set(citation.page_id, page);
        }
        p.verifyCitations(answer, manifest, pages); return { answer, manifest, pages };
      }, options);
      await this.eligible(id, true, options);
      d.store.transaction((tx) => {
        const answerArtifact = artifact(tx, p.canonicalBytes(json(delivered.answer))), manifestArtifact = artifact(tx, p.canonicalBytes(json(delivered.manifest)));
        const pageArtifacts = [...delivered.pages].map(([pageId, bytes]) => ({ pageId, sha256: artifact(tx, bytes) }));
        updateTx(tx, d, id, (r) => ({ ...r, broker: { ...r.broker, answerArtifact, manifestArtifact, pageArtifacts }, view: { ...r.view, answer: { text: delivered.answer.payload.answer, citations: delivered.answer.payload.citations, answer_sha256: quote.payload.answer_sha256, verified: true, untrusted_content: true }, content_state: 'eligible', delivery_state: 'delivered', import_state: 'import_pending', message: 'verified answer; external untrusted evidence' } }), 'settled');
        this.receipt(tx, id);
      });
    } catch (error) {
      if (error instanceof FoundationError && error.code === 'CONTENT_REVOKED') this.withhold(id, true);
      else d.store.transaction((tx) => {
        updateTx(tx, d, id, (r) => ({ ...r, view: { ...r.view, answer: null, delivery_state: error instanceof FoundationError && error.code === 'VERIFICATION_FAILED' ? 'verification_failed' : 'recovery_required', refund_state: error instanceof FoundationError && ['NOT_READY', 'SELLER_UNAVAILABLE'].includes(error.code) ? r.view.refund_state : 'refund_pending', message: 'delivery recovery required; do not purchase again' } })); this.receipt(tx, id);
      });
    }
  }
  async visible(id: Id, options?: SellerCallOptions): Promise<ConsultView> {
    const row = readJournal(this.deps.store, id).value;
    if (row.broker.aliasOf) return this.visible(row.broker.aliasOf, options);
    if (row.view.answer) {
      try { this.checkCache(row); } catch { this.withhold(id, false); return structuredClone(readJournal(this.deps.store, id).value.view); }
      try { await this.eligible(id, true, options); }
      catch (error) {
        const revoked = error instanceof FoundationError && error.code === 'CONTENT_REVOKED';
        this.withhold(id, revoked, !revoked);
        return { ...structuredClone(readJournal(this.deps.store, id).value.view), answer: null };
      }
      if (row.view.content_state !== 'eligible') this.deps.store.transaction(tx => {
        updateTx(tx, this.deps, id, r => ({ ...r, view: { ...r.view, content_state: 'eligible', message: 'verified answer; external untrusted evidence' } }));
        this.receipt(tx, id);
      });
    }
    return structuredClone(readJournal(this.deps.store, id).value.view);
  }
  checkCache(row: BrokerRow): void {
    const p = this.ports;
    const bytes = (hash: Sha256 | null): Uint8Array => {
      requireThat(hash, 'VERIFICATION_FAILED'); const record = this.deps.store.read('artifacts', hash); requireThat(record, 'VERIFICATION_FAILED');
      const value = Buffer.from(record.value.bytes_base64, 'base64'); requireThat(digest(value) === hash, 'VERIFICATION_FAILED'); return value;
    };
    const answer = p.parseWire('answer', bytes(row.broker.answerArtifact)), manifest = p.parseWire('manifest', bytes(row.broker.manifestArtifact));
    p.verifyEnvelope('answer', answer, row.broker.listing!.signing_key); p.verifyEnvelope('manifest', manifest, row.broker.listing!.signing_key);
    requireThat(p.payloadHash(json(answer.payload)) === row.broker.quote!.payload.answer_sha256 && p.payloadHash(json(manifest.payload)) === row.broker.quote!.payload.manifest_sha256, 'VERIFICATION_FAILED');
    requireThat(row.view.answer?.text === answer.payload.answer && p.payloadHash(json(row.view.answer.citations)) === p.payloadHash(json(answer.payload.citations)) && row.view.answer.answer_sha256 === row.broker.quote!.payload.answer_sha256 && row.view.answer.verified === true && row.view.answer.untrusted_content === true, 'VERIFICATION_FAILED');
    p.verifyCitations(answer, manifest, new Map(row.broker.pageArtifacts.map((page) => [page.pageId, bytes(page.sha256)])));
  }
  receipt(tx: StoreTx, id: Id): void {
    const row = readJournal(tx, id).value, j = row.broker, v = row.view, q = j.quote?.payload;
    const signed = tx.read('signed_transactions', id)?.value, arm = tx.read('arms', id)?.value.arm;
    const settlement = tx.read('settlements', id)?.value ?? null;
    const refs: Record<string, Sha256> = {};
    if (j.answerArtifact) refs.answer = j.answerArtifact;
    if (j.manifestArtifact) refs.manifest = j.manifestArtifact;
    for (const page of j.pageArtifacts) refs[`page:${page.pageId}`] = page.sha256;
    for (const [name, value] of Object.entries({ quote: j.quote, arm, approval: j.approval })) if (value) refs[name] = artifact(tx, this.ports.canonicalBytes(json(value)));
    const receipt: Receipt = { approval_ref: signed?.approval_ref ?? j.approval?.approvalRef ?? null, v: 1, receipt_id: v.receipt_id, request_id: row.request_id, buyer_id: row.buyer_id, seller_id: q?.seller_id ?? null, classification: 'technical_verification', question: j.question.text, question_policy_sha256: j.policyHash, quote_id: q?.quote_id ?? null, quote_sha256: q ? this.ports.payloadHash(json(q)) : null, answer_sha256: q?.answer_sha256 ?? null, registry_sha256: j.registryHash, manifest_sha256: q?.manifest_sha256 ?? null, arm_ticket_sha256: arm ? this.ports.payloadHash(json(arm.payload)) : null, dispositions: v.dispositions, network: j.input.max_price.network, asset: q?.asset ?? (j.input.max_price.network === 'devnet' ? 'TEST' : 'USDC'), total_atomic: v.purchase_amount_atomic, seller_atomic: settlement?.seller_credit ?? (v.purchase_amount_atomic === null ? null : zero), fee_atomic: settlement?.marketplace_credit ?? (v.purchase_amount_atomic === null ? null : zero), network_fee_lamports: v.network_fee_lamports, transaction_signature: signed?.signature ?? null, finalized_slot: settlement?.slot ?? null, explorer_url: null, settlement, verified: { chain: settlement ? true : q ? false : 'not_applicable', seller_signature: q ? true : 'not_applicable', answer_commitment: v.answer !== null ? true : q ? false : 'not_applicable', source_hashes: v.answer !== null ? true : q ? false : 'not_applicable' }, artifact_refs: refs, refund: { status: v.refund_state, returned_atomic: zero, transactions: [] }, latency_ms: { precheck: null, finality: null, delivery: null }, gbrain: { page_id: null, sync_state: v.import_state }, payment_state: v.payment_state, content_state: v.content_state, delivery_state: v.delivery_state, refund_state: v.refund_state, import_state: v.import_state, feedback_state: v.feedback_state };
    requireThat(this.ports.persistReceipt(tx, receipt, { blobs: new Map() }) === v.receipt_id, 'RECEIPT_STORE_UNAVAILABLE');
  }
  async resume(): Promise<RecoverySummary> {
    let pending = 0, resolved = 0, failed = 0;
    for (const row of journals(this.deps.store)) {
      if (row.buyer_id !== this.deps.policy.buyer.buyer_id || row.broker.stage === 'closed') continue;
      const id = row.view.consult_id;
      try {
        if (row.broker.stage === 'precheck') {
          this.deps.store.transaction((tx) => { for (const listing of candidates(this.deps, this.ports, row.broker.input, row.broker.question)) finishCheck(tx, this.deps, this.ports, id, listing.seller_id, null); });
          this.closeUnsent(id, 'precheck_failed');
        } else if (['selected', 'reviewing', 'approved', 'reserved'].includes(row.broker.stage)) this.closeUnsent(id, 'cancelled');
        else if (row.broker.stage === 'arming' || row.broker.stage === 'armed') await this.purchase(id);
        else await this.recover(id);
        const current = readJournal(this.deps.store, id).value;
        if (['closed', 'settled'].includes(current.broker.stage)) resolved++; else pending++;
      } catch { failed++; }
    }
    return { pending, resolved, failed };
  }
}

/** Local composition adapter, with the frozen CreateBroker/ResumePending
 * signatures. Do not expose this factory/ports/config over MCP.
 */
export function bindBroker(ports: BrokerPorts): BoundBroker {
  return { createBroker: (deps) => new BrokerCore(deps, ports).api(), resumePending: (deps) => new BrokerCore(deps, ports).resume() };
}
export const createBroker: CreateBroker = (deps) => {
  const ports = (deps as Partial<BrokerRuntimeDeps>).brokerPorts; requireThat(ports, 'NOT_READY');
  return bindBroker(ports).createBroker(deps);
};
export const resumePending: ResumePending = async (deps) => {
  const ports = (deps as Partial<BrokerRuntimeDeps>).brokerPorts; requireThat(ports, 'NOT_READY');
  return bindBroker(ports).resumePending(deps);
};

/** Local protected adapter until the lead exports this operator surface. */
export async function renewUnsignedPurchase(deps: BrokerDeps, ports: BrokerPorts, id: Id, previousArmHash: Sha256): Promise<ConsultView> {
  return new BrokerCore(deps, ports).renew(id, previousArmHash);
}
