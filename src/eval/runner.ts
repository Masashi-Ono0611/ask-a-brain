import { bytesHash, canonicalBytes, M03, parseWire, payloadHash, renderAnswer, strictJson } from '../wire/index.ts';
import type { ConsultView, Id, TaskTools, RunArm, IsoTime } from '../wire/contracts.ts';
import type { Accounting, AttemptResult, FrozenRun, Metrics, RunnerDependencies } from './types.ts';
import { checklist, parseCorpus, parseFixture } from './fixtures.ts';
import { createTaskTools } from './tools.ts';
import { parseStudy, planRuns, replayLimits, taskNames, toolsForArm } from './arms.ts';
import { clone, EvalError, id, integer, object, requireEval, text } from './validation.ts';

const limitations = Object.freeze(['SYNTHETIC_ONLY', 'NO_HISTORICAL_OR_GATE1_CREDIT', 'LIVE_TOKEN_CAP_UNVERIFIED', 'OS_ISOLATION_UNVERIFIED', 'HUMAN_SIGNED_DEVNET_UNRUN']);
export function unrunResult(spec: FrozenRun, reason = 'UNRUN'): AttemptResult {
  return { run_id: spec.run_id, spec, status: 'unrun', reason_code: reason, evidence: [], tokens: 0, calls: 0, rejected_calls: 0,
    elapsed_ms: 0, consult_ids: [], observation: null, usage: null, purchases_reserved: 0, accounting: [], simulated: true,
    historical_n: 0, compliant_primary: false, limitations };
}
function metrics(input: unknown): Metrics {
  const m = object(input, ['effective_model', 'config_sha256', 'tokens', 'model_ms', 'human_active_ms', 'chain_ms', 'model_expense_usd', 'rpc_expense_usd', 'hosting_expense_usd']);
  text(m.effective_model); text(m.config_sha256);
  for (const key of ['tokens', 'model_ms', 'human_active_ms', 'chain_ms']) if (m[key] !== null) integer(m[key]);
  for (const key of ['model_expense_usd', 'rpc_expense_usd', 'hosting_expense_usd']) requireEval(m[key] === null || (typeof m[key] === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(m[key])));
  return clone(m) as unknown as Metrics;
}
/** Protected orchestrator only. The driver gets no spec, rubric, market or store. */
export function createReplayRunner(deps: RunnerDependencies) {
  const study = parseStudy(canonicalBytes(deps.study)); let running = false;
  const journal = deps.journal;
  const runArm: RunArm = async (specInput, options = {}) => {
    requireEval(!running, 'RUN_ALREADY_ACTIVE');
    const spec = clone(specInput);
    const expected = planRuns(study, spec.started_at).find((s) => s.run_id === spec.run_id);
    requireEval(expected && payloadHash(expected) === payloadHash(spec), 'FROZEN_SPEC_CHANGED');
    requireEval(!journal.read().some((e) => e.run_id === spec.run_id), 'ATTEMPT_EXISTS');
    running = true;
    options.signal?.throwIfAborted();
    const start = deps.clock.monotonicMs();
    let calls = 0, rejected = 0, purchases = 0, closed = false, busy = false;
    let usage: Metrics | null = null, reason = 'COMPLETED';
    const accounting: Accounting[] = [], consultIds: Id[] = [];
    let controller: ReturnType<typeof createTaskTools> | null = null;
    const abort = new AbortController(), cancelTimer = new AbortController();
    const cancel = (): void => abort.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const deadline = new Date(Math.min(Date.parse(deps.clock.now()) + replayLimits.wall_ms, options.deadline ? Date.parse(options.deadline) : Infinity)).toISOString() as IsoTime;
    const callOptions = { signal: abort.signal, deadline };
    function guard(): void {
      requireEval(!closed, 'RUN_CLOSED');
      requireEval(!abort.signal.aborted, 'RUN_CANCELLED');
      requireEval(deps.clock.monotonicMs() - start < replayLimits.wall_ms && Date.parse(deps.clock.now()) < Date.parse(deadline), 'WALL_BUDGET');
    }
    function recordView(view: ConsultView): ConsultView {
      // Preserve observed payment/delivery even when matched-content verification fails.
      if (!consultIds.includes(view.consult_id)) consultIds.push(view.consult_id);
      accounting.push({ principal_atomic: view.purchase_amount_atomic, network_fee_lamports: view.network_fee_lamports,
        payment_state: view.payment_state, delivery_state: view.delivery_state, refund_state: view.refund_state });
      return view;
    }
    try {
      journal.append({ kind: 'start', run_id: spec.run_id, data: { spec, at: deps.clock.now(), limits: replayLimits, limitations } });
      const fixtureBytes = deps.source.fixture(spec.fixture_id), corpusBytes = deps.source.corpus(), rubricBytes = deps.source.rubric(spec.fixture_id);
      requireEval(bytesHash(fixtureBytes) === spec.fixture_sha256 && bytesHash(corpusBytes) === spec.corpus_sha256 && bytesHash(rubricBytes) === spec.rubric_sha256, 'FROZEN_ARTIFACT_CHANGED');
      const fixture = parseFixture(fixtureBytes), corpus = parseCorpus(corpusBytes);
      requireEval(fixture.fixture_id === spec.fixture_id, 'FIXTURE_DENIED');
      const matched = checklist(corpus, spec.question_id);
      controller = createTaskTools(fixture, corpus, spec.arm, deps.clock, spec.run_id);
      const tools = controller.tools;
      function validateView(view: ConsultView): ConsultView {
        recordView(view);
        journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: closed ? 'late_market_observation' : 'market_observation', accounting: clone(accounting), consult_ids: clone(consultIds) } });
        if (view.answer) {
          const expectedSpans = matched.selection.spans;
          requireEval(matched.selection.support === 'supported' && view.answer.citations.length === expectedSpans.length, 'COMPARATOR_MISMATCH');
          expectedSpans.forEach((span, index) => {
            const citation = view.answer!.citations[index]!, page = corpus.pages.find((p) => p.page_id === span.page_id)!;
            requireEval(citation.page_id === span.page_id && citation.content_sha256 === page.sha256 && citation.byte_start === span.byte_start && citation.byte_end === span.byte_end &&
              citation.excerpt === Buffer.from(page.text).subarray(span.byte_start, span.byte_end).toString('utf8'), 'COMPARATOR_MISMATCH');
          });
          requireEval(view.answer.verified === true && view.answer.untrusted_content === true &&
            view.answer.text === renderAnswer(view.answer.citations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }))), 'COMPARATOR_MISMATCH');
        }
        return view;
      }
      async function dispatch(name: string, input: unknown): Promise<unknown> {
        if (taskNames.includes(name as typeof taskNames[number])) {
          const fn = tools[name as Exclude<keyof TaskTools, 'read_checklist'>] as (input: unknown) => Promise<unknown>;
          return fn(input);
        }
        if (name === 'read_checklist') { const q = object(input, ['question_id']); requireEval(q.question_id === spec.question_id, 'QUESTION_DENIED'); return tools.read_checklist({ question_id: id(q.question_id) }); }
        requireEval(spec.arm === 'C', 'TOOL_DENIED');
        if (name === 'consult') {
          const c = parseWire('consult_input', canonicalBytes(input));
          requireEval(c.question_id === spec.question_id && c.max_price.network === 'devnet', 'QUESTION_DENIED');
          requireEval(purchases < replayLimits.purchases, 'PURCHASE_BUDGET');
          // Reservation survives errors/unknown status; never recycle after decline/refund.
          purchases++;
          journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'purchase_reserved', purchases } });
          return validateView(await deps.market.consult(deps.buyer, c, callOptions));
        }
        if (name === 'find') { const row = object(input, ['topic']); return deps.market.find(deps.buyer, { topic: text(row.topic) }); }
        if (name === 'status') { const row = object(input, ['consult_id']); const key = id(row.consult_id); requireEval(consultIds.includes(key), 'CONSULT_DENIED'); return validateView(await deps.market.status(deps.buyer, { consult_id: key }, callOptions)); }
        if (name === 'feedback') {
          const row = object(input, ['consult_id', 'useful', 'reason_code']); const key = id(row.consult_id); requireEval(consultIds.includes(key), 'CONSULT_DENIED');
          requireEval(typeof row.useful === 'boolean' && ['prevented_missed_check', 'unblocked_task', 'already_known', 'incorrect', 'not_actionable', 'other'].includes(String(row.reason_code)));
          return deps.market.feedback(deps.buyer, input as Parameters<typeof deps.market.feedback>[1]);
        }
        if (name === 'report') {
          object(input, ['date_utc']);
          // Global market reports contain cross-arm outcomes: never forward them.
          return { markdown: 'Run-scoped report: consult status only.', receipt_ids: [], gbrain_pending_count: 0 };
        }
        throw new EvalError('TOOL_DENIED');
      }
      async function call(bytes: Uint8Array): Promise<unknown> {
        let admitted = false;
        try {
          guard(); requireEval(!busy, 'CONCURRENT_CALL_DENIED'); requireEval(calls < replayLimits.calls, 'CALL_BUDGET');
          calls++; admitted = true; busy = true;
          journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'admitted', call: calls, request_sha256: bytesHash(bytes) } });
          requireEval(bytes.byteLength <= M03.ingressBodyMax.value * 1024, 'INPUT_TOO_LARGE');
          const request = object(strictJson(bytes), ['tool', 'input']); const name = text(request.tool);
          requireEval(toolsForArm(spec.arm).includes(name), 'TOOL_DENIED');
          const output = await dispatch(name, request.input);
          guard();
          journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'returned', call: calls, tool: name, input: request.input, output,
            observation: controller!.snapshot(), accounting: clone(accounting) } });
          return clone(output);
        } catch (error) {
          rejected++;
          const code = error instanceof EvalError ? error.message : 'CALL_FAILED';
          journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'rejected', call: calls, reason_code: code, accounting: clone(accounting) } });
          if (['WALL_BUDGET', 'CALL_BUDGET', 'PURCHASE_BUDGET', 'COMPARATOR_MISMATCH'].includes(code)) { reason = code; closed = true; abort.abort(); }
          throw new EvalError(code);
        } finally { if (admitted) busy = false; }
      }
      const timeout = deps.clock.sleep(Math.max(0, Date.parse(deadline) - Date.parse(deps.clock.now())), cancelTimer.signal).then(() => {
        reason = 'WALL_BUDGET'; closed = true; controller?.close(); abort.abort(); throw new EvalError('WALL_BUDGET');
      });
      const execution = Promise.resolve().then(() => deps.driver.execute(Object.freeze({ fixture_id: fixture.fixture_id, question_id: spec.question_id,
        prompt: fixture.prompt, tools: Object.freeze(toolsForArm(spec.arm)), call }), abort.signal));
      const cancelled = new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new EvalError('RUN_CANCELLED')), { once: true }));
      usage = metrics(await Promise.race([execution, timeout, cancelled]));
      guard(); requireEval(!busy, 'INFLIGHT_CALL');
      requireEval(usage.effective_model === study.effective_model && usage.config_sha256 === study.config_sha256, 'MODEL_CONFIG_DRIFT');
      requireEval(usage.tokens !== null, 'USAGE_UNKNOWN');
      requireEval(usage.tokens <= replayLimits.tokens, 'TOKEN_BUDGET');
      requireEval(controller.snapshot().finished, 'NO_COMPLETION');
    } catch (error) { if (reason === 'COMPLETED') reason = error instanceof EvalError ? error.message : 'OBSERVATION_FAILED'; }
    finally { closed = true; controller?.close(); abort.abort(); cancelTimer.abort(); running = false; options.signal?.removeEventListener('abort', cancel); }
    const observation = controller?.snapshot() ?? null;
    const result: AttemptResult = { ...unrunResult(spec), status: reason === 'COMPLETED' ? 'completed' : 'failed', reason_code: reason,
      evidence: observation?.actions.map((a) => a.evidence) ?? [], tokens: usage?.tokens ?? null, usage, calls, rejected_calls: rejected,
      elapsed_ms: Math.max(0, Math.floor(deps.clock.monotonicMs() - start)), consult_ids: consultIds, purchases_reserved: purchases, observation, accounting };
    journal.append({ kind: 'result', run_id: spec.run_id, data: result }); return clone(result);
  }
  return { runArm };
}
/** Recover without re-executing or discarding a crashed/partial attempt. */
export function collectAttempts(plan: readonly FrozenRun[], journal: RunnerDependencies['journal']): readonly AttemptResult[] {
  const events = journal.read();
  requireEval(events.every((e) => plan.some((s) => s.run_id === e.run_id)), 'UNPLANNED_ATTEMPT');
  return plan.map((spec) => {
    const own = events.filter((e) => e.run_id === spec.run_id), results = own.filter((e) => e.kind === 'result');
    requireEval(results.length <= 1 && own.filter((e) => e.kind === 'start').length <= 1, 'DUPLICATE_ATTEMPT');
    if (results[0]) {
      const result = clone(results[0].data) as AttemptResult;
      requireEval(result.run_id === spec.run_id && payloadHash(result.spec) === payloadHash(spec), 'RESULT_SPEC_MISMATCH');
      const late = own.filter((e) => e.kind === 'call' && (e.data as Record<string, unknown>).phase === 'late_market_observation').at(-1)?.data as Record<string, unknown> | undefined;
      return late ? { ...result, accounting: clone(late.accounting) as AttemptResult['accounting'], consult_ids: clone(late.consult_ids) as readonly Id[] } : result;
    }
    if (!own.length) return unrunResult(spec);
    const calls = own.filter((e) => e.kind === 'call').map((e) => e.data as Record<string, unknown>);
    const lastObservation = calls.filter((c) => c.observation).at(-1)?.observation as AttemptResult['observation'] | undefined;
    const accounting = calls.filter((c) => c.accounting).at(-1)?.accounting as AttemptResult['accounting'] | undefined;
    const consults = calls.filter((c) => c.consult_ids).at(-1)?.consult_ids as readonly Id[] | undefined;
    return { ...unrunResult(spec, 'INTERRUPTED_UNKNOWN'), status: 'failed', observation: lastObservation ?? null,
      evidence: lastObservation?.actions.map((a) => a.evidence) ?? [], accounting: accounting ?? [], consult_ids: consults ?? [],
      calls: calls.filter((c) => c.phase === 'admitted').length, rejected_calls: calls.filter((c) => c.phase === 'rejected').length,
      purchases_reserved: calls.filter((c) => c.phase === 'purchase_reserved').length };

  });
}

/** Study-level entrypoint: freeze the complete plan before starting; fresh ports
 * per arm, chronological rotating order, no selective retries or replacements.
 * A protected host must provide a fresh isolated driver and run-scoped buyer.
 */
export async function runFrozenStudy(plan: readonly FrozenRun[], journal: RunnerDependencies['journal'], environment: (spec: FrozenRun) => Omit<RunnerDependencies, 'journal'>): Promise<readonly AttemptResult[]> {
  requireEval(plan.length > 0, 'EMPTY_PLAN');
  const existing = journal.read();
  let last = -1;
  for (const event of existing.filter((e) => e.kind === 'start')) {
    const index = plan.findIndex((s) => s.run_id === event.run_id);
    requireEval(index === last + 1, 'ARM_ORDER_CHANGED'); last = index;
  }
  for (const spec of plan) {
    const deps = environment(spec);
    requireEval(payloadHash(planRuns(deps.study, spec.started_at)) === payloadHash(plan), 'FROZEN_PLAN_CHANGED');
    if (journal.read().some((e) => e.run_id === spec.run_id)) continue;
    await createReplayRunner({ ...deps, journal }).runArm(spec);
  }
  return collectAttempts(plan, journal);
}
