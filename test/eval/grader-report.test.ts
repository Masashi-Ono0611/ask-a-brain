import test from 'node:test';
import assert from 'node:assert/strict';
import { payloadHash } from '../../src/wire/index.ts';
import type { TaskEvidence } from '../../src/wire/contracts.ts';
import { armOrder, collectAttempts, createReplayRunner, gradeAttempt, gradeRun, planRuns, summarizeReplay } from '../../src/eval/index.ts';
import { call, measured, rehearse, source, consultInput } from '../../scripts/eval/synthetic.ts';
import { driver, setup } from './helpers.ts';
test('A/A deterministic grades and final-state hashes match from fresh snapshots', async () => {
  const a1 = setup(), a2 = setup(); const r1 = await a1.runner.runArm(a1.spec), r2 = await a2.runner.runArm(a2.spec);
  assert.deepEqual(await gradeAttempt(r1, source), await gradeAttempt(r2, source));
  assert.equal(payloadHash(r1.observation), payloadHash(r2.observation)); assert.equal(r1.observation!.files.work, 'done');
});
test('critical final-state regression fails despite valid terminal evidence; safe repair passes', async () => {
  const c = setup();
  const d = driver(async (s) => {
    const input = { fixture_id: s.fixture_id };
    await call(s, 'apply_fixture_fix', { ...input, fix_id: 'discard' });
    const l = await call(s, 'check_leftovers', input) as TaskEvidence, v = await call(s, 'verify_fixture', input) as TaskEvidence;
    await call(s, 'finish_with_evidence', { ...input, evidence_ids: [l.evidence_id, v.evidence_id] }); return measured(c.deps.study);
  });
  const bad = await createReplayRunner({ ...c.deps, driver: d }).runArm(c.spec);
  assert.equal(bad.status, 'completed'); const grade = await gradeAttempt(bad, source);
  assert.equal(grade.verdict, 'fail'); assert.equal(grade.critical_regression, true);
  const clean = setup(); assert.equal((await gradeAttempt(await clean.runner.runArm(clean.spec), source)).verdict, 'pass');
});
test('forged final state, action evidence, usage or rubric cannot manufacture PASS; restored evidence passes', async () => {
  const c = setup(); const good = await c.runner.runArm(c.spec);
  for (const mutate of [
    (r: typeof good) => { (r.observation!.files as Record<string, string>).work = 'invented'; },
    (r: typeof good) => { (r.observation!.actions[0]!.evidence as { passed: boolean }).passed = false; },
    (r: typeof good) => { (r as { usage: null }).usage = null; },
    (r: typeof good) => { (r as { calls: number }).calls = 999999; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.equal((await gradeAttempt(bad, source)).verdict, 'ungraded'); assert.equal((await gradeAttempt(good, source)).verdict, 'pass'); }
  const badSource = { ...source, rubric: () => Buffer.from('{}') };
  assert.equal((await gradeAttempt(good, badSource)).verdict, 'ungraded');
  assert.equal(gradeRun(c.spec, good.evidence.at(-1)!).verdict, 'ungraded');
  assert.equal((await gradeAttempt(good, source)).verdict, 'pass');
});
test('matched synthetic triples rotate order, expose no rubric, and retain null delta/zero historical n', async () => {
  const result = await rehearse(), summary = summarizeReplay(result.plan, result.attempts, result.grades);
  assert.deepEqual(result.plan.map((r) => r.arm), ['A', 'B', 'C', 'B', 'C', 'A', 'C', 'A', 'B']);
  assert.deepEqual(armOrder(0), ['A', 'B', 'C']);
  assert.equal(summary.ac.both_pass, 3); assert.equal(summary.bc.both_pass, 3);
  assert.equal(summary.ac.improvement, 0); assert.equal(summary.historical_n, 0); assert.equal(summary.live_paid_n, 0);
  assert.equal(summary.incomplete_triples, 0); assert.match(result.report, /UNVERIFIED/);
  assert.equal(result.attempts.every((r) => r.usage?.human_active_ms === null), true);
  for (const c of ['s1', 's2', 's3']) {
    const rows = result.attempts.filter((r) => r.spec.fixture_id === c);
    assert.equal(new Set(rows.map((r) => r.spec.fixture_sha256)).size, 1);
    assert.equal(new Set(rows.map((r) => r.observation!.initial_sha256)).size, 1);
    assert.equal(new Set(rows.map((r) => r.spec.config_sha256)).size, 1);
  }
});
test('unknowns, failures, unrun and repeats retain denominators; omission/duplication rejected', async () => {
  const c = setup(); await c.runner.runArm(c.spec);
  const rows = collectAttempts(c.plan, c.journal), grades = await Promise.all(rows.map((r) => gradeAttempt(r, source)));
  const summary = summarizeReplay(c.plan, rows, grades);
  assert.equal(summary.incomplete_triples, 3); assert.equal(summary.arms.A.attempted, 1); assert.equal(summary.arms.B.unrun, 3);
  assert.equal(summary.bc.unknown, 3); assert.equal(summary.bc.denominator, 3);
  assert.throws(() => summarizeReplay(c.plan, rows.slice(1), grades), /MISSING_DENOMINATOR/);
  assert.throws(() => summarizeReplay(c.plan, rows.map(() => rows[0]!), grades), /DUPLICATE_RESULT/);
  assert.equal(summarizeReplay(c.plan, rows, grades).arms.A.pass, 1);
  const repeated = planRuns({ ...c.deps.study, repeat_rounds: 1 }, c.clock.now()); assert.equal(repeated.length, c.plan.length * 2);
  assert.equal(repeated.filter((s) => s.primary).length, c.plan.length);
});
test('all five paired contingency cells reconcile including regression and unknown', async () => {
  // Public synthetic aggregation vectors only; these are not run/outcome claims.
  const c = setup(); const basic = c.plan.slice(0, 3);
  const plan = Array.from({ length: 5 }, (_, i) => basic.map((s) => ({ ...s, run_id: `${s.run_id}_${i}` as typeof s.run_id, fixture_id: `pair${i}` as typeof s.fixture_id }))).flat();
  const rows = collectAttempts(plan, c.journal);
  const left = ['pass', 'fail', 'fail', 'pass', 'ungraded'] as const, right = ['pass', 'fail', 'pass', 'fail', 'pass'] as const;
  const grades = plan.map((s, index) => ({ run_id: s.run_id, verdict: s.arm === 'C' ? right[Math.floor(index / 3)]! : left[Math.floor(index / 3)]!, reason_code: 'AGGREGATION_VECTOR', evidence_ids: [], critical_regression: false }));
  const summary = summarizeReplay(plan, rows, grades);
  assert.deepEqual(summary.ac, { both_pass: 1, both_fail: 1, improvement: 1, regression: 1, unknown: 1, denominator: 5 });
  assert.deepEqual(summary.ac, summary.bc);
});
test('refund and failed delivery expenses survive failed run instead of deleting accounting', async () => {
  const c = setup('C'), original = c.deps.market;
  const r = await createReplayRunner({ ...c.deps, market: { ...original, async consult(ctx, input) {
    const view = await original.consult(ctx, input); return { ...view, answer: null, refund_state: 'partial_refund', delivery_state: 'delivery_failed' };
  } }, driver: driver(async (s) => { await call(s, 'consult', consultInput(s.question_id)); return measured(c.deps.study); }) }).runArm(c.spec);
  assert.equal(r.reason_code, 'NO_COMPLETION'); assert.equal(r.accounting[0]!.refund_state, 'partial_refund');
  assert.equal(r.accounting[0]!.delivery_state, 'delivery_failed'); assert.notEqual(r.accounting[0]!.principal_atomic, null);
  const clean = setup('C'); assert.equal((await clean.runner.runArm(clean.spec)).status, 'completed');
});

test('frozen study rejects omitted/reordered arms and selective repeats; complete plan works', async () => {
  const { runFrozenStudy } = await import('../../src/eval/index.ts');
  const c = setup();
  await assert.rejects(runFrozenStudy(c.plan.slice(1), c.journal, () => c.deps), /FROZEN_PLAN_CHANGED/);
  assert.throws(() => planRuns(c.deps.study, c.clock.now(), 1), /FROZEN_REPEAT_CHANGED/);
  const rows = await runFrozenStudy(c.plan, c.journal, () => ({ ...c.deps, driver: (setup()).deps.driver, market: (setup()).deps.market }));
  assert.equal(rows.length, c.plan.length); assert.equal(rows.every((r) => r.status === 'completed'), true);
  const other = setup(); other.journal.append({ kind: 'start', run_id: other.plan[1]!.run_id, data: {} });
  await assert.rejects(runFrozenStudy(other.plan, other.journal, () => other.deps), /ARM_ORDER_CHANGED/);
});

test('an observed task failure completes its arm; missing observation makes an incomplete triple', async () => {
  const result = await rehearse(); const attempts = [...structuredClone(result.attempts)];
  const first = attempts[0]!;
  attempts[0] = { ...first, status: 'failed', reason_code: 'CALL_BUDGET' };
  const grades = await Promise.all(attempts.map((a) => gradeAttempt(a, source)));
  assert.equal(grades[0]!.verdict, 'fail');
  const knownFailure = summarizeReplay(result.plan, attempts, grades);
  assert.equal(knownFailure.incomplete_triples, 0); assert.equal(knownFailure.arms.A.fail, 1);
  attempts[0] = { ...attempts[0]!, observation: null, reason_code: 'INTERRUPTED_UNKNOWN' };
  const unknown = await Promise.all(attempts.map((a) => gradeAttempt(a, source)));
  assert.equal(summarizeReplay(result.plan, attempts, unknown).incomplete_triples, 1);
  assert.equal(summarizeReplay(result.plan, result.attempts, result.grades).incomplete_triples, 0);
});
