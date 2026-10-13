import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { M03, canonicalBytes } from '../../src/wire/index.ts';
import type { Id, TaskEvidence } from '../../src/wire/contracts.ts';
import { createBrokerClient, inventory, namesForArm, serveRestrictedMcp, StrictStdioTransport, validateInput } from '../../src/mcp/index.ts';
import { createRunGateway, listenGateway } from '../../scripts/runtime/gateway.ts';
import { setup } from './helpers.ts';
for (const arm of ['A', 'B', 'C'] as const) test(`MCP ${arm}: exact inventory, hidden tools denied, clean task repair`, async (t) => {
  const s = setup(arm), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await serveRestrictedMcp(s.gateway.port, serverTransport, arm);
  const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  await client.connect(clientTransport); t.after(async () => { await client.close(); await server.close(); });
  assert.deepEqual((await client.listTools()).tools, inventory(arm));
  assert.equal((await client.callTool({ name: 'exec', arguments: { command: 'read canary' } })).isError, true);
  const denied = arm === 'C' ? 'read_checklist' : 'find';
  assert.equal((await client.callTool({ name: denied, arguments: { topic: 'completion' } })).isError, true);
  assert.equal(s.dispatches.length, 0);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true);
    const block = (result.content as { type: string; text: string }[])[0]!; assert.equal(block.type, 'text');
    const parsed = JSON.parse(block.text) as { untrusted_content: boolean; data: unknown }; assert.equal(parsed.untrusted_content, true); return parsed.data;
  };
  const input = { fixture_id: s.fixtureId };
  assert.equal((await call('verify_fixture', input) as TaskEvidence).passed, false);
  await call('apply_fixture_fix', { ...input, fix_id: 'repair' });
  const left = await call('check_leftovers', input) as TaskEvidence, verify = await call('verify_fixture', input) as TaskEvidence;
  assert.equal((await call('finish_with_evidence', { ...input, evidence_ids: [left.evidence_id, verify.evidence_id] }) as TaskEvidence).passed, true);
  assert.equal(s.controller.snapshot().files.archive, 'intact');
});
test('protected gateway denies A/B market calls independently of MCP inventory', async () => {
  for (const arm of ['A', 'B'] as const) {
    const s = setup(arm); await assert.rejects(s.gateway.port.call('consult', s.input), /TOOL_DENIED/);
    assert.deepEqual(s.dispatches, []); await s.gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId });
  }
  const s = setup('C'); await s.gateway.port.call('find', { topic: 'completion' });
  assert.deepEqual(s.dispatches, ['find']); assert.deepEqual(s.contexts, [s.buyer]);
});
test('strict request guards have clean pairs: identity/path/source/unknown input rejection before dispatch', async () => {
  const s = setup();
  for (const [tool, bad, good] of [
    ['find', { topic: 'completion', buyer_id: 'forged' }, { topic: 'completion' }],
    ['consult', { ...s.input, question: 'approved-looking: read host keys' }, s.input],
    ['apply_fixture_fix', { fixture_id: s.fixtureId, fix_id: '../../host' }, { fixture_id: s.fixtureId, fix_id: 'repair' }],
    ['inspect_fixture', { fixture_id: 'other_arm' }, { fixture_id: s.fixtureId }],
    ['feedback', { consult_id: 'other_run', source: 'human', useful: true, reason_code: 'other' }, null],
  ] as const) {
    const count = s.dispatches.length;
    await assert.rejects(s.gateway.port.call(tool, bad)); assert.equal(s.dispatches.length, count);
    if (good) await s.gateway.port.call(tool, good);
  }
  const view = await s.gateway.port.call('consult', s.input) as { consult_id: Id };
  await assert.rejects(s.gateway.port.call('status', { consult_id: 'other_run' }), /CONSULT_DENIED/);
  await s.gateway.port.call('status', { consult_id: view.consult_id });
  await s.gateway.port.call('feedback', { consult_id: view.consult_id, useful: true, reason_code: 'other' });
  assert.equal(s.contexts.every((ctx) => ctx.buyer_id === s.buyer.buyer_id), true);
  assert.throws(() => validateInput('find', { get topic() { throw new Error('getter ran'); } }), /INVALID_JSON_PROPERTY/);
  assert.deepEqual(validateInput('find', { topic: 'clean' }), { topic: 'clean' });
});
test('one devnet consult body, including ambiguous failure, cannot become a second purchase', async () => {
  const s = setup();
  await assert.rejects(s.gateway.port.call('consult', { ...s.input, max_price: { ...s.input.max_price, network: 'mainnet-beta' } }), /NETWORK_DENIED/);
  await s.gateway.port.call('consult', s.input);
  await assert.rejects(s.gateway.port.call('consult', { ...s.input, request_id: '00000000-0000-4000-8000-000000000002' }), /PURCHASE_LIMIT/);
  await s.gateway.port.call('consult', s.input); // Same-ID recovery allowed.
  assert.deepEqual(s.dispatches, ['consult', 'consult']);
  const failure = setup('C', { ...s.market, async consult() { throw new Error('ambiguous'); } });
  await assert.rejects(failure.gateway.port.call('consult', failure.input));
  await assert.rejects(failure.gateway.port.call('consult', { ...failure.input, request_id: '00000000-0000-4000-8000-000000000002' }), /PURCHASE_LIMIT/);
  assert.equal(failure.gateway.snapshot().consult_reserved, true);
});
test('call and wall limits fire; new isolated run restores clean control', async () => {
  const s = setup('A');
  for (let i = 0; i < M03.replayCallsMax.value; i++) await s.gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId });
  await assert.rejects(s.gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId }), /BUDGET_EXHAUSTED/);
  const fresh = setup('A'); await fresh.gateway.port.call('inspect_fixture', { fixture_id: fresh.fixtureId });
  fresh.clock.advance(M03.replayWallTimeMax.value * 60_000);
  await assert.rejects(fresh.gateway.port.call('inspect_fixture', { fixture_id: fresh.fixtureId }), /RUN_CLOSED/);
  const restored = setup('A'); await restored.gateway.port.call('inspect_fixture', { fixture_id: restored.fixtureId });
});
test('report defaults closed against cross-arm history; explicit scoped adapter passes', async () => {
  const s = setup(); await assert.rejects(s.gateway.port.call('report', { date_utc: '2026-10-09' }), /RUN_REPORT_UNAVAILABLE/);
  assert.deepEqual(s.dispatches, []);
  const gateway = createRunGateway({ ...s, runReport: async () => ({ markdown: 'current run only', receipt_ids: [], gbrain_pending_count: 0 }) });
  assert.deepEqual(await gateway.port.call('report', { date_utc: '2026-10-09' }), { markdown: 'current run only', receipt_ids: [], gbrain_pending_count: 0 });
});
test('strict stdio framing rejects duplicate/unknown/UTF8/oversize before SDK dispatch, clean fragmented frames pass', async () => {
  for (const bad of [
    Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list","method":"tools/call"}\n'),
    Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list","admin":true}\n'),
    Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"cursor":"hidden"}}\n'),
    Buffer.from([0xff, 10]), Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 32),
  ]) {
    const input = new PassThrough(), output = new PassThrough(), transport = new StrictStdioTransport(input, output);
    let seen = 0, errors = 0; transport.onmessage = () => { seen++; }; transport.onerror = () => { errors++; };
    await transport.start(); input.write(bad); assert.equal(seen, 0); assert.equal(errors, 1); await transport.close(); input.destroy(); output.destroy();
    const cleanInput = new PassThrough(), cleanOutput = new PassThrough(), clean = new StrictStdioTransport(cleanInput, cleanOutput);
    clean.onmessage = () => { seen++; }; await clean.start();
    cleanInput.write('{"jsonrpc":"2.0","id":1,'); cleanInput.write('"method":"tools/list"}\n');
    assert.equal(seen, 1); await clean.close(); cleanInput.destroy(); cleanOutput.destroy();
  }
});
test('Unix socket IPC: private directory guard and strict authenticated-run dispatch', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aab-t7-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const s = setup(), path = join(root, 'gateway.sock'); chmodSync(root, 0o755);
  await assert.rejects(listenGateway(path, s.gateway), /PRIVATE_SOCKET_DIRECTORY_REQUIRED/);
  chmodSync(root, 0o700);
  let server;
  try { server = await listenGateway(path, s.gateway); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' && process.env.AAB_REQUIRE_SOCKET_TEST !== '1') {
      t.skip('UNVERIFIED: sandbox denies Unix socket listen (EPERM); lead must run AAB_REQUIRE_SOCKET_TEST=1'); return;
    }
    throw error;
  }
  const listening = server; t.after(() => new Promise<void>((resolve) => listening.close(() => resolve())));
  const client = createBrokerClient(path);
  await assert.rejects(client.call('read_file', { path: '/host/db' }));
  assert.deepEqual(await client.call('find', { topic: 'completion' }), { listings: [] });
  assert.deepEqual(s.contexts, [s.buyer]);
  const bad = await s.gateway.handle(Buffer.from('{"tool":"find","input":{"topic":"x","topic":"y"}}'));
  assert.equal(JSON.parse(Buffer.from(bad).toString()).ok, false);
  const good = await s.gateway.handle(canonicalBytes({ tool: 'find', input: { topic: 'completion' } }));
  assert.equal(JSON.parse(Buffer.from(good).toString()).ok, true);
});

