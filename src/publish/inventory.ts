import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { BundleInput, Manifest } from '../wire/contracts.ts';
import { M03, bytesHash, payloadHash } from '../wire/index.ts';
import { publicPath, requirePublish, validateInput } from './validation.ts';

/** Resolve once; reject any symlink component beneath the platform's canonical
 * temp root too. Callers on macOS should pass realpath(tmpdir()), not /var. */
export function realDirectory(path: string): string {
  const absolute = resolve(path);
  requirePublish(realpathSync(absolute) === absolute && lstatSync(absolute).isDirectory(), 'DIRECTORY_LINK'); return absolute;
}
export function regularBytes(path: string, maxBytes: number): Uint8Array {
  const before = lstatSync(path); requirePublish(before.isFile() && before.nlink === 1 && before.size <= maxBytes, 'NONREGULAR_OR_OVERSIZE');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = fstatSync(fd); requirePublish(current.isFile() && current.nlink === 1 && current.ino === before.ino && current.dev === before.dev && current.size === before.size, 'FILE_RACE');
    const bytes = readFileSync(fd); const after = fstatSync(fd);
    requirePublish(bytes.length === current.size && after.size === current.size && after.mtimeMs === current.mtimeMs && after.ctimeMs === current.ctimeMs && after.nlink === 1, 'FILE_RACE'); return bytes;
  } finally { closeSync(fd); }
}
/** Input root is the deliberately approved projection, NEVER an original corpus.
 * Enumerate names to reject extras before reading any content. */
export function readInventory(root: string, expected: Manifest['files']): ReadonlyMap<string, Uint8Array> {
  const directory = realDirectory(root); const allowed = new Set(expected.map((f) => f.path));
  requirePublish(allowed.size === expected.length && expected.length <= M03.chunksMax.value, 'INVENTORY_MISMATCH');
  expected.forEach((f) => { publicPath(f.path); requirePublish(Number.isSafeInteger(f.size_bytes) && f.size_bytes >= 0 && /^[a-f0-9]{64}$/.test(f.sha256), 'INVALID_INVENTORY'); });
  requirePublish(expected.reduce((sum, f) => sum + f.size_bytes, 0) <= M03.sealedPayloadMax.value * 1024 * 1024, 'INVENTORY_LIMIT');
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'pages' && entry.isDirectory()) {
      realDirectory(join(directory, 'pages'));
      for (const page of readdirSync(join(directory, 'pages'), { withFileTypes: true })) {
        requirePublish(page.isFile() && allowed.has(`pages/${page.name}`), 'UNLISTED_OR_LINK'); paths.push(`pages/${page.name}`);
      }
    } else { requirePublish(entry.isFile() && allowed.has(entry.name), 'UNLISTED_OR_LINK'); paths.push(entry.name); }
  }
  requirePublish(paths.length === expected.length, 'INVENTORY_MISMATCH');
  const files = new Map<string, Uint8Array>();
  for (const file of expected) {
    const bytes = regularBytes(join(directory, file.path), file.path.startsWith('pages/') ? M03.pageMax.value * 1024 : M03.sealedPayloadMax.value * 1024 * 1024);
    requirePublish(bytes.length === file.size_bytes && bytesHash(bytes) === file.sha256, 'FILE_CHANGED'); files.set(file.path, bytes);
  }
  return files;
}
export function writeExclusive(path: string, bytes: Uint8Array): void {
  requirePublish(isAbsolute(path), 'ABSOLUTE_PATH_REQUIRED');
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
/** No activation pointer exists. A crash leaves an inert, incomplete directory
 * which cannot be reused; a new empty staging directory is required. */
export function stageBundle(input: BundleInput, staging: string): BundleInput {
  const snapshot = validateInput(input); const directory = realDirectory(staging);
  requirePublish(readdirSync(directory).length === 0, 'STAGING_NOT_EMPTY');
  mkdirSync(join(directory, 'pages'), { mode: 0o700 });
  for (const [path, bytes] of snapshot.files) writeExclusive(join(directory, path), bytes);
  for (const path of [join(directory, 'pages'), directory]) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  const files = readInventory(directory, snapshot.manifest.files);
  requirePublish(payloadHash(snapshot.manifest.files) === payloadHash(input.manifest.files), 'INPUT_CHANGED');
  return validateInput({ manifest: snapshot.manifest, files });
}
