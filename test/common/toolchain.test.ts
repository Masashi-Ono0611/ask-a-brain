import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertToolchain } from '../../scripts/assert-toolchain.ts';
test('toolchain positive control detects a mismatched installed version and restores fixture', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aab-toolchain-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, value: unknown): void => { writeFileSync(join(root, path), JSON.stringify(value)); };
  mkdirSync(join(root, 'config/dependencies'), { recursive: true }); mkdirSync(join(root, 'node_modules/typescript'), { recursive: true });
  const pins = { dependencies: {}, devDependencies: { typescript: '5.9.3' } };
  write('config/tooling-pins.json', { node: '24.13.0', npm: '11.6.2', typescript: '5.9.3' });
  write('config/dependencies/pins.json', pins); write('package.json', { type: 'module', ...pins });
  write('package-lock.json', { lockfileVersion: 3, packages: { '': pins, 'node_modules/typescript': { version: '5.9.3' } } });
  const packagePath = 'node_modules/typescript/package.json'; write(packagePath, { name: 'typescript', version: '5.9.3' });
  const versions = { node: '24.13.0', npm: '11.6.2' };
  assert.deepEqual(assertToolchain(root, versions), { directPackages: 1, installedPackages: 1 });
  const original = readFileSync(join(root, packagePath), 'utf8');
  try {
    write(packagePath, { name: 'typescript', version: '0.0.0' });
    assert.throws(() => assertToolchain(root, versions), /TOOLCHAIN_MISMATCH/);
  } finally { writeFileSync(join(root, packagePath), original); }
  assert.equal(assertToolchain(root, versions).installedPackages, 1);
  assert.throws(() => assertToolchain(root, { ...versions, node: '24.0.0' }), /Node/);
  assert.throws(() => assertToolchain(root, { ...versions, npm: '11.0.0' }), /npm/);
  mkdirSync(join(root, 'node_modules/extra')); write('node_modules/extra/package.json', { name: 'extra', version: '1.0.0' });
  assert.throws(() => assertToolchain(root, versions)); rmSync(join(root, 'node_modules/extra'), { recursive: true });
  write(packagePath, { name: 'typescript', version: '5.9.3', scripts: { install: 'ignored-fixture' } });
  assert.throws(() => assertToolchain(root, versions), /INSTALL_SCRIPT_FORBIDDEN/);
  writeFileSync(join(root, packagePath), original);
  assert.equal(assertToolchain(root, versions).directPackages, 1);
});
