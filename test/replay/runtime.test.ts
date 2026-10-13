import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileJournal, planRuns, collectAttempts } from '../../src/eval/index.ts';
import { loadStudy, source } from '../../scripts/eval/synthetic.ts';
import type { IsoTime } from '../../src/wire/contracts.ts';
import { readPin } from '../../scripts/replay/config.ts';
import type { Candidate, Documentation } from '../../scripts/replay/config.ts';
import { runAttempt } from '../../scripts/replay/run-attempt.ts';
import type { DryRuntime } from '../../scripts/replay/run-attempt.ts';
import { M03 } from '../../src/wire/index.ts';
function documented(candidate: Candidate): Documentation { return { version: 'codex-cli 0.160.0', exec_help: candidate.flags.join(' '),
  assignments: candidate.assignments.map((assignment) => ({ assignment, excerpt: `TEST DOCUMENTATION: ${assignment}` })),
  disabled_surfaces: ['builtins', 'features', 'plugins', 'skills', 'hooks', 'rules', 'project_config'], provenance: 'test_fixture' }; }
function setup(t: { after(fn: () => void): void }, mode = 'clean') {
  const directory = mkdtempSync(join(tmpdir(), 'aab-replay-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const spec = { ...planRuns(loadStudy(), '2026-10-09T00:00:00.000Z' as IsoTime)[0]!, model: readPin().requested_model };
  writeFileSync(join(directory, 'settings.json'), JSON.stringify({ mode, spec }));
  const journalPath = join(directory, 'attempts.jsonl'), journal = new FileJournal(journalPath); t.after(() => journal.close());
  const dry: DryRuntime = { docker: { executable: process.execPath, prefix: [fileURLToPath(new URL('./fake-docker.ts', import.meta.url)), directory] },
    codex: { executable: process.execPath, prefix: [fileURLToPath(new URL('./stub-codex.ts', import.meta.url)), directory] },
    env: { PATH: '/usr/bin:/bin', HOME: directory }, documentation: documented,
    bridgeEvents: () => {
      const path = join(directory, 'attempt', 'bridge.jsonl'); if (!existsSync(path)) return [];
      const bridge = new FileJournal(path); try { return bridge.read(); } finally { bridge.close(); }
    } };
  const options = { spec, source, journal, directory: join(directory, 'attempt'), image: `synthetic/node@sha256:${'b'.repeat(64)}` };
  return { directory, spec, journal, journalPath, dry, options };
}
function inferred(directory: string): boolean { return existsSync(join(directory, 'inference.log')); }
test('clean subprocess replay journals four real MCP actions and grades PASS; reopen preserves attempt', async (t) => {
  const s = setup(t); const result = await runAttempt(s.options, s.dry);
  assert.equal(result.attempt.reason_code, 'COMPLETED'); assert.equal(result.grade.verdict, 'pass'); assert.equal(result.attempt.calls, 4);
  assert.equal(result.attempt.tokens, 3); assert.equal(result.attempt.observation?.finished, true); assert.equal(inferred(s.directory), true);
  assert.equal(result.runtime.cleanup, 'removed_own_role_and_volume'); assert.equal(result.runtime.exit?.code, 0);
  assert.equal(result.attempt.compliant_primary, false); assert.equal(result.attempt.historical_n, 0);
  s.journal.close(); const reopened = new FileJournal(s.journalPath); t.after(() => reopened.close());
  assert.equal(collectAttempts([s.spec], reopened).length, 1);
  assert.equal(collectAttempts([s.spec], reopened)[0]!.status, 'completed');
  await assert.rejects(runAttempt({ ...s.options, journal: reopened }, s.dry), /ATTEMPT_EXISTS/);
});
for (const mode of ['absent', 'broken', 'network', 'host_home', 'gateway_absent']) {
  test(`${mode} aborts BEFORE inference, counts failed attempt, then fresh clean counterpart passes`, async (t) => {
    const bad = setup(t, mode); const result = await runAttempt(bad.options, bad.dry);
    assert.equal(result.attempt.status, 'failed'); assert.equal(inferred(bad.directory), false);
    assert.equal(bad.journal.read().filter((e) => e.kind === 'start').length, 1);
    assert.equal(bad.journal.read().filter((e) => e.kind === 'result').length, 1);
    assert.equal(collectAttempts([bad.spec], bad.journal)[0]!.status, 'failed');
    const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).grade.verdict, 'pass');
  });
}
test('unknown config key blocks inference, restored documented config admits clean control', async (t) => {
  const s = setup(t);
  s.dry.documentation = (candidate) => ({ ...documented(candidate), assignments: documented(candidate).assignments.slice(1) });
  const result = await runAttempt(s.options, s.dry);
  assert.equal(result.attempt.reason_code, 'CONFIG_BLOCKED'); assert.equal(inferred(s.directory), false);
  assert.ok(result.runtime.blocked.includes('UNKNOWN_CONFIG_KEY_OR_VALUE:model'));
  assert.equal(existsSync(join(s.options.directory, 'config', 'config.toml')), false);
  const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).grade.verdict, 'pass');
});
test('watchdog receives M03 deadline and SIGKILLs only hung Codex; journal/cleanup survive', async (t) => {
  const s = setup(t, 'hang'); let milliseconds = 0;
  s.dry.deadline = (kill, ms) => { milliseconds = ms; const timer = setTimeout(kill, 1500); return () => clearTimeout(timer); };
  const result = await runAttempt(s.options, s.dry);
  assert.equal(milliseconds, M03.replayWallTimeMax.value * 60_000); assert.equal(inferred(s.directory), true);
  assert.equal(result.attempt.reason_code, 'WALL_BUDGET'); assert.equal(result.runtime.exit?.signal, 'SIGKILL');
  assert.equal(result.runtime.cleanup, 'removed_own_role_and_volume');
  const operations = readFileSync(join(s.directory, 'docker.log'), 'utf8'); assert.match(operations, /"rm","-f"/);
  const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).runtime.exit?.code, 0);
});
for (const [mode, reason] of [['invalid_usage', 'CLI_EVENT_INVALID'], ['overbudget', 'TOKEN_BUDGET'], ['noop', 'NO_COMPLETION'], ['exit', 'CODEX_EXIT_FAILED']] as const) {
  test(`${mode} cannot pass; clean action counterpart passes`, async (t) => {
    const s = setup(t, mode); const result = await runAttempt(s.options, s.dry);
    assert.equal(result.attempt.reason_code, reason); assert.notEqual(result.grade.verdict, 'pass');
    const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).grade.verdict, 'pass');
  });
}
test('live mode records BLOCKED without ever spawning Docker or Codex', async (t) => {
  const s = setup(t); const result = await runAttempt(s.options);
  assert.equal(result.attempt.reason_code, 'LIVE_PREFLIGHT_BLOCKED'); assert.equal(result.runtime.mode, 'blocked_live');
  assert.equal(existsSync(join(s.directory, 'docker.log')), false); assert.equal(inferred(s.directory), false);
  assert.ok(result.runtime.blocked.includes('ISOLATED_GATEWAY_TRANSPORT_UNAVAILABLE'));
  assert.equal(collectAttempts([s.spec], s.journal)[0]!.status, 'failed');
});
test('changed frozen fixture aborts and is counted; restored clean source succeeds', async (t) => {
  const s = setup(t); const result = await runAttempt({ ...s.options, source: { ...source, fixture: () => Buffer.from('{}') } }, s.dry);
  assert.equal(result.attempt.reason_code, 'FROZEN_ARTIFACT_CHANGED'); assert.equal(inferred(s.directory), false);
  const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).grade.verdict, 'pass');
});

