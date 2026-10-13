import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalBytes, bytesHash, M03 } from '../../src/wire/index.ts';
import type { Id } from '../../src/wire/contracts.ts';
import { captureMock } from '../../scripts/replay/capture-inventory-mock.ts';
import { extractInventory, verifyInventory } from '../../scripts/replay/host-inventory.ts';
import { hostArgs } from '../../scripts/replay/host-config.ts';
import { hostMcpCommand } from '../../scripts/replay/mcp-host.ts';
import { createSupervisor, gradeHost, observationFromJournal, CodedDenial, PROCEDURAL_DENIAL_CODES } from '../../scripts/replay/host-supervisor.ts';
import { runHostAttempt, provisionAuth } from '../../scripts/replay/run-host-attempt.ts';
import type { HostResult } from '../../scripts/replay/run-host-attempt.ts';
import { runProcess } from '../../scripts/replay/host-process.ts';
import { executeStudy, stratifiedReport } from '../../scripts/replay/run-study.ts';
import { HostLines } from '../../scripts/replay/host-lines.ts';
import { root, fixture, clock, temp, stub, requestInventory, runtimeRequest } from './host-support.ts';
const pin = { model: 'pinned-test-model', effort: 'high' as const };
const noIpc = async () => ({ close() {} });
for (const arm of ['A', 'B', 'C'] as const) test(`host ${arm}: complete nested inventory accepts clean; extra/missing surface rejects`, () => {
  const clean = extractInventory(requestInventory(arm)); verifyInventory(clean, arm);
  assert.throws(() => verifyInventory(extractInventory(requestInventory(arm, 'exec_command')), arm), /EXTRA_TOOL/);
  assert.throws(() => verifyInventory({ ...clean, top: [...clean.top, 'web.search'] }, arm), /EXTRA_TOOL/);
  assert.throws(() => verifyInventory({ ...clean, nested: [] }, arm), /MISSING_TOOL/);
  assert.throws(() => extractInventory(canonicalBytes({ tools: [], input: [] })), /INCOMPLETE/);
  verifyInventory(extractInventory(requestInventory(arm)), arm);
});
test('host framing and parser reject duplicate fields, invalid UTF8, unknown keys; clean control is admitted', async () => {
  const events: unknown[] = [], f = fixture();
  const controller = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, journal: (e) => events.push(e), exhausted() {} });
  for (const bytes of [Buffer.from('{"tool":"inspect_fixture","tool":"verify_fixture","input":{"fixture_id":"I2"}}'), Buffer.from([0xff]),
    canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2', path: '/secret' } }), canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' }, extra: true }),
    canonicalBytes({ tool: 'consult', input: { question_id: 'Q01' } })]) await assert.rejects(controller.call(bytes));
  const good = await controller.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' } })); assert.ok(good);
  assert.equal(controller.calls(), 6); assert.equal(controller.snapshot().actions.length, 1);
  const lines = new HostLines(3, () => {}); assert.throws(() => lines.push(Buffer.from('1234\n')), /LINE_LIMIT/);
  const clean = new HostLines(3, () => {}); clean.push(Buffer.from('123\n')); clean.end();
});
test('supervisor counts every denied call; call limit fires before effect; clean fresh state restores', async () => {
  let killed = false; const f = fixture();
  const c = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, journal() {}, exhausted() { killed = true; } });
  for (let n = 0; n < M03.replayCallsMax.value; n++) await c.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' } }));
  const before = c.snapshot(); await assert.rejects(c.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' } })), /CALL_LIMIT/);
  assert.equal(killed, true); assert.deepEqual(c.snapshot(), before);
  const clean = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, journal() {}, exhausted() {} });
  assert.equal(clean.calls(), 0); await clean.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' } }));
});
test('procedural denial codes are opaque by default; with error_codes only allowlisted procedural codes surface, journaled; others stay opaque', async () => {
  const f = fixture(); const fix = canonicalBytes({ tool: 'apply_fixture_fix', input: { fixture_id: 'I2', fix_id: 'fix' } });
  // default (primary study): the call fails with the opaque denial and no code is journaled
  const events: any[] = []; const primary = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, journal: (e) => events.push(e), exhausted() {} });
  await assert.rejects(primary.call(fix), (e: Error) => e.message === 'REQUEST_DENIED' && !(e instanceof CodedDenial));
  assert.ok(events.filter((e) => e.phase === 'response').every((e) => e.code === undefined));
  // opt-in secondary variant: the same call surfaces exactly one allowlisted procedural code, and the journal records it
  const events2: any[] = []; const secondary = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, errorCodes: true, journal: (e) => events2.push(e), exhausted() {} });
  await assert.rejects(secondary.call(fix), (e: Error) => e instanceof CodedDenial && PROCEDURAL_DENIAL_CODES.includes(e.code));
  assert.ok(events2.some((e) => e.phase === 'response' && PROCEDURAL_DENIAL_CODES.includes(e.code)));
  // non-procedural failures stay opaque even in the variant (unknown tool, malformed input)
  for (const bad of [canonicalBytes({ tool: 'shell', input: {} }), canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2', extra: 1 } })]) {
    await assert.rejects(secondary.call(bad), (e: Error) => e.message === 'REQUEST_DENIED' && !(e instanceof CodedDenial));
  }
  // restored: after inspecting, the same fix call is admitted
  await secondary.call(canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 'I2' } })); await secondary.call(fix);
});
test('recorded action grade passes above observed token allowance; forged trace and unfinished run fail controls', async () => {
  const f = fixture(), events: unknown[] = []; const c = createSupervisor({ ...f, clock, arm: 'A', knowledge: null, journal: (e) => events.push(e), exhausted() {} });
  for (const [tool, input] of [['inspect_fixture', { fixture_id: 'I2' }], ['apply_fixture_fix', { fixture_id: 'I2', fix_id: 'fix' }], ['verify_fixture', { fixture_id: 'I2' }]] as const) await c.call(canonicalBytes({ tool, input }));
  const attempt = () => ({ run_id: f.run, fixture_sha256: bytesHash(f.fixture), rubric_sha256: bytesHash(f.rubric), observation: c.snapshot(), status: 'completed' as const, calls: c.calls(), elapsed_ms: 1, tokens: M03.replayBuyerTokensMax.value + 1 });
  assert.equal((await gradeHost(attempt(), f.fixture, f.rubric)).verdict, 'fail');
  await c.call(canonicalBytes({ tool: 'finish_with_evidence', input: { fixture_id: 'I2', evidence_ids: c.snapshot().actions.map((a) => a.evidence.evidence_id) } }));
  assert.equal((await gradeHost(attempt(), f.fixture, f.rubric)).verdict, 'pass');
  const recorded = await observationFromJournal(events, { ...f, clock, arm: 'A', knowledge: null, journal() {}, exhausted() {} }); assert.deepEqual(recorded, c.snapshot());
  assert.equal((await gradeHost({ ...attempt(), observation: { ...recorded, files: { state: 'forged' } } }, f.fixture, f.rubric)).verdict, 'ungraded');
  assert.equal((await gradeHost(attempt(), f.fixture, f.rubric)).verdict, 'pass');
});
test('strict config stub rejects unknown key before fake endpoint inventory; restored flags capture raw complete request', async (t) => {
  const dir = temp(t), valid = requestInventory('A');
  const endpoint = async () => ({ url: 'http://127.0.0.1:1/v1', requests: [valid, runtimeRequest('A')], close: async () => {} });
  const bad = stub(t, 'process.stderr.write("unknown config key"); process.exit(2);');
  await assert.rejects(captureMock(root, join(dir, 'bad'), 'A', pin, bad, endpoint, noIpc), /STRICT_CONFIG/);
  assert.equal(existsSync(join(dir, 'bad/inventory.json')), false);
  const clean = stub(t, `const a=process.argv; if(!a.includes('--strict-config')||!a.includes('shell_tool')||!a.includes('sleep_tool')||!a.includes('read-only'))process.exit(3); process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"cached_input_tokens":0}}\\n');`);
  const evidence = await captureMock(root, join(dir, 'good'), 'A', pin, clean, endpoint, noIpc);
  assert.equal(evidence.arm, 'A'); assert.deepEqual(readFileSync(join(dir, 'good/request-0.json')), valid);
  const args = hostArgs(root, dir, 'A', '/tmp/test.sock', pin); const unknown = stub(t, `if(process.argv.includes('made_up_key=true'))process.exit(2);`);
  assert.equal((await runProcess(unknown, [...args, '-c', 'made_up_key=true'], {}, dir, '', () => {})).code, 2);
  assert.equal((await runProcess(unknown, args, {}, dir, '', () => {})).code, 0);
});
test('mock inventory extra tool fails closed and retains raw request; clean counterpart succeeds', async (t) => {
  const dir = temp(t), command = stub(t, '');
  const endpoint = (extra?: string, runtime: { extra?: string; omit?: string } = {}) => async () => ({ url: 'http://127.0.0.1:1/v1', requests: [requestInventory('B', extra), runtimeRequest('B', runtime)], close: async () => {} });
  await assert.rejects(captureMock(root, join(dir, 'bad'), 'B', pin, command, endpoint('shell'), noIpc), /EXTRA_TOOL/);
  assert.ok(existsSync(join(dir, 'bad/request-0.json')));
  // runtime ALL_TOOLS enumeration: an extra effectful tool, or a missing arm tool, fails closed; the clean counterpart passes
  await assert.rejects(captureMock(root, join(dir, 'bad-runtime-extra'), 'B', pin, command, endpoint(undefined, { extra: 'exec_command' }), noIpc), /EXTRA_TOOL/);
  await assert.rejects(captureMock(root, join(dir, 'bad-runtime-missing'), 'B', pin, command, endpoint(undefined, { omit: 'mcp__replay__read_checklist' }), noIpc), /MISSING_TOOL/);
  assert.ok(existsSync(join(dir, 'bad-runtime-extra/request-1.json')));
  const evidence = await captureMock(root, join(dir, 'good'), 'B', pin, command, endpoint(), noIpc);
  assert.ok(evidence.runtime_all_tools.includes('mcp__replay__read_checklist')); assert.ok(!evidence.runtime_all_tools.includes('exec_command'));
});
test('wall watchdog kills a hanging stub process; completed counterpart survives; M03 deadline supplied', async (t) => {
  const dir = temp(t); let observed = 0;
  const result = await runProcess(stub(t, 'setInterval(()=>{}, 1000);'), [], {}, dir, '', () => {}, (kill, ms) => {
    observed = ms; const timer = setTimeout(kill, 50); return () => clearTimeout(timer);
  });
  assert.equal(observed, M03.replayWallTimeMax.value * 60_000); assert.equal(result.timeout, true); assert.equal(result.signal, 'SIGKILL');
  const clean = await runProcess(stub(t, ''), [], {}, dir, '', () => {}); assert.equal(clean.code, 0); assert.equal(clean.timeout, false);
});
test('auth only explicit separate path; denied source leaves no copy, throwaway auth passes', (t) => {
  const dir = temp(t), source = join(dir, 'provided'), home = join(dir, 'home'); mkdirSync(source); mkdirSync(home);
  writeFileSync(join(source, 'auth.json'), '{"test":"not-a-secret"}'); writeFileSync(join(source, 'config.toml'), 'unexpected');
  assert.throws(() => provisionAuth('/tmp/.codex', home), /AUTH_REQUIRED/); assert.equal(existsSync(join(home, 'auth.json')), false);
  provisionAuth(source, home); assert.equal(existsSync(join(home, 'config.toml')), false); assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), '{"test":"not-a-secret"}');
});
test('MCP process permission path cannot read a hidden rubric; permitted module readable with identical flags', (t) => {
  const dir = temp(t), hidden = join(dir, 'rubric.json'); writeFileSync(hidden, 'HIDDEN_RESOLUTION');
  const command = hostMcpCommand(root, 'A', join(dir, 'socket'));
  const flags = command.args.slice(0, -3);
  const probe = `const fs=require('node:fs'); try {fs.readFileSync(process.argv[1]); process.stdout.write('READ');} catch(e) {process.stdout.write(e.code);}`;
  const denied = spawnSync(process.execPath, [...flags, '-e', probe, hidden], { encoding: 'utf8' });
  assert.equal(denied.status, 0); assert.equal(denied.stdout, 'ERR_ACCESS_DENIED');
  const clean = spawnSync(process.execPath, [...flags, '-e', probe, join(root, 'src/wire/constants.ts')], { encoding: 'utf8' });
  assert.equal(clean.status, 0); assert.equal(clean.stdout, 'READ');
});
test('attempt keeps failed preflight, timeout and incomplete result; restart is refused', async (t) => {
  const dir = temp(t), source = join(dir, 'auth'); mkdirSync(source); writeFileSync(join(source, 'auth.json'), '{}');
  const options = { ...fixture(), root, directory: join(dir, 'attempt'), arm: 'A' as const, pin, command: stub(t, ''), authDirectory: source, knowledge: null, questionCatalog: [] };
  const failed = await runHostAttempt(options, { capture: async () => { throw new Error('UNKNOWN_CONFIG'); } });
  assert.equal(failed.status, 'incomplete'); assert.equal(failed.verdict, 'ungraded'); assert.ok(existsSync(join(options.directory, 'result.json')));
  await assert.rejects(runHostAttempt(options));
  const capture = async () => ({ arm: 'A' as const, pin, inventories: [], runtime_all_tools: [] as string[], residual_sha256: bytesHash(Buffer.from('residual')) });
  const incomplete = await runHostAttempt({ ...options, directory: join(dir, 'clean'), command: stub(t, 'process.stdout.write(\'{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":2,"cached_input_tokens":0}}\\n\');') }, { capture, listen: noIpc });
  assert.equal(incomplete.tokens, 5); assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.verdict, 'fail');
});
test('18 rotated attempts retained; Record 6 strata and A-C/B-C denominators reconcile including exceptions', async () => {
  const ids = ['I1', 'I2', 'I4', 'I5', 'I6', 'I8'], arms = ['A', 'B', 'C'] as const;
  const rotation = ids.map((fixture_id, i) => ({ fixture_id, order: [...arms.slice(i % 3), ...arms.slice(0, i % 3)] }));
  const order: string[] = []; let writes = 0;
  const results = await executeStudy(rotation, async (fixture_id, arm): Promise<HostResult> => {
    order.push(`${fixture_id}_${arm}`); if (fixture_id === 'I2' && arm === 'B') throw new Error('interrupted');
    return { run: `${fixture_id}_${arm}`, fixture_id, arm, status: 'completed', reason: 'COMPLETED', verdict: arm === 'A' ? 'fail' : 'pass', critical_regression: false,
      elapsed_ms: 10, calls: 4, tokens: 5, token_limit_exceeded: false, payment_mode: arm === 'C' ? 'SIMULATED' : 'none', live_paid: false, residual_sha256: null };
  }, () => { writes++; });
  assert.equal(results.length, 18); assert.equal(writes, 36); assert.deepEqual(order, rotation.flatMap((r) => r.order.map((a) => `${r.fixture_id}_${a}`)));
  const report = stratifiedReport(results); assert.equal(report.label, 'exploratory'); assert.equal(report.live_paid.value, 0);
  for (const summary of report.summaries) for (const pair of summary.pairs) {
    const n = summary.stratum === 'pooled' ? 6 : summary.stratum === 'no resolution overlap' ? 1 : 5;
    assert.equal(Object.values(pair.cells).reduce((sum, c) => sum + c.value!, 0), n);
    assert.ok(Object.values(pair.cells).every((c) => c.overlap.length));
  }
  assert.equal(report.summaries[1]!.arms[1]!.incomplete.value, 1);
  assert.throws(() => stratifiedReport([...results, results[0]!]), /DUPLICATE/);
  assert.equal(stratifiedReport([]).summaries[0]!.arms[0]!.unrun.value, 6);
});
test('successful runner grades supervisor actions, records observed overage, cleans temporary auth; frozen residual change prevents launch', async (t) => {
  const dir = temp(t), auth = join(dir, 'provided'); mkdirSync(auth); writeFileSync(join(auth, 'auth.json'), '{}');
  const options = { ...fixture(), root, directory: join(dir, 'completed'), arm: 'A' as const, pin, command: stub(t,
    `setTimeout(()=>{process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":${M03.replayBuyerTokensMax.value + 1},"output_tokens":1,"cached_input_tokens":0}}\\n');},100);`),
    authDirectory: auth, knowledge: null, questionCatalog: [] };
  const capture = async () => ({ arm: 'A' as const, pin, inventories: [], runtime_all_tools: [] as string[], residual_sha256: bytesHash(Buffer.from('residual')) });
  const listen = async (_path: string, call: (bytes: Buffer) => Promise<unknown>) => {
    const timer = setTimeout(() => { void (async () => {
      const evidence: string[] = [];
      for (const [tool, input] of [['inspect_fixture', { fixture_id: 'I2' }], ['apply_fixture_fix', { fixture_id: 'I2', fix_id: 'fix' }], ['verify_fixture', { fixture_id: 'I2' }]] as const) {
        const result = await call(Buffer.from(canonicalBytes({ tool, input }))) as { evidence_id?: string; evidence?: { evidence_id: string } };
        evidence.push(result.evidence?.evidence_id ?? result.evidence_id!);
      }
      await call(Buffer.from(canonicalBytes({ tool: 'finish_with_evidence', input: { fixture_id: 'I2', evidence_ids: evidence } })));
    })(); }, 10);
    return { close() { clearTimeout(timer); } };
  };
  const result = await runHostAttempt(options, { capture, listen });
  assert.equal(result.status, 'completed'); assert.equal(result.verdict, 'pass'); assert.equal(result.token_limit_exceeded, true); assert.equal(result.calls, 4);
  const events = readFileSync(join(options.directory, 'journal.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const args = events.find((e) => e.phase === 'configuration').args as string[];
  const task = args[args.indexOf('--cd') + 1]!; assert.equal(existsSync(task), false);
  const denied = await runHostAttempt({ ...options, directory: join(dir, 'different'), expectedResidual: 'unexpected' }, { capture, listen });
  assert.equal(denied.reason, 'PREFLIGHT_FAILED'); assert.equal(denied.calls, 0); assert.equal(denied.tokens, null);
});
