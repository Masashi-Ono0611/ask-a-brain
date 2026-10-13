/** PROTECTED supervisor adapter. Only public/*.json projections and tool returns
 * may reach a buyer. Never mount this directory, tests, or .local in a buyer.
 * T8's static synthetic Fixture cannot represent the approved transition rules.
 * Reuses its wire evidence/observation formats without changing shared contracts. */
import { bytesHash, canonicalBytes, M03, payloadHash, strictJson } from '../../../src/wire/index.ts';
import type { ActionRecord, Clock, FixtureView, Id, Observation, ReplayGrade, TaskEvidence, TaskTools } from '../../../src/wire/contracts.ts';
export type State = Readonly<Record<string, string>>;
export type Predicate = { readonly file_id: string; readonly equals: string } | { readonly file_id: string; readonly not_equals: string };
export interface VisibleFixture {
  readonly v: 1; readonly fixture_id: Id; readonly label: 'historical-derived-toy'; readonly family_id: Id;
  readonly prompt: string; readonly files: State;
  readonly fixes: readonly { readonly fix_id: Id; readonly description: string }[];
}
interface Fix { readonly fix_id: Id; readonly changes: State; readonly requires: readonly string[]; readonly when: readonly Predicate[] }
export interface HeldOut {
  readonly v: 1; readonly fixture_id: Id; readonly canary: string; readonly source_sha256: string;
  readonly initial: State; readonly visible_fields: readonly string[]; readonly leftover_fields: readonly string[];
  readonly inspect_changes: State; readonly fixes: readonly Fix[];
  readonly verify_rules: readonly { readonly when: readonly Predicate[]; readonly changes: State }[];
  readonly checks: readonly Predicate[]; readonly ownership_fixes: readonly string[];
  readonly pass_predicates: readonly Predicate[]; readonly fail_predicates: readonly Predicate[];
  readonly critical_regression: readonly Predicate[];
}
export function requireCondition(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  canonicalBytes(value);
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  const row = value as Record<string, unknown>;
  requireCondition(Object.keys(row).length === keys.length && keys.every((k) => Object.hasOwn(row, k)), 'UNKNOWN_OR_MISSING_FIELD'); return row;
}
function text(value: unknown): string { requireCondition(typeof value === 'string', 'INVALID_TEXT'); return value; }
function id(value: unknown): Id { const s = text(value); requireCondition(/^[A-Za-z0-9_-]+$/.test(s), 'INVALID_ID'); return s as Id; }
function array(value: unknown): readonly unknown[] { requireCondition(Array.isArray(value), 'INVALID_ARRAY'); return value; }
function strings(value: unknown): readonly string[] { return array(value).map(text); }
function state(value: unknown): State {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_STATE');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [id(k), text(v)]));
}
function parse(bytes: Uint8Array): unknown {
  requireCondition(bytes.length <= M03.sealedPayloadMax.value * 1024 * 1024, 'INPUT_TOO_LARGE');
  return strictJson(bytes, { integerNumbersOnly: true });
}
function predicates(value: unknown): readonly Predicate[] {
  return array(value).map((p) => {
    requireCondition(p !== null && typeof p === 'object', 'INVALID_PREDICATE');
    const op = Object.hasOwn(p, 'equals') ? 'equals' : 'not_equals'; const row = object(p, ['file_id', op]);
    return op === 'equals' ? { file_id: id(row.file_id), equals: text(row.equals) } : { file_id: id(row.file_id), not_equals: text(row.not_equals) };
  });
}
export function matches(files: State, p: Predicate): boolean { return 'equals' in p ? files[p.file_id] === p.equals : files[p.file_id] !== p.not_equals; }
export function parseVisible(bytes: Uint8Array): VisibleFixture {
  const f = object(parse(bytes), ['v', 'fixture_id', 'label', 'family_id', 'prompt', 'files', 'fixes']);
  requireCondition(f.v === 1 && f.label === 'historical-derived-toy', 'INVALID_FIXTURE');
  const fixes = array(f.fixes).map((v) => { const x = object(v, ['fix_id', 'description']); return { fix_id: id(x.fix_id), description: text(x.description) }; });
  requireCondition(fixes.length > 0 && new Set(fixes.map((x) => x.fix_id)).size === fixes.length, 'INVALID_FIXES');
  return { v: 1, fixture_id: id(f.fixture_id), label: 'historical-derived-toy', family_id: id(f.family_id), prompt: text(f.prompt), files: state(f.files), fixes };
}
export function parseHeldOut(bytes: Uint8Array, fixture: VisibleFixture): HeldOut {
  const r = object(parse(bytes), ['v', 'fixture_id', 'canary', 'source_sha256', 'initial', 'visible_fields', 'leftover_fields', 'inspect_changes', 'fixes', 'verify_rules', 'checks', 'ownership_fixes', 'pass_predicates', 'fail_predicates', 'critical_regression']);
  requireCondition(r.v === 1 && r.fixture_id === fixture.fixture_id && /^[a-f0-9]{64}$/.test(text(r.source_sha256)), 'RUBRIC_BINDING');
  const initial = state(r.initial), visible_fields = strings(r.visible_fields), leftover_fields = strings(r.leftover_fields), ownership_fixes = strings(r.ownership_fixes);
  const inspect_changes = state(r.inspect_changes);
  const fixes = array(r.fixes).map((value): Fix => { const f = object(value, ['fix_id', 'changes', 'requires', 'when']);
    const requires = strings(f.requires); requireCondition(requires.every((x) => ['inspect_fixture', 'check_leftovers'].includes(x)), 'INVALID_PRECONDITION');
    return { fix_id: id(f.fix_id), changes: state(f.changes), requires, when: predicates(f.when) }; });
  const verify_rules = array(r.verify_rules).map((value) => { const rule = object(value, ['when', 'changes']); return { when: predicates(rule.when), changes: state(rule.changes) }; });
  const checks = predicates(r.checks), pass_predicates = predicates(r.pass_predicates), fail_predicates = predicates(r.fail_predicates), critical_regression = predicates(r.critical_regression);
  requireCondition(pass_predicates.length > 0 && checks.length > 0 && critical_regression.length > 0, 'EMPTY_RUBRIC');
  requireCondition(payloadHash(fixture.files) === payloadHash(Object.fromEntries(visible_fields.map((k) => [k, initial[k]]))), 'SNAPSHOT_MISMATCH');
  requireCondition(payloadHash(fixture.fixes.map((x) => x.fix_id)) === payloadHash(fixes.map((x) => x.fix_id)), 'FIX_LIST_MISMATCH');
  requireCondition(ownership_fixes.every((x) => fixes.some((f) => f.fix_id === x)), 'INVALID_OWNERSHIP_FIX');
  const referenced = [...visible_fields, ...leftover_fields, ...Object.keys(inspect_changes), ...fixes.flatMap((f) => [...Object.keys(f.changes), ...f.when.map((p) => p.file_id)]), ...verify_rules.flatMap((r) => [...Object.keys(r.changes), ...r.when.map((p) => p.file_id)]), ...[...checks, ...pass_predicates, ...fail_predicates, ...critical_regression].map((p) => p.file_id)];
  requireCondition(referenced.every((k) => Object.hasOwn(initial, k)), 'UNKNOWN_STATE_FIELD');
  return { v: 1, fixture_id: fixture.fixture_id, canary: text(r.canary), source_sha256: text(r.source_sha256), initial, visible_fields, leftover_fields, inspect_changes, fixes, verify_rules, checks, ownership_fixes, pass_predicates, fail_predicates, critical_regression };
}
export type ApprovedTools = Omit<TaskTools, 'read_checklist' | 'inspect_fixture' | 'check_leftovers'> & {
  inspect_fixture(input: Parameters<TaskTools['inspect_fixture']>[0]): Promise<FixtureView & { readonly evidence: TaskEvidence }>;
  check_leftovers(input: Parameters<TaskTools['check_leftovers']>[0]): Promise<TaskEvidence & { readonly files: State }>;
};
/** No I/O, arbitrary expressions, hidden-grade output, reset, or rubric tool. */
export function createApprovedTools(visible: VisibleFixture, hidden: HeldOut, clock: Clock, namespace: Id) {
  // Revalidate and detach all trusted caller objects; a later caller mutation cannot alter a run.
  const fixture = parseVisible(canonicalBytes(visible)), model = parseHeldOut(canonicalBytes(hidden), fixture);
  id(namespace); let files = { ...model.initial }, finished = false, closed = false;
  const actions: ActionRecord[] = [];
  const latest = (op: TaskEvidence['operation']) => actions.findLast((a) => a.evidence.operation === op);
  const project = (keys: readonly string[]): State => Object.fromEntries(keys.map((k) => [k, files[k]!]));
  function change(changes: State): void {
    const latched = model.critical_regression.filter((p) => matches(files, p)).map((p) => [p.file_id, files[p.file_id]!] as const);
    files = { ...files, ...changes };
    for (const [key, value] of latched) files[key] = value;
  }
  function admit(input: unknown, keys = ['fixture_id']): Record<string, unknown> {
    requireCondition(!closed && !finished, 'TASK_CLOSED'); const row = object(input, keys);
    requireCondition(row.fixture_id === fixture.fixture_id, 'FIXTURE_DENIED'); return row;
  }
  function record(operation: TaskEvidence['operation'], passed: boolean, input: unknown): TaskEvidence {
    const evidence: TaskEvidence = { fixture_id: fixture.fixture_id, evidence_id: `${namespace}_e${actions.length + 1}` as Id, operation, passed, artifact_sha256: payloadHash(files), recorded_at: clock.now() };
    actions.push(structuredClone({ evidence, input, files })); return structuredClone(evidence);
  }
  const tools: ApprovedTools = {
    async inspect_fixture(input) { admit(input); change(model.inspect_changes); const evidence = record('inspect_fixture', true, input);
      return { fixture_id: fixture.fixture_id, description: fixture.prompt + '\nAvailable fixes: ' + fixture.fixes.map((f) => `${f.fix_id}: ${f.description}`).join('; '), files: project(model.visible_fields), evidence }; },
    async check_leftovers(input) { admit(input); return { ...record('check_leftovers', true, input), files: project(model.leftover_fields) }; },
    async apply_fixture_fix(input) {
      const row = admit(input, ['fixture_id', 'fix_id']), fix = model.fixes.find((f) => f.fix_id === row.fix_id); requireCondition(fix, 'FIX_DENIED');
      requireCondition(fix.requires.every((op) => { const a = latest(op as TaskEvidence['operation']); return a && a.evidence.artifact_sha256 === payloadHash(files); }), 'PRECONDITION_REQUIRED');
      requireCondition(fix.when.every((p) => matches(files, p)), 'ALLOWANCE_EXHAUSTED');
      const before = payloadHash(files); change(fix.changes); return record('apply_fixture_fix', before !== payloadHash(files), input);
    },
    async verify_fixture(input) {
      admit(input); // At most one transition per observation: queued -> running -> terminal.
      const rule = model.verify_rules.find((r) => r.when.every((p) => matches(files, p))); if (rule) change(rule.changes);
      return record('verify_fixture', model.checks.every((p) => matches(files, p)), input);
    },
    async finish_with_evidence(input) {
      const row = admit(input, ['fixture_id', 'evidence_ids']); const ids = array(row.evidence_ids).map(id);
      requireCondition(new Set(ids).size === ids.length && ids.length > 0, 'EVIDENCE_DENIED');
      const selected = ids.map((key) => actions.find((a) => a.evidence.evidence_id === key));
      requireCondition(selected.every((a) => a?.evidence.passed), 'EVIDENCE_DENIED');
      const inspect = latest('inspect_fixture'), repair = latest('apply_fixture_fix'), verify = latest('verify_fixture');
      requireCondition(inspect && repair && verify && [inspect, repair, verify].every((a) => selected.includes(a)), 'TERMINAL_EVIDENCE_REQUIRED');
      requireCondition(verify.evidence.passed && verify.evidence.artifact_sha256 === payloadHash(files) && actions.indexOf(verify) > actions.indexOf(repair), 'STALE_VERIFICATION');
      const repairs = actions.filter((a) => a.evidence.operation === 'apply_fixture_fix');
      for (const a of repairs) {
        const earlier = actions.slice(0, actions.indexOf(a));
        requireCondition(earlier.some((x) => x.evidence.operation === 'inspect_fixture'), 'INSPECTION_REQUIRED');
        const fixId = (a.input as { fix_id: string }).fix_id;
        if (model.ownership_fixes.includes(fixId)) {
          const owner = earlier.findLast((x) => x.evidence.operation === 'check_leftovers');
          requireCondition(owner && selected.includes(owner) && owner.evidence.artifact_sha256 === earlier.at(-1)?.evidence.artifact_sha256, 'OWNERSHIP_EVIDENCE_REQUIRED');
        }
      }
      finished = true; return record('finish_with_evidence', true, input);
    },
  };
  return { tools: Object.freeze(tools), async call(bytes: Uint8Array): Promise<unknown> {
    requireCondition(bytes.length <= M03.ingressBodyMax.value * 1024, 'INPUT_TOO_LARGE');
    const row = object(strictJson(bytes), ['tool', 'input']);
    requireCondition(typeof row.tool === 'string' && Object.hasOwn(tools, row.tool), 'TOOL_DENIED');
    return (tools[row.tool as keyof ApprovedTools] as (input: unknown) => Promise<unknown>)(row.input);
  }, snapshot: (): Observation => structuredClone({ fixture_id: fixture.fixture_id, initial_sha256: payloadHash(model.initial), files, actions, finished }), close: () => { closed = true; } };
}
export interface ApprovedAttempt {
  readonly run_id: Id; readonly fixture_sha256: string; readonly rubric_sha256: string;
  readonly observation: Observation | null; readonly status: 'completed' | 'failed' | 'unrun';
  readonly calls: number; readonly tokens: number | null; readonly elapsed_ms: number;
}
/** Pure predicate layer: fault-injected states test otherwise unreachable critical
 * predicates, but are NOT accepted as valid recorded action traces. */
