/** Real Unix IPC on a host; no TCP, Codex, auth, or model connection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { hostMcpCommand } from '../../scripts/replay/mcp-host.ts';
import { createSupervisor, listenSupervisor } from '../../scripts/replay/host-supervisor.ts';
import { root, temp, fixture, clock } from './host-support.ts';
test('host MCP entrypoint: denied rubric-shaped tool and permitted action over stdio/Unix IPC', async (t) => {
  const dir = temp(t), socket = join(dir, 'ipc.sock'); const events: unknown[] = [];
  const c = createSupervisor({ ...fixture(), arm: 'A', clock, knowledge: null, journal: (e) => events.push(e), exhausted() {} });
  let listener;
  try { listener = await listenSupervisor(socket, c.call); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' && process.env.AAB_REQUIRE_SOCKET_TEST !== '1') {
      t.skip('UNVERIFIED: sandbox denies Unix listen; lead runs AAB_REQUIRE_SOCKET_TEST=1'); return;
    }
    throw error;
  }
  t.after(() => listener.close());
  const command = hostMcpCommand(root, 'A', socket);
  const child = spawn(command.command, command.args, { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = ''; child.stderr.on('data', (b) => { stderr += b.toString(); });
  const responses = new Map<number, (value: unknown) => void>(); let pending = '';
  child.stdout.on('data', (b) => { pending += b.toString(); let index;
    while ((index = pending.indexOf('\n')) >= 0) { const row = strictJson(Buffer.from(pending.slice(0, index))) as { id: number }; pending = pending.slice(index + 1); responses.get(row.id)?.(row); }
  });
  let sequence = 0;
  async function request(method: string, params: unknown) {
    const id = ++sequence;
    return await new Promise<Record<string, unknown>>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`MCP_REPLY_MISSING: ${stderr}`)), 3000);
      responses.set(id, (value) => { clearTimeout(timer); responses.delete(id); ok(value as Record<string, unknown>); });
      child.stdin.write(Buffer.concat([canonicalBytes({ jsonrpc: '2.0', id, method, params }), Buffer.from('\n')]));
    });
  }
  const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }); assert.ok(initialized.result);
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const listed = await request('tools/list', {}); assert.equal((listed.result as { tools: unknown[] }).tools.length, 5);
  const bad = await request('tools/call', { name: 'read_rubric', arguments: { path: '/hidden' } }); assert.equal((bad.result as { isError: boolean }).isError, true);
  const clean = await request('tools/call', { name: 'inspect_fixture', arguments: { fixture_id: 'I2' } }); assert.notEqual((clean.result as { isError?: boolean }).isError, true);
  assert.equal(c.calls(), 2); assert.equal(c.snapshot().actions.length, 1); assert.ok(events.length);
  child.stdin.end();
});
