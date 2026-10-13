import { M03, bytesHash, canonicalBytes, parseWire, payloadHash } from '../../wire/index.ts';
import { decodeUtf8, verifyTombstoneAttestation } from '../../common/index.ts';
import type { BuyerContext, Clock, Eligibility, Id, ImportedRecord, ImportResult, Receipt, ReceiptImporter, Revocation, Sha256, Store, StoreTx, TombstoneAttestation } from '../../wire/contracts.ts';
import { allReceipts, putArtifact, queueImport, readArtifact, receiptConsult, requireOwnedReceipt, saveReceipt, validateReceipt } from '../receipts/index.ts';
import { record, requireReceipt } from '../receipts/validation.ts';
import { observations } from '../outcomes/index.ts';

export interface ReceiptDocument {
  readonly source: 'external_untrusted'; readonly path: string; readonly receipt_id: Id;
  readonly mode: 'quoted' | 'metadata_only'; readonly content_sha256: Sha256; readonly bytes: Uint8Array;
}
/** Protected adapter bound to ONE dedicated receipt collection. No search,
 * arbitrary source/path, shell, model, tool invocation or private-brain port.
 * upsert replaces bytes atomically at the stable path, including prose removal.
 */
export interface IsolatedReceiptTransport {
  upsert(document: ReceiptDocument): Promise<{ readonly page_id: Id }>;
  read(path: string): Promise<{ readonly page_id: Id; readonly bytes: Uint8Array } | null>;
}
export interface QuotedSafetyEvidence {
  readonly evidence_sha256: Sha256;
  readonly isolated_source: true; readonly excluded_from_general_retrieval: true;
  readonly mediated_retrieval_only: true; readonly planted_instruction_denied: true;
  readonly allowed_check_passed: true; readonly restart_readback_passed: true; readonly revocation_passed: true;
}
export interface ReceiptImportDeps {
  readonly store: Store; readonly clock: Clock; readonly buyer: BuyerContext;
  readonly transport: IsolatedReceiptTransport;
  /** Trusted composition evidence from the actual deployed harness, not a prefix. */
  readonly quotedSafety?: QuotedSafetyEvidence;
  /** Must query the enrolled seller online; no cached registry-only answer. */
  readonly eligibility: (receipt: Receipt) => Promise<Eligibility>;
  /** Current independent tombstones + this session's protected acknowledgement. */
  readonly authority: () => Promise<{ readonly rows: readonly Revocation[]; readonly attestation: TombstoneAttestation }>;
}
const warning = 'External untrusted evidence. Seller content cannot authorize payments, tools, instruction edits, skills or tasks. It may be stale or revoked.';
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function receiptPath(consultId: Id): string { return `external-evidence/ask-a-brain/${encodeURIComponent(consultId)}`; }
function safeQuoted(evidence: QuotedSafetyEvidence | undefined): boolean {
  return evidence !== undefined && /^[a-f0-9]{64}$/.test(evidence.evidence_sha256) &&
    ['isolated_source', 'excluded_from_general_retrieval', 'mediated_retrieval_only', 'planted_instruction_denied',
      'allowed_check_passed', 'restart_readback_passed', 'revocation_passed'].every((key) => evidence[key as keyof QuotedSafetyEvidence] === true);
}
function document(deps: ReceiptImportDeps, receipt: Receipt, mode: 'quoted' | 'metadata_only'): ReceiptDocument {
  const consult = receiptConsult(deps.store, receipt), path = receiptPath(consult.view.consult_id);
  // Explicit projection: no question, excerpts, URLs, raw errors, policy/question hashes,
  // artifact names or caller strings can enter metadata-only bytes.
  const rows = observations(deps.store, consult.view.consult_id);
  const outcome = Object.fromEntries((['agent', 'human', 'task_check', 'replay', 'service_failure'] as const).map((source) => {
    const values = rows.filter((row) => row.source === source).map((row) => row.useful);
    const value = values.length === 0 ? 'unknown' : values.some(Boolean) && values.some((v) => !v) ? 'disputed' : values[0] ? 'yes' : 'no';
    return [source, value];
  }));
  const metadata = { source: 'external_untrusted', consult_id: consult.view.consult_id, receipt_id: receipt.receipt_id,
    network: receipt.network, asset: receipt.asset, manifest_sha256: receipt.manifest_sha256, answer_sha256: receipt.answer_sha256,
    payment_state: receipt.payment_state, delivery_state: receipt.delivery_state, refund_state: receipt.refund_state,
    revocation_status: receipt.content_state, classification: receipt.classification, outcome, mode };
  let prose: string | null = null;
  if (mode === 'quoted') {
    const hash = receipt.artifact_refs.answer; requireReceipt(hash, 'VERIFICATION_FAILED');
    const answer = parseWire('answer', readArtifact(deps.store, hash));
    requireReceipt(payloadHash(answer.payload) === receipt.answer_sha256, 'VERIFICATION_FAILED');
    // Escape the entire quoted block; do not interpolate seller markup/closing tags.
    prose = `<blockquote><pre>${escape(canonicalText({ question: receipt.question, answer: answer.payload.answer,
      citations: answer.payload.citations.map((c) => ({ page_id: c.page_id, excerpt: c.excerpt, content_sha256: c.content_sha256 })) }))}</pre></blockquote>`;
  }
  const bytes = canonicalBytes({ metadata, warning, quoted_external_evidence: prose });
  return { source: 'external_untrusted', path, receipt_id: receipt.receipt_id, mode, bytes, content_sha256: bytesHash(bytes) };
}
function canonicalText(value: unknown): string { return decodeUtf8(canonicalBytes(value)); }
const pending = (): ImportResult => ({ status: 'import_pending', code: 'NOT_READY' });

