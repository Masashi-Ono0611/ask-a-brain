import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryJournal } from '../../src/eval/index.ts';
import type { Id } from '../../src/wire/contracts.ts';
import { canonicalBytes, M03 } from '../../src/wire/index.ts';
import { candidateConfig, auditConfig, parseDocumentation, writeConfig, codexArgv, readPin } from '../../scripts/replay/config.ts';
import { validateContainer, createArgs, execArgs } from '../../scripts/replay/docker.ts';
import { auditRelay, claimBridge, Lines } from '../../scripts/replay/bridge.ts';
import { usageObserver } from '../../scripts/replay/observations.ts';
import { inventorySupport } from '../../scripts/replay/capture-inventory.ts';
const id = 'a'.repeat(64), token = 'b'.repeat(32), image = `synthetic/node@sha256:${'c'.repeat(64)}`;
const baseline = () => ({ id, image, token, running: true, user: '65532:65532', role: 'buyer_mcp', network: 'none', readonly: true, privileged: false,
  caps: ['ALL'], add_caps: null, security: ['no-new-privileges:true'], pid: '', ipc: 'private', devices: [], ports: {}, restart: 'no',
  memory: M03.workerMemoryMax.value * 1024 ** 3, swap: M03.workerMemoryMax.value * 1024 ** 3, pids: 64, cpus: 1_000_000_000,
  mounts: [{ Type: 'volume', Name: `aab-task-${token}`, Source: '/var/lib/docker/volumes/task/_data', Destination: '/task', Driver: 'local', Mode: 'z', RW: true, Propagation: '' }] });