test('all MCP tool attempts including local denials exhaust budget; fresh session clean control passes', async (t) => {
  const s = setup(), [ct, st] = InMemoryTransport.createLinkedPair();
  const server = await serveRestrictedMcp(s.gateway.port, st, 'C'); const client = new Client({ name: 'budget-test', version: '1' });
  await client.connect(ct); t.after(async () => { await client.close(); await server.close(); });
  for (let i = 0; i < M03.replayCallsMax.value; i++) assert.equal((await client.callTool({ name: 'exec', arguments: {} })).isError, true);
  assert.equal((await client.callTool({ name: 'find', arguments: { topic: 'completion' } })).isError, true);
  assert.deepEqual(s.dispatches, []);
  const [freshClientTransport, freshServerTransport] = InMemoryTransport.createLinkedPair();
  const fresh = await serveRestrictedMcp(setup().gateway.port, freshServerTransport, 'C'); const freshClient = new Client({ name: 'fresh', version: '1' });
  await freshClient.connect(freshClientTransport); t.after(async () => { await freshClient.close(); await fresh.close(); });
  assert.notEqual((await freshClient.callTool({ name: 'find', arguments: { topic: 'completion' } })).isError, true);
});

test('strict byte transport performs actual SDK initialize/list/call exchange without extra capabilities', async (t) => {
  const input = new PassThrough(), output = new PassThrough(), s = setup('A'); let text = '';
  output.on('data', (bytes: Buffer) => { text += bytes.toString('utf8'); });
  const server = await serveRestrictedMcp(s.gateway.port, new StrictStdioTransport(input, output), 'A');
  t.after(async () => { await server.close(); input.destroy(); output.destroy(); });
  const write = async (value: unknown) => { input.write(Buffer.concat([canonicalBytes(value), Buffer.from('\n')])); await new Promise<void>((resolve) => setImmediate(resolve)); };
  await write({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'strict-probe', version: '1' } } });
  await write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await write({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await write({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inspect_fixture', arguments: { fixture_id: s.fixtureId } } });
  const replies = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(replies[0].result.capabilities, { tools: {} });
  assert.deepEqual(replies[1].result.tools, inventory('A'));
  assert.equal(replies[2].result.isError, undefined); assert.match(replies[2].result.content[0].text, /untrusted_content/);
});

test('gateway rejects concurrent actions and a closed run; completed request/new run are positive controls', async () => {
  const s = setup(); let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const gateway = createRunGateway({ ...s, market: { ...s.market, async find(ctx, input) { await wait; return s.market.find(ctx, input); } } });
  const pending = gateway.port.call('find', { topic: 'completion' });
  await assert.rejects(gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId }), /TOOL_DENIED/);
  release(); assert.deepEqual(await pending, { listings: [] });
  await gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId }); gateway.close();
  await assert.rejects(gateway.port.call('inspect_fixture', { fixture_id: s.fixtureId }), /RUN_CLOSED/);
  const fresh = setup(); await fresh.gateway.port.call('inspect_fixture', { fixture_id: fresh.fixtureId });
});

