import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import type { SetupJournal, SetupKeys, SetupState } from '../../src/chain/index.ts';
import { generateThrowawayKey, parseCliKey } from '../../src/chain/index.ts';
import { canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { object, integer } from '../../src/chain/rpc.ts';
import { requireChain } from '../../src/chain/legacy.ts';
/** Parent walk prevents following symlinks. Secret root must be owned/private. */
export function privateDirectory(directory: string): string {
  requireChain(isAbsolute(directory)); const path = resolve(directory); let current = parse(path).root;
  for (const part of relative(current, path).split('/')) {
    current = join(current, part);
    try { const stat = lstatSync(current); requireChain(stat.isDirectory() && !stat.isSymbolicLink()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; mkdirSync(current, { mode: 0o700 }); }
  }
  const stat = lstatSync(path); requireChain(stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0); return path;
}
export function readPrivate(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd); requireChain(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0); return readFileSync(fd); }
  finally { closeSync(fd); }
}
export function writePrivate(path: string, bytes: Uint8Array, replace = false): void {
  privateDirectory(dirname(path)); const destination = replace ? `${path}.next` : path;
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  if (replace) renameSync(destination, path);
  const dir = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function loadSetupKeys(directory: string): SetupKeys {
  const root = privateDirectory(directory); const keys = {} as Record<keyof SetupKeys, Uint8Array>;
  for (const name of ['buyer', 'seller', 'marketplace', 'mint', 'seal'] as const) {
    const path = join(root, `${name}.json`);
    try { keys[name] = parseCliKey(readPrivate(path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = generateThrowawayKey(); writePrivate(path, Buffer.from(JSON.stringify([...generated.keyBytes]))); keys[name] = generated.keyBytes;
    }
  }
  return keys;
}
export function fileSetupJournal(directory: string): SetupJournal {
  const path = join(privateDirectory(directory), 'setup.json');
  return {
    read() {
      // A completed .next is a pre-dispatch durable journal candidate. Promote it;
      // a truncated pre-rename write was never acknowledged to the dispatcher.
      try {
        const candidate = readPrivate(`${path}.next`);
        try { strictJson(candidate, { integerNumbersOnly: true }); renameSync(`${path}.next`, path); const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
        catch { unlinkSync(`${path}.next`); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      let bytes: Uint8Array; try { bytes = readPrivate(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      const row = object(strictJson(bytes, { integerNumbersOnly: true }), ['v', 'limitsSha256', 'genesis', 'addresses', 'entries', 'airdropAttempts', 'airdropSignature', 'airdropPending', 'mintAttempted']);
      object(row.addresses, ['buyer', 'seller', 'marketplace', 'mint', 'seal', 'buyerAta', 'sellerAta', 'marketplaceAta']);
      requireChain(row.v === 1 && typeof row.genesis === 'string' && Array.isArray(row.entries) && typeof row.airdropPending === 'boolean' && typeof row.mintAttempted === 'boolean'); integer(row.airdropAttempts);
      for (const entry of row.entries) {
        const e = object(entry, ['name', 'signature', 'transactionBase64', 'lastValidBlockHeight', 'state', 'fee']);
        requireChain(typeof e.name === 'string' && typeof e.signature === 'string' && typeof e.transactionBase64 === 'string' && ['pending', 'finalized'].includes(String(e.state)) && (e.fee === null || typeof e.fee === 'string')); integer(e.lastValidBlockHeight);
      }
      return row as unknown as SetupState;
    },
    write(state) { writePrivate(path, canonicalBytes(state), true); },
  };
}
