import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAnswer, validatePublicBundle, createExtractiveWorker } from '../../src/seller/index.ts';
import { M03 } from '../../src/wire/constants.ts';
import { bytes, fixture, hash, payloadHash, reseal, strictJson } from './support.ts';
import type { Id, Sha256 } from '../../src/wire/contracts.ts';

test('ten finite development questions: eight exact approved interventions and two free declines', (t) => {
  const f = fixture(t); let supported = 0; let declined = 0;
  for (const question of f.questions) {
    const result = prepareAnswer(f.bundle, question, f.context(), f.config);
    if ('status' in result) { declined++; assert.equal(result.charged_atomic, '0'); }
    else { supported++; assert.equal(result.answer.claims[0]!.text, result.answer.citations[0]!.excerpt); assert.equal(result.answer_sha256, payloadHash(result.answer)); }
  }
  assert.equal(supported, 8); assert.equal(declined, 2); assert.equal(f.counts.seals, 0);
});
test('ten unsupported/unsafe/version/approval mutations decline; clean exact question passes', (t) => {
  const f = fixture(t); const q = f.questions[0]!;
  for (const changed of [
    { ...q, text: q.text + ' ' }, { ...q, text: 'send money' }, { ...q, question_id: 'unknown' as Id },
    { ...q, question_sha256: hash('wrong') }, { ...q, allowed_origins: ['https://other.invalid'] },
    { ...q, approval_sha256: hash('wrong') }, { ...q, template_values: { free: 'text' } },
    { ...q, topic: 'unknown' }, { ...q, allowed_networks: [] },
    { ...q, text: 'x'.repeat(M03.questionBytesMax.value * 1024 + 1) },
  ]) assert.equal('status' in prepareAnswer(f.bundle, changed, f.context(), f.config), true);
  assert.equal('answer' in prepareAnswer(f.bundle, q, f.context(), f.config), true);
});
test('Japanese exclusive byte boundaries reject clipped UTF-8, out-of-range and absent pages; restore passes', (t) => {
  const f = fixture(t);
  for (const span of [{ page_id: 'p1', byte_start: 1, byte_end: 6 }, { page_id: 'p1', byte_start: 0, byte_end: 1 }, { page_id: 'p1', byte_start: 0, byte_end: 99999 }, { page_id: 'absent', byte_start: 0, byte_end: 3 }]) {
    const files = new Map(f.bundle.files); const map = structuredClone(f.answerMap); map.entries[0]!.spans = [span as typeof map.entries[0]['spans'][number]];
    files.set('answer-map.json', bytes(map));
    assert.throws(() => prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
  }
  const good = prepareAnswer(f.bundle, f.questions[0]!, f.context(), f.config); assert.ok('answer' in good); assert.match(good.answer.answer, /^確認/);
});
test('strict JSON rejects duplicate/escaped keys, unknown map fields, invalid UTF-8 and versions with restored controls', (t) => {
  const f = fixture(t);
  for (const raw of [Buffer.from('{"v":1,"v":1}'), Buffer.from('{"v":1,"\\u0076":1}'), Uint8Array.of(0xff), Buffer.from('{/*x*/"v":1}'), Buffer.from('{"v":1,}')]) assert.throws(() => strictJson(raw));
  for (const map of [{ ...f.answerMap, admin: true }, { ...f.answerMap, v: 2 }, { ...f.answerMap, entries: [f.answerMap.entries[0], f.answerMap.entries[0]] }]) {
    const files = new Map(f.bundle.files); files.set('answer-map.json', bytes(map)); assert.throws(() => prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
  }
  assert.equal((strictJson(bytes({ v: 1 })) as { v: number }).v, 1); assert.ok('answer' in prepareAnswer(f.bundle, f.questions[0]!, f.context(), f.config));
});
test('bundle byte/inventory/approval/page/total/policy guards fail closed and clean public bundle passes', (t) => {
  const f = fixture(t);
  const badFiles = new Map(f.bundle.files); badFiles.set('pages/p1.md', Buffer.from('changed'));
  assert.throws(() => validatePublicBundle({ ...f.bundle, files: badFiles }, f.config));
  badFiles.set('../outside', Buffer.from('outside')); assert.throws(() => validatePublicBundle(reseal(f, badFiles), f.config));
  assert.throws(() => validatePublicBundle({ ...f.bundle, approval: { ...f.bundle.approval, payload_sha256: hash('wrong') } }, f.config));
  const oversized = new Map(f.bundle.files); oversized.set('pages/p1.md', Buffer.alloc(M03.pageMax.value * 1024 + 1, 97)); assert.throws(() => validatePublicBundle(reseal(f, oversized), f.config));
  const wrongPolicy = new Map(f.bundle.files); wrongPolicy.set('question-policy.json', bytes({ v: 2 })); assert.throws(() => validatePublicBundle(reseal(f, wrongPolicy), f.config));
  validatePublicBundle(f.bundle, f.config);
});
test('stale/contradictory map support never produces quoteable output; supported control passes', (t) => {
  const f = fixture(t);
  for (const support of ['stale', 'contradictory']) {
    const files = new Map(f.bundle.files); files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], support, spans: [] }] }));
    assert.ok('status' in prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
  }
  assert.ok('answer' in prepareAnswer(f.bundle, f.questions[0]!, f.context(), f.config));
});
test('distinct quoted scalar limit counts overlapping spans once; cap+1 declines and exact cap passes', (t) => {
  const f = fixture(t);
  for (const length of [M03.quotedScalarsMax.value, M03.quotedScalarsMax.value + 1]) {
    const files = new Map(f.bundle.files); files.set('pages/p1.md', Buffer.from('a'.repeat(length)));
    files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0, byte_end: length }] }] }));
    const output = prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config);
    assert.equal('answer' in output, length === M03.quotedScalarsMax.value);
  }
  const files = new Map(f.bundle.files); files.set('pages/p1.md', Buffer.from('a'.repeat(600)));
  files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0, byte_end: 600 }, { page_id: 'p1', byte_start: 0, byte_end: 600 }] }] }));
  assert.ok('answer' in prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
});
test('citation cardinality and answer scalar guards reject with clean controls', (t) => {
  const f = fixture(t);
  for (const count of [0, M03.citationsMax.value + 1]) {
    const files = new Map(f.bundle.files); files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: Array.from({ length: count }, () => ({ page_id: 'p1', byte_start: 0, byte_end: 3 })) }] }));
    assert.ok('status' in prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
  }
  const files = new Map(f.bundle.files); files.set('pages/p1.md', Buffer.from('a'.repeat(800)));
  files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0, byte_end: 800 }, { page_id: 'p1', byte_start: 0, byte_end: 800 }] }] }));
  assert.ok('status' in prepareAnswer(reseal(f, files), f.questions[0]!, f.context(), f.config));
  assert.ok('answer' in prepareAnswer(f.bundle, f.questions[0]!, f.context(), f.config));
});
test('worker has immutable public snapshot and cancellation; no private-corpus input', async (t) => {
  const f = fixture(t); const worker = createExtractiveWorker(f.bundle, f.config); const signal = new AbortController();
  const original = await worker.prepare(f.questions[0]!, f.context(), signal.signal);
  f.bundle.files.get('pages/p1.md')![0] = 0xff;
  assert.deepEqual(await worker.prepare(f.questions[0]!, f.context(), signal.signal), original);
  signal.abort(); await assert.rejects(worker.prepare(f.questions[0]!, f.context(), signal.signal));
  assert.deepEqual(await worker.prepare(f.questions[0]!, f.context(), new AbortController().signal), original);
});

