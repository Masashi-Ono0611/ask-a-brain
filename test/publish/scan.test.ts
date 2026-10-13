import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bytesHash, payloadHash } from '../../src/wire/index.ts';
import { createBundleScanner, createGitleaksEngine, regularBytes } from '../../src/publish/index.ts';
import { clock, fakeEngine, fixture, h, temporary } from './helpers.ts';
for (const mode of ['always-clean', 'error', 'skip-end', 'skip-start', 'wrong-line', 'missing-built-in', 'throws']) test(`scanner simulator ${mode} fails closed; restored simulator passes`, () => {
  const input = fixture(); const engine = fakeEngine((bytes, result) => {
    if (mode === 'always-clean') return { status: 0, findings: [] };
    if (mode === 'error') return { status: 2, findings: [] };
    if (mode === 'throws') throw new Error('synthetic scanner failure');
    if (mode === 'missing-built-in' && Buffer.from(bytes).toString().includes('api_key =')) return { status: 17, findings: [{ rule: 'custom-only', line: 1 }] };
    if (mode === 'skip-end') return { ...result, findings: result.findings.filter((f) => f.rule !== 'aab-coverage-end') };
    if (mode === 'skip-start') return { ...result, findings: result.findings.filter((f) => f.rule !== 'aab-coverage-start') };
    if (mode === 'wrong-line') return { ...result, findings: result.findings.map((f) => ({ ...f, line: 999 })) };
    return result;
  });
  assert.throws(() => createBundleScanner(engine, clock()).scan(input.files, input.manifest.files));
  assert.equal(createBundleScanner(fakeEngine(), clock()).scan(input.files, input.manifest.files).bundle_sha256, payloadHash(input.manifest.files));
});
test('scanner compares every byte and rejects independent markers, including candidate ignores', () => {
  const input = fixture(); const scanner = createBundleScanner(fakeEngine(), clock());
  assert.throws(() => scanner.scan(new Map(input.files).set('extra', Buffer.from('extra')), input.manifest.files), /SCAN_INVENTORY/);
  assert.throws(() => scanner.scan(new Map(input.files).set('pages/p1.md', Buffer.from('changed')), input.manifest.files), /SCAN_INVENTORY/);
  const files = new Map([['pages/p1.md', Buffer.from('社外秘 # gitleaks:allow')]]);
  assert.throws(() => scanner.scan(files, [...files].map(([path, b]) => ({ path, size_bytes: b.length, sha256: bytesHash(b) }))), /BUSINESS_MARKER/);
  assert.equal(scanner.scan(input.files, input.manifest.files).passed, true);
});
test('real subprocess adapter: missing/mismatched pins and bad reports block; local protocol stand-in passes', (t) => {
  const dir = temporary(t); const executable = join(dir, 'fake-scanner'); const config = realpathSync(resolve('config/scanner/gitleaks.toml'));
  // Tests adapter plumbing only, not Gitleaks rules. No downloaded executable.
  const source = `#!${process.execPath}\nconst fs=require('node:fs'); if(process.argv[2]==='version'){console.log('0.0.0');}else{ const input=fs.readFileSync(0,'utf8');const report=process.argv[process.argv.indexOf('--report-path')+1]; const findings=[];input.split('\\n').forEach((line,i)=>{ if(line.includes('api_key ='))findings.push({RuleID:'generic-api-key',StartLine:i+1});if(line.startsWith('AAB_SCAN_START_'))findings.push({RuleID:'aab-coverage-start',StartLine:i+1});if(line.startsWith('AAB_SCAN_END_'))findings.push({RuleID:'aab-coverage-end',StartLine:i+1}); });fs.writeFileSync(report,JSON.stringify(findings));process.exitCode=findings.length?17:0; }\n`;
  writeFileSync(executable, source, { mode: 0o700 });
  const pins = { executable, executableSha256: h(source), config, configSha256: bytesHash(regularBytes(config, Number.MAX_SAFE_INTEGER)), version: '0.0.0' };
  assert.throws(() => createGitleaksEngine({ ...pins, executable: join(dir, 'missing') }));
  assert.throws(() => createGitleaksEngine({ ...pins, executableSha256: h('wrong') }), /PIN_MISMATCH/);
  assert.throws(() => createGitleaksEngine({ ...pins, configSha256: h('wrong') }), /PIN_MISMATCH/);
  const input = fixture(); const clean = () => createBundleScanner(createGitleaksEngine(pins), clock()).scan(input.files, input.manifest.files);
  assert.equal(clean().passed, true);
  assert.throws(() => createGitleaksEngine({ ...pins, version: '9.9.9' }).scan(Buffer.from('clean')), /VERSION/);
  for (const body of ["process.kill(process.pid, 'SIGTERM')", "process.stdout.write('x'.repeat(2 * 1024 * 1024))", "require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--report-path')+1],JSON.stringify([{RuleID:'custom',StartLine:1,unknown:true}]));process.exitCode=17", "process.exit(2)", "console.error('skipped bytes');process.exit(0)", "process.exit(0)", "require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--report-path')+1], '{}')"]) {
    const broken = `#!${process.execPath}\nif(process.argv[2]==='version')console.log('0.0.0');else{${body}}\n`;
    writeFileSync(executable, broken); const engine = createGitleaksEngine({ ...pins, executableSha256: h(broken) });
    assert.throws(() => engine.scan(Buffer.from('clean'))); writeFileSync(executable, source); assert.equal(clean().passed, true);
  }
  chmodSync(executable, 0o600); assert.throws(clean, /UNAVAILABLE/); chmodSync(executable, 0o700); assert.equal(clean().passed, true);
});
