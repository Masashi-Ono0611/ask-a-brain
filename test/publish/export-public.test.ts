import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLessonLeaks, lessonShingles } from '../../scripts/publish/export-public.ts';
const lesson = '# T\n\nSynthetic planted sentence number one that is long enough to form a shingle window here.\n';
test('lesson leak scan: planted lesson line is found (bad control); unrelated text and a short line stay silent (clean control)', () => {
  const sh = lessonShingles([lesson]); assert.ok(sh.size > 0);
  const dir = mkdtempSync(join(tmpdir(), 'aab-leak-')); mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'clean.md'), 'Nothing here is from any lesson. Synthetic planted sentence.\n');
  assert.deepEqual(findLessonLeaks(dir, sh), []);
  writeFileSync(join(dir, 'docs', 'leak.md'), `intro\n${lesson.split('\n')[2]}\n`);
  assert.deepEqual(findLessonLeaks(dir, sh), ['docs/leak.md']);
});
