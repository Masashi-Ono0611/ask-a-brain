import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalBytes, payloadHash } from '../../src/wire/index.ts';
import { createExtractiveWorker } from '../../src/seller/index.ts';
import { readInventory, stageBundle } from '../../src/publish/index.ts';
import { fixture, harness, temporary, writeProjection } from './helpers.ts';
import { M03, canonicalBytes as canonical, parseWire, payloadHash as hash, strictJson, verifyCitations, verifyEnvelope } from '../../src/wire/index.ts';

for (const kind of ['hidden', 'unlisted', 'symlink', 'hardlink', 'directory', 'fifo', 'changed', 'missing', 'linked-pages', 'linked-root']) test(`inventory refuses ${kind}, restores exact allowlist`, (t) => {
  const dir = temporary(t); const source = join(dir, 'projection'); const input = fixture(); writeProjection(source, input);
  const p = join(source, 'pages/p1.md'); const bytes = readFileSync(p); let undo = () => {};
  if (kind === 'hidden' || kind === 'unlisted') { const path = join(source, kind === 'hidden' ? '.gitleaksignore' : 'extra.txt'); writeFileSync(path, 'ignored'); undo = () => unlinkSync(path); }
  if (['symlink', 'hardlink', 'directory', 'fifo'].includes(kind)) {
    unlinkSync(p); const outside = join(dir, 'outside.md'); writeFileSync(outside, bytes);
    if (kind === 'symlink') symlinkSync(outside, p);
    if (kind === 'hardlink') linkSync(outside, p);
    if (kind === 'directory') mkdirSync(p);
    if (kind === 'fifo') assert.equal(spawnSync('mkfifo', [p]).status, 0);
    undo = () => { if (kind === 'directory') { renameSync(p, join(dir, 'moved-directory')); } else unlinkSync(p); writeFileSync(p, bytes); };
  }
  if (kind === 'changed') { writeFileSync(p, 'tampered'); undo = () => writeFileSync(p, bytes); }
  if (kind === 'missing') { unlinkSync(p); undo = () => writeFileSync(p, bytes); }
  if (kind === 'linked-pages') { renameSync(join(source, 'pages'), join(dir, 'outside-pages')); symlinkSync(join(dir, 'outside-pages'), join(source, 'pages')); undo = () => { unlinkSync(join(source, 'pages')); renameSync(join(dir, 'outside-pages'), join(source, 'pages')); }; }
  if (kind === 'linked-root') { renameSync(source, join(dir, 'outside-root')); symlinkSync(join(dir, 'outside-root'), source); undo = () => { unlinkSync(source); renameSync(join(dir, 'outside-root'), source); }; }
  try { assert.throws(() => readInventory(source, input.manifest.files)); } finally { undo(); }
  const restored = readInventory(source, input.manifest.files); for (const [path, data] of input.files) assert.deepEqual(Buffer.from(restored.get(path)!), Buffer.from(data));
});
test('interrupted copy leaves inert residue; previous artifact intact; fresh empty staging succeeds', (t) => {
  const dir = temporary(t); const stage = join(dir, 'stage'); mkdirSync(stage);
  const old = join(dir, 'previous.json'); writeFileSync(old, 'previous inactive bundle');
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.writeFileSync; fs.writeFileSync=(...args)=>{ original(...args); process.exit(23); }; syncBuiltinESMExports(); const {fixture}=await import('./test/publish/helpers.ts'); const {stageBundle}=await import('./src/publish/index.ts'); stageBundle(fixture(),process.argv[1]);`;
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', code, stage]).status, 23);
  const input = fixture(); assert.throws(() => readInventory(stage, input.manifest.files)); assert.throws(() => stageBundle(input, stage), /STAGING_NOT_EMPTY/);
  assert.equal(readFileSync(old, 'utf8'), 'previous inactive bundle'); const fresh = join(dir, 'fresh'); mkdirSync(fresh);
  assert.deepEqual(stageBundle(input, fresh).manifest, input.manifest); assert.throws(() => stageBundle(input, fresh), /STAGING_NOT_EMPTY/);
});
test('two synthetic private corpora and outside canaries cannot alter public output or fixed-query results', async (t) => {
  const dir = temporary(t); const input = fixture(); const h = harness(input); const bundles = [];
  for (const variant of ['a', 'b']) {
    const root = join(dir, variant); mkdirSync(root); const projection = join(root, 'approved'); writeProjection(projection, input);
    // Deliberately never pass these synthetic-original locations to publisher.
    writeFileSync(join(root, 'private-corpus.txt'), `AAB_PRIVATE_CANARY_${variant} ${variant.repeat(100)}`);
    const empty = join(root, 'stage'); mkdirSync(empty);
    const snapshot = stageBundle({ manifest: input.manifest, files: readInventory(projection, input.manifest.files) }, empty);
    bundles.push(await h.publisher.sealBundle(h.publisher.scanAndValidate(snapshot), h.signer));
  }
  assert.deepEqual(bundles[0], bundles[1]); assert.equal(payloadHash(bundles[0]!.manifest), payloadHash(bundles[1]!.manifest));
  const policy = parseWire('question_policy', input.files.get('question-policy.json')!);
  const config = { origin: 'https://seller.example', limits: M03, wire: { parse: parseWire, canonical, hash, json: strictJson, verify: verifyEnvelope, citations: verifyCitations } };
  const results = await Promise.all(bundles.map((b) => createExtractiveWorker(b, config).prepare(policy.questions[0]!, { quote_id: 'quote' as never, buyer_id: 'buyer' as never, created_at: input.manifest.created_at, commitment_salt: 'synthetic-fixed-salt' }, new AbortController().signal)));
  assert.deepEqual(results[0], results[1]); assert.ok(!Buffer.from(canonicalBytes(results)).toString().includes('AAB_PRIVATE_CANARY'));
  assert.equal('answer' in results[0]!, true);
});
