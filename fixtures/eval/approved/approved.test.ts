import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { bytesHash, canonicalBytes, M03, strictJson } from '../../../src/wire/index.ts';
import type { Id, IsoTime, Observation } from '../../../src/wire/contracts.ts';
import { armOrder, toolsForArm } from '../../../src/eval/index.ts';
import { createApprovedTools, gradeApprovedAttempt, gradeFinalState, matches, object, parseHeldOut, parseVisible } from './adapter.ts';
import type { ApprovedAttempt, HeldOut, VisibleFixture } from './adapter.ts';
import { approvedKnowledge, approvedPages, lessonHashes } from './knowledge.ts';
import { approvedOrder, protocol } from './protocol.ts';
const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const manifest = strictJson(read('fixtures/eval/approved/manifest.json')) as unknown as { cases: {fixture_id: string; source_sha256: string; fixture_sha256: string; rubric_sha256: string; paths_sha256: string; state_predicates: number; critical_predicates: number}[] };
const clock = { now: () => '2026-10-09T00:00:00.000Z' as IsoTime, monotonicMs: () => 0, sleep: async () => {} };
type Controller = ReturnType<typeof createApprovedTools>;
interface Paths { correct_fix: Id; tempting_wrong_fix: Id; critical_fix: Id | null; verify_count: number; critical_path_status: string }
function load(key: string) {
  const fixtureBytes = read(`fixtures/eval/approved/public/${key}.json`), rubricBytes = read(`.local/eval/rubrics/${key}.json`);
  const fixture = parseVisible(fixtureBytes), model = parseHeldOut(rubricBytes, fixture);
  const pathsBytes = read(`.local/eval/rubrics/${key}.paths.json`);
  const paths = object(strictJson(pathsBytes), ['v', 'fixture_id', 'correct_fix', 'tempting_wrong_fix', 'critical_fix', 'verify_count', 'critical_path_status']) as unknown as Paths;
  return { fixtureBytes, rubricBytes, fixture, model, paths, pathsBytes };
}
function controller(fixture: VisibleFixture, model: HeldOut, run = 'test'): Controller { return createApprovedTools(fixture, model, clock, run as Id); }
async function prepare(c: Controller, fixture: VisibleFixture) {
  const input = { fixture_id: fixture.fixture_id };
  await c.tools.inspect_fixture(input); await c.tools.check_leftovers(input);
}
async function repair(c: Controller, fixture: VisibleFixture, paths: Paths) {
  const input = { fixture_id: fixture.fixture_id };
  await prepare(c, fixture);
  await c.tools.apply_fixture_fix({ ...input, fix_id: paths.correct_fix });
  for (let n = 0; n < paths.verify_count; n++) await c.tools.verify_fixture(input);
}
async function finish(c: Controller, fixture: VisibleFixture) {
  const actions = c.snapshot().actions;
  // Earlier failed observations are retained in the trace, never submitted as success evidence.
  const evidence_ids = actions.filter((a) => a.evidence.passed).map((a) => a.evidence.evidence_id);
  return c.tools.finish_with_evidence({ fixture_id: fixture.fixture_id, evidence_ids });
}
function attempt(observation: Observation | null, f: ReturnType<typeof load>, overrides: Partial<ApprovedAttempt> = {}): ApprovedAttempt {
  return { run_id: 'test' as Id, fixture_sha256: bytesHash(f.fixtureBytes), rubric_sha256: bytesHash(f.rubricBytes), observation,
    status: observation?.finished ? 'completed' : 'failed', calls: observation?.actions.length ?? 0, tokens: 0, elapsed_ms: 0, ...overrides };
}
const grade = (c: Controller, f: ReturnType<typeof load>, overrides: Partial<ApprovedAttempt> = {}) => gradeApprovedAttempt(attempt(c.snapshot(), f, overrides), f.fixtureBytes, f.rubricBytes);