test('inventory probe uses fixed trivial prompt and never upgrades MCP evidence to complete inventory', async (t) => {
  const { captureInventory } = await import('../../scripts/replay/capture-inventory.ts');
  const s = setup(t, 'noop'); const report = await captureInventory(s.options, Buffer.from('--json --debug'), s.dry);
  assert.equal(report.inference_started, true); assert.equal(report.complete, false); assert.equal(report.tools, null);
  assert.equal(readFileSync(join(s.directory, 'prompt.txt'), 'utf8'), 'Reply with OK. Do not call any tools.\n');
  assert.equal(s.journal.read().filter((e) => e.kind === 'start').length, 1);
});
test('interrupted start is counted UNKNOWN and cannot be restarted; new clean attempt still passes', async (t) => {
  const s = setup(t); s.journal.append({ kind: 'start', run_id: s.spec.run_id, data: { spec: s.spec } });
  assert.equal(collectAttempts([s.spec], s.journal)[0]!.reason_code, 'INTERRUPTED_UNKNOWN');
  await assert.rejects(runAttempt(s.options, s.dry), /ATTEMPT_EXISTS/); assert.equal(inferred(s.directory), false);
  const clean = setup(t); assert.equal((await runAttempt(clean.options, clean.dry)).grade.verdict, 'pass');
});
test('operator CLI records blocked attempt; duplicate/unknown operator JSON cannot launch', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { parseRequest } = await import('../../scripts/replay/request.ts');
  const s = setup(t); const request = { spec: s.spec, directory: s.options.directory, journal: s.journalPath, image: s.options.image,
    fixture: fileURLToPath(new URL('../../fixtures/eval/synthetic/s1.json', import.meta.url)),
    rubric: fileURLToPath(new URL('../../fixtures/eval/synthetic/s1.rubric.json', import.meta.url)),
    corpus: fileURLToPath(new URL('../../fixtures/eval/synthetic/corpus.json', import.meta.url)) };
  assert.equal(parseRequest(Buffer.from(JSON.stringify(request))).spec.run_id, s.spec.run_id);
  assert.throws(() => parseRequest(Buffer.from(JSON.stringify({ ...request, shell: 'true' }))));
  assert.throws(() => parseRequest(Buffer.from('{"spec":{},"spec":{}}')));
  assert.throws(() => parseRequest(Buffer.from([0xff])));
  const path = join(s.directory, 'request.json'); writeFileSync(path, JSON.stringify(request));
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/replay/run-attempt.ts', import.meta.url)), path], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: s.directory } });
  assert.equal(child.status, 2, child.stderr); assert.match(child.stdout, /LIVE_PREFLIGHT_BLOCKED/);
  assert.equal(s.journal.read().filter((e) => e.kind === 'result').length, 1); assert.equal(inferred(s.directory), false);
});
