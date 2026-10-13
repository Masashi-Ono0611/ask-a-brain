import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { M03, bytesHash, canonicalBytes, parseWire, payloadHash, resolveQuestion } from '../../src/wire/index.ts';
import { parseAnswerMap } from '../../src/common/index.ts';
import { createReviewPacket, readInventory } from '../../src/publish/index.ts';
import { admissionInput, approvalPins, buildRealProjection, createProjection, loadApprovedSources } from '../../scripts/publish/build-real-projection.ts';

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'aab-real-projection-'));
  const source = join(root, 'source'), index = join(root, 'approval-index.md');
  mkdirSync(join(source, 'lessons'), { recursive: true }); mkdirSync(join(source, 'questions'));
  const questions = Array.from({ length: 10 }, (_, i) => ({ id: `Q${String(i + 1).padStart(2, '0')}`, version: 1, text: `What confirms synthetic task ${i + 1}?`, lesson: `L${Math.floor(i / 2) + 1}`, sha256_of_utf8_text: bytesHash(Buffer.from(`What confirms synthetic task ${i + 1}?`)) }));
  const map: Record<string, { page: string; start_byte: number; end_byte: number; text: string }[]> = {};
  const prefix = '# Synthetic lesson\n\n';
  for (let i = 1; i <= M03.founderSlicePages.value; i++) {
    const text = `確認 🧠 ${i}: check the exact output.\nThis toy observation has limited scope.`;
    writeFileSync(join(source, `lessons/L${i}.md`), `${prefix}${text}\n`);
    for (const q of questions.filter((q) => q.lesson === `L${i}`)) map[q.id] = [{ page: `lessons/L${i}.md`, start_byte: Buffer.byteLength(prefix), end_byte: Buffer.byteLength(prefix + text), text }];
  }
  const negatives = Array.from({ length: 10 }, (_, i) => {
    const target = i === 8 ? questions[0]! : questions[4]!;
    const text = i < 8 ? `Unsupported synthetic topic ${i + 1}?` : target.text;
    return { id: `N${String(i + 1).padStart(2, '0')}`, version: i < 8 ? 1 : i === 8 ? 2 : 0, text, sha256_of_utf8_text: bytesHash(Buffer.from(text)),
      category: i < 8 ? 'unsupported-topic' : 'version-mismatch', reason: 'Synthetic control.', expected_disposition: 'local_reject', ...(i < 8 ? {} : { target_question_id: target.id }) };
  });
  const writeJson = (path: string, data: unknown): void => writeFileSync(join(source, path), JSON.stringify(data));
  writeJson('questions/questions.json', questions); writeJson('questions/answer-map.json', map); writeJson('questions/negatives.json', negatives);
  const repin = (): void => {
    const row = (name: string, path: string): string => { const bytes = readFileSync(join(source, path)); return `| ${name} | ${bytes.length} | ${bytesHash(bytes)} |`; };
    writeFileSync(index, ['## Approval 1: five lessons (2026-10-09, founder chat)', ...Array.from({ length: M03.founderSlicePages.value }, (_, i) => row(`L${i + 1}.md`, `lessons/L${i + 1}.md`)),
      '## Approval 2: ten questions and answer-map spans (2026-10-09, founder chat)', row('questions/questions.json', 'questions/questions.json'), row('questions/answer-map.json', 'questions/answer-map.json')].join('\n'));
  };
  repin();
  const load = () => loadApprovedSources(source, readFileSync(index));
  const build = () => createProjection(load());
  return { root, source, index, questions, map, negatives, writeJson, repin, load, build, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('synthetic stand-ins produce deterministic exact pages, frozen map/policy, and inert T5 review', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const first = buildRealProjection(f.source, f.index, join(f.root, 'first'));
  const second = buildRealProjection(f.source, f.index, join(f.root, 'second'));
  assert.equal(first.manifest_sha256, second.manifest_sha256); assert.equal(first.inventory_sha256, second.inventory_sha256);
  const result = f.build(); const packet = createReviewPacket(result.bundle, result.worksheet);
  assert.equal(packet.kind, 'inert-review-only'); assert.equal(result.proof.supported, 10); assert.equal(result.proof.local_rejected, 10);
  const inventory = readInventory(join(first.output, 'real'), result.bundle.manifest.files);
  for (let i = 1; i <= M03.founderSlicePages.value; i++) assert.deepEqual(Buffer.from(inventory.get(`pages/p${i}.md`)!), readFileSync(join(f.source, `lessons/L${i}.md`)));
  const policy = parseWire('question_policy', inventory.get('question-policy.json')!);
  const map = parseAnswerMap(inventory.get('answer-map.json')!);
  assert.equal(map.entries.length, 10);
  assert.equal(result.worksheetMapping.worksheet_sha256, payloadHash(result.worksheet));
  for (const page of result.worksheetMapping.pages) assert.equal(result.bundle.manifest.pages.find((p) => p.page_id === page.page_id)!.content_sha256, page.sha256);
  assert.equal(policy.approval_sha256, bytesHash(readFileSync(join(f.source, 'questions/questions.json'))));
  assert.deepEqual(readdirSync(join(first.output, 'real')).sort(), ['answer-map.json', 'pages', 'question-policy.json']);
  for (const q of f.questions) assert.equal(resolveQuestion(policy, admissionInput(q.id, q.version)).text, q.text);
  for (const p of result.proof.questions) {
    assert.ok(p.quoted_scalars <= M03.quotedScalarsMax.value); assert.ok(p.rendered_scalars <= M03.answerScalarsMax.value);
    for (const span of p.spans) assert.equal(Buffer.from(inventory.get(`pages/${span.page_id}.md`)!).subarray(span.byte_start, span.byte_end).toString(), span.text);
  }
  assert.equal(first.manifest_sha256, payloadHash(result.bundle.manifest));
});