for (const key of approvedOrder) {
  test(`${key}: frozen bytes, prompt, family and rubric predicates match the approved spec`, () => {
    const f = load(key), frozen = manifest.cases.find((c) => c.fixture_id === key)!;
    assert.equal(bytesHash(f.fixtureBytes), frozen.fixture_sha256); assert.equal(bytesHash(f.rubricBytes), frozen.rubric_sha256); assert.equal(bytesHash(f.pathsBytes), frozen.paths_sha256);
    const original = read(`.local/approved-src/incidents/${key}.md`); assert.equal(bytesHash(original), frozen.source_sha256);
    assert.equal(f.model.source_sha256, frozen.source_sha256);
    const source = original.toString('utf8');
    assert.equal(f.fixture.prompt, source.split('## Shared task prompt\n')[1]!.split('\n\n##')[0]!.trim());
    assert.ok(source.includes(`Family ID: ${f.fixture.family_id}`));
    assert.deepEqual(f.fixture.fixes.map((x) => x.fix_id), [...source.matchAll(/^- (k\d+[a-z]):/gm)].map((m) => m[1]));
    assert.equal(f.model.pass_predicates.length, frozen.state_predicates); assert.equal(f.model.critical_regression.length, frozen.critical_predicates);
  });
  test(`${key}: correct path PASS; tempting wrong path FAIL; pristine A/A replay identical`, async () => {
    const f = load(key), c = controller(f.fixture, f.model);
    await repair(c, f.fixture, f.paths); await finish(c, f.fixture);
    assert.equal((await grade(c, f)).verdict, 'pass');
    const again = controller(f.fixture, f.model); await repair(again, f.fixture, f.paths); await finish(again, f.fixture);
    assert.deepEqual(again.snapshot(), c.snapshot()); assert.deepEqual(await grade(again, f), await grade(c, f));
    const wrong = controller(f.fixture, f.model); await prepare(wrong, f.fixture);
    await wrong.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.tempting_wrong_fix });
    for (let n = 0; n < f.paths.verify_count; n++) await wrong.tools.verify_fixture({ fixture_id: f.fixture.fixture_id });
    await assert.rejects(finish(wrong, f.fixture)); assert.equal((await grade(wrong, f)).verdict, 'fail');
  });
  test(`${key}: every critical predicate fires on bad final state and clean counterpart passes`, async () => {
    const f = load(key), c = controller(f.fixture, f.model); await repair(c, f.fixture, f.paths); await finish(c, f.fixture);
    const good = c.snapshot().files; assert.deepEqual(gradeFinalState(f.model, good), { passed: true, critical_regression: false });
    for (const p of f.model.critical_regression) {
      assert.ok('equals' in p);
      const bad = { ...good, [p.file_id]: p.equals };
      assert.deepEqual(gradeFinalState(f.model, bad), { passed: false, critical_regression: true });
      // A fabricated final state is UNKNOWN in the trace grader, never accepted as runtime harm evidence.
      const forged = { ...c.snapshot(), files: bad };
      assert.equal((await gradeApprovedAttempt(attempt(forged, f), f.fixtureBytes, f.rubricBytes)).verdict, 'ungraded');
      assert.equal((await grade(c, f)).verdict, 'pass');
    }
  });
  test(`${key}: critical approved path latches through later repair, or explicitly records unreachable coverage`, async (t) => {
    const f = load(key);
    if (f.paths.critical_fix === null) {
      assert.equal(f.paths.critical_path_status, 'UNVERIFIED_NO_APPROVED_TRANSITION');
      // Prove the limitation against every enumerated transition instead of inventing a harmful fix.
      assert.ok(f.model.fixes.every((fix) => f.model.critical_regression.every((p) => !matches({ ...f.model.initial, ...fix.changes }, p))));
      t.skip('UNVERIFIED: no approved fix triggers critical regression; predicate-level controls only'); return;
    }
    const c = controller(f.fixture, f.model); await prepare(c, f.fixture);
    await c.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.critical_fix });
    assert.deepEqual([ (await grade(c, f)).verdict, (await grade(c, f)).critical_regression ], ['fail', true]);
    await repair(c, f.fixture, f.paths);
    assert.equal((await grade(c, f)).critical_regression, true);
    const clean = controller(f.fixture, f.model); await repair(clean, f.fixture, f.paths); await finish(clean, f.fixture); assert.equal((await grade(clean, f)).verdict, 'pass');
  });
  test(`${key}: unknown fix, foreign fixture, unknown fields, duplicate JSON and invalid UTF8 leave state intact`, async () => {
    const f = load(key), c = controller(f.fixture, f.model), before = c.snapshot();
    const input = { fixture_id: f.fixture.fixture_id };
    const bad = [
      canonicalBytes({ tool: 'apply_fixture_fix', input: { ...input, fix_id: '../private' } }),
      canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'OTHER' } }),
      canonicalBytes({ tool: 'inspect_fixture', input: { ...input, path: '.local/eval/rubrics' } }),
      canonicalBytes({ tool: 'read_rubric', input }),
      Buffer.from(`{"tool":"inspect_fixture","tool":"verify_fixture","input":{"fixture_id":"${key}"}}`),
      Buffer.from([0xff]),
    ];
    for (const bytes of bad) { await assert.rejects(c.call(bytes)); assert.deepEqual(c.snapshot(), before); }
    await c.call(canonicalBytes({ tool: 'inspect_fixture', input })); assert.equal(c.snapshot().actions.length, 1);
  });
  test(`${key}: all required terminal receipts, inspection ordering and fresh verification are enforced`, async () => {
    const f = load(key), c = controller(f.fixture, f.model); await repair(c, f.fixture, f.paths);
    const good = c.snapshot();
    for (const op of ['inspect_fixture', 'apply_fixture_fix', 'verify_fixture', ...(f.model.ownership_fixes.length ? ['check_leftovers'] : [])]) {
      await assert.rejects(c.tools.finish_with_evidence({ fixture_id: f.fixture.fixture_id, evidence_ids: good.actions.filter((a) => a.evidence.passed && a.evidence.operation !== op).map((a) => a.evidence.evidence_id) }));
      assert.deepEqual(c.snapshot(), good);
    }
    await assert.rejects(c.tools.finish_with_evidence({ fixture_id: f.fixture.fixture_id, evidence_ids: ['another_run_e1' as Id] }));
    await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
    const noInspect = controller(f.fixture, f.model);
    try { await noInspect.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.correct_fix }); } catch { /* Explicit precondition may refuse even before grading. */ }
    for (let n = 0; n < f.paths.verify_count; n++) await noInspect.tools.verify_fixture({ fixture_id: f.fixture.fixture_id });
    await assert.rejects(finish(noInspect, f.fixture)); assert.notEqual((await grade(noInspect, f)).verdict, 'pass');
    const stale = controller(f.fixture, f.model); await repair(stale, f.fixture, f.paths);
    const old = stale.snapshot().actions.filter((a) => a.evidence.passed).map((a) => a.evidence.evidence_id);
    await stale.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.tempting_wrong_fix });
    await assert.rejects(stale.tools.finish_with_evidence({ fixture_id: f.fixture.fixture_id, evidence_ids: old }));
  });
  test(`${key}: recommendations/no-op do not complete; missing/corrupt observations UNKNOWN; frozen-byte tamper rejected`, async () => {
    const f = load(key), c = controller(f.fixture, f.model); await prepare(c, f.fixture);
    assert.equal((await grade(c, f, { status: 'completed' })).verdict, 'fail');
    await repair(c, f.fixture, f.paths); await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
    assert.equal((await gradeApprovedAttempt(attempt(null, f), f.fixtureBytes, f.rubricBytes)).verdict, 'ungraded');
    const observation = structuredClone(c.snapshot()); const action = observation.actions[0]!;
    const forged = { ...observation, actions: [{ ...action, evidence: { ...action.evidence, artifact_sha256: bytesHash(Buffer.from('forged')) } }, ...observation.actions.slice(1)] };
    assert.equal((await gradeApprovedAttempt(attempt(forged, f), f.fixtureBytes, f.rubricBytes)).verdict, 'ungraded');
    assert.equal((await gradeApprovedAttempt(attempt(c.snapshot(), f), Buffer.concat([f.fixtureBytes, Buffer.from(' ')]), f.rubricBytes)).verdict, 'ungraded');
    assert.equal((await grade(c, f)).verdict, 'pass');
  });
  test(`${key}: budget positive controls and UNKNOWN usage preserve truthful outcomes`, async () => {
    const f = load(key), c = controller(f.fixture, f.model); await repair(c, f.fixture, f.paths); await finish(c, f.fixture);
    assert.equal((await grade(c, f, { calls: M03.replayCallsMax.value, tokens: M03.replayBuyerTokensMax.value, elapsed_ms: M03.replayWallTimeMax.value * 60_000 - 1 })).verdict, 'pass');
    for (const over of [{ calls: M03.replayCallsMax.value + 1 }, { tokens: M03.replayBuyerTokensMax.value + 1 }, { elapsed_ms: M03.replayWallTimeMax.value * 60_000 }]) assert.equal((await grade(c, f, over)).reason_code, 'BUDGET_EXHAUSTED');
    assert.equal((await grade(c, f, { tokens: null })).reason_code, 'USAGE_UNKNOWN');
    assert.equal((await grade(c, f)).verdict, 'pass');
  });
  test(`${key}: strict fixture/rubric parsing rejects mutated schemas and restores exact inputs`, () => {
    const f = load(key);
    assert.throws(() => parseVisible(canonicalBytes({ ...f.fixture, rubric: 'leak' })));
    assert.throws(() => parseVisible(Buffer.from(f.fixtureBytes.toString().replace('"v": 1', '"v": 1, "v": 1'))));
    assert.throws(() => parseHeldOut(canonicalBytes({ ...f.model, unexpected: true }), f.fixture));
    assert.throws(() => parseHeldOut(canonicalBytes({ ...f.model, initial: { ...f.model.initial, [Object.keys(f.fixture.files)[0]!]: 'changed' } }), f.fixture));
    assert.deepEqual(parseHeldOut(f.rubricBytes, parseVisible(f.fixtureBytes)), f.model);
  });
  test(`${key}: buyer projections and every lesson omit hidden canaries, rubric predicates and scripted option labels`, async () => {
    const f = load(key), c = controller(f.fixture, f.model);
    const view = await c.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id });
    const left = await c.tools.check_leftovers({ fixture_id: f.fixture.fixture_id });
    const publicBytes = JSON.stringify([view, left]);
    for (const marker of [f.model.canary, 'pass_predicates', 'critical_regression', 'correct_fix', 'tempting_wrong_fix']) assert.ok(!publicBytes.includes(marker));
    for (const lesson of Object.keys(lessonHashes)) {
      const bytes = read(`fixtures/eval/approved/lessons/${lesson}.md`).toString('utf8');
      for (const fix of f.fixture.fixes) assert.ok(!bytes.includes(fix.fix_id));
      assert.ok(!bytes.includes(f.model.canary));
    }
    assert.deepEqual(Object.keys(c.tools).sort(), ['inspect_fixture', 'check_leftovers', 'apply_fixture_fix', 'verify_fixture', 'finish_with_evidence'].sort());
    // This verifies byte-level separation only. Semantic resolution overlap is reported, not wished away.
  });
}

