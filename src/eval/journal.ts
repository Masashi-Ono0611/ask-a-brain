/** Protected host storage, never mounted or exported as a buyer capability.
 * One writer; hash chaining detects accidental corruption, not a hostile host.
 */
import { closeSync, constants, fsyncSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalBytes, payloadHash, strictJson } from '../wire/index.ts';
import type { Sha256 } from '../wire/contracts.ts';
import type { Journal, JournalEvent } from './types.ts';
import { clone, hash, id, object, requireEval } from './validation.ts';
export class MemoryJournal implements Journal {
  #events: JournalEvent[] = [];
  append(event: JournalEvent): void { canonicalBytes(event); this.#events.push(clone(event)); }
  read(): readonly JournalEvent[] { return clone(this.#events); }
}
export class FileJournal implements Journal {
  readonly #fd: number; #closed = false;
  constructor(path: string) {
    this.#fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    const stat = fstatSync(this.#fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) { closeSync(this.#fd); throw new Error('JOURNAL_DENIED'); }
    try {
      this.read();
      const parent = openSync(dirname(path), 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch (error) { closeSync(this.#fd); throw error; }
  }
  #rows(): { events: JournalEvent[]; tip: Sha256 | null } {
    requireEval(!this.#closed, 'JOURNAL_CLOSED');
    const bytes = Buffer.alloc(fstatSync(this.#fd).size);
    let offset = 0; while (offset < bytes.length) { const n = readSync(this.#fd, bytes, offset, bytes.length - offset, offset); requireEval(n > 0, 'JOURNAL_CORRUPT'); offset += n; }
    const content = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    requireEval(content === '' || content.endsWith('\n'), 'JOURNAL_CORRUPT');
    let tip: Sha256 | null = null; const events: JournalEvent[] = [];
    for (const line of content.split('\n').filter(Boolean)) {
      const row = object(strictJson(Buffer.from(line)), ['previous', 'event', 'sha256']);
      requireEval(row.previous === tip, 'JOURNAL_CORRUPT');
      requireEval(hash(row.sha256) === payloadHash({ previous: row.previous, event: row.event }), 'JOURNAL_CORRUPT');
      const e = object(row.event, ['kind', 'run_id', 'data']);
      requireEval(e.kind === 'start' || e.kind === 'call' || e.kind === 'result', 'JOURNAL_CORRUPT');
      events.push({ kind: e.kind, run_id: id(e.run_id), data: e.data }); tip = hash(row.sha256);
    }
    return { events, tip };
  }
  append(event: JournalEvent): void {
    const { tip } = this.#rows(); const body = { previous: tip, event };
    const bytes = Buffer.from([...canonicalBytes({ ...body, sha256: payloadHash(body) }), 10]);
    let offset = 0; while (offset < bytes.length) offset += writeSync(this.#fd, bytes, offset, bytes.length - offset);
    fsyncSync(this.#fd);
  }
  read(): readonly JournalEvent[] { return clone(this.#rows().events); }
  close(): void { if (!this.#closed) { closeSync(this.#fd); this.#closed = true; } }
}