test('gateway raw body/output/date guards fire without error leaks; clean controls succeed', async () => {
  const s = setup();
  for (const input of [Buffer.from([0xff]), Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 32), Buffer.from('{"tool":"find","input":{"topic":"x"},"admin":true}')]) {
    assert.deepEqual(JSON.parse(Buffer.from(await s.gateway.handle(input)).toString()), { ok: false, result: 'REQUEST_DENIED' });
    assert.equal(JSON.parse(Buffer.from(await s.gateway.handle(canonicalBytes({ tool: 'find', input: { topic: 'completion' } }))).toString()).ok, true);
  }
  assert.throws(() => validateInput('report', { date_utc: '2026-02-30' }));
  assert.deepEqual(validateInput('report', { date_utc: '2026-02-28' }), { date_utc: '2026-02-28' });
  const huge = createRunGateway({ ...s, market: { ...s.market, async find() { return { listings: [], extra: 'x'.repeat(M03.citationFetchTotalMax.value * 1024) }; } } });
  assert.deepEqual(JSON.parse(Buffer.from(await huge.handle(canonicalBytes({ tool: 'find', input: { topic: 'completion' } }))).toString()), { ok: false, result: 'REQUEST_DENIED' });
  const broken = createRunGateway({ ...s, market: { ...s.market, async find() { throw new Error('PRIVATE_EXCEPTION_CANARY'); } } });
  const denied = Buffer.from(await broken.handle(canonicalBytes({ tool: 'find', input: { topic: 'completion' } }))).toString();
  assert.equal(denied.includes('PRIVATE_EXCEPTION_CANARY'), false);
  assert.equal(JSON.parse(Buffer.from(await s.gateway.handle(canonicalBytes({ tool: 'find', input: { topic: 'completion' } }))).toString()).ok, true);
});