test('each approved file rejects changed size and same-size changed bytes, then passes after restore', (t) => {
  const f = fixture(); t.after(f.cleanup);
  for (const pin of approvalPins(readFileSync(f.index))) {
    const path = join(f.source, pin.path), original = readFileSync(path);
    for (const changed of [Buffer.concat([original, Buffer.from(' ')]), Buffer.from(original)]) {
      if (changed.length === original.length) changed[0] = changed[0]! ^ 1;
      writeFileSync(path, changed); assert.throws(f.load, /SOURCE_APPROVAL_MISMATCH/);
      writeFileSync(path, original); assert.equal(f.build().proof.supported, 10);
    }
  }
});

test('approval scope rejects missing, duplicate, or displaced approval rows, and restores', (t) => {
  const f = fixture(); t.after(f.cleanup); const original = readFileSync(f.index, 'utf8'); const row = original.split('\n')[1]!;
  for (const bad of [original.replace(row, ''), original.replace(row, `${row}\n${row}`), original.replace('## Approval 1:', '## Not approval 1:')]) {
    writeFileSync(f.index, bad); assert.throws(f.load, /APPROVAL_/); writeFileSync(f.index, original); assert.equal(f.build().proof.supported, 10);
  }
});

const shapeCases: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
  ['duplicate JSON keys', (f) => { const path = join(f.source, 'questions/questions.json'); writeFileSync(path, readFileSync(path, 'utf8').replace('"version":1', '"version":1,"version":1')); }],
  ['invalid UTF-8', (f) => writeFileSync(join(f.source, 'lessons/L1.md'), Buffer.from([0xff]))],
  ['unknown question field', (f) => f.writeJson('questions/questions.json', [{ ...f.questions[0], extra: true }, ...f.questions.slice(1)])],
  ['unknown map field', (f) => f.writeJson('questions/answer-map.json', { ...f.map, N01: [] })],
  ['unknown span field', (f) => f.writeJson('questions/answer-map.json', { ...f.map, Q01: [{ ...f.map.Q01![0], extra: true }] })],
  ['unknown negative field', (f) => f.writeJson('questions/negatives.json', [{ ...f.negatives[0], extra: true }, ...f.negatives.slice(1)])],
  ['missing question', (f) => f.writeJson('questions/questions.json', f.questions.slice(1))],
  ['missing map entry', (f) => { delete f.map.Q01; f.writeJson('questions/answer-map.json', f.map); }],
  ['missing negative', (f) => f.writeJson('questions/negatives.json', f.negatives.slice(1))],
  ['duplicate question ID', (f) => f.writeJson('questions/questions.json', [f.questions[0], ...f.questions.slice(0, -1)])],
  ['duplicate negative ID', (f) => f.writeJson('questions/negatives.json', [f.negatives[0], ...f.negatives.slice(0, -1)])],
  ['unsupported question version', (f) => f.writeJson('questions/questions.json', [{ ...f.questions[0], version: 2 }, ...f.questions.slice(1)])],
  ['question hash mismatch', (f) => f.writeJson('questions/questions.json', [{ ...f.questions[0], text: 'Changed' }, ...f.questions.slice(1)])],
  ['negative hash mismatch', (f) => f.writeJson('questions/negatives.json', [{ ...f.negatives[0], text: 'Changed' }, ...f.negatives.slice(1)])],
  ['negative approved text', (f) => f.writeJson('questions/negatives.json', [{ ...f.negatives[0], text: f.questions[0]!.text, sha256_of_utf8_text: f.questions[0]!.sha256_of_utf8_text }, ...f.negatives.slice(1)])],
  ['negative wrong target form', (f) => f.writeJson('questions/negatives.json', [{ ...f.negatives[0], target_question_id: 'Q01' }, ...f.negatives.slice(1)])],
  ['negative supported version', (f) => { f.negatives[8]!.version = 1; f.writeJson('questions/negatives.json', f.negatives); }],
  ['negative wrong target text', (f) => { f.negatives[8]!.target_question_id = 'Q05'; f.writeJson('questions/negatives.json', f.negatives); }],
  ['wrong lesson association', (f) => { f.questions[0]!.lesson = 'L2'; f.writeJson('questions/questions.json', f.questions); }],
  ['altered excerpt', (f) => { f.map.Q01![0]!.text += '!'; f.writeJson('questions/answer-map.json', f.map); }],
  ['split Unicode boundary', (f) => { f.map.Q01![0]!.start_byte++; f.writeJson('questions/answer-map.json', f.map); }],
  ['reversed span', (f) => { f.map.Q01![0]!.start_byte = f.map.Q01![0]!.end_byte; f.writeJson('questions/answer-map.json', f.map); }],
  ['out of page span', (f) => { f.map.Q01![0]!.end_byte += M03.pageMax.value * 1024; f.writeJson('questions/answer-map.json', f.map); }],
  ['empty span list', (f) => { f.map.Q01 = []; f.writeJson('questions/answer-map.json', f.map); }],
  ['span traversal', (f) => { f.map.Q01![0]!.page = '../L1.md'; f.writeJson('questions/answer-map.json', f.map); }],
  ['citation count overflow', (f) => { f.map.Q01 = Array.from({ length: M03.citationsMax.value + 1 }, () => f.map.Q01![0]!); f.writeJson('questions/answer-map.json', f.map); }],
  ['quoted scalar overflow', (f) => {
    const text = 'x'.repeat(M03.quotedScalarsMax.value + 1); writeFileSync(join(f.source, 'lessons/L1.md'), text);
    for (const q of ['Q01', 'Q02']) f.map[q] = [{ page: 'lessons/L1.md', start_byte: 0, end_byte: Buffer.byteLength(text), text }];
    f.writeJson('questions/answer-map.json', f.map);
  }],
  ['rendered scalar overflow with overlap counted once', (f) => {
    const text = 'x'.repeat(Math.floor(M03.answerScalarsMax.value / 2) + 1); writeFileSync(join(f.source, 'lessons/L1.md'), text);
    for (const q of ['Q01', 'Q02']) f.map[q] = Array.from({ length: 2 }, () => ({ page: 'lessons/L1.md', start_byte: 0, end_byte: Buffer.byteLength(text), text }));
    f.writeJson('questions/answer-map.json', f.map);
  }],
];
for (const [name, mutate] of shapeCases) test(`${name} is rejected after pin check, and clean counterpart passes after restore`, (t) => {
  const f = fixture(); t.after(f.cleanup);
  const snapshot = new Map([...approvalPins(readFileSync(f.index)).map((p) => p.path), 'questions/negatives.json'].map((path) => [path, readFileSync(join(f.source, path))]));
  assert.equal(f.build().proof.supported, 10); mutate(f); f.repin(); assert.throws(f.build);
  for (const [path, bytes] of snapshot) writeFileSync(join(f.source, path), bytes);
  f.repin(); assert.equal(f.build().proof.supported, 10);
});

