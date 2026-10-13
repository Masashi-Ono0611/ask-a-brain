import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PIN_DOCUMENT');
  return value as RecordValue;
}
function json(path: string): RecordValue { return object(JSON.parse(readFileSync(path, 'utf8'))); }
function same(left: unknown, right: unknown, label: string): void { if (!isDeepStrictEqual(left, right)) throw new Error(`TOOLCHAIN_MISMATCH: ${label}`); }
export interface ToolVersions { readonly node: string; readonly npm: string }
/** root/versions injection supports isolated positive controls without editing installs. */
export function assertToolchain(root: string, versions: ToolVersions): { readonly directPackages: number; readonly installedPackages: number } {
  const tooling = json(join(root, 'config/tooling-pins.json'));
  same(versions.node, tooling.node, 'Node'); same(versions.npm, tooling.npm, 'npm');
  const pins = json(join(root, 'config/dependencies/pins.json'));
  const manifest = json(join(root, 'package.json'));
  const lock = json(join(root, 'package-lock.json'));
  same(lock.lockfileVersion, 3, 'lockfile format');
  const packages = object(lock.packages); const lockedRoot = object(packages['']);
  for (const field of ['dependencies', 'devDependencies']) {
    same(manifest[field], pins[field], `${field} manifest pins`);
    same(lockedRoot[field], pins[field], `${field} lock pins`);
  }
  same(manifest.type, 'module', 'ESM');
  const direct = { ...object(pins.dependencies), ...object(pins.devDependencies) };
  same(direct.typescript, tooling.typescript, 'TypeScript pin');
  for (const [name, version] of Object.entries(direct)) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('NONEXACT_DEPENDENCY_PIN');
    same(json(join(root, 'node_modules', name, 'package.json')).version, version, `direct package ${name}`);
  }
  // Hoisted transitives are also physical top-level directories. Check against
  // the complete reviewed lock instead of mistaking them for extra direct deps.
  const installed = new Set<string>();
  function inspectPackage(path: string): void {
    const key = relative(root, path).split('\\').join('/');
    const locked = object(packages[key]); const actual = json(join(path, 'package.json'));
    same(actual.version, locked.version, `installed ${key}`);
    same(actual.name, key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length), `package name ${key}`);
    const scripts = actual.scripts === undefined ? {} : object(actual.scripts);
    if (['preinstall', 'install', 'postinstall'].some((event) => Object.hasOwn(scripts, event))) throw new Error(`INSTALL_SCRIPT_FORBIDDEN: ${key}`);
    installed.add(key);
    const nested = join(path, 'node_modules'); if (existsSync(nested)) inspectDirectory(nested);
  }
  function inspectDirectory(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('UNEXPECTED_NODE_MODULES_ENTRY');
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(path, { withFileTypes: true })) {
          if (!scoped.isDirectory() || scoped.isSymbolicLink()) throw new Error('UNEXPECTED_SCOPED_ENTRY');
          inspectPackage(join(path, scoped.name));
        }
      } else inspectPackage(path);
    }
  }
  inspectDirectory(join(root, 'node_modules'));
  const expected = Object.keys(packages).filter((path) => path !== '');
  same([...installed].sort(), expected.sort(), 'installed package inventory');
  return { directPackages: Object.keys(direct).length, installedPackages: installed.size };
}
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const npm = spawnSync('npm', ['--version'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    if (npm.error || npm.status !== 0) throw new Error('NPM_VERSION_UNAVAILABLE');
    const result = assertToolchain(root, { node: process.versions.node, npm: npm.stdout.trim() });
    console.log(`toolchain PASS: Node ${process.versions.node}; npm ${npm.stdout.trim()}; ${result.directPackages} direct pins; ${result.installedPackages} locked installed packages`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'TOOLCHAIN_ASSERT_FAILED'); process.exitCode = 1;
  }
}