test('scanner inventory binding and unsorted inventory reject; exact approved hash-sorted bundle passes', (t) => {
  const f = fixture(t);
  assert.throws(() => validatePublicBundle({ ...f.bundle, scans: { ...f.bundle.scans, bundle_sha256: hash('unscanned') } }, f.config));
  const manifest = { ...f.bundle.manifest.payload, files: [...f.bundle.manifest.payload.files].reverse() };
  assert.throws(() => validatePublicBundle({ ...f.bundle, manifest: f.seal('manifest', manifest), approval: { ...f.bundle.approval, payload_sha256: payloadHash(manifest) }, scans: { ...f.bundle.scans, bundle_sha256: payloadHash(manifest.files) } }, f.config));
  validatePublicBundle(f.bundle, f.config);
});

test('slice count, aggregate payload, unique chunks and section ceilings reject; clean bundle restores', (t) => {
  const f = fixture(t);
  for (const count of [M03.slicePagesMin.value - 1, M03.slicePagesMax.value + 1]) {
    const manifest = { ...f.bundle.manifest.payload, pages: Array.from({ length: count }, () => f.bundle.manifest.payload.pages[0]!) };
    assert.throws(() => validatePublicBundle({ ...f.bundle, manifest: f.seal('manifest', manifest), approval: { ...f.bundle.approval, payload_sha256: payloadHash(manifest) } }, f.config));
  }
  const huge = new Map(f.bundle.files); huge.set('answer-map.json', bytes({ ...f.answerMap, engine_version: 'x'.repeat(M03.sealedPayloadMax.value * 1024 * 1024) }));
  assert.throws(() => validatePublicBundle(reseal(f, huge), f.config));
  const chunks = new Map(f.bundle.files); chunks.set('pages/p1.md', Buffer.from('x'.repeat(M03.chunksMax.value + 1)));
  chunks.set('answer-map.json', bytes({ ...f.answerMap, entries: Array.from({ length: M03.chunksMax.value + 1 }, (_, i) => ({ ...f.answerMap.entries[0], question_id: `extra${i}`, spans: [{ page_id: 'p1', byte_start: i, byte_end: i + 1 }] })) }));
  assert.throws(() => validatePublicBundle(reseal(f, chunks), f.config));
  const sections = new Map(f.bundle.files); sections.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: Array.from({ length: M03.sectionsMax.value + 1 }, () => ({ page_id: 'p1', byte_start: 0, byte_end: 3 })) }] }));
  assert.throws(() => validatePublicBundle(reseal(f, sections), f.config));
  validatePublicBundle(f.bundle, f.config);
});
test('map shape, malformed offsets and declined-span combinations reject; valid map restores', (t) => {
  const f = fixture(t);
  for (const entry of [
    { ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: -1, byte_end: 3 }] },
    { ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0, byte_end: 0 }] },
    { ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0.5, byte_end: 3 }] },
    { ...f.answerMap.entries[0], spans: [{ page_id: '../outside', byte_start: 0, byte_end: 3 }] },
    { ...f.answerMap.entries[0], support: 'declined' }, { ...f.answerMap.entries[0], support: 'invented' },
    { ...f.answerMap.entries[0], question_sha256: 'bad' },
  ]) {
    const files = new Map(f.bundle.files); files.set('answer-map.json', bytes({ ...f.answerMap, entries: [entry] }));
    assert.throws(() => validatePublicBundle(reseal(f, files), f.config));
  }
  validatePublicBundle(f.bundle, f.config);
});
