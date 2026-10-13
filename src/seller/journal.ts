/** Content-free append-only independent journal. Store outside content backups.
 * The protected operator still supplies a newest-generation/digest attestation:
 * local fsync cannot prove that an administrator has not restored an old file.
 */
import { constants, closeSync, fstatSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Revocation, TombstoneJournal, TombstoneAttestation } from '../wire/contracts.ts';
import { FoundationError, validateTombstones } from '../common/index.ts';
import type { SellerWire } from './ports.ts';
import { jsonValue } from './ports.ts';
function checked(value: unknown): Revocation {
  return { ...validateTombstones([value as Revocation])[0]! };
}
export class FileTombstoneJournal implements TombstoneJournal {
  readonly #path: string; readonly #wire: Pick<SellerWire, 'json' | 'canonical' | 'hash'>;
  readonly newestState?: () => Promise<TombstoneAttestation>;
  constructor(path: string, wire: Pick<SellerWire, 'json' | 'canonical' | 'hash'>, authority?: () => Promise<TombstoneAttestation>) {
    this.#path = path; this.#wire = wire;
    if (authority) this.newestState = authority;
  }
  /** Explicit first provisioning only; startup readAll never creates a missing file. */
  initializeEmpty(): void {
    const fd = openSync(this.#path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const dir = openSync(dirname(this.#path), constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  #open(flags: number): number {
    const fd = openSync(this.#path, flags | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) { closeSync(fd); throw new FoundationError('NOT_READY'); }
    return fd;
  }
  #read(fd: number): Revocation[] {
    const bytes = readFileSync(fd); if (!bytes.length) return [];
    if (bytes[bytes.length - 1] !== 10) throw new FoundationError('NOT_READY'); // torn append is offline, never ignored
    const result: Revocation[] = []; const seen = new Set<string>(); let generation = 0; let start = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) {
      const row = checked(this.#wire.json(bytes.subarray(start, i))); start = i + 1;
      const key = `${row.slice_id}:${row.manifest_sha256}`;
      if (seen.has(key) || row.generation <= generation) throw new FoundationError('NOT_READY');
      seen.add(key); generation = row.generation; result.push(row);
    }
    return result;
  }
  async readAll(): Promise<readonly Revocation[]> {
    const fd = this.#open(constants.O_RDONLY); try { return this.#read(fd); } finally { closeSync(fd); }
  }
  async append(revocation: Revocation): Promise<void> {
    checked(revocation);
    // No await between open/read/append/fsync: single controller process owns journal.
    const fd = this.#open(constants.O_RDWR | constants.O_APPEND);
    try {
      const rows = this.#read(fd); const old = rows.find((r) => r.slice_id === revocation.slice_id && r.manifest_sha256 === revocation.manifest_sha256);
      if (old) { if (this.#wire.hash(jsonValue(old)) !== this.#wire.hash(jsonValue(revocation))) throw new FoundationError('STATE_CONFLICT'); return; }
      if (revocation.generation <= (rows.at(-1)?.generation ?? 0)) throw new FoundationError('STATE_CONFLICT');
      const data = Buffer.concat([this.#wire.canonical(jsonValue(revocation)), Buffer.from('\n')]);
      let offset = 0; while (offset < data.length) { const wrote = writeSync(fd, data, offset, data.length - offset); if (wrote <= 0) throw new FoundationError('NOT_READY'); offset += wrote; }
      fsyncSync(fd);
    } finally { closeSync(fd); }
  }
}
