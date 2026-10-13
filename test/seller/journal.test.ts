import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, readFileSync, symlinkSync, writeFileSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { FileTombstoneJournal } from '../../src/seller/index.ts';
import { fixture, hash } from './support.ts';

test('independent journal missing/torn/unknown/duplicate state is offline; intact fsynced records reopen', async (t) => {
  const f = fixture(t); const path = join(f.directory, 'independent.jsonl'); let journal = new FileTombstoneJournal(path, f.wire);
  await assert.rejects(journal.readAll()); journal.initializeEmpty(); assert.deepEqual(await journal.readAll(), []);
  assert.throws(() => journal.initializeEmpty()); const revocation = f.revocation(); await journal.append(revocation); const exact = readFileSync(path);
  journal = new FileTombstoneJournal(path, f.wire); assert.deepEqual(await journal.readAll(), [revocation]); await journal.append(revocation); assert.deepEqual(readFileSync(path), exact);
  for (const bad of [Buffer.from('{'), Buffer.from('{"generation":1,"generation":2}\n'), Buffer.from('{"unknown":1}\n'), Buffer.concat([exact, exact]), Uint8Array.of(255, 10)]) {
    writeFileSync(path, bad); await assert.rejects(journal.readAll()); writeFileSync(path, exact); assert.deepEqual(await journal.readAll(), [revocation]);
  }
});
test('journal monotonic generation, immutable revocation and restrictive file controls with clean counterparts', async (t) => {
  const f = fixture(t); const path = join(f.directory, 'journal'); const journal = new FileTombstoneJournal(path, f.wire); journal.initializeEmpty();
  const first = f.revocation(); await journal.append(first);
  await assert.rejects(journal.append({ ...first, reason: 'rights' }), /STATE_CONFLICT/);
  await assert.rejects(journal.append({ ...first, manifest_sha256: hash('second') }), /STATE_CONFLICT/);
  const second = { ...first, manifest_sha256: hash('second'), generation: first.generation + 1 }; await journal.append(second); assert.equal((await journal.readAll()).length, 2);
  chmodSync(path, 0o644); await assert.rejects(journal.readAll(), /NOT_READY/); chmodSync(path, 0o600); assert.equal((await journal.readAll()).length, 2);
  const symbolic = join(f.directory, 'symbolic'); symlinkSync(path, symbolic); await assert.rejects(new FileTombstoneJournal(symbolic, f.wire).readAll());
  const hard = join(f.directory, 'hard'); linkSync(path, hard); await assert.rejects(journal.readAll(), /NOT_READY/);
  const clean = join(f.directory, 'clean'); const cleanJournal = new FileTombstoneJournal(clean, f.wire); cleanJournal.initializeEmpty(); assert.deepEqual(await cleanJournal.readAll(), []);
});