test('protocol freezes six primary cases, rotations, budgets and all-attempt denominators', () => {
  assert.deepEqual(strictJson(read('config/eval/protocol.json')), protocol());
  assert.deepEqual(manifest.cases.map((c) => c.fixture_id), [...approvedOrder]);
  protocol().arms.forEach((arm) => assert.deepEqual(arm.tools, toolsForArm(arm.arm)));
  protocol().rotation.forEach((r, i) => assert.deepEqual(r.order, armOrder(i)));
  assert.equal(protocol().denominators.planned_attempts, approvedOrder.length * protocol().arms.length);
});
test('lesson approval bytes pass; one-byte mutation and extra page denied; clean restored', () => {
  const lessons = new Map(Object.keys(lessonHashes).map((key) => [key, read(`fixtures/eval/approved/lessons/${key}.md`)]));
  assert.equal(approvedPages(lessons).length, lessons.size);
  const mutated = new Map(lessons); mutated.set('L1', Buffer.concat([mutated.get('L1')!, Buffer.from(' ')]));
  assert.throws(() => approvedPages(mutated), /LESSON_APPROVAL_MISMATCH/);
  assert.throws(() => approvedPages(new Map([...lessons, ['extra', Buffer.from('hidden')]])), /CORPUS_SET_MISMATCH/);
  assert.equal(approvedPages(lessons).length, lessons.size);
});
test('B/C exact approved map required; missing or unapproved map fails closed', (t) => {
  const lessons = new Map(Object.keys(lessonHashes).map((key) => [key, read(`fixtures/eval/approved/lessons/${key}.md`)]));
  assert.throws(() => approvedKnowledge(lessons, null, null), /APPROVED_QUESTIONS_AND_MAP_REQUIRED/);
  assert.throws(() => approvedKnowledge(lessons, Buffer.from('{}'), Buffer.from('{}')), /QUESTION_MAP_APPROVAL_MISMATCH/);
  if (!existsSync(new URL('.local/approved-src/questions/questions.json', root)) || !existsSync(new URL('.local/approved-src/questions/answer-map.json', root))) {
    t.skip('UNVERIFIED: approved questions/map missing; exact B/C parity positive control not run'); return;
  }
  const knowledge = approvedKnowledge(lessons, read('.local/approved-src/questions/questions.json'), read('.local/approved-src/questions/answer-map.json'));
  const map = strictJson(read('.local/approved-src/questions/answer-map.json')) as unknown as { entries: { question_id: Id }[] };
  for (const entry of map.entries) {
    const free = knowledge.read_checklist(entry.question_id), paid = knowledge.expected_paid_support(entry.question_id);
    assert.deepEqual(free.selection, paid.selection);
    paid.excerpts.forEach((excerpt, i) => { const span = free.selection.spans[i]!; const page = free.pages.find((p) => p.page_id === span.page_id)!; assert.equal(excerpt, Buffer.from(page.text).subarray(span.byte_start, span.byte_end).toString('utf8')); });
  }
});
test('public buyer directory contains exactly the frozen six visible snapshots', () => {
  assert.deepEqual(readdirSync(new URL('fixtures/eval/approved/public/', root)).sort(), approvedOrder.map((id) => `${id}.json`).sort());
});

