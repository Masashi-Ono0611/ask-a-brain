import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Clock, Manifest, ScanAttestation, Sha256 } from '../wire/contracts.ts';
import { M03, bytesHash, payloadHash, strictJson } from '../wire/index.ts';
import { regularBytes } from './inventory.ts';
import { guardText, hash, record, requirePublish } from './validation.ts';

/** Lead-provisioned protected configuration. No fallback to PATH, auto-download,
 * candidate rule/ignore files, inherited environment or invented checksum. */
export interface ScannerPins { readonly executable: string; readonly executableSha256: Sha256; readonly version: string; readonly config: string; readonly configSha256: Sha256 }
export interface ScanResult { readonly status: number; readonly findings: readonly { readonly rule: string; readonly line: number }[] }
export interface ScannerEngine { readonly version: string; readonly sha256: Sha256; scan(bytes: Uint8Array): ScanResult }
export interface BundleScanner { scan(files: ReadonlyMap<string, Uint8Array>, inventory: Manifest['files']): ScanAttestation }
export function createGitleaksEngine(pins: ScannerPins): ScannerEngine {
  record(pins, ['executable', 'executableSha256', 'version', 'config', 'configSha256']);
  const pin = structuredClone(pins);
  hash(pin.executableSha256); hash(pin.configSha256);
  requirePublish(/^\d+\.\d+\.\d+$/.test(pin.version) && isAbsolute(pin.executable) && isAbsolute(pin.config), 'SCANNER_PIN_REQUIRED');
  function verifyPins(): void {
    requirePublish(realpathSync(pin.executable) === pin.executable && realpathSync(pin.config) === pin.config, 'SCANNER_LINK');
    // Binary size is not a content cap. stat/read without an arbitrary product limit.
    requirePublish(bytesHash(regularBytes(pin.executable, Number.MAX_SAFE_INTEGER)) === pin.executableSha256 && bytesHash(regularBytes(pin.config, M03.sealedPayloadMax.value * 1024 * 1024)) === pin.configSha256, 'SCANNER_PIN_MISMATCH');
  }
  verifyPins();
  function execute(args: string[], cwd: string, input?: Uint8Array) {
    verifyPins();
    const result = spawnSync(pin.executable, args, { cwd, env: { LANG: 'C', LC_ALL: 'C' }, ...(input === undefined ? {} : { input }), encoding: 'utf8', timeout: M03.precheckMax.value * 1000, maxBuffer: M03.sealedPayloadMax.value * 1024 * 1024 });
    requirePublish(!result.error && result.signal === null && result.status !== null, 'SCANNER_UNAVAILABLE'); verifyPins(); return result;
  }
  return { version: pin.version, sha256: pin.executableSha256, scan(bytes) {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'aab-scan-'));
    try {
      const version = execute(['version'], dir);
      requirePublish(version.status === 0 && version.stdout.trim().replace(/^v/, '') === pin.version, 'SCANNER_VERSION_MISMATCH');
      const report = join(dir, 'report.json');
      const result = execute(['stdin', '--config', pin.config, '--ignore-gitleaks-allow', '--gitleaks-ignore-path', '/dev/null', '--redact=100', '--report-format', 'json', '--report-path', report, '--exit-code', '17', '--no-banner'], dir, bytes);
      requirePublish(result.status === 0 || result.status === 17, 'SCANNER_ERROR');
      // Missing/malformed report, skip warnings or partial input is never a pass.
      requirePublish(!/skip|error|fatal|warn|truncat/i.test(result.stderr), 'SCANNER_SKIPPED_BYTES');
      const value = strictJson(regularBytes(report, M03.sealedPayloadMax.value * 1024 * 1024));
      requirePublish(Array.isArray(value), 'SCANNER_REPORT');
      const findings = value.map((v) => {
        requirePublish(v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.RuleID === 'string' && Number.isSafeInteger(v.StartLine) && Number(v.StartLine) > 0, 'SCANNER_REPORT');
        const known = ['RuleID', 'Description', 'StartLine', 'EndLine', 'StartColumn', 'EndColumn', 'Match', 'Secret', 'File', 'SymlinkFile', 'Commit', 'Entropy', 'Author', 'Email', 'Date', 'Message', 'Tags', 'Fingerprint'];
        requirePublish(Object.keys(v).every((key) => known.includes(key)), 'SCANNER_REPORT_FIELDS');
        return { rule: v.RuleID, line: Number(v.StartLine) };
      });
      requirePublish((result.status === 0) === (findings.length === 0), 'SCANNER_REPORT_STATUS');
      return { status: result.status!, findings };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } };
}
function checkResult(result: ScanResult, clean: boolean): void {
  requirePublish(result.status === (clean ? 0 : 17) && (clean ? result.findings.length === 0 : result.findings.length > 0), 'SCANNER_CONTROL_FAILED');
}
export function createBundleScanner(engine: ScannerEngine, clock: Clock): BundleScanner {
  hash(engine.sha256); requirePublish(engine.version.length > 0, 'SCANNER_PIN_REQUIRED');
  function controls(): void {
    checkResult(engine.scan(Buffer.from('A harmless synthetic lesson.\n')), true);
    // Synthetic generic-api-key trigger, assembled in memory, never usable auth.
    const fake = ['Ab7kQ9mZ', '2rT4vX6n', 'P8sW3yH5', 'cL0dF1jG'].join('');
    const builtIn = engine.scan(Buffer.from(`api_key = "${fake}"\n`)); checkResult(builtIn, false);
    requirePublish(builtIn.findings.some((f) => f.rule === 'generic-api-key'), 'SCANNER_BUILTIN_NOT_DETECTED');
    checkResult(engine.scan(Buffer.from('A harmless synthetic lesson.\n')), true);
    let blocked = false; try { guardText(Buffer.from(['AAB', 'BUSINESS', 'CANARY'].join('_'))); } catch { blocked = true; }
    requirePublish(blocked, 'BUSINESS_CONTROL_FAILED'); guardText(Buffer.from('A harmless synthetic lesson.\n'));
  }
  return { scan(files, inventory) {
    controls(); requirePublish(files.size === inventory.length, 'SCAN_INVENTORY');
    const seen = new Set<string>();
    for (const file of inventory) {
      const bytes = files.get(file.path);
      requirePublish(!seen.has(file.path) && bytes && bytes.length === file.size_bytes && bytesHash(bytes) === file.sha256, 'SCAN_INVENTORY'); seen.add(file.path);
      guardText(bytes, file.path.startsWith('pages/'));
      checkResult(engine.scan(Uint8Array.from(bytes)), true);
      // Same exact bytes bracketed with sentinels. Both exact boundary lines must
      // be inspected; a binary/size/ignore skip cannot masquerade as zero findings.
      const start = `AAB_SCAN_START_${file.sha256}\n`;
      const challenge = Buffer.concat([Buffer.from(start), bytes, Buffer.from(`\nAAB_SCAN_END_${file.sha256}\n`)]);
      const challenged = engine.scan(challenge); checkResult(challenged, false);
      const endLine = new TextDecoder().decode(bytes).split('\n').length + 2;
      requirePublish(challenged.findings.some((f) => f.rule === 'aab-coverage-start' && f.line === 1) && challenged.findings.some((f) => f.rule === 'aab-coverage-end' && f.line === endLine), 'SCANNER_SKIPPED_BYTES');
      checkResult(engine.scan(Uint8Array.from(bytes)), true);
    }
    return { bundle_sha256: payloadHash(inventory), scanner_version: engine.version, scanner_sha256: engine.sha256, scanned_at: clock.now(), passed: true };
  } };
}