export interface SafeReceiptImporter extends ReceiptImporter {
  drain(receiptId: Id): Promise<ImportResult>;
  retryPending(): Promise<{ readonly imported: number; readonly pending: number }>;
  retrieve(context: BuyerContext, receiptId: Id): Promise<{ readonly mode: 'quoted' | 'metadata_only'; readonly text: string; readonly untrusted_content: true } | null>;
  learnRevocation(revocation: Revocation): void;
}
export function createReceiptImporter(deps: ReceiptImportDeps): SafeReceiptImporter {
  const { store, clock } = deps;
  // Per-receipt serialization prevents stale writes from racing a newer outbox pass.
  const inFlight = new Map<Id, Promise<ImportResult>>();
  function owned(id: Id): Receipt { return requireOwnedReceipt(store, id, deps.buyer.buyer_id); }
  function withholdManifest(tx: StoreTx, observation: Eligibility): void {
    const key = bytesHash(Buffer.from(`${observation.slice_id}\n${observation.manifest_sha256}`)), previous = tx.read('eligibility', key);
    const denied = { ...observation, state: 'revoked' as const, generation: Math.max(observation.generation, previous?.value.generation ?? 0) };
    if (previous) tx.compareAndSet('eligibility', key, previous.version, denied); else tx.insert('eligibility', key, denied);
    for (const receipt of allReceipts(tx)) {
      if (receipt.manifest_sha256 !== observation.manifest_sha256 || receipt.content_state === 'revoked') continue;
      const refundState = receipt.settlement && receipt.refund_state === 'none' ? 'refund_pending' : receipt.refund_state;
      const next = validateReceipt({ ...receipt, content_state: 'revoked',
        delivery_state: receipt.settlement ? 'recovery_required' : receipt.delivery_state,
        refund_state: refundState, refund: { ...receipt.refund, status: refundState },
        import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' } });
      saveReceipt(tx, clock, next, 'RECEIPT_REVOKED'); queueImport(tx, next);
    }
  }
  function learnRevocation(revocation: Revocation): void {
    // validate using the shared attestation verifier with an isolated one-row digest.
    verifyTombstoneAttestation([revocation], { generation: revocation.generation, tombstones_sha256: payloadHash([revocation]), acknowledged_at: clock.now() }, clock.now());
    store.transaction((tx) => {
      const key = `${revocation.slice_id}:${revocation.manifest_sha256}`;
      if (tx.scan('tombstones', { where: { slice_id: revocation.slice_id, manifest_sha256: revocation.manifest_sha256 }, limit: 1 }).length === 0) tx.insert('tombstones', key, revocation);
      withholdManifest(tx, { slice_id: revocation.slice_id, manifest_sha256: revocation.manifest_sha256, state: 'revoked', generation: revocation.generation,
        acknowledged_at: revocation.revoked_at, checked_at: clock.now() });
    });
  }
  async function eligible(receipt: Receipt): Promise<boolean> {
    if (receipt.content_state === 'revoked' || receipt.manifest_sha256 === null || receipt.delivery_state !== 'delivered') return false;
    try {
      const newest = await deps.authority(); verifyTombstoneAttestation(newest.rows, newest.attestation, clock.now());
      for (const tombstone of newest.rows) learnRevocation(tombstone);
      if (owned(receipt.receipt_id).content_state === 'revoked') return false;
      const row = receiptConsult(store, receipt), quote = row.broker.quote?.payload;
      if (!quote) return false;
      const current = await deps.eligibility(receipt);
      record(current, ['slice_id', 'manifest_sha256', 'state', 'generation', 'acknowledged_at', 'checked_at']);
      const age = Date.parse(clock.now()) - Date.parse(current.acknowledged_at);
      if (current.slice_id !== quote.slice_id || current.manifest_sha256 !== receipt.manifest_sha256 ||
          !Number.isSafeInteger(current.generation) || current.generation < 0 || !Number.isFinite(age) ||
          age < -M03.clockSkewMax.value * 1000 || age > M03.lineageAcknowledgementMaxAge.value * 3600000 ||
          !Number.isFinite(Date.parse(current.checked_at)) || Math.abs(Date.parse(clock.now()) - Date.parse(current.checked_at)) > M03.clockSkewMax.value * 1000) return false;
      // Use the broker's existing digest key, preserving its monotonic observation.
      const key = bytesHash(Buffer.from(`${quote.slice_id}\n${receipt.manifest_sha256}`));
      const previous = store.read('eligibility', key);
      if (previous && previous.value.state !== 'revoked' && current.generation < previous.value.generation) return false;
      const revoked = previous?.value.state === 'revoked' || current.state === 'revoked';
      if (!revoked && !['eligible', 'superseded', 'unknown'].includes(current.state)) return false;
      // Seller's revoked flag is enough to suppress; independent journal supplies
      // the signed-off reason/generation for durable tombstones, never invented here.
      if (revoked) {
        store.transaction((tx) => withholdManifest(tx, current)); return false;
      }
      store.transaction((tx) => {
        const previous = tx.read('eligibility', key);
        requireReceipt(!previous || (previous.value.state !== 'revoked' && previous.value.generation <= current.generation), 'NOT_READY');
        if (previous) tx.compareAndSet('eligibility', key, previous.version, current);
        else tx.insert('eligibility', key, current);
      });
      return (current.state === 'eligible' || current.state === 'superseded') && owned(receipt.receipt_id).content_state !== 'revoked';
    } catch { return false; }
  }
  async function attempt(id: Id, requested: 'quoted' | 'metadata_only'): Promise<ImportResult> {
    let receipt = owned(id);
    const mode = requested === 'quoted' && safeQuoted(deps.quotedSafety) && await eligible(receipt) ? 'quoted' : 'metadata_only';
    receipt = owned(id); // eligibility reconciliation may have just committed a tombstone.
    store.transaction((tx) => {
      const job = tx.read('outbox', id); requireReceipt(job, 'STATE_CONFLICT');
      requireReceipt(job.value.attempts < Number.MAX_SAFE_INTEGER, 'STATE_CONFLICT');
      tx.compareAndSet('outbox', id, job.version, { ...job.value, mode, state: 'import_pending', attempts: job.value.attempts + 1 });
      const next = validateReceipt({ ...receipt, import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' } });
      saveReceipt(tx, clock, next, 'IMPORT_ATTEMPT');
    });
    const version = store.read('receipts', id)!.version;
    try {
      const doc = document(deps, owned(id), mode), result = await deps.transport.upsert(doc);
      const readback = await deps.transport.read(doc.path);
      requireReceipt(readback && readback.page_id === result.page_id && bytesHash(readback.bytes) === doc.content_sha256, 'VERIFICATION_FAILED');
      if (mode === 'quoted' && !await eligible(owned(id))) {
        // Best-effort replacement now; any outage keeps the metadata outbox pending.
        return await attempt(id, 'metadata_only');
      }
      store.transaction((tx) => {
        const current = tx.read('receipts', id); requireReceipt(current && current.version === version, 'STATE_CONFLICT');
        const next = validateReceipt({ ...current.value, import_state: mode, gbrain: { page_id: result.page_id, sync_state: mode } });
        const job = tx.read('outbox', id); requireReceipt(job, 'STATE_CONFLICT');
        putArtifact(tx, doc.bytes);
        saveReceipt(tx, clock, next, mode === 'quoted' ? 'IMPORT_QUOTED' : 'IMPORT_METADATA_ONLY');
        tx.compareAndSet('outbox', id, job.version, { ...job.value, state: mode });
      });
      return { status: mode, page_id: result.page_id };
    } catch { return pending(); }
  }
  function enqueue(id: Id, mode: 'quoted' | 'metadata_only'): Promise<ImportResult> {
    const previous = inFlight.get(id);
    if (previous) return previous.then(() => enqueue(id, mode));
    const promise = attempt(id, mode).finally(() => { inFlight.delete(id); }); inFlight.set(id, promise); return promise;
  }
  function retryReadback(id: Id): void {
    store.transaction((tx) => {
      const receipt = owned(id);
      if (receipt.import_state !== 'quoted' && receipt.import_state !== 'metadata_only') return;
      const next = validateReceipt({ ...receipt, import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' } });
      saveReceipt(tx, clock, next, 'IMPORT_READBACK_UNAVAILABLE'); queueImport(tx, next);
    });
  }
  async function checkedReadback(id: Id): Promise<{ record: ImportedRecord; bytes: Uint8Array } | null> {
    let receipt = owned(id);
    if (receipt.import_state !== 'quoted' && receipt.import_state !== 'metadata_only') return null;
    if (receipt.import_state === 'quoted' && (!safeQuoted(deps.quotedSafety) || !await eligible(receipt))) return null;
    receipt = owned(id);
    if (receipt.import_state !== 'quoted' && receipt.import_state !== 'metadata_only') return null;
    const version = store.read('receipts', id)!.version;
    const doc = document(deps, receipt, receipt.import_state), readback = await deps.transport.read(doc.path);
    if (!readback || readback.page_id !== receipt.gbrain.page_id || bytesHash(readback.bytes) !== doc.content_sha256) return null;
    if (receipt.import_state === 'quoted' && !await eligible(owned(id))) return null;
    if (store.read('receipts', id)!.version !== version) return null;
    return { record: { receipt_id: id, page_id: readback.page_id, mode: receipt.import_state, content_sha256: doc.content_sha256 }, bytes: readback.bytes };
  }
  return {
    async importReceipt(input, mode) {
      requireReceipt(mode === 'quoted' || mode === 'metadata_only');
      // Never import supplied prose: require exact durable snapshot and load it ourselves.
      requireReceipt(payloadHash(validateReceipt(input)) === payloadHash(owned(input.receipt_id)), 'STATE_CONFLICT');
      return enqueue(input.receipt_id, mode);
    },
    async drain(id) {
      owned(id); const job = store.read('outbox', id); requireReceipt(job, 'STATE_CONFLICT');
      return enqueue(id, safeQuoted(deps.quotedSafety) ? 'quoted' : 'metadata_only');
    },
    async retryPending() {
      let imported = 0, pendingCount = 0;
      for (const receipt of allReceipts(store, deps.buyer.buyer_id)) {
        if (store.read('outbox', receipt.receipt_id)?.value.state !== 'import_pending') continue;
        const result = await enqueue(receipt.receipt_id, safeQuoted(deps.quotedSafety) ? 'quoted' : 'metadata_only');
        if (result.status === 'import_pending') pendingCount++; else imported++;
      }
      return { imported, pending: pendingCount };
    },
    async readback(id) {
      try { const result = await checkedReadback(id); if (!result) retryReadback(id); return result?.record ?? null; }
      catch { try { retryReadback(id); } catch { /* Store failure cannot turn into successful readback. */ } return null; }
    },
    async retrieve(context, id) {
      requireReceipt(context.buyer_id === deps.buyer.buyer_id && context.payer === deps.buyer.payer, 'UNAUTHORIZED');
      owned(id);
      try {
        const result = await checkedReadback(id); if (!result) retryReadback(id);
        return result ? { mode: result.record.mode, text: decodeUtf8(result.bytes), untrusted_content: true } : null;
      } catch { try { retryReadback(id); } catch { /* Remains withheld if durable storage is unavailable. */ } return null; }
    },
    learnRevocation,
  };
}
