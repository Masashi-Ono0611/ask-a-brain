/** Protected task supervisor. No filesystem, shell, URL or rubric capability. */
import { payloadHash } from '../wire/index.ts';
import type { Clock, Id, TaskEvidence, TaskTools } from '../wire/contracts.ts';
import type { ActionRecord, Arm, Corpus, Fixture, ToolController } from './types.ts';
import { checklist, matches } from './fixtures.ts';
import { array, clone, id, object, requireEval } from './validation.ts';
export function createTaskTools(fixture: Fixture, corpus: Corpus, arm: Arm, clock: Clock, namespace: Id): ToolController {
  const initial = clone(fixture); let state = { ...initial.files }; let finished = false, closed = false;
  const actions: ActionRecord[] = [];
  function admit(input: unknown, keys: readonly string[]): Record<string, unknown> {
    requireEval(!closed && !finished, 'TASK_CLOSED'); const row = object(input, keys);
    requireEval(id(row.fixture_id) === initial.fixture_id, 'FIXTURE_DENIED'); return row;
  }
  function evidence(operation: TaskEvidence['operation'], passed: boolean, input: unknown): TaskEvidence {
    const value: TaskEvidence = { fixture_id: initial.fixture_id, evidence_id: id(`${namespace}_e${actions.length + 1}`), operation,
      passed, artifact_sha256: payloadHash(state), recorded_at: clock.now() };
    actions.push({ evidence: clone(value), files: { ...state }, input: clone(input) }); return value;
  }
  const tools: TaskTools = {
    async inspect_fixture(input) {
      admit(input, ['fixture_id']); evidence('inspect_fixture', true, input);
      return { fixture_id: initial.fixture_id, description: initial.prompt + '\nAvailable fixes: ' + initial.fixes.map((f) => `${f.fix_id}: ${f.description}`).join('; '), files: { ...state } };
    },
    async check_leftovers(input) { admit(input, ['fixture_id']); return evidence('check_leftovers', initial.leftovers.every((p) => matches(state, p)), input); },
    async apply_fixture_fix(input) {
      const row = admit(input, ['fixture_id', 'fix_id']); const fix = initial.fixes.find((f) => f.fix_id === id(row.fix_id));
      requireEval(fix, 'FIX_DENIED'); const changed = Object.entries(fix.changes).some(([key, value]) => state[key] !== value);
      state = { ...state, ...fix.changes }; return evidence('apply_fixture_fix', changed, input);
    },
    async verify_fixture(input) { admit(input, ['fixture_id']); return evidence('verify_fixture', initial.checks.every((p) => matches(state, p)), input); },
    async finish_with_evidence(input) {
      const row = admit(input, ['fixture_id', 'evidence_ids']); const ids = array(row.evidence_ids).map(id);
      requireEval(ids.length > 0 && new Set(ids).size === ids.length, 'EVIDENCE_DENIED');
      const selected = ids.map((key) => actions.find((a) => a.evidence.evidence_id === key));
      requireEval(selected.every((a) => a && a.evidence.passed && a.evidence.artifact_sha256 === payloadHash(state)), 'EVIDENCE_DENIED');
      requireEval(['check_leftovers', 'verify_fixture'].every((op) => selected.some((a) => a?.evidence.operation === op)), 'EVIDENCE_DENIED');
      finished = true; return evidence('finish_with_evidence', true, input);
    },
    async read_checklist(input) {
      requireEval(!closed && !finished, 'TASK_CLOSED'); requireEval(arm === 'B', 'TOOL_DENIED');
      const row = object(input, ['question_id']); return clone(checklist(corpus, id(row.question_id)));
    },
  };
  return { tools: Object.freeze(tools), snapshot: () => clone({ fixture_id: initial.fixture_id, initial_sha256: payloadHash(initial.files), files: state, actions, finished }), close: () => { closed = true; } };
}
