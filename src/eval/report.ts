import type { Grade, RenderReplayReport } from '../wire/contracts.ts';
import type { Arm, AttemptResult, FrozenRun, ReplayGrade } from './types.ts';
import { requireEval } from './validation.ts';
export function summarizeReplay(plan: readonly FrozenRun[], attempts: readonly AttemptResult[], grades: readonly ReplayGrade[]) {
  requireEval(new Set(plan.map((s) => s.run_id)).size === plan.length, 'DUPLICATE_PLAN');
  requireEval(attempts.length === plan.length && grades.length === plan.length, 'MISSING_DENOMINATOR');
  requireEval(new Set(attempts.map((r) => r.run_id)).size === plan.length && new Set(grades.map((g) => g.run_id)).size === plan.length, 'DUPLICATE_RESULT');
  requireEval(plan.every((s) => attempts.some((r) => r.run_id === s.run_id) && grades.some((g) => g.run_id === s.run_id)), 'MISSING_DENOMINATOR');
  const primary = plan.filter((s) => s.primary);
  const count = (arm: Arm) => {
    const specs = primary.filter((s) => s.arm === arm);
    const rows = specs.map((s) => attempts.find((r) => r.run_id === s.run_id)!);
    const gs = specs.map((s) => grades.find((g) => g.run_id === s.run_id)!);
    return { planned: rows.length, attempted: rows.filter((r) => r.status !== 'unrun').length, unrun: rows.filter((r) => r.status === 'unrun').length,
      pass: gs.filter((g) => g.verdict === 'pass').length, fail: gs.filter((g) => g.verdict === 'fail').length,
      unknown: gs.filter((g) => g.verdict === 'ungraded').length, critical_regressions: gs.filter((g) => g.critical_regression).length };
  };
  const families = [...new Set(primary.map((s) => s.fixture_id))];
  const verdict = (fixture: string, arm: Arm): Grade['verdict'] => {
    const spec = primary.find((s) => s.fixture_id === fixture && s.arm === arm);
    return grades.find((g) => g.run_id === spec?.run_id)?.verdict ?? 'ungraded';
  };
  function paired(left: Arm) {
    const cells = { both_pass: 0, both_fail: 0, improvement: 0, regression: 0, unknown: 0, denominator: families.length };
    for (const fixture of families) {
      const a = verdict(fixture, left), c = verdict(fixture, 'C');
      if (a === 'ungraded' || c === 'ungraded') cells.unknown++;
      else if (a === 'pass' && c === 'pass') cells.both_pass++;
      else if (a === 'fail' && c === 'fail') cells.both_fail++;
      else if (a === 'fail') cells.improvement++;
      else cells.regression++;
    }
    return cells;
  }
  return { historical_n: 0, live_paid_n: 0, synthetic_cases: families.length,
    incomplete_triples: families.filter((f) => ['A', 'B', 'C'].some((arm) => {
      const spec = primary.find((s) => s.fixture_id === f && s.arm === arm);
      const attempt = attempts.find((r) => r.run_id === spec?.run_id);
      return !spec || !attempt || attempt.status === 'unrun' || grades.find((g) => g.run_id === spec.run_id)?.verdict === 'ungraded';
    })).length,
    arms: { A: count('A'), B: count('B'), C: count('C') }, ac: paired('A'), bc: paired('B'),
    repeated_attempts: attempts.filter((a) => !a.spec.primary && a.status !== 'unrun').length,
    repeated_unrun: attempts.filter((a) => !a.spec.primary && a.status === 'unrun').length,
    attempts: attempts.map((a) => ({ run_id: a.run_id, arm: a.spec.arm, primary: a.spec.primary, status: a.status, reason: a.reason_code,
      wall_ms: a.reason_code === 'INTERRUPTED_UNKNOWN' ? null : a.elapsed_ms, tokens: a.usage?.tokens ?? null, model_ms: a.usage?.model_ms ?? null, chain_ms: a.usage?.chain_ms ?? null,
      human_active_ms: a.usage?.human_active_ms ?? null, model_expense_usd: a.usage?.model_expense_usd ?? null,
      rpc_expense_usd: a.usage?.rpc_expense_usd ?? null, hosting_expense_usd: a.usage?.hosting_expense_usd ?? null,
      accounting: a.accounting, calls: a.calls, rejected_calls: a.rejected_calls, purchases_reserved: a.purchases_reserved })) };
}
export function renderDetailedReplayReport(plan: readonly FrozenRun[], attempts: readonly AttemptResult[], grades: readonly ReplayGrade[]): string {
  const summary = summarizeReplay(plan, attempts, grades);
  return ['Synthetic infrastructure rehearsal only; historical n = 0; live-paid n = 0; no Gate 1 credit.',
    'Wall times use a virtual test clock, not measured model/host performance. Founder active time is not measured.',
    'Scripted driver, simulated consultation, no wallet signature or live model. Token enforcement and OS isolation remain UNVERIFIED.',
    'A complete triple requires three observed grades; an observed task failure remains in the denominator. Historical evaluation is unrun.',
    'Null usage, time and expense fields mean not measured/unknown. Legacy RunResult.tokens=0 does not establish known zero usage.',
    'Paired improvement cells are descriptive; assistance causality, prevention, demand and currency savings are not inferred.',
    'Accounting entries are successive observations, not additive purchases. Refunds and delivery failures remain visible.',
    '```json', JSON.stringify(summary, null, 2), '```'].join('\n');
}
/** Legacy projection only; cannot reconstruct missing/unrun denominators. */
export const renderReplayReport: RenderReplayReport = (runs, grades) => [
  'Incomplete legacy projection: use renderDetailedReplayReport with the frozen plan for reconciled denominators.',
  ...runs.map((r) => `${r.run_id}: ${r.status}; ${grades.find((g) => g.run_id === r.run_id)?.verdict ?? 'ungraded'}`),
].join('\n');
