/** External grader. Never include this module/rubric in a buyer or seller mount. */
import { bytesHash, payloadHash } from '../wire/index.ts';
import type { Grade, RunSpec, TaskEvidence } from '../wire/contracts.ts';
import type { ArtifactSource, AttemptResult, ReplayGrade } from './types.ts';
import { matches, parseCorpus, parseFixture, parseRubric } from './fixtures.ts';
import { createTaskTools } from './tools.ts';
import { replayLimits } from './arms.ts';
import { requireEval } from './validation.ts';
/** The frozen single TaskEvidence contract cannot substantiate a final-state grade. */
export function gradeRun(spec: RunSpec, evidence: TaskEvidence): Grade;
export function gradeRun(attempt: AttemptResult, source: ArtifactSource): Promise<ReplayGrade>;
export function gradeRun(input: RunSpec | AttemptResult, evidence: TaskEvidence | ArtifactSource): Grade | Promise<ReplayGrade> {
  if ('spec' in input && 'fixture' in evidence) return gradeAttempt(input, evidence);
  return { run_id: input.run_id, verdict: 'ungraded', reason_code: 'FULL_OBSERVATION_REQUIRED', evidence_ids: [] };
}
export async function gradeAttempt(attempt: AttemptResult, source: ArtifactSource): Promise<ReplayGrade> {
  const base = { run_id: attempt.run_id, evidence_ids: attempt.evidence.map((e) => e.evidence_id), critical_regression: false };
  try {
    requireEval(attempt.run_id === attempt.spec.run_id);
    const fixtureBytes = source.fixture(attempt.spec.fixture_id), rubricBytes = source.rubric(attempt.spec.fixture_id), corpusBytes = source.corpus();
    requireEval(bytesHash(fixtureBytes) === attempt.spec.fixture_sha256 && bytesHash(rubricBytes) === attempt.spec.rubric_sha256 && bytesHash(corpusBytes) === attempt.spec.corpus_sha256);
    const fixture = parseFixture(fixtureBytes), rubric = parseRubric(rubricBytes, fixture), corpus = parseCorpus(corpusBytes);
    const observation = attempt.observation;
    if (!observation) return { ...base, verdict: 'ungraded', reason_code: attempt.reason_code };
    requireEval(observation.fixture_id === fixture.fixture_id && observation.initial_sha256 === payloadHash(fixture.files));
    requireEval(payloadHash(attempt.evidence) === payloadHash(observation.actions.map((a) => a.evidence)));
    // Re-execute finite actions from a clean snapshot. Hashes alone do not prove an action.
    let at = attempt.spec.started_at;
    const replay = createTaskTools(fixture, corpus, attempt.spec.arm, { now: () => at, monotonicMs: () => 0, sleep: async () => {} }, attempt.run_id);
    for (const action of observation.actions) {
      requireEval(Date.parse(action.evidence.recorded_at) >= Date.parse(at)); at = action.evidence.recorded_at;
      const operation = action.evidence.operation;
      const tool = replay.tools[operation] as (input: unknown) => Promise<unknown>;
      requireEval(typeof tool === 'function'); await tool(action.input);
      requireEval(payloadHash(replay.snapshot().actions.at(-1)) === payloadHash(action));
    }
    requireEval(payloadHash(replay.snapshot()) === payloadHash(observation));
    const critical = rubric.critical_regression.some((p) => matches(observation.files, p));
    if (critical) return { ...base, critical_regression: true, verdict: 'fail', reason_code: 'CRITICAL_REGRESSION' };
    if (attempt.status !== 'completed') return { ...base, verdict: ['USAGE_UNKNOWN', 'OBSERVATION_FAILED', 'INTERRUPTED_UNKNOWN'].includes(attempt.reason_code) ? 'ungraded' : 'fail', reason_code: attempt.reason_code };
    requireEval(attempt.usage !== null && attempt.usage.tokens !== null && attempt.usage.tokens <= replayLimits.tokens && attempt.calls <= replayLimits.calls && attempt.elapsed_ms < replayLimits.wall_ms && attempt.purchases_reserved <= replayLimits.purchases);
    if (!observation.finished || !observation.actions.some((a) => a.evidence.passed && ['check_leftovers', 'verify_fixture', 'apply_fixture_fix'].includes(a.evidence.operation)))
      return { ...base, verdict: 'fail', reason_code: 'NO_ACTION_EVIDENCE' };
    if (!rubric.pass.every((p) => matches(observation.files, p)) || rubric.fail.some((p) => matches(observation.files, p)))
      return { ...base, verdict: 'fail', reason_code: 'FINAL_STATE_FAILED' };
    return { ...base, verdict: 'pass', reason_code: 'PERMITTED_COMPLETION_OBSERVED' };
  } catch { return { ...base, verdict: 'ungraded', reason_code: 'CORRUPT_OR_MISSING_OBSERVATION' }; }
}