const verify = (value: unknown) => validateContainer(canonicalBytes(value), { id, token, image });
function temp(t: { after(fn: () => void): void }) { const dir = mkdtempSync(join(tmpdir(), 'aab-guard-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('config generation leaves only inert candidates for undocumented keys; documented test counterpart activates', (t) => {
  const root = temp(t), candidate = candidateConfig('B', '/tmp/aab/bridge-launcher', id);
  const report = writeConfig(join(root, 'blocked'), candidate);
  assert.equal(report.status, 'BLOCKED'); assert.ok(report.blocked.includes('UNKNOWN_CONFIG_KEY_OR_VALUE:skills.enabled'));
  assert.equal(existsSync(join(root, 'blocked', 'config.toml')), false);
  assert.equal(candidate.values['mcp_servers.aab.required'], true); assert.equal(candidate.values.model, readPin().requested_model);
  const docs = { version: 'codex-cli 0.160.0', exec_help: candidate.flags.join(' '), assignments: candidate.assignments.map((assignment) => ({ assignment, excerpt: assignment })),
    disabled_surfaces: ['builtins', 'features', 'plugins', 'skills', 'hooks', 'rules', 'project_config'], provenance: 'test_fixture' };
  const parsed = parseDocumentation(canonicalBytes(docs));
  assert.equal(writeConfig(join(root, 'clean'), candidate, parsed).status, 'DOCUMENTED_ONLY');
  assert.equal(readFileSync(join(root, 'clean', 'config.toml'), 'utf8'), candidate.toml);
  assert.deepEqual(readdirSync(join(root, 'clean')).sort(), ['candidate-config.toml', 'config-report.json', 'config.toml']);
  assert.equal(candidate.rollout_budget.emitted, false); assert.equal(candidate.rollout_budget.status, 'UNVERIFIED');
  assert.ok(codexArgv(candidate, '/tmp/manager').includes('--strict-config'));
  assert.throws(() => writeConfig(join(root, 'clean'), candidate, parsed), /EEXIST/);
  assert.equal(auditConfig(candidate, { ...parsed, disabled_surfaces: [] }).status, 'BLOCKED');
});
test('documentation rejects unknown fields, duplicate keys and invalid UTF-8 with clean counterpart', () => {
  const valid = { version: 'codex-cli 0.160.0', exec_help: '', assignments: [], disabled_surfaces: [], provenance: 'test_fixture' };
  const good = canonicalBytes(valid); assert.equal(parseDocumentation(good).version, valid.version);
  for (const bad of [canonicalBytes({ ...valid, arbitrary: true }), Buffer.from('{"version":"codex-cli 0.160.0","version":"codex-cli 0.160.0"}'), Buffer.from([0xff])]) assert.throws(() => parseDocumentation(bad));
  assert.equal(parseDocumentation(good).version, valid.version);
});
for (const [field, value] of Object.entries({ network: 'host', readonly: false, privileged: true, user: '0', caps: [], add_caps: ['SYS_ADMIN'], security: [],
  pid: 'host', ipc: 'host', devices: [{}], ports: { '80/tcp': [] }, restart: 'always', running: false, role: 'broker', memory: 0, swap: -1, pids: 0, cpus: 0 })) {
  test(`container guard ${field} rejects bad and restored exact isolated counterpart passes`, () => {
    assert.throws(() => verify({ ...baseline(), [field]: value })); assert.equal(verify(baseline()).id, id);
  });
}
test('mounts, role identity, digest, extras and invalid encodings fail closed with clean pair', () => {
  const base = baseline();
  for (const mutated of [
    { ...base, id: 'f'.repeat(64) }, { ...base, token: 'd'.repeat(32) }, { ...base, image: 'node:latest' }, { ...base, extra: true },
    { ...base, mounts: [] }, { ...base, mounts: [...base.mounts, base.mounts[0]] },
    { ...base, mounts: [{ ...base.mounts[0], Type: 'bind', Source: '/home/dummy' }] },
    { ...base, mounts: [{ ...base.mounts[0], Name: 'wrong-volume' }] },
    { ...base, mounts: [{ ...base.mounts[0], Destination: '/home/dummy' }] },
  ]) { assert.throws(() => verify(mutated)); assert.equal(verify(base).id, id); }
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{"id":"a","id":"b"}')]) assert.throws(() => validateContainer(bytes, { id }));
});
test('launcher exposes only bound opaque container and arm; restart cannot reset budget', (t) => {
  const root = temp(t), binding = { id, arm: 'A' as const, lock: join(root, 'once') };
  for (const args of [[id, 'A', '/tmp'], [id, 'A', 'sh'], [id, 'B'], ['--host=tcp://dummy', 'A'], [id, 'https://dummy']]) {
    assert.throws(() => claimBridge(binding, args)); assert.equal(existsSync(binding.lock), false);
  }
  claimBridge(binding, [id, 'A']); assert.equal(existsSync(binding.lock), true);
  assert.throws(() => claimBridge(binding, [id, 'A']), /EEXIST/);
  claimBridge({ ...binding, lock: join(root, 'fresh') }, [id, 'A']);
  assert.throws(() => execArgs('sh', 'A')); assert.throws(() => execArgs(id, 'sh' as 'A'));
  assert.ok(execArgs(id, 'A').includes('/app/scripts/runtime/buyer.ts'));
  assert.throws(() => createArgs('node:latest', token)); assert.throws(() => createArgs(image, '/tmp'));
  assert.ok(createArgs(image, token).includes('--network=none'));
});
test('relay denies arbitrary tools, wrong arm, extra arguments, duplicates and invalid UTF-8 before dispatch', () => {
  const run = 'test_run' as Id;
  const request = (name: string, input: unknown, id = 1) => canonicalBytes({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: input } });
  const clean = () => { const journal = new MemoryJournal(), audit = auditRelay('A', journal, run); audit.request(Buffer.from(request('check_leftovers', { fixture_id: 's1' }))); assert.equal(journal.read().length, 1); };
  for (const bytes of [request('shell', { command: 'true' }), request('consult', {}), request('check_leftovers', { fixture_id: 's1', path: '/home' }),
    Buffer.from('{"jsonrpc":"2.0","id":1,"id":2,"method":"tools/list"}'), Buffer.from([0xff]), canonicalBytes({ jsonrpc: '2.0', method: 'sampling/createMessage' })]) {
    assert.throws(() => auditRelay('A', new MemoryJournal(), run).request(Buffer.from(bytes))); clean();
  }
});
test('call cap counts requests including rejected requests and new clean run restores allowance', () => {
  const journal = new MemoryJournal(), audit = auditRelay('A', journal, 'run' as Id);
  for (let n = 1; n <= M03.replayCallsMax.value; n++) {
    audit.request(Buffer.from(canonicalBytes({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'check_leftovers', arguments: { fixture_id: 's1' } } })));
    audit.response(Buffer.from(canonicalBytes({ jsonrpc: '2.0', id: n, result: {} })));
  }
  const request = Buffer.from(canonicalBytes({ jsonrpc: '2.0', id: M03.replayCallsMax.value + 1, method: 'tools/call', params: { name: 'check_leftovers', arguments: { fixture_id: 's1' } } }));
  assert.throws(() => audit.request(request), /CALL_BUDGET/);
  assert.equal(journal.read().filter((e) => (e.data as { phase: string }).phase === 'requested').length, M03.replayCallsMax.value + 1);
  auditRelay('A', new MemoryJournal(), 'fresh' as Id).request(request);
});
test('line limits/truncation reject bad and clean fragmented UTF-8 passes without replacement', () => {
  const values: Buffer[] = [], max = M03.ingressBodyMax.value * 1024;
  const clean = new Lines(max, (bytes) => values.push(bytes)); const bytes = Buffer.from('日本語\n');
  clean.push(bytes.subarray(0, 1)); clean.push(bytes.subarray(1)); clean.end(); assert.equal(values[0]!.toString(), '日本語');
  const bad = new Lines(max, () => {}); assert.throws(() => bad.push(Buffer.alloc(max + 1)), /LINE_LIMIT/);
  const partial = new Lines(max, () => {}); partial.push(Buffer.from('x')); assert.throws(() => partial.end(), /TRUNCATED_LINE/);
  const restored = new Lines(max, () => {}); restored.push(Buffer.from('x\n')); restored.end();
});
test('usage parsing rejects unknown/duplicate/malformed data and counts cached tokens only once', () => {
  const observer = usageObserver(); const good = { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2, cached_input_tokens: 3 } };
  observer.accept(canonicalBytes(good)); assert.equal(observer.snapshot().tokens, 7);
  for (const bad of [canonicalBytes({ ...good, unknown: true }), canonicalBytes({ ...good, usage: { ...good.usage, cached_input_tokens: 6 } }),
    Buffer.from('{"type":"turn.completed","type":"turn.completed"}'), Buffer.from([0xff])]) assert.throws(() => observer.accept(bad));
  observer.accept(canonicalBytes(good)); assert.equal(observer.snapshot().tokens, 14); assert.equal(observer.snapshot().schema_status, 'UNVERIFIED');
});
test('diagnostic flags, expected MCP tools and model prose never prove complete inventory', () => {
  for (const text of ['--json', '--debug --trace', 'tools/list', 'I have only five tools', '{"complete":true,"tools":[]}']) {
    const report = inventorySupport(Buffer.from(text)); assert.equal(report.complete, false); assert.equal(report.status, 'UNVERIFIED');
  }
  assert.deepEqual(inventorySupport(Buffer.from('--debug --trace')).diagnostic_flag_mentions, ['--debug', '--trace']);
  assert.throws(() => inventorySupport(Buffer.from([0xff]))); assert.equal(inventorySupport(Buffer.from('--json')).complete, false);
});

