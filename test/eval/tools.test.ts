import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesHash, canonicalBytes, payloadHash } from '../../src/wire/index.ts';
import { FixedClock } from '../../src/common/index.ts';
import type { Id, TaskTools } from '../../src/wire/contracts.ts';
import { checklist, createTaskTools, parseCorpus, parseFixture, parseStudy } from '../../src/eval/index.ts';
import { loadStudy, source } from '../../scripts/eval/synthetic.ts';
const key = 's1' as Id, q = 'q1' as Id;
const input = { fixture_id: key };
function create(arm: 'A' | 'B' | 'C' = 'A', namespace = 'test') {
  return createTaskTools(parseFixture(source.fixture(key)), parseCorpus(source.corpus()), arm, new FixedClock('2026-10-09T00:00:00.000Z'), namespace as Id);
}
async function finish(tools: TaskTools) {
  const left = await tools.check_leftovers(input), verify = await tools.verify_fixture(input);
  return tools.finish_with_evidence({ ...input, evidence_ids: [left.evidence_id, verify.evidence_id] });
}
test('strict fixture parser rejects duplicate/unknown keys, invalid UTF8, bad IDs and versions; exact clean bytes pass', () => {
  const clean = source.fixture(key); const fixture = parseFixture(clean);
  const bad = [Buffer.from('{"v":1,"v":1}'), Uint8Array.from([0xff]), canonicalBytes({ ...fixture, command: 'unavailable' }),
    canonicalBytes({ ...fixture, v: 2 }), canonicalBytes({ ...fixture, fixture_id: '../outside' }), canonicalBytes({ ...fixture, files: { '../outside': 'x' } })];
  for (const bytes of bad) { assert.throws(() => parseFixture(bytes)); assert.deepEqual(parseFixture(clean), fixture); }
});
test('finite IDs, exact fields and no shell/path/rubric access; repair still succeeds after every rejection', async () => {
  const control = create(); const tools = control.tools;
  for (const bad of [{ fixture_id: '../rubric' }, { fixture_id: key, path: 'rubric' }, { fixture_id: 'other_arm' }, { fixture_id: key, command: 'echo' }]) {
    await assert.rejects(tools.inspect_fixture(bad as typeof input));
    assert.equal((await tools.inspect_fixture(input)).fixture_id, key);
  }
  await assert.rejects(tools.apply_fixture_fix({ ...input, fix_id: 'arbitrary' as Id }), /FIX_DENIED/);
  assert.equal((await tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id })).passed, true);
  assert.equal((await finish(tools)).passed, true);
  const output = JSON.stringify(control.snapshot()); assert.equal(output.includes('RUBRIC_ONLY'), false);
});
test('all arms retain failing and successful task checks; snapshots reset independently', async () => {
  for (const arm of ['A', 'B', 'C'] as const) {
    const c = create(arm); assert.equal((await c.tools.check_leftovers(input)).passed, false);
    assert.equal((await c.tools.verify_fixture(input)).passed, false);
    await c.tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id });
    assert.equal((await finish(c.tools)).passed, true);
    assert.equal(create(arm).snapshot().files.work, 'pending');
  }
});
test('stale, guessed, cross-run and failed evidence cannot finish; fresh exact evidence can', async () => {
  const c = create(), old = await c.tools.verify_fixture(input);
  await assert.rejects(c.tools.finish_with_evidence({ ...input, evidence_ids: [old.evidence_id] }), /EVIDENCE_DENIED/);
  await c.tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id });
  const beforeChange = await c.tools.verify_fixture(input);
  await c.tools.apply_fixture_fix({ ...input, fix_id: 'discard' as Id });
  await assert.rejects(c.tools.finish_with_evidence({ ...input, evidence_ids: [beforeChange.evidence_id] }), /EVIDENCE_DENIED/);
  const fresh = create('A', 'fresh'); await fresh.tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id });
  for (const ids of [['guessed'], [beforeChange.evidence_id], []]) await assert.rejects(fresh.tools.finish_with_evidence({ ...input, evidence_ids: ids as Id[] }), /EVIDENCE_DENIED/);
  assert.equal((await finish(fresh.tools)).passed, true);
  await assert.rejects(fresh.tools.verify_fixture(input), /TASK_CLOSED/);
  const restored = create(); await restored.tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id }); assert.equal((await finish(restored.tools)).passed, true);
});
test('mutating returned files, evidence or snapshots cannot alter protected state', async () => {
  const c = create(); const view = await c.tools.inspect_fixture(input); (view.files as Record<string, string>).work = 'done';
  const ev = await c.tools.verify_fixture(input); (ev as { passed: boolean }).passed = true;
  (c.snapshot().files as Record<string, string>).archive = 'lost';
  assert.equal((await c.tools.verify_fixture(input)).passed, false); assert.equal(c.snapshot().files.archive, 'intact');
  await c.tools.apply_fixture_fix({ ...input, fix_id: 'repair' as Id }); assert.equal((await finish(c.tools)).passed, true);
});
test('checklist is B-only, finite-question, exact corpus/map; rejected access leaves clean B available', async () => {
  for (const arm of ['A', 'C'] as const) await assert.rejects(create(arm).tools.read_checklist({ question_id: q }), /TOOL_DENIED/);
  const b = create('B'); await assert.rejects(b.tools.read_checklist({ question_id: 'hidden_solution' as Id }), /QUESTION_DENIED/);
  const corpus = parseCorpus(source.corpus()); assert.deepEqual(await b.tools.read_checklist({ question_id: q }), checklist(corpus, q));
  assert.equal(payloadHash((await b.tools.read_checklist({ question_id: q })).pages), payloadHash(corpus.pages));
});
test('corpus rejects changed page hashes and invalid UTF8 span boundaries, clean map works', () => {
  const corpus = parseCorpus(source.corpus());
  assert.throws(() => parseCorpus(canonicalBytes({ ...corpus, pages: corpus.pages.map((p) => ({ ...p, text: p.text + 'tampered' })) })), /CORPUS_MISMATCH/);
  const bad = structuredClone(corpus); (bad.map.entries[0]!.spans[0] as { byte_end: number }).byte_end = 99999;
  assert.throws(() => parseCorpus(canonicalBytes(bad)), /CORPUS_MISMATCH/);
  assert.deepEqual(parseCorpus(source.corpus()), corpus);
});
test('primary live/model-auth mode is refused, synthetic config remains usable', () => {
  const s = loadStudy(); assert.throws(() => parseStudy(canonicalBytes({ ...s, mode: 'live' })), /LIVE_REPLAY_BLOCKED/);
  assert.deepEqual(parseStudy(canonicalBytes(s)), s);
});

test('split Japanese UTF8 spans and nested unknown map fields fail; aligned exact spans pass', () => {
  const corpus = parseCorpus(source.corpus()); const content = '日本語';
  const utf8 = { ...corpus, pages: [{ page_id: 'jp' as Id, text: content, sha256: bytesHash(Buffer.from(content)) }], map: { ...corpus.map,
    entries: [{ ...corpus.map.entries[0]!, spans: [{ page_id: 'jp' as Id, byte_start: 0, byte_end: Buffer.byteLength(content) }] }] } };
  assert.doesNotThrow(() => parseCorpus(canonicalBytes(utf8)));
  const bad = structuredClone(utf8); bad.map.entries[0]!.spans[0]!.byte_start = 1;
  assert.throws(() => parseCorpus(canonicalBytes(bad)));
  assert.throws(() => parseCorpus(canonicalBytes({ ...utf8, map: { ...utf8.map, private_rubric: 'not allowed' } })));
  assert.doesNotThrow(() => parseCorpus(canonicalBytes(utf8)));
});
