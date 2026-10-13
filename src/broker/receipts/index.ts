import { randomUUID } from 'node:crypto';
import { FoundationError } from '../../common/index.ts';
import { bytesHash, canonicalBytes, parseWire, payloadHash, verifyEnvelope, verifyCitations, verifyAnswerCommitment } from '../../wire/index.ts';
import type { BrokerConsultRow, Clock, Id, PersistReceipt, Receipt, ReceiptArtifacts, ReconciledReceipt, Sha256, Store, StoreTx } from '../../wire/contracts.ts';
import { requireReceipt, validateReceipt } from './validation.ts';
export { parseReceipt, validateReceipt } from './validation.ts';

export function readArtifact(store: Pick<Store, 'read'>, hash: Sha256): Uint8Array {
  const row = store.read('artifacts', hash)?.value;
  requireReceipt(row && row.sha256 === hash, 'VERIFICATION_FAILED');
  const bytes = Buffer.from(row.bytes_base64, 'base64');
  requireReceipt(bytes.toString('base64') === row.bytes_base64 && bytesHash(bytes) === hash, 'VERIFICATION_FAILED');
  return bytes;
}
export function putArtifact(tx: StoreTx, bytes: Uint8Array): Sha256 {
  const hash = bytesHash(bytes), existing = tx.read('artifacts', hash);
  if (existing) readArtifact(tx, hash);
  else tx.insert('artifacts', hash, { sha256: hash, bytes_base64: Buffer.from(bytes).toString('base64') });
  return hash;
}
export function receiptConsult(store: Pick<Store, 'scan'>, receipt: Receipt): BrokerConsultRow {
  const rows = store.scan('consults', { where: { buyer_id: receipt.buyer_id, request_id: receipt.request_id }, limit: 2 });
  const row = rows[0]?.value;
  requireReceipt(rows.length === 1 && row?.broker && row.view && row.view.receipt_id === receipt.receipt_id && !row.broker.aliasOf, 'STATE_CONFLICT');
  return row as BrokerConsultRow;
}
/** Receipt primary keys are receipt_id by the Store contract, so pagination is exact. */
export function allReceipts(store: Pick<Store, 'scan'>, buyer?: Id): Receipt[] {
  const result: Receipt[] = []; let cursor: string | undefined;
  for (;;) {
    // Store adapter resource bound (not an M03 product cap).
    const page = store.scan('receipts', { limit: 1000, ...(buyer ? { where: { buyer_id: buyer } } : {}), ...(cursor ? { cursor } : {}) });
    result.push(...page.map((row) => validateReceipt(row.value)));
    if (page.length < 1000) return result;
    cursor = page.at(-1)!.value.receipt_id;
  }
}
export function receiptEvent(tx: StoreTx, clock: Clock, consultId: Id, code: string): void {
  tx.append({ event_id: `receipt_${randomUUID()}` as Id, consult_id: consultId, code, recorded_at: clock.now(), counters: {} });
}
/** Updates the broker view too: stale status must not undo import/refund/feedback. */
export function saveReceipt(tx: StoreTx, clock: Clock, receipt: ReconciledReceipt, code: string): void {
  const previous = tx.read('receipts', receipt.receipt_id);
  const row = receiptConsult(tx, receipt), id = row.view.consult_id;
  if (previous) tx.compareAndSet('receipts', receipt.receipt_id, previous.version, receipt);
  else tx.insert('receipts', receipt.receipt_id, receipt);
  const current = tx.read('consults', id);
  requireReceipt(current, 'STATE_CONFLICT');
  tx.compareAndSet('consults', id, current.version, { ...row, view: { ...row.view,
    import_state: receipt.import_state, feedback_state: receipt.feedback_state,
    refund_state: receipt.refund_state, content_state: receipt.content_state, delivery_state: receipt.delivery_state,
    ...(receipt.content_state === 'revoked' ? { answer: null } : {}),
  } });
  // Immutable full versions preserve delivery failure and accounting through corrections.
  putArtifact(tx, canonicalBytes(receipt));
  receiptEvent(tx, clock, id, code);
}
export function queueImport(tx: StoreTx, receipt: Receipt, mode: 'quoted' | 'metadata_only' = 'metadata_only'): void {
  const current = tx.read('outbox', receipt.receipt_id);
  const row = { receipt_id: receipt.receipt_id, mode, attempts: current?.value.attempts ?? 0, state: 'import_pending' as const };
  if (current) tx.compareAndSet('outbox', receipt.receipt_id, current.version, row);
  else tx.insert('outbox', receipt.receipt_id, row);
}
function verifyStoredArtifacts(tx: StoreTx, receipt: ReconciledReceipt): void {
  for (const hash of Object.values(receipt.artifact_refs)) readArtifact(tx, hash);
  const get = (name: string): Uint8Array => {
    const hash = receipt.artifact_refs[name]; requireReceipt(hash, 'VERIFICATION_FAILED'); return readArtifact(tx, hash);
  };
  const registry = parseWire('registry', get('registry'));
  const policy = parseWire('question_policy', get('question_policy'));
  requireReceipt(payloadHash(registry) === receipt.registry_sha256 && payloadHash(policy) === receipt.question_policy_sha256 &&
    policy.questions.some((q) => q.text === receipt.question), 'VERIFICATION_FAILED');
  if (receipt.quote_id === null) return;
  const quote = parseWire('quote', get('quote')), q = quote.payload;
  const listing = registry.listings.find((l) => l.seller_id === receipt.seller_id);
  requireReceipt(listing, 'VERIFICATION_FAILED'); verifyEnvelope('quote', quote, listing.signing_key);
  requireReceipt(q.quote_id === receipt.quote_id && q.request_id === receipt.request_id && q.buyer_id === receipt.buyer_id &&
    q.seller_id === receipt.seller_id && q.network === receipt.network && q.asset === receipt.asset &&
    payloadHash(q) === receipt.quote_sha256 && q.answer_sha256 === receipt.answer_sha256 && q.manifest_sha256 === receipt.manifest_sha256 &&
    bytesHash(Buffer.from(receipt.question)) === q.question_sha256, 'VERIFICATION_FAILED');
  if (receipt.arm_ticket_sha256 !== null) {
    const arm = parseWire('arm', get('arm')); verifyEnvelope('arm', arm, listing.signing_key);
    requireReceipt(payloadHash(arm.payload) === receipt.arm_ticket_sha256 && arm.payload.quote_sha256 === receipt.quote_sha256 &&
      arm.payload.buyer_id === receipt.buyer_id && arm.payload.quote_id === receipt.quote_id, 'VERIFICATION_FAILED');
    if (receipt.settlement) requireReceipt(receipt.settlement.genesis === q.genesis_hash && receipt.settlement.message_sha256 === arm.payload.message_sha256, 'VERIFICATION_FAILED');
  }
  if (receipt.delivery_state !== 'delivered') return;
  requireReceipt(receipt.approval_ref !== null && receipt.content_state !== 'revoked' && receipt.content_state !== 'unknown', 'VERIFICATION_FAILED');
  const answer = parseWire('answer', get('answer')), manifest = parseWire('manifest', get('manifest'));
  verifyEnvelope('answer', answer, listing.signing_key); verifyEnvelope('manifest', manifest, listing.signing_key);
  verifyAnswerCommitment(quote, answer);
  const pages = new Map(answer.payload.citations.map((c) => [c.page_id, get(`page:${c.page_id}`)]));
  verifyCitations(answer, manifest, pages);
  requireReceipt(payloadHash(manifest.payload) === receipt.manifest_sha256, 'VERIFICATION_FAILED');
}
export interface ReceiptPersistenceOptions {
  readonly clock: Clock;
  /** Protected replay-run lookup; never supplied by MCP or receipt fields. */
  readonly isReplay?: (consultId: Id) => boolean;
}
export function createReceiptPersistence(options: ReceiptPersistenceOptions): PersistReceipt {
  return (tx: StoreTx, input: Receipt, artifacts: ReceiptArtifacts): Id => {
    const candidate = validateReceipt(input), row = receiptConsult(tx, candidate), previous = tx.read('receipts', candidate.receipt_id)?.value;
    const j = row.broker;
    requireReceipt(candidate.classification !== 'independent', 'POLICY_DENIED');
    requireReceipt(candidate.question === j.question.text && candidate.registry_sha256 === j.registryHash &&
      candidate.question_policy_sha256 === j.policyHash && candidate.buyer_id === row.buyer_id, 'STATE_CONFLICT');
    if (previous) {
      requireReceipt(previous.request_id === candidate.request_id && previous.buyer_id === candidate.buyer_id &&
        previous.question === candidate.question && previous.registry_sha256 === candidate.registry_sha256 &&
        previous.question_policy_sha256 === candidate.question_policy_sha256 && previous.quote_id === candidate.quote_id, 'IDEMPOTENCY_CONFLICT');
      requireReceipt(previous.settlement === null || payloadHash(previous.settlement) === payloadHash(candidate.settlement), 'STATE_CONFLICT');
    }
    for (const [hash, bytes] of artifacts.blobs) {
      requireReceipt(bytesHash(bytes) === hash, 'VERIFICATION_FAILED'); putArtifact(tx, bytes);
    }
    const refs: Record<string, Sha256> = { ...previous?.artifact_refs, ...candidate.artifact_refs, registry: candidate.registry_sha256, question_policy: candidate.question_policy_sha256 };
    const signed = tx.read('signed_transactions', row.view.consult_id)?.value;
    const approval = signed?.approval_ref ?? j.approval?.approvalRef ?? null;
    requireReceipt(candidate.approval_ref === null || candidate.approval_ref === approval, 'VERIFICATION_FAILED');
    if (candidate.settlement) refs.settlement = putArtifact(tx, canonicalBytes(candidate.settlement));
    if (signed?.transaction_sha256) refs.transaction = signed.transaction_sha256;
    let receipt: ReconciledReceipt = { ...candidate, approval_ref: approval, artifact_refs: refs,
      classification: options.isReplay?.(row.view.consult_id) === true ? 'replay' : 'technical_verification',
      feedback_state: previous?.feedback_state ?? 'none',
      refund: previous && previous.refund_state !== 'none' ? previous.refund : candidate.refund,
      refund_state: previous && previous.refund_state !== 'none' ? previous.refund_state : candidate.refund_state,
      import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' },
    };
    // A late broker retry cannot clear a learned tombstone or recovery obligation.
    const revoked = previous?.content_state === 'revoked' || (receipt.manifest_sha256 !== null &&
      (tx.scan('tombstones', { where: { manifest_sha256: receipt.manifest_sha256 }, limit: 1 }).length > 0 ||
        tx.scan('eligibility', { where: { manifest_sha256: receipt.manifest_sha256 }, limit: 1 })[0]?.value.state === 'revoked'));
    if (revoked) receipt = { ...receipt, content_state: 'revoked', delivery_state: receipt.settlement ? 'recovery_required' : receipt.delivery_state,
      refund_state: receipt.settlement && receipt.refund_state === 'none' ? 'refund_pending' : receipt.refund_state,
      refund: { ...receipt.refund, status: receipt.settlement && receipt.refund_state === 'none' ? 'refund_pending' : receipt.refund_state } };
    verifyStoredArtifacts(tx, receipt);
    // Ignore only T6-managed import state when detecting an identical broker retry.
    if (previous && payloadHash({ ...previous, import_state: 'import_pending', gbrain: receipt.gbrain }) === payloadHash(receipt)) return receipt.receipt_id;
    receipt = validateReceipt(receipt);
    saveReceipt(tx, options.clock, receipt, `RECEIPT_${receipt.delivery_state.toUpperCase()}`); queueImport(tx, receipt);
    return receipt.receipt_id;
  };
}
/** Convenient port with the platform clock; callers with virtual time use the factory. */
import { SystemClock } from '../../common/index.ts';
export const persistReceipt: PersistReceipt = createReceiptPersistence({ clock: new SystemClock() });

export function requireOwnedReceipt(store: Pick<Store, 'read'>, id: Id, buyer: Id): ReconciledReceipt {
  const row = store.read('receipts', id);
  if (!row || row.value.buyer_id !== buyer) throw new FoundationError('UNAUTHORIZED');
  return validateReceipt(row.value);
}