for (const key of approvedOrder) {
  test(`${key}: executable pass/critical predicates exactly transcribe the frozen source`, () => {
    const f = load(key), source = read(`.local/approved-src/incidents/${key}.md`).toString('utf8');
    function expected(line: string, delimiter: string) {
      return line.split(delimiter).map((term) => {
        const [file_id, value] = term.trim().split('=');
        assert.ok(file_id && value);
        return { file_id, equals: f.model.initial[value] ?? value };
      });
    }
    const pass = source.split('PASS requires all of: ')[1]!.split(';')[0]!;
    const critical = source.split('CRITICAL REGRESSION: ')[1]!.split('.')[0]!;
    // Text order is immaterial to conjunction/disjunction; frozen values are not.
    const sorted = (x: unknown[]) => x.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(sorted([...f.model.pass_predicates]), sorted(expected(pass, ' AND ')));
    assert.deepEqual(sorted([...f.model.critical_regression]), sorted(expected(critical, ' OR ')));
    assert.deepEqual(sorted([...f.model.fail_predicates]), sorted(f.model.pass_predicates.map((p) => { assert.ok('equals' in p); return { file_id: p.file_id, not_equals: p.equals }; })));
  });
  test(`${key}: finish closes the run, returned views cannot mutate it, and a fresh run restores initial state`, async () => {
    const f = load(key), c = controller(f.fixture, f.model), initial = c.snapshot();
    const view = await c.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id });
    const original = c.snapshot(); (view.files as Record<string, string>)[Object.keys(view.files)[0]!] = 'external-write'; assert.deepEqual(c.snapshot(), original);
    await repair(c, f.fixture, f.paths); await finish(c, f.fixture); const terminal = c.snapshot();
    await assert.rejects(c.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id }), /TASK_CLOSED/); assert.deepEqual(c.snapshot(), terminal);
    const fresh = controller(f.fixture, f.model); assert.deepEqual(fresh.snapshot(), initial);
    await fresh.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id }); fresh.close();
    await assert.rejects(fresh.tools.check_leftovers({ fixture_id: f.fixture.fixture_id }), /TASK_CLOSED/);
  });
}
test('I1 explicit inspection/ownership preconditions reject without mutation and clean counterpart completes', async () => {
  const f = load('I1'), c = controller(f.fixture, f.model), input = { fixture_id: f.fixture.fixture_id, fix_id: f.paths.correct_fix };
  const before = c.snapshot(); await assert.rejects(c.tools.apply_fixture_fix(input), /PRECONDITION_REQUIRED/); assert.deepEqual(c.snapshot(), before);
  await c.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id }); const inspected = c.snapshot();
  await assert.rejects(c.tools.apply_fixture_fix(input), /PRECONDITION_REQUIRED/); assert.deepEqual(c.snapshot(), inspected);
  await repair(c, f.fixture, f.paths); await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
});
test('I4 one fresh trigger cannot be spent twice; ordered verification retains the old attempt', async () => {
  const f = load('I4'), c = controller(f.fixture, f.model); await prepare(c, f.fixture);
  await c.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.correct_fix }); const once = c.snapshot();
  await assert.rejects(c.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.correct_fix }), /ALLOWANCE_EXHAUSTED/); assert.deepEqual(c.snapshot(), once);
  assert.equal((await c.tools.verify_fixture({ fixture_id: f.fixture.fixture_id })).passed, false);
  assert.equal(c.snapshot().files.new_status, 'running');
  assert.equal((await c.tools.verify_fixture({ fixture_id: f.fixture.fixture_id })).passed, true);
  assert.equal(c.snapshot().files.old_attempt_preserved, 'true'); await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
});
test('all 30 lesson overlap assessments exist; substantive contamination stays flagged', () => {
  const report = strictJson(read('.local/eval/rubrics/overlap.json')) as unknown as { pairs: {fixture_id: string; lesson_id: string; assessment: string}[]; resolution_overlap_flag: boolean };
  assert.equal(report.pairs.length, approvedOrder.length * Object.keys(lessonHashes).length);
  assert.equal(new Set(report.pairs.map((p) => `${p.fixture_id}/${p.lesson_id}`)).size, report.pairs.length);
  for (const id of approvedOrder) for (const lesson of Object.keys(lessonHashes)) assert.ok(report.pairs.some((p) => p.fixture_id === id && p.lesson_id === lesson));
  assert.equal(report.resolution_overlap_flag, true);
  assert.equal(report.pairs.filter((p) => p.assessment === 'substantial_resolution_overlap').length, 5);
});
test('I5 stale verification and missing ownership receipts fire exact guards, then fresh controlled repair passes', async () => {
  const f = load('I5'), c = controller(f.fixture, f.model); await repair(c, f.fixture, f.paths);
  await c.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.tempting_wrong_fix });
  await assert.rejects(finish(c, f.fixture), /STALE_VERIFICATION/);
  await repair(c, f.fixture, f.paths); await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
  const noOwner = controller(f.fixture, f.model); await noOwner.tools.inspect_fixture({ fixture_id: f.fixture.fixture_id });
  await noOwner.tools.apply_fixture_fix({ fixture_id: f.fixture.fixture_id, fix_id: f.paths.correct_fix });
  await noOwner.tools.verify_fixture({ fixture_id: f.fixture.fixture_id });
  await assert.rejects(finish(noOwner, f.fixture), /OWNERSHIP_EVIDENCE_REQUIRED/);
  const clean = controller(f.fixture, f.model); await repair(clean, f.fixture, f.paths); await finish(clean, f.fixture); assert.equal((await grade(clean, f)).verdict, 'pass');
});
test('oversized request denied before parsing; ordinary request remains usable', async () => {
  const f = load('I1'), c = controller(f.fixture, f.model), initial = c.snapshot();
  await assert.rejects(c.call(Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 32)), /INPUT_TOO_LARGE/); assert.deepEqual(c.snapshot(), initial);
  await c.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: f.fixture.fixture_id } })); assert.equal(c.snapshot().actions.length, 1);
});
test('task observations track reclaimed scratch, repaired resolver traces and the actual extra-card count', async () => {
  const one = load('I1'), rig = controller(one.fixture, one.model); await repair(rig, one.fixture, one.paths);
  const leftovers = await rig.tools.check_leftovers({ fixture_id: one.fixture.fixture_id });
  assert.equal(leftovers.files.scratch_object, 'none'); assert.equal(leftovers.files.scratch_owner, 'none');
  const two = load('I2'), resolver = controller(two.fixture, two.model); await repair(resolver, two.fixture, two.paths);
  const view = await resolver.tools.inspect_fixture({ fixture_id: two.fixture.fixture_id });
  assert.equal(view.files.changed_trace, 'local:reed:sprout'); assert.equal(view.files.unchanged_trace, 'local:reed:sprout');
  const six = load('I6'), delivery = controller(six.fixture, six.model); await prepare(delivery, six.fixture);
  // Choose the remaining neutral wrong option from the frozen option list, not a secret test-only fix.
  const other = six.fixture.fixes.find((f) => f.fix_id !== six.paths.correct_fix && f.fix_id !== six.paths.tempting_wrong_fix)!;
  await delivery.tools.apply_fixture_fix({ fixture_id: six.fixture.fixture_id, fix_id: other.fix_id });
  assert.equal((await delivery.tools.inspect_fixture({ fixture_id: six.fixture.fixture_id })).files.unrelated_card_count, '1');
  const clean = controller(six.fixture, six.model); await repair(clean, six.fixture, six.paths); await finish(clean, six.fixture);
  assert.equal((await grade(clean, six)).verdict, 'pass');
});
test('I2/I4/I6 do not gain an unapproved ownership-check prerequisite', async () => {
  for (const key of ['I2', 'I4', 'I6']) {
    const f = load(key), c = controller(f.fixture, f.model), input = { fixture_id: f.fixture.fixture_id };
    await c.tools.inspect_fixture(input); await c.tools.apply_fixture_fix({ ...input, fix_id: f.paths.correct_fix });
    for (let n = 0; n < f.paths.verify_count; n++) await c.tools.verify_fixture(input);
    await finish(c, f.fixture); assert.equal((await grade(c, f)).verdict, 'pass');
  }
});
