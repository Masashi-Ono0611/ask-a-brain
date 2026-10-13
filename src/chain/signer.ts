import type { Address, ExpiryRefusal, ExpectedPayment, Id, Sha256, Signer, SignRequest, SignResult, SignedTransactionRow, Store, TestSignerConfig, Uuid } from '../wire/contracts.ts';
import { bytesHash, canonicalBytes, payloadHash, strictJson, validateWire, M03 } from '../wire/index.ts';
import { decodeAmount, FoundationError } from '../common/index.ts';
import { attachSignature, decodeLegacy, decodeSignedPayment, DEVNET_GENESIS, MAINNET_GENESIS, requireChain, validateLegacyMessage } from './legacy.ts';
import { signBytes } from './keys.ts';

export function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  requireChain(value !== null && typeof value === 'object' && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  requireChain(Object.keys(record).length === fields.length && fields.every(f => Object.hasOwn(record, f)));
  return record;
}
export function validateSignRequest(request: SignRequest): ExpectedPayment {
  exactObject(request, ['requestId', 'quoteId', 'network', 'genesis', 'message', 'messageHash', 'expectedPayer', 'quote', 'arm', 'manifestHash', 'registryHash', 'questionPolicyHash', 'reservationId', 'estimatedFee', 'maximumFee', 'blockhash', 'offerApproval']);
  validateWire('quote', request.quote); validateWire('arm', request.arm);
  const q = request.quote.payload; const a = request.arm.payload;
  exactObject(request.blockhash, ['blockhash', 'lastValidBlockHeight', 'observedAt']);
  exactObject(request.offerApproval, ['status', 'reviewedHash', 'actor', 'at', 'approvalRef']);
  requireChain(request.message instanceof Uint8Array && request.requestId === q.request_id && request.quoteId === q.quote_id && request.expectedPayer === q.payer && request.network === q.network && request.genesis === q.genesis_hash);
  requireChain(request.messageHash === bytesHash(request.message) && a.message_sha256 === request.messageHash && a.quote_id === q.quote_id && a.quote_sha256 === payloadHash(q) && a.buyer_id === q.buyer_id);
  requireChain(a.recent_blockhash === request.blockhash.blockhash && a.last_valid_block_height === request.blockhash.lastValidBlockHeight && request.manifestHash === q.manifest_sha256);
  requireChain(request.offerApproval.status === 'approved' && request.offerApproval.reviewedHash === payloadHash(q) && ['test', 'human'].includes(request.offerApproval.actor));
  requireChain([request.manifestHash, request.registryHash, request.questionPolicyHash].every(h => /^[0-9a-f]{64}$/.test(h)));
  requireChain([request.reservationId, request.offerApproval.approvalRef].every(id => typeof id === 'string' && /^[A-Za-z0-9_.\/-]+$/.test(id)));
  const issued = Date.parse(q.issued_at); const expires = Date.parse(q.expires_at); const armed = Date.parse(a.armed_at); const approved = Date.parse(request.offerApproval.at);
  requireChain(Number.isFinite(approved) && approved >= issued && approved <= armed && armed < expires && Number.isFinite(Date.parse(request.blockhash.observedAt)));
  requireChain(decodeAmount(request.estimatedFee) <= decodeAmount(request.maximumFee) && decodeAmount(request.maximumFee) <= M03.feePerPurchaseMax.value);
  const d = decodeLegacy(request.message); const source = d.instructions[0]?.accountIndices[0]; requireChain(source !== undefined && d.accountKeys[source]);
  const expected = { quote: request.quote, payer: { payer: q.payer, tokenAccount: d.accountKeys[source] }, blockhash: request.blockhash, messageHash: request.messageHash };
  validateLegacyMessage(request.message, expected); return expected;
}
export interface SignJournal {
  read(requestId: Uuid, hash: Sha256): SignResult | null;
  /** Optional only for legacy adapters; absent means renewal is unavailable. */
  begin?(request: SignRequest): void;
  expired?(request: SignRequest): void;
  write(request: SignRequest, result: Extract<SignResult, { status: 'signed' }>): void;
}
/** Same public port, volatile recovery for rehearsals only. Human helper uses StoreSignJournal. */
export class MemorySignJournal implements SignJournal {
  #attempts = new Set<Uuid>();
  #expired = new Map<string, ExpiryRefusal>();
  begin(request: SignRequest): void {
    requireChain(!this.#expired.has(`${request.requestId}:${request.messageHash}`));
    this.#attempts.add(request.requestId);
  }
  expired(request: SignRequest): void {
    requireChain(!this.#attempts.has(request.requestId) && !this.#rows.has(request.requestId));
    this.#expired.set(`${request.requestId}:${request.messageHash}`, { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: request.messageHash });
  }
  #rows = new Map<Uuid, { hash: Sha256; quote: Id; result: SignResult }>();
  read(id: Uuid, hash: Sha256): SignResult | null { const row = this.#rows.get(id); if (row && row.hash !== hash) throw new FoundationError('IDEMPOTENCY_CONFLICT'); if (row) return structuredClone(row.result); if (this.#attempts.has(id)) throw new FoundationError('PAYMENT_UNCERTAIN'); return this.#expired.get(`${id}:${hash}`) ?? null; }
  write(request: SignRequest, result: Extract<SignResult, { status: 'signed' }>): void {
    const existing = this.#rows.get(request.requestId);
    requireChain(!existing || existing.hash === request.messageHash);
    requireChain(!this.#expired.has(`${request.requestId}:${request.messageHash}`));
    for (const [id, row] of this.#rows) if (row.quote === request.quoteId && id !== request.requestId) throw new FoundationError('IDEMPOTENCY_CONFLICT');
    this.#rows.set(request.requestId, { hash: request.messageHash, quote: request.quoteId, result: structuredClone(result) });
  }
}
/** Reuses T0 tables. Approval result and signed bytes commit in ONE FULL/WAL transaction. */
interface HelperSignedRow extends SignedTransactionRow { readonly result_sha256: Sha256 }
export class StoreSignJournal implements SignJournal {
  #store: Store;
  constructor(store: Store) { this.#store = store; }
  begin(request: SignRequest): void {
    this.#store.transaction(tx => {
      requireChain(!tx.read('events', `expired_${request.requestId}_${request.messageHash}`));
      requireChain(!tx.read('events', `signing_${request.requestId}`) && !tx.read('events', `signing_quote_${request.quoteId}`));
      requireChain(!tx.scan('signed_transactions', { where: { quote_id: request.quoteId }, limit: 1 }).length);
      for (const event_id of [`signing_${request.requestId}`, `signing_quote_${request.quoteId}`]) tx.append({ event_id: event_id as Id, consult_id: request.requestId as unknown as Id, code: `SIGNING:${request.messageHash}`, recorded_at: request.blockhash.observedAt, counters: {} });
    });
  }
  expired(request: SignRequest): void {
    validateSignRequest(request);
    this.#store.transaction(tx => {
      requireChain(!tx.read('events', `signing_${request.requestId}`) && !tx.read('events', `signing_quote_${request.quoteId}`));
      requireChain(!tx.scan('signed_transactions', { where: { request_id: request.requestId }, limit: 1 }).length && !tx.scan('signed_transactions', { where: { quote_id: request.quoteId }, limit: 1 }).length);
      const event_id = `expired_${request.requestId}_${request.messageHash}` as Id;
      if (!tx.read('events', event_id)) tx.append({ event_id, consult_id: request.requestId as unknown as Id, code: 'EXPIRED_BEFORE_APPROVAL', recorded_at: request.blockhash.observedAt, counters: { lastValidBlockHeight: request.blockhash.lastValidBlockHeight } });
    });
  }
  read(requestId: Uuid, hash: Sha256): SignResult | null {
    const row = this.#store.read('signed_transactions', requestId)?.value as HelperSignedRow | undefined;
    if (!row) {
      if (this.#store.read('events', `signing_${requestId}`)) throw new FoundationError('PAYMENT_UNCERTAIN');
      return this.#store.read('events', `expired_${requestId}_${hash}`) ? { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: hash } : null;
    }
    if (row.message_sha256 !== hash) throw new FoundationError('IDEMPOTENCY_CONFLICT');
    const tx = Buffer.from(row.transaction_base64, 'base64'); const signed = decodeSignedPayment(tx);
    requireChain(bytesHash(signed.message) === hash && signed.signature === row.signature);
    const resultHash = row.result_sha256; requireChain(typeof resultHash === 'string');
    const artifact = this.#store.read('artifacts', resultHash)?.value; requireChain(artifact);
    const resultBytes = Buffer.from(artifact.bytes_base64, 'base64'); requireChain(bytesHash(resultBytes) === resultHash);
    const result = strictJson(resultBytes) as unknown as SignResult;
    requireChain(result.status === 'signed' && result.messageHash === hash && result.signature === row.signature && result.publicKey === decodeLegacy(signed.message).accountKeys[0]);
    exactObject(result, ['status', 'messageHash', 'publicKey', 'signature', 'approvalRef']);
    return result;
  }
  write(request: SignRequest, result: Extract<SignResult, { status: 'signed' }>): void {
    const expected = validateSignRequest(request);
    const payment = attachSignature({ message: request.message, messageHash: request.messageHash, expected, decoded: validateLegacyMessage(request.message, expected) }, result);
    this.#store.transaction(tx => {
      requireChain(!tx.read('events', `expired_${request.requestId}_${request.messageHash}`));
      const existing = tx.read('signed_transactions', request.requestId);
      if (existing) { requireChain(existing.value.signature === payment.signature && existing.value.message_sha256 === payment.messageHash); return; }
      const resultHash = payloadHash(result);
      tx.insert('artifacts', resultHash, { sha256: resultHash, bytes_base64: Buffer.from(canonicalBytes(result)).toString('base64') });
      const row: HelperSignedRow = { result_sha256: resultHash, request_id: request.requestId, quote_id: request.quoteId, genesis: request.genesis, signature: payment.signature, message_sha256: payment.messageHash, transaction_base64: Buffer.from(payment.transaction).toString('base64') };
      tx.insert('signed_transactions', request.requestId, row);
    });
  }
}
export class TestSigner implements Signer {
  #config: TestSignerConfig; #journal: SignJournal; #tail: Promise<unknown> = Promise.resolve();
  constructor(config: TestSignerConfig, journal: SignJournal = new MemorySignJournal()) {
    if (config.network !== 'devnet' && config.network !== 'local-simulation') throw new FoundationError('NETWORK_MISMATCH');
    if (config.network === 'devnet' && config.genesis !== DEVNET_GENESIS) throw new FoundationError('NETWORK_MISMATCH');
    requireChain(typeof config.keyBytes === 'function' && (config.network !== 'local-simulation' || !!config.namespace));
    this.#config = { ...config }; this.#journal = journal;
  }
  async publicKey(): Promise<Address> { return this.#config.publicKey; }
  async recover(id: Uuid, hash: Sha256): Promise<SignResult | null> { return this.#journal.read(id, hash); }
  sign(input: SignRequest): Promise<SignResult> {
    const request = structuredClone(input);
    const run = this.#tail.then(async (): Promise<SignResult> => {
      if (request.network !== 'devnet' || request.genesis !== DEVNET_GENESIS || request.genesis === MAINNET_GENESIS) return { status: 'denied', reason: 'NETWORK_MISMATCH' };
      validateSignRequest(request); requireChain(request.expectedPayer === this.#config.publicKey);
      const existing = this.#journal.read(request.requestId, request.messageHash); if (existing) return existing;
      const bytes = Uint8Array.from(await this.#config.keyBytes());
      try {
        const result = { status: 'signed', messageHash: request.messageHash, publicKey: this.#config.publicKey, signature: signBytes(request.message, bytes, this.#config.publicKey), approvalRef: request.offerApproval.approvalRef } as const;
        this.#journal.write(request, result); return result;
      } finally { bytes.fill(0); }
    });
    this.#tail = run.catch(() => undefined); return run;
  }
}
export function createTestSigner(config: TestSignerConfig): Signer { return new TestSigner(config); }
