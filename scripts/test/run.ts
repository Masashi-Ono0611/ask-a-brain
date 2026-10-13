import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
function discover(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? discover(join(path, entry.name)) : entry.isFile() && entry.name.endsWith('.test.ts') ? [join(path, entry.name)] : []);
}
// Bare `node --test` discovers this directory too. Never recursively launch
// from a test child; npm test is the authoritative explicit-file invocation.
if (process.env.NODE_TEST_CONTEXT === undefined) {
  const files = discover(join(root, 'test')).sort();
  if (files.length === 0) throw new Error('NO_TESTS_FOUND');
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