test('public input file denies final symlink and directory, restores regular file through OS temp alias', async (t) => {
  const { writeFileSync, symlinkSync } = await import('node:fs');
  const { readPublicFile } = await import('../../scripts/replay/request.ts');
  const root = temp(t), file = join(root, 'public.json'), linked = join(root, 'linked.json');
  writeFileSync(file, '{}'); symlinkSync(file, linked);
  assert.throws(() => readPublicFile(linked)); assert.throws(() => readPublicFile(root));
  assert.equal(readPublicFile(file).toString(), '{}');
});
test('config target and version guards reject substitutions; exact counterpart remains accepted', () => {
  for (const [arm, launcher, container] of [['D', '/tmp/bridge', id], ['A', 'sh', id], ['A', '/tmp/bridge;sh', id], ['A', '/tmp/bridge', 'short']])
    assert.throws(() => candidateConfig(arm as 'A', launcher!, container!));
  assert.equal(candidateConfig('A', '/tmp/bridge', id).arm, 'A');
  const docs = { version: 'codex-cli 0.159.0', exec_help: '', assignments: [], disabled_surfaces: [], provenance: 'test_fixture' };
  assert.throws(() => parseDocumentation(canonicalBytes(docs)));
  assert.equal(parseDocumentation(canonicalBytes({ ...docs, version: 'codex-cli 0.160.0' })).version, 'codex-cli 0.160.0');
});
test('usage accepts the two measured Codex 0.160.0 extra counters and still refuses other unknown, negative or fractional fields', () => {
  const measured = { type: 'turn.completed', usage: { cache_write_input_tokens: 0, cached_input_tokens: 104832, input_tokens: 129640, output_tokens: 340, reasoning_output_tokens: 0 } };
  const observer = usageObserver(); observer.accept(canonicalBytes(measured)); assert.equal(observer.snapshot().tokens, 129980);
  for (const usage of [{ ...measured.usage, surprise: 1 }, { ...measured.usage, reasoning_output_tokens: -1 }, { ...measured.usage, cache_write_input_tokens: 1.5 }]) {
    assert.throws(() => usageObserver().accept(canonicalBytes({ type: 'turn.completed', usage })));
  }
  observer.accept(canonicalBytes(measured)); assert.equal(observer.snapshot().tokens, 259960); // restored: clean message still counts
});