test('negative versions fail real wire admission while the exact finite version passes; no map row is exposed', (t) => {
  const f = fixture(); t.after(f.cleanup); const result = f.build(); const policy = parseWire('question_policy', result.bundle.files.get('question-policy.json')!);
  for (const n of f.negatives) {
    assert.throws(() => resolveQuestion(policy, admissionInput(n.target_question_id ?? n.id, n.version)), /QUESTION_NOT_APPROVED/);
    assert.equal(result.proof.negatives.find((p) => p.control_id === n.id)!.mapped_spans, 0);
    assert.equal(resolveQuestion(policy, admissionInput(n.target_question_id ?? 'Q01', 1)).template_values.version, '1');
  }
  assert.throws(() => resolveQuestion(policy, { ...admissionInput('Q01', 1), template_values: {} }), /QUESTION_NOT_APPROVED/);
  assert.equal(resolveQuestion(policy, admissionInput('Q01', 1)).text, f.questions[0]!.text);
  const publicText = [...result.bundle.files.values()].map((b) => Buffer.from(b).toString()).join('\n');
  for (const n of f.negatives.slice(0, 8)) assert.ok(!publicText.includes(n.text));
});

test('symlinks, hardlinks, hidden extras and missing pages fail, and restored source passes', (t) => {
  const f = fixture(); t.after(f.cleanup); const page = join(f.source, 'lessons/L1.md'), original = readFileSync(page);
  const target = join(f.root, 'public-stand-in.md'); writeFileSync(target, original);
  for (const create of [symlinkSync, linkSync]) {
    rmSync(page); create(target, page); assert.throws(f.load); rmSync(page); writeFileSync(page, original); assert.equal(f.build().proof.supported, 10);
  }
  for (const path of [join(f.source, '.extra'), join(f.source, 'lessons/.extra'), join(f.source, 'questions/.extra')]) {
    writeFileSync(path, 'not read'); assert.throws(f.load, /SOURCE_INVENTORY/); rmSync(path); assert.equal(f.build().proof.supported, 10);
  }
  rmSync(page); assert.throws(f.load, /SOURCE_INVENTORY/); writeFileSync(page, original); assert.equal(f.build().proof.supported, 10);
});

test('CLI refuses tampered source without output and existing output without overwriting; clean T5 review passes', (t) => {
  const f = fixture(); t.after(f.cleanup); const output = join(f.root, 'output'); const path = join(f.source, 'lessons/L1.md'), original = readFileSync(path);
  const run = () => spawnSync(process.execPath, ['scripts/publish/build-real-projection.ts', f.source, f.index, output], { encoding: 'utf8' });
  writeFileSync(path, 'changed'); assert.equal(run().status, 1); assert.ok(!readdirSync(f.root).includes('output')); writeFileSync(path, original);
  assert.equal(run().status, 0); const manifest = readFileSync(join(output, 'manifest.json')); assert.equal(run().status, 1); assert.deepEqual(readFileSync(join(output, 'manifest.json')), manifest);
  const stage = join(f.root, 'stage'); mkdirSync(stage);
  const review = spawnSync(process.execPath, ['scripts/publish/operator.ts', 'review', join(output, 'manifest.json'), join(output, 'real'), join(output, 'worksheet.json'), stage, join(f.root, 'review.txt')], { encoding: 'utf8' });
  assert.equal(review.status, 0, review.stderr); assert.match(review.stdout, /review-only/);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'review.txt'), 'utf8')).kind, 'inert-review-only');
});
