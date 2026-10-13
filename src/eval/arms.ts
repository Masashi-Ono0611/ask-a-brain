import { M03, payloadHash } from '../wire/index.ts';
import type { IsoTime } from '../wire/contracts.ts';
import type { Arm, FrozenRun, Study } from './types.ts';
import { array, hash, id, immutable, integer, object, parse, requireEval, text } from './validation.ts';
export const taskNames = Object.freeze(['inspect_fixture', 'check_leftovers', 'apply_fixture_fix', 'verify_fixture', 'finish_with_evidence'] as const);
export const marketNames = Object.freeze(['find', 'consult', 'status', 'feedback', 'report'] as const);
export function toolsForArm(arm: Arm): readonly string[] { return [...taskNames, ...(arm === 'B' ? ['read_checklist'] : arm === 'C' ? marketNames : [])]; }
export function armOrder(index: number): readonly Arm[] { const arms: Arm[] = ['A', 'B', 'C']; return [...arms.slice(index % arms.length), ...arms.slice(0, index % arms.length)]; }
export function parseStudy(bytes: Uint8Array): Study {
  const s = object(parse(bytes), ['v', 'study_id', 'mode', 'repeat_rounds', 'cases', 'corpus_sha256', 'model', 'effective_model', 'config_sha256', 'question_policy_sha256', 'code_revision', 'token_enforcement']);
  requireEval(s.v === 1 && s.mode === 'synthetic', 'LIVE_REPLAY_BLOCKED');
  requireEval(s.token_enforcement === 'unverified' || s.token_enforcement === 'synthetic_meter');
  const cases = array(s.cases).map((input) => { const c = object(input, ['fixture_id', 'fixture_sha256', 'rubric_sha256', 'question_id']);
    return { fixture_id: id(c.fixture_id), fixture_sha256: hash(c.fixture_sha256), rubric_sha256: hash(c.rubric_sha256), question_id: id(c.question_id) }; });
  requireEval(cases.length > 0 && new Set(cases.map((c) => c.fixture_id)).size === cases.length);
  return immutable({ v: 1, study_id: id(s.study_id), mode: 'synthetic', repeat_rounds: integer(s.repeat_rounds), cases, corpus_sha256: hash(s.corpus_sha256), model: text(s.model),
    effective_model: text(s.effective_model), config_sha256: hash(s.config_sha256), question_policy_sha256: hash(s.question_policy_sha256),
    code_revision: text(s.code_revision), token_enforcement: s.token_enforcement });
}
/** Plan whole rounds before execution; a repeat never replaces a primary run. */
export function planRuns(study: Study, startedAt: IsoTime, repeats = study.repeat_rounds): readonly FrozenRun[] {
  requireEval(Number.isSafeInteger(repeats) && repeats >= 0 && repeats === study.repeat_rounds, 'FROZEN_REPEAT_CHANGED');
  const runs: FrozenRun[] = [];
  for (let round = 0; round <= repeats; round++) study.cases.forEach((c, index) => {
    for (const arm of armOrder(index)) runs.push({ run_id: id(`run_${payloadHash({ study: study.study_id, fixture: c.fixture_id, round, arm })}`), fixture_id: c.fixture_id,
      arm, question_id: c.question_id, model: study.model, config_sha256: study.config_sha256, fixture_sha256: c.fixture_sha256,
      started_at: startedAt, study_sha256: payloadHash(study), rubric_sha256: c.rubric_sha256, corpus_sha256: study.corpus_sha256,
      round, case_index: index, primary: round === 0 });
  });
  return immutable(runs);
}
export const replayLimits = Object.freeze({ wall_ms: M03.replayWallTimeMax.value * 60 * 1000, calls: M03.replayCallsMax.value,
  tokens: M03.replayBuyerTokensMax.value, purchases: M03.replayPaidArmPurchasesMax.value });
