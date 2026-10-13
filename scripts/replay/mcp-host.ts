/** Unprivileged stdio frontend. No rubric, fixture engine, bundle, or grader imports.
 * A single Unix-domain connection carries validated calls to the supervisor.
 * Launch with hostMcpCommand's Node permission allowlist, never bare node. */
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { StrictStdioTransport } from '../../src/mcp/index.ts';
import { canonicalBytes, strictJson, M03 } from '../../src/wire/index.ts';
import { armSchema, hostTools } from './host-surface.ts';
import type { Arm } from './host-surface.ts';
import { HostLines } from './host-lines.ts';
const replySchema = z.object({ ok: z.boolean(), data: z.unknown().optional(), code: z.enum(['PRECONDITION_REQUIRED', 'INSPECTION_REQUIRED', 'EVIDENCE_DENIED', 'TERMINAL_EVIDENCE_REQUIRED', 'OWNERSHIP_EVIDENCE_REQUIRED', 'STALE_VERIFICATION', 'FIX_DENIED', 'TASK_CLOSED']).optional() }).strict();
export async function serveHostMcp(arm: Arm, socketPath: string): Promise<void> {
  const socket = connect(socketPath); socket.on('error', () => { process.exitCode = 1; void server.close(); });
  let pending: { resolve(value: unknown): void; reject(error: Error): void } | null = null;
  const lines = new HostLines(M03.sealedPayloadMax.value * 1024 * 1024, (bytes) => {
    const result = replySchema.parse(strictJson(bytes));
    if (!pending) throw new Error('UNSOLICITED_REPLY');
    const active = pending; pending = null;
    if (result.ok) active.resolve(result.data); else active.reject(new Error(result.code ? `REQUEST_DENIED:${result.code}` : 'REQUEST_DENIED'));
  });
  socket.on('data', (bytes) => { try { lines.push(bytes); } catch { socket.destroy(); } });
  socket.on('close', () => { pending?.reject(new Error('SUPERVISOR_CLOSED')); pending = null; void server.close(); });
  const server = new Server({ name: 'aab-host-replay', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: hostTools(arm) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // Supervisor, not this restartable frontend, owns call counting and journal.
      const input = request.params.arguments ?? {};
      if (pending) throw new Error('SERIAL_CALL_REQUIRED');
      const data = await new Promise<unknown>((resolve, reject) => {
        pending = { resolve, reject };
        socket.write(Buffer.concat([canonicalBytes({ tool: request.params.name, input }), Buffer.from('\n')]));
      });
      return { content: [{ type: 'text', text: Buffer.from(canonicalBytes({ untrusted_content: true, data })).toString('utf8') }] };
    } catch (error) { const m = error instanceof Error ? error.message : ''; return { isError: true, content: [{ type: 'text', text: /^REQUEST_DENIED:[A-Z_]+$/.test(m) ? m : 'REQUEST_DENIED' }] }; }
  });
  const transport = new StrictStdioTransport(process.stdin, process.stdout);
  transport.onclose = () => socket.destroy();
  await server.connect(transport);
  process.stdin.once('end', () => socket.destroy());
}
export function hostMcpCommand(root: string, arm: Arm, socketPath: string) {
  const reads = ['package.json', 'node_modules', 'src/wire', 'src/mcp', 'scripts/replay/mcp-host.ts', 'scripts/replay/host-surface.ts', 'scripts/replay/host-lines.ts'];
  return { command: process.execPath, args: ['--permission', ...reads.map((p) => `--allow-fs-read=${resolve(root, p)}`), resolve(root, 'scripts/replay/mcp-host.ts'), arm, socketPath] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arm, socket, ...extra] = process.argv.slice(2);
  if (!socket || extra.length) throw new Error('ARM_SOCKET_REQUIRED');
  await serveHostMcp(armSchema.parse(arm), socket);
}
