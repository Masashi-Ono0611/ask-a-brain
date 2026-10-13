import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pins = JSON.parse(readFileSync(join(root, 'config/tooling-pins.json'), 'utf8')) as { gitleaks: string };
export const scannerConfig = join(root, 'scripts/check/gitleaks.toml');
export function scan(args: string[], cwd = root): number {
  // Redacted, bounded output; never relay scanner findings (may include secrets).
  const result = spawnSync('gitleaks', args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status === null) throw new Error('Gitleaks unavailable or failed; install the verified pinned system tool through the lead. Secret scan fails closed.');
  return result.status;
}
/** Real built-in rule controls run with exactly the production allowlist. */
export function allowlistControls(): void {
  const dir = mkdtempSync(join(tmpdir(), 'aab-allowlist-'));
  try {
    const files = ['fixtures/wire/registry.json', 'fixtures/wire/quote.json'];
    for (const path of files) { mkdirSync(dirname(join(dir, path)), { recursive: true }); copyFileSync(join(root, path), join(dir, path)); }
    const args = ['dir', '.', '--config', scannerConfig, '--ignore-gitleaks-allow', '--gitleaks-ignore-path', '/dev/null', '--redact', '--no-banner', '--exit-code', '17'];
    const expect = (status: number): void => { if (scan(args, dir) !== status) throw new Error('Gitleaks exact allowlist control failed.'); };
    expect(0); // all nine reviewed public matches pass
    const planted = join(dir, 'outside.txt');
    // An exact allowed value is still detected outside the exact two paths.
    const value = JSON.parse(readFileSync(join(root, files[1]!), 'utf8')).payload.token_program as string;
    writeFileSync(planted, JSON.stringify({ token_program: value })); expect(17);
    writeFileSync(planted, 'clean control\n'); expect(0);
    // Synthetic fake secret: generated only under OS temp, never usable credentials.
    const fake = ['Ab7kQ9mZ', '2rT4vX6n', 'P8sW3yH5', 'cL0dF1jG'].join('');
    writeFileSync(planted, JSON.stringify({ api_key: fake })); expect(17);
    writeFileSync(planted, 'clean control\n'); expect(0);
    const allowedFile = join(dir, files[1]!); const clean = readFileSync(allowedFile);
    writeFileSync(allowedFile, JSON.stringify({ api_key: fake })); expect(17);
    writeFileSync(allowedFile, clean); expect(0);
    // Same value in a different field must not be covered by the exact-match rule.
    writeFileSync(allowedFile, JSON.stringify({ api_key: value })); expect(17);
    writeFileSync(allowedFile, clean); expect(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function checkSecrets(): void {
  const version = spawnSync('gitleaks', ['version'], { encoding: 'utf8', timeout: 10_000 });
  if (version.error || version.status !== 0) throw new Error('System gitleaks is absent or unavailable. Secret scan fails closed; lead must provision the verified scanner.');
  if (version.stdout.trim().replace(/^v/, '') !== pins.gitleaks) throw new Error(`Gitleaks version mismatch: expected ${pins.gitleaks}. Secret scan fails closed.`);
  const fixture = mkdtempSync(join(tmpdir(), 'aab-scanner-'));
  try {
    const config = join(fixture, 'rules.toml');
    writeFileSync(config, '[[rules]]\nid = "aab-positive-control"\ndescription = "Inert scanner control"\nregex = "AAB_SCAN_CONTROL_[0-9]{8}"\n');
    const input = join(fixture, 'input.txt');
    writeFileSync(input, ['AAB', 'SCAN', 'CONTROL', '12345678'].join('_'));
    if (scan(['dir', fixture, '--config', config, '--redact', '--no-banner', '--exit-code', '17']) !== 17) throw new Error('Gitleaks positive control was not detected.');
    writeFileSync(input, 'clean control\n');
    if (scan(['dir', fixture, '--config', config, '--redact', '--no-banner', '--exit-code', '17']) !== 0) throw new Error('Gitleaks restored clean control failed.');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
  allowlistControls();
  if (scan(['git', root, '--config', scannerConfig, '--ignore-gitleaks-allow', '--gitleaks-ignore-path', '/dev/null', '--redact', '--no-banner']) !== 0) throw new Error('Gitleaks history scan failed or found a secret; inspect locally with redaction.');
  // Scan tracked and nonignored working files, never descend into .local keys,
  // ignored runtime data, dependency trees or symlinks.
  const inventory = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (inventory.error || inventory.status !== 0) throw new Error('Secret scan file inventory unavailable.');
  const staging = mkdtempSync(join(tmpdir(), 'aab-scan-tree-'));
  try {
    for (const path of new Set(inventory.stdout.split('\0').filter(Boolean))) {
      if (path.split('/').some((part) => ['.local', 'node_modules', '.git', '..'].includes(part)) || path.startsWith('/')) throw new Error('Forbidden tracked path in secret scan inventory.');
      const source = join(root, path);
      let stat;
      try { stat = lstatSync(source); } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; // Deleted tracked file; history is still scanned.
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Nonregular file in secret scan inventory.');
      const destination = join(staging, path); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
    }
    if (scan(['dir', '.', '--config', scannerConfig, '--ignore-gitleaks-allow', '--gitleaks-ignore-path', '/dev/null', '--redact', '--no-banner'], staging) !== 0) throw new Error('Gitleaks working-tree scan failed or found a secret; inspect locally with redaction.');
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.log('secret scan PASS: custom marker and built-in secret bad/clean controls; exact-file/match allowlist controls; git history and working tree');
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkSecrets(); } catch (error) { console.error(error instanceof Error ? error.message : 'SECRET_SCAN_FAILED'); process.exitCode = 1; }
}
