import test from 'node:test';
import assert from 'node:assert/strict';
import { M03, canonicalBytes, payloadHash, renderAnswer, strictJson } from '../../src/wire/index.ts';
import type { AnswerMap, BundleInput } from '../../src/wire/contracts.ts';
import { buildManifest, createReviewPacket, guardText, inertText, validateBundle, validateInput } from '../../src/publish/index.ts';
import { approvalFor, at, fixture, h, worksheet } from './helpers.ts';

for (const [name, bad] of Object.entries({ html: '<script>alert(1)</script>', inline: '[label](target)', wiki: '[[hidden]]', reference: '[label]: target', image: '![image](target)', url: 'https://hidden.example', entity: '&#91;hidden&#93;', escape: '\\[hidden]', transclusion: '{{hidden}}', frontmatter: '---\nsecret: x\n---', control: '\u001b[31m', bidi: '\u202eprivate', business: 'customer_data', japanese: '社外秘', piiEmail: 'person@example.test', piiPhone: '+81 90 1234 5678', provenance: 'derived_from: abc', path: '/Users/person/brain', graph: 'parent_count: 4', canary: 'AAB_PRIVATE_CANARY' })) {
  test(`content guard rejects ${name}; restored clean Japanese page passes`, () => {
    assert.throws(() => guardText(Buffer.from(bad), true)); assert.doesNotThrow(() => guardText(Buffer.from('A synthetic technical lesson. 日本語。\n'), true));
  });
}
for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xc0, 0xaf), Buffer.from('\ufeffBOM')]) test(`strict UTF-8 rejects ${Buffer.from(bytes).toString('hex')}; valid multibyte passes`, () => {
  assert.throws(() => guardText(bytes, true)); assert.doesNotThrow(() => guardText(Buffer.from('日本語'), true));
});
function rebuild(input: BundleInput, files: Map<string, Uint8Array>): BundleInput {
  const { v: _v, pages: _p, files: _f, policy_sha256: _h, ...metadata } = input.manifest; return buildManifest(metadata, files);
}
for (const [name, mutate] of Object.entries<(input: BundleInput) => BundleInput>({
  'changed byte': (i) => ({ ...i, files: new Map(i.files).set('pages/p1.md', Buffer.from('changed')) }),
  'extra file': (i) => ({ ...i, files: new Map(i.files).set('.hidden', Buffer.from('extra')) }),
  'missing page': (i) => { const f = new Map(i.files); f.delete('pages/p1.md'); return { ...i, files: f }; },
  'manifest unknown field': (i) => ({ ...i, manifest: { ...i.manifest, invented: true } as BundleInput['manifest'] }),
  'page count': (i) => ({ ...i, manifest: { ...i.manifest, pages: i.manifest.pages.slice(1) } }),
  'unsorted inventory': (i) => ({ ...i, manifest: { ...i.manifest, files: [...i.manifest.files].reverse() } }),
  'traversal': (i) => ({ ...i, manifest: { ...i.manifest, files: i.manifest.files.map((f, n) => n === 0 ? { ...f, path: '../answer-map.json' } : f) } }),
  'page cap': (i) => rebuild(i, new Map(i.files).set('pages/p1.md', Buffer.alloc(M03.pageMax.value * 1024 + 1, 65))),
  'policy noncanonical': (i) => rebuild(i, new Map(i.files).set('question-policy.json', Buffer.concat([Buffer.from(' '), i.files.get('question-policy.json')!]))),
  'duplicate keys': (i) => rebuild(i, new Map(i.files).set('answer-map.json', Buffer.from('{"v":1,"v":1,"engine_version":"e","entries":[]}'))),
  'escaped equivalent keys': (i) => rebuild(i, new Map(i.files).set('answer-map.json', Buffer.from('{"v":1,"\\u0076":1,"engine_version":"e","entries":[]}'))),
  'map unknown field': (i) => rebuild(i, new Map(i.files).set('answer-map.json', canonicalBytes({ ...strictJson(i.files.get('answer-map.json')!) as object, injected: 1 }))),
  'invalid map UTF8': (i) => rebuild(i, new Map(i.files).set('answer-map.json', Uint8Array.of(0xff))),
})) test(`bundle rejects ${name}; unchanged inventory passes`, () => {
  const good = fixture(); assert.throws(() => validateInput(mutate(good))); assert.deepEqual(validateInput(good).manifest, good.manifest);
});
for (const [name, change] of Object.entries<(map: AnswerMap) => unknown>({
  unknownQuestion: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, question_id: 'not-approved' }) }),
  unknownPage: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, spans: [{ page_id: 'missing', byte_start: 0, byte_end: 1 }] }) }),
  unindexedPage: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, support: 'declined', spans: [] }) }),
  splitUtf8: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, spans: [{ ...e.spans[0], byte_start: e.spans[0]!.byte_end - 3 }] }) }),
  pastEnd: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, spans: [{ ...e.spans[0], byte_end: 9999 }] }) }),
  noCitation: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, spans: [] }) }),
  duplicateEntry: (m) => ({ ...m, entries: [...m.entries, m.entries[0]] }),
  citationCap: (m) => ({ ...m, entries: m.entries.map((e, n) => n ? e : { ...e, spans: Array.from({ length: M03.citationsMax.value + 1 }, () => e.spans[0]) }) }),
})) test(`answer map rejects ${name}; exact full-page spans pass`, () => {
  const good = fixture(); const map = strictJson(good.files.get('answer-map.json')!) as unknown as AnswerMap;
  assert.throws(() => rebuild(good, new Map(good.files).set('answer-map.json', canonicalBytes(change(map))))); assert.doesNotThrow(() => validateInput(good));
});
test('scan and approval have different hash semantics and never authorize each other', () => {
  const input = fixture(); const approval = approvalFor(input).approval;
  const scans = { bundle_sha256: payloadHash(input.manifest.files), scanner_version: 'test-only', scanner_sha256: h('scanner'), scanned_at: at, passed: true as const };
  assert.notEqual(scans.bundle_sha256, approval.payload_sha256);
  for (const bad of [{ ...approval, payload_sha256: scans.bundle_sha256 }, { ...approval, actor: 'test' }, { ...approval, approval_id: 'wrong' }]) assert.throws(() => validateBundle(input, bad as typeof approval, scans));
  for (const bad of [{ ...scans, bundle_sha256: approval.payload_sha256 }, { ...scans, passed: false }, { ...scans, ignored: true }]) assert.throws(() => validateBundle(input, approval, bad as typeof scans));
  assert.equal(validateBundle(input, approval, scans).approval.payload_sha256, payloadHash(input.manifest));
});
test('nine-field worksheet excludes forbidden origin and raw lineage; inert packet is lossless', () => {
  const input = fixture(); const rows = worksheet(input);
  for (const changed of [{ origin: 'business-public' }, { license: 'LicenseRef-pending' }, { derived_from: '/private/original' }, { right_to_sell: '' }, { sensitivity: 'unknown' }, { review_status: 'draft' }]) {
    assert.throws(() => createReviewPacket(input, rows.map((r, n) => n ? r : { ...r, ...changed }) as typeof rows));
    assert.doesNotThrow(() => createReviewPacket(input, rows));
  }
  const packet = createReviewPacket(input, rows); const rendered = inertText(packet);
  assert.deepEqual(strictJson(rendered), packet); assert.equal(packet.whole_page_download, true);
  assert.equal(Object.keys(rows[0]!).length, 10); // page_id + the nine M07 fields
  assert.equal(packet.public_files.length, input.files.size);
  const hostile = inertText({ example: '<script>\u001b\u202e&' }); assert.ok(!/[<>\u001b\u202e&]/.test(Buffer.from(hostile).toString()));
});
test('decoded policy strings cannot hide business/PII instructions behind JSON escapes', () => {
  const good = fixture(); const original = strictJson(good.files.get('question-policy.json')!) as unknown as { questions: { text: string; question_sha256: string }[] };
  for (const text of ['社外秘', 'person@example.test', '<script>', 'derived_from: hidden']) {
    const policy = structuredClone(original); policy.questions[0]!.text = text; policy.questions[0]!.question_sha256 = h(text);
    const files = new Map(good.files).set('question-policy.json', canonicalBytes(policy));
    assert.throws(() => rebuild(good, files)); assert.doesNotThrow(() => validateInput(good));
  }
});
test('quoted-scalar and answer-scalar caps reject overage; exact boundary and overlap control pass', () => {
  const original = fixture();
  const modified = (size: number, repeats: number) => {
    const files = new Map(original.files); files.set('pages/p1.md', Buffer.from('a'.repeat(size)));
    const map = strictJson(files.get('answer-map.json')!) as unknown as AnswerMap;
    files.set('answer-map.json', canonicalBytes({ ...map, entries: map.entries.map((entry, n) => n ? entry : { ...entry, spans: Array.from({ length: repeats }, () => ({ page_id: 'p1', byte_start: 0, byte_end: size })) }) }));
    return rebuild(original, files);
  };
  assert.throws(() => modified(M03.quotedScalarsMax.value + 1, 1), /EXTRACT_LIMIT/);
  assert.doesNotThrow(() => modified(M03.quotedScalarsMax.value, 1));
  const size = Math.floor(M03.answerScalarsMax.value / M03.citationsMax.value);
  assert.throws(() => modified(size, M03.citationsMax.value), /EXTRACT_LIMIT/); // join separators exceed the answer limit
  const overhead = renderAnswer(Array.from({ length: M03.citationsMax.value }, (_, n) => ({ text: '', citation_ids: [`c${n + 1}` as never] }))).length;
  assert.doesNotThrow(() => modified(Math.floor((M03.answerScalarsMax.value - overhead) / M03.citationsMax.value), M03.citationsMax.value)); // overlapping source counted once
});
test('extra page/path inventory and scanner failed flags cannot admit a bundle', () => {
  const good = fixture();
  const files = new Map(good.files); files.set('pages/p-extra.md', Buffer.from('A public but unindexed lesson.'));
  assert.throws(() => rebuild(good, files), /UNINDEXED_PAGE/);
  for (const path of ['.hidden', 'pages/.hidden.md', 'pages/../outside.md', '/absolute.md', 'pages\\p1.md', 'manifest.json']) assert.throws(() => rebuild(good, new Map(good.files).set(path, Buffer.from('public'))));
  assert.doesNotThrow(() => validateInput(good));
});
test('worksheet rejects duplicate/missing/unknown page and extra metadata; exact worksheet passes', () => {
  const good = fixture(); const rows = worksheet(good);
  for (const bad of [rows.slice(1), rows.map((r, n) => n ? r : { ...r, page_id: rows[1]!.page_id }), rows.map((r, n) => n ? r : { ...r, page_id: 'not-approved' }), rows.map((r, n) => n ? r : { ...r, hidden: true })]) {
    assert.throws(() => createReviewPacket(good, bad as typeof rows)); assert.doesNotThrow(() => createReviewPacket(good, rows));
  }
});
