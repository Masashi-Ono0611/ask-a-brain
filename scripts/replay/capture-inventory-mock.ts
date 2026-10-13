/** LEAD HOST ONLY: local mock provider, never a live model or real auth. */
import { createServer } from 'node:http';
import { listenSupervisor } from './host-supervisor.ts';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M03, canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { hostArgs, pinSchema } from './host-config.ts';
import type { Pin } from './host-config.ts';
import type { Arm } from './host-surface.ts';
import type { Command } from './process.ts';
import { runProcess } from './host-process.ts';
import { extractInventory, verifyInventory, residualHash, extractRuntimeTools, verifyRuntimeTools } from './host-inventory.ts';
export const INVENTORY_CALL_ID = 'call_inventory_all_tools';
export interface MockEndpoint { url: string; requests: Buffer[]; close(): Promise<void> }
export async function startMockEndpoint(): Promise<MockEndpoint> {
  const requests: Buffer[] = [];
  const server = createServer((req, res) => {
    let length = 0; const chunks: Buffer[] = [];
    req.on('data', (b: Buffer) => { length += b.length; if (length > M03.sealedPayloadMax.value * 1024 * 1024) req.destroy(); else chunks.push(b); });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
      const bytes = Buffer.concat(chunks);
      try { strictJson(bytes); } catch { res.writeHead(400).end(); return; }
      requests.push(bytes); const id = `resp_mock_${requests.length}`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('response.created', { response: { id } });
      // Turn 1 instructs the exec orchestrator to enumerate ALL_TOOLS (the runtime's own list of enabled nested tools, incl. deferred
      // MCP tools); turn 2 receives that output in its request and ends the session. Measured shape: decision L8.
      if (requests.length === 1) event('response.output_item.done', { item: { type: 'custom_tool_call', call_id: INVENTORY_CALL_ID, name: 'exec', input: 'text(JSON.stringify(ALL_TOOLS.map((t) => t.name)))' } });
      else event('response.output_item.done', { item: { type: 'message', role: 'assistant', id: 'msg_mock', content: [{ type: 'output_text', text: 'ok' }] } });
      event('response.completed', { response: { id, usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } }); res.end();
    });
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('MOCK_FAILED');
  return { url: `http://127.0.0.1:${address.port}/v1`, requests, close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}
export async function captureMock(root: string, directory: string, arm: Arm, pin: Pin, command: Command,
  endpointFactory: () => Promise<MockEndpoint> = startMockEndpoint, listen = listenSupervisor) {
  mkdirSync(directory, { mode: 0o700 });
  const runtime = mkdtempSync(join(tmpdir(), 'aab-inv-')), home = join(runtime, 'home'), cwd = join(runtime, 'task'), socket = join(runtime, 'mcp.sock');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(cwd, { mode: 0o700 });
  // Inventory preflight must never execute a task. MCP tools/list does not need IPC.
  let ipc: Awaited<ReturnType<typeof listenSupervisor>> | undefined;
  let endpoint: MockEndpoint | undefined;
  try {
    ipc = await listen(socket, async () => { throw new Error('INVENTORY_ONLY'); });
    endpoint = await endpointFactory();
    const args = hostArgs(root, cwd, arm, socket, pin, endpoint.url);
    writeFileSync(join(directory, 'argv.json'), canonicalBytes(args), { flag: 'wx' });
    const events: unknown[] = [];
    const exit = await runProcess(command, args, { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, MOCK_KEY: 'dummy' }, cwd, 'Reply ok. Do not call tools.', (bytes) => { events.push(strictJson(bytes)); });
    writeFileSync(join(directory, 'process.json'), canonicalBytes({ exit, events }), { flag: 'wx' });
    for (const [i, bytes] of endpoint.requests.entries()) writeFileSync(join(directory, `request-${i}.json`), bytes, { flag: 'wx' });
    if (exit.code !== 0 || exit.timeout || exit.invalid || endpoint.requests.length !== 2) throw new Error('STRICT_CONFIG_OR_CAPTURE_FAILED');
    // Declarations of the first request (static) and the runtime's ALL_TOOLS (second request) must both match the arm's exact surface.
    const inventories = endpoint.requests.slice(0, 1).map((bytes) => { const value = extractInventory(bytes); verifyInventory(value, arm, { staticOnly: true }); return value; });
    const runtime = extractRuntimeTools(endpoint.requests[1]!, INVENTORY_CALL_ID); verifyRuntimeTools(runtime, arm);
    const hashes = inventories.map(residualHash);
    if (new Set(hashes).size !== 1) throw new Error('INVENTORY_CHANGED');
    const evidence = { arm, pin, inventories, runtime_all_tools: runtime, residual_sha256: hashes[0]! };
    writeFileSync(join(directory, 'inventory.json'), canonicalBytes(evidence), { flag: 'wx' }); return evidence;
  } finally { await endpoint?.close(); ipc?.close(); rmSync(runtime, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, out, model, effort, executable, ...extra] = process.argv.slice(2);
  if (!root || !out || !executable || extra.length) throw new Error('ROOT_NEW_OUTPUT_MODEL_EFFORT_CODEX_REQUIRED');
  const pin = pinSchema.parse({ model, effort }); mkdirSync(out, { mode: 0o700 });
  const results = [];
  for (const arm of ['A', 'B', 'C'] as const) results.push(await captureMock(resolve(root), join(out, arm), arm, pin, { executable, prefix: [] }));
  if (new Set(results.map((r) => r.residual_sha256)).size !== 1) throw new Error('ASYMMETRIC_RESIDUAL_SURFACE');
}
