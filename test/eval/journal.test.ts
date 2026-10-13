import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Id } from '../../src/wire/contracts.ts';
import { FileJournal } from '../../src/eval/index.ts';
import { rehearse } from '../../scripts/eval/synthetic.ts';
function directory(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), 'aab-eval-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('fsynced append-only journal survives reopen; complete attempts are never rerun', async (t) => {
  const path = join(directory(t), 'attempts.jsonl'); const journal = new FileJournal(path);
  const first = await rehearse(journal); const count = journal.read().length; journal.close();
  const reopened = new FileJournal(path); try {
    assert.equal(reopened.read().length, count); const second = await rehearse(reopened);
    assert.equal(reopened.read().length, count); assert.deepEqual(second.grades, first.grades);
    assert.equal(first.grades.filter((g) => g.verdict === 'pass').length, 9);
  } finally { reopened.close(); }
});
test('tampered/truncated journal refuses startup; restored original passes', (t) => {
  const path = join(directory(t), 'attempts.jsonl'); const journal = new FileJournal(path);
  journal.append({ kind: 'start', run_id: 'run' as Id, data: { public: 'clean' } }); journal.close(); const bytes = readFileSync(path);
  for (const bad of [Buffer.from(bytes.toString().replace('clean', 'other')), bytes.subarray(0, bytes.length - 1), Uint8Array.from([0xff, 10])]) {
    writeFileSync(path, bad); assert.throws(() => new FileJournal(path)); writeFileSync(path, bytes);
    const control = new FileJournal(path); assert.equal(control.read().length, 1); control.close();
  }
});
test('journal rejects symlinks and broad permissions, private regular file works', (t) => {
  const dir = directory(t), path = join(dir, 'events'); const journal = new FileJournal(path); journal.close();
  symlinkSync(path, join(dir, 'link')); assert.throws(() => new FileJournal(join(dir, 'link')));
  chmodSync(path, 0o644); assert.throws(() => new FileJournal(path), /JOURNAL_DENIED/);
  chmodSync(path, 0o600); linkSync(path, join(dir, 'hardlink')); assert.throws(() => new FileJournal(path), /JOURNAL_DENIED/);
  rmSync(join(dir, 'hardlink')); const restored = new FileJournal(path); assert.equal(restored.read().length, 0); restored.close();
});
