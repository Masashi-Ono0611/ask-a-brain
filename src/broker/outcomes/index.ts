import { randomUUID } from 'node:crypto';
import { atomicFromBigint, decodeAmount } from '../../common/index.ts';
import { M03, canonicalBytes, strictJson, validateWire } from '../../wire/index.ts';
import type { AgentFeedbackInput, BuyerContext, Clock, FeedbackOutput, Id, MarketApi, Outcome, OutcomeSource, Receipt, RefundRow, ReportOutput, Sha256, Store, StoreTx } from '../../wire/contracts.ts';
import { allReceipts, putArtifact, queueImport, readArtifact, receiptConsult, saveReceipt, validateReceipt } from '../receipts/index.ts';
import { opaqueId, record, requireReceipt } from '../receipts/validation.ts';

export interface OperatorContext { readonly operator_id: Id; readonly session_id: Id }
export interface CheckedRun { readonly run_sha256: Sha256; readonly verdict: 'pass' | 'fail' | 'unknown' }
export interface OutcomeDeps {
  readonly store: Store; readonly clock: Clock; readonly buyer: BuyerContext;
  /** These capabilities are protected operator/checker entry points, never MCP fields. */
  readonly authorizeHuman: (context: OperatorContext) => boolean;
  readonly verifyRun: (source: 'task_check' | 'replay', consultId: Id, runHash: Sha256) => Promise<CheckedRun>;
  readonly verifyRefund: (consultId: Id, evidenceHash: Sha256) => Promise<Omit<RefundRow, 'consult_id' | 'corrects'>>;
}
export interface OutcomeService {
  feedback: MarketApi['feedback']; report: MarketApi['report'];
  human(context: OperatorContext, input: AgentFeedbackInput, corrects?: Id): Outcome;
  taskCheck(consultId: Id, runHash: Sha256): Promise<Outcome | null>;
  replay(consultId: Id, runHash: Sha256): Promise<Outcome | null>;
  serviceFailure(consultId: Id): Outcome;
  observeRun(source: 'task_check' | 'replay', consultId: Id, runHash: Sha256, corrects?: Id): Promise<Outcome>;
  refund(context: OperatorContext, consultId: Id, evidenceHash: Sha256): Promise<void>;
}
function feedbackInput(input: unknown): AgentFeedbackInput {
  const value = record(input instanceof Uint8Array ? strictJson(input, { integerNumbersOnly: true }) : input, ['consult_id', 'useful', 'reason_code']);
  requireReceipt(typeof value.useful === 'boolean' && ['prevented_missed_check', 'unblocked_task', 'already_known', 'incorrect', 'not_actionable', 'other'].includes(String(value.reason_code)));
  return { consult_id: opaqueId(value.consult_id), useful: value.useful, reason_code: value.reason_code as AgentFeedbackInput['reason_code'] };
}
/** Returns every append-only observation, including corrections (no vote aggregation). */
export function observations(store: Pick<Store, 'scan'>, consultId: Id): Outcome[] {
  const result: Outcome[] = []; let cursor: string | undefined;
  for (;;) {
    const rows = store.scan('outcomes', { where: { consult_id: consultId }, limit: 1000, ...(cursor ? { cursor } : {}) });
    result.push(...rows.map((row) => row.value));
    if (rows.length < 1000) return result;
    cursor = rows.at(-1)!.value.feedback_id;
  }
}
export function exclusion(receipt: Receipt, source: OutcomeSource, kind: 'founder' | 'demo' | 'independent' | undefined): string {
  if (source === 'replay' || receipt.classification === 'replay') return 'replay';
  if (kind === 'demo') return 'demo';
  if (receipt.network === 'devnet') return 'devnet';
  if (kind === 'founder') return 'self_operator_funded';
  return 'independence_unverified'; // no independent paid admission in this build
}
function receiptForConsult(store: Pick<Store, 'read'>, consultId: Id, buyer: Id): Receipt {
  opaqueId(consultId);
  const row = store.read('consults', consultId)?.value;
  requireReceipt(row?.buyer_id === buyer && row.view && row.broker && !row.broker.aliasOf, 'UNAUTHORIZED');
  const receipt = store.read('receipts', row.view.receipt_id)?.value;
  requireReceipt(receipt && receipt.buyer_id === buyer && receipt.seller_id !== null, 'NOT_READY');
  return validateReceipt(receipt);
}
function hashInput(hash: Sha256): void { requireReceipt(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)); }
function updateFeedbackReceipt(tx: StoreTx, deps: OutcomeDeps, receipt: Receipt, ref: { name: string; bytes: Uint8Array } | null, code: string): void {
  const refs = { ...receipt.artifact_refs };
  if (ref) refs[ref.name] = putArtifact(tx, ref.bytes);
  const next = validateReceipt({ ...receipt, artifact_refs: refs, feedback_state: 'recorded', import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' } });
  saveReceipt(tx, deps.clock, next, code); queueImport(tx, next);
}
export function createOutcomeService(deps: OutcomeDeps): OutcomeService {
  const { store, clock } = deps;
  function authorized(context: BuyerContext): void {
    requireReceipt(context.buyer_id === deps.buyer.buyer_id && context.payer === deps.buyer.payer, 'UNAUTHORIZED');
  }
  function write(source: OutcomeSource, input: AgentFeedbackInput, corrects: Id | null = null, run: CheckedRun | null = null): Outcome {
    const feedback = feedbackInput(input);
    return store.transaction((tx) => {
      const receipt = receiptForConsult(tx, feedback.consult_id, deps.buyer.buyer_id), consult = receiptConsult(tx, receipt);
      const original = observations(tx, feedback.consult_id).filter((row) => row.source === source && row.corrects === null);
      if (corrects === null) {
        requireReceipt(original.length < M03.observationsPerConsultSource.value && !receipt.artifact_refs[`unknown:${source}`], 'IDEMPOTENCY_CONFLICT');
        const startedAt = receipt.settlement?.observed_at ?? consult.broker.createdAt;
        const age = Date.parse(clock.now()) - Date.parse(startedAt);
        requireReceipt(Number.isFinite(age) && age >= 0 && age <= M03.feedbackWindow.value * 86400000, 'POLICY_DENIED');
      } else {
        opaqueId(corrects);
        requireReceipt(original.length === 1 && original[0]!.feedback_id === corrects && original[0]!.buyer_id === receipt.buyer_id, 'STATE_CONFLICT');
      }
      requireReceipt(source !== 'service_failure' || ['delivery_failed', 'verification_failed', 'recovery_required'].includes(receipt.delivery_state), 'STATE_CONFLICT');
      const outcome: Outcome = { v: 1, feedback_id: `feedback_${randomUUID()}` as Id, consult_id: feedback.consult_id,
        quote_id: receipt.quote_id, answer_sha256: receipt.answer_sha256, buyer_id: receipt.buyer_id, seller_id: receipt.seller_id!,
        source, useful: run?.verdict === 'unknown' ? null : feedback.useful, verdict: run?.verdict ?? (feedback.useful ? 'pass' : 'fail'), run_sha256: run?.run_sha256 ?? null, reason_code: feedback.reason_code, transaction_signature: receipt.transaction_signature,
        classification: source === 'replay' ? 'replay' : receipt.classification, eligible_for_trust: false,
        exclusion_reason: exclusion(receipt, source, consult.broker.listing?.listing_kind), recorded_at: clock.now(), corrects };
      // Shared schema validates the authenticated source and run evidence together.
      validateWire('outcome', outcome);
      tx.insert('outcomes', outcome.feedback_id, outcome);
      updateFeedbackReceipt(tx, deps, receipt, run ? { name: `outcome:${outcome.feedback_id}`, bytes: canonicalBytes({ source, ...run }) } : null, 'OUTCOME_RECORDED');
      return outcome;
    });
  }
  async function check(source: 'task_check' | 'replay', consultId: Id, runHash: Sha256): Promise<Outcome | null> {
    hashInput(runHash); receiptForConsult(store, consultId, deps.buyer.buyer_id);
    const run = await deps.verifyRun(source, consultId, runHash);
    record(run, ['run_sha256', 'verdict']);
    requireReceipt(run.run_sha256 === runHash && ['pass', 'fail', 'unknown'].includes(run.verdict), 'VERIFICATION_FAILED');
    if (run.verdict !== 'unknown') return write(source, { consult_id: consultId, useful: run.verdict === 'pass', reason_code: 'other' }, null, run);
    // Outcome.useful is boolean-only: keep explicit UNKNOWN evidence locally and
    // no fabricated negative vote. The report counts absence as unknown.
    store.transaction((tx) => {
      const receipt = receiptForConsult(tx, consultId, deps.buyer.buyer_id), key = `unknown:${source}`;
      requireReceipt(!receipt.artifact_refs[key] && !observations(tx, consultId).some((o) => o.source === source), 'IDEMPOTENCY_CONFLICT');
      updateFeedbackReceipt(tx, deps, receipt, { name: key, bytes: canonicalBytes({ source, ...run }) }, 'OUTCOME_UNKNOWN');
    }); return null;
  }
  return {
    async observeRun(source, consultId, runHash, corrects) {
      requireReceipt(source === 'task_check' || source === 'replay', 'UNAUTHORIZED');
      hashInput(runHash); receiptForConsult(store, consultId, deps.buyer.buyer_id);
      const run = await deps.verifyRun(source, consultId, runHash);
      record(run, ['run_sha256', 'verdict']);
      requireReceipt(run.run_sha256 === runHash && ['pass', 'fail', 'unknown'].includes(run.verdict), 'VERIFICATION_FAILED');
      return write(source, { consult_id: consultId, useful: run.verdict === 'pass', reason_code: 'other' }, corrects ?? null, run);
    },
    async feedback(context, input): Promise<FeedbackOutput> {
      authorized(context); const result = write('agent', input);
      return { feedback_id: result.feedback_id, source: 'agent', eligible_for_trust: false };
    },
    human(context, input, corrects) { requireReceipt(deps.authorizeHuman(context), 'UNAUTHORIZED'); return write('human', input, corrects ?? null); },
    taskCheck: (id, hash) => check('task_check', id, hash), replay: (id, hash) => check('replay', id, hash),
    serviceFailure(id) { return write('service_failure', { consult_id: id, useful: false, reason_code: 'other' }); },
    async refund(context, consultId, evidenceHash) {
      requireReceipt(deps.authorizeHuman(context), 'UNAUTHORIZED'); hashInput(evidenceHash);
      receiptForConsult(store, consultId, deps.buyer.buyer_id);
      const verified = await deps.verifyRefund(consultId, evidenceHash);
      record(verified, ['genesis', 'signature', 'amount_atomic', 'recorded_at']);
      requireReceipt(typeof verified.recorded_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(verified.recorded_at) &&
        Number.isFinite(Date.parse(verified.recorded_at)) && Date.parse(verified.recorded_at) <= Date.parse(clock.now()) + M03.clockSkewMax.value * 1000, 'VERIFICATION_FAILED');
      store.transaction((tx) => {
        const receipt = receiptForConsult(tx, consultId, deps.buyer.buyer_id);
        requireReceipt(receipt.settlement && receipt.total_atomic !== null && receipt.settlement.genesis === verified.genesis, 'VERIFICATION_FAILED');
        const amount = decodeAmount(verified.amount_atomic), returned = decodeAmount(receipt.refund.returned_atomic) + amount;
        requireReceipt(amount > 0n && returned <= decodeAmount(receipt.total_atomic), 'VERIFICATION_FAILED');
        const row: RefundRow = { ...verified, consult_id: consultId, corrects: null };
        requireReceipt(tx.scan('refunds', { where: { genesis: row.genesis, signature: row.signature }, limit: 1 }).length === 0, 'IDEMPOTENCY_CONFLICT');
        const status = returned === decodeAmount(receipt.total_atomic) ? 'refunded' : 'partial_refund';
        const next = validateReceipt({ ...receipt, refund_state: status,
          refund: { status, returned_atomic: atomicFromBigint(returned), transactions: [...receipt.refund.transactions, row.signature] },
          import_state: 'import_pending', gbrain: { page_id: null, sync_state: 'import_pending' } });
        tx.insert('refunds', `refund_${randomUUID()}`, row);
        putArtifact(tx, canonicalBytes({ evidence_sha256: evidenceHash, ...row }));
        saveReceipt(tx, clock, next, 'REFUND_RECORDED'); queueImport(tx, next);
      });
    },
    async report(context, input): Promise<ReportOutput> {
      authorized(context); const value = record(input, ['date_utc']);
      requireReceipt(typeof value.date_utc === 'string' && /^\d{4}-\d\d-\d\d$/.test(value.date_utc) &&
        new Date(`${value.date_utc}T00:00:00Z`).toISOString().slice(0, 10) === value.date_utc);
      const receipts = allReceipts(store, deps.buyer.buyer_id).filter((receipt) => receiptConsult(store, receipt).broker.createdAt.slice(0, 10) === value.date_utc);
      return renderReport(store, receipts, value.date_utc);
    },
  };
}
type Signal = 'yes' | 'no' | 'unknown' | 'disputed';
function signal(rows: readonly Outcome[], source: OutcomeSource): Signal {
  const values = rows.filter((row) => row.source === source).map((row) => row.useful);
  if (!values.length || values.every((v) => v === null)) return 'unknown';
  if (values.some(Boolean) && values.some((v) => v === false)) return 'disputed';
  return values.includes(true) ? 'yes' : values.includes(false) ? 'no' : 'unknown';
}
function displayId(id: string): string { return id.replace(/[|<>`\r\n]/g, '_'); }
function renderReport(store: Store, receipts: readonly Receipt[], day: string): ReportOutput {
  const lines = [`Ask a Brain — consults started ${day} UTC`, '', 'unrated until 3 independent buyers',
    'Eligible independent buyers: 0 (closed admission policy). No numeric score. Missing feedback is unknown.',
    'Metadata-only is reduced conformance; import_pending means gbrain storage remains unmet.', '',
    '| Evidence class / network | Finalized paid denominator | Delivered | Failed ever | Pending delivery | Refunded | Partial refund | Principal atomic | Returned atomic | Actual fees lamports | Unknown payments | Unknown fees |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const classification of ['technical_verification', 'replay', 'independent'] as const) {
    for (const network of ['devnet', 'mainnet-beta'] as const) {
      // Legacy/mislabeled independent records remain in the technical denominator;
      // none may become an endorsement or silently disappear under closed admission.
      const cohort = classification === 'independent' ? [] : receipts.filter((r) =>
        (r.classification === 'replay' ? 'replay' : 'technical_verification') === classification && r.network === network);
      const paid = cohort.filter((r) => r.settlement !== null && r.settlement.payer_debit !== '0');
      const failed = (r: Receipt): boolean => {
        if (['delivery_failed', 'verification_failed', 'recovery_required'].includes(r.delivery_state)) return true;
        const id = receiptConsult(store, r).view.consult_id;
        // Persisted failure events remain after recovery/refund.
        return ['RECEIPT_DELIVERY_FAILED', 'RECEIPT_VERIFICATION_FAILED', 'RECEIPT_RECOVERY_REQUIRED', 'RECEIPT_REVOKED'].some((code) =>
          events(store, id).some((event) => event.code === code));
      };
      const sum = (rows: readonly Receipt[], field: 'total_atomic' | 'network_fee_lamports'): string => rows.reduce((n, r) => n + (r[field] === null ? 0n : decodeAmount(r[field])), 0n).toString();
      lines.push(`| ${classification} / ${network} | ${paid.length} | ${paid.filter((r) => r.delivery_state === 'delivered').length} | ${paid.filter(failed).length} | ${paid.filter((r) => r.delivery_state === 'pending').length} | ${paid.filter((r) => r.refund_state === 'refunded').length} | ${paid.filter((r) => r.refund_state === 'partial_refund').length} | ${sum(paid, 'total_atomic')} | ${paid.reduce((n, r) => n + decodeAmount(r.refund.returned_atomic), 0n)} | ${sum(cohort, 'network_fee_lamports')} | ${cohort.filter((r) => r.payment_state === 'payment_pending').length} | ${cohort.filter((r) => r.network_fee_lamports === null).length} |`);
    }
  }
  lines.push('', 'Failure and refund columns overlap; a refund never removes a failure. Known fee totals exclude unknown fees; pending is not zero spend.', '',
    '| Receipt / consult | Seller / operator / kind | Evidence class | Payment / delivery / refund | Import | Agent | Human | Task check | Replay | Service failure | Eligible | Primary exclusion |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|');
  const evidenceLines: string[] = [];
  for (const r of receipts) {
    const row = receiptConsult(store, r), id = row.view.consult_id, outcomes = observations(store, id);
    const listing = row.broker.listing;
    lines.push(`| ${displayId(r.receipt_id)} / ${displayId(id)} | ${displayId(r.seller_id ?? 'none')} / ${displayId(listing?.operator_id ?? 'none')} / ${listing?.listing_kind ?? 'none'} | ${r.classification === 'replay' ? 'replay' : 'technical_verification'} | ${r.payment_state} / ${r.delivery_state} / ${r.refund_state} | ${r.import_state} | ${signal(outcomes, 'agent')} | ${signal(outcomes, 'human')} | ${signal(outcomes, 'task_check')} | ${signal(outcomes, 'replay')} | ${signal(outcomes, 'service_failure')} | false | ${exclusion(r, 'human', listing?.listing_kind)} |`);
    for (const outcome of outcomes) {
      const evidence = r.artifact_refs[`outcome:${outcome.feedback_id}`];
      if (evidence) {
        const value = strictJson(readArtifact(store, evidence));
        // Content-free run hash only, never arbitrary evidence prose or remote URLs.
        if (value && typeof value === 'object' && !Array.isArray(value) && 'run_sha256' in value && typeof value.run_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.run_sha256)) evidenceLines.push(`Run evidence ${displayId(r.receipt_id)} / ${outcome.source}: sha256:${value.run_sha256}`);
      }
    }
    for (const source of ['task_check', 'replay'] as const) {
      const evidence = r.artifact_refs[`unknown:${source}`];
      if (!evidence) continue;
      const value = strictJson(readArtifact(store, evidence));
      if (value && typeof value === 'object' && !Array.isArray(value) && 'run_sha256' in value && typeof value.run_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.run_sha256)) evidenceLines.push(`UNKNOWN run evidence ${displayId(r.receipt_id)} / ${source}: sha256:${value.run_sha256}`);
    }
  }
  if (evidenceLines.length) lines.push('', ...evidenceLines);
  lines.push('', '| Source | Yes / pass | No / fail | Unknown | Disputed | Coverage / consult denominator |', '|---|---:|---:|---:|---:|---|');
  for (const source of ['agent', 'human', 'task_check', 'replay', 'service_failure'] as const) {
    const signals = receipts.map((r) => signal(observations(store, receiptConsult(store, r).view.consult_id), source));
    const count = (s: Signal): number => signals.filter((v) => v === s).length;
    lines.push(`| ${source} | ${count('yes')} | ${count('no')} | ${count('unknown')} | ${count('disputed')} | ${signals.length - count('unknown')} / ${signals.length} |`);
  }
  return { markdown: `${lines.join('\n')}\n`, receipt_ids: receipts.map((r) => r.receipt_id), gbrain_pending_count: receipts.filter((r) => r.import_state === 'import_pending').length };
}
function events(store: Pick<Store, 'scan'>, consultId: Id) {
  const result = []; let cursor: string | undefined;
  for (;;) {
    const page = store.scan('events', { where: { consult_id: consultId }, limit: 1000, ...(cursor ? { cursor } : {}) });
    result.push(...page.map((r) => r.value));
    if (page.length < 1000) return result;
    cursor = page.at(-1)!.value.event_id;
  }
}