export function gradeFinalState(model: HeldOut, files: State) {
  const critical_regression = model.critical_regression.some((p) => matches(files, p));
  return { passed: !critical_regression && model.pass_predicates.every((p) => matches(files, p)) && !model.fail_predicates.some((p) => matches(files, p)), critical_regression };
}
/** Grade only an authenticated supervisor observation, bound to frozen bytes.
 * As in T8, hashes/re-execution detect corruption, not a malicious host signer. */
export async function gradeApprovedAttempt(attempt: ApprovedAttempt, fixtureBytes: Uint8Array, rubricBytes: Uint8Array): Promise<ReplayGrade> {
  const base = { run_id: attempt.run_id, evidence_ids: [] as Id[], critical_regression: false };
  try {
    requireCondition(attempt.fixture_sha256 === bytesHash(fixtureBytes) && attempt.rubric_sha256 === bytesHash(rubricBytes), 'FROZEN_ARTIFACT_CHANGED');
    const fixture = parseVisible(fixtureBytes), model = parseHeldOut(rubricBytes, fixture), observation = attempt.observation;
    if (!observation) return { ...base, verdict: 'ungraded', reason_code: 'OBSERVATION_MISSING' };
    let at = observation.actions[0]?.evidence.recorded_at;
    const replay = createApprovedTools(fixture, model, { now: () => { requireCondition(at, 'TIME_MISSING'); return at; }, monotonicMs: () => 0, sleep: async () => {} }, attempt.run_id);
    for (const a of observation.actions) {
      requireCondition(Number.isFinite(Date.parse(a.evidence.recorded_at)) && Date.parse(a.evidence.recorded_at) >= Date.parse(at!), 'INVALID_TIME'); at = a.evidence.recorded_at;
      requireCondition(Object.hasOwn(replay.tools, a.evidence.operation), 'INVALID_OPERATION');
      const invoke = replay.tools[a.evidence.operation] as (input: unknown) => Promise<unknown>;
      await invoke(a.input); requireCondition(payloadHash(replay.snapshot().actions.at(-1)) === payloadHash(a), 'CORRUPT_ACTION');
    }
    requireCondition(payloadHash(replay.snapshot()) === payloadHash(observation), 'CORRUPT_OBSERVATION');
    base.evidence_ids = observation.actions.map((a) => a.evidence.evidence_id);
    const final = gradeFinalState(model, observation.files);
    if (final.critical_regression) return { ...base, verdict: 'fail', critical_regression: true, reason_code: 'CRITICAL_REGRESSION' };
    if (attempt.tokens === null) return { ...base, verdict: 'ungraded', reason_code: 'USAGE_UNKNOWN' };
    requireCondition([attempt.calls, attempt.tokens, attempt.elapsed_ms].every((x) => Number.isSafeInteger(x) && x >= 0) && attempt.calls >= observation.actions.length, 'INVALID_METRICS');
    if (attempt.calls > M03.replayCallsMax.value || attempt.tokens > M03.replayBuyerTokensMax.value || attempt.elapsed_ms >= M03.replayWallTimeMax.value * 60_000)
      return { ...base, verdict: 'fail', reason_code: 'BUDGET_EXHAUSTED' };
    if (attempt.status !== 'completed' || !observation.finished || !final.passed) return { ...base, verdict: 'fail', reason_code: 'REQUIRED_COMPLETION_MISSING' };
    return { ...base, verdict: 'pass', reason_code: 'PERMITTED_COMPLETION_OBSERVED' };
  } catch { return { ...base, verdict: 'ungraded', reason_code: 'CORRUPT_OR_MISSING_OBSERVATION' }; }
}
