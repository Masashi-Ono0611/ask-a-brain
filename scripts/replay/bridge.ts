/** Audited stdio relay. Public arguments are ONLY container ID and arm. The
 * generated per-run launcher binds all host paths, commands and journal IDs. */
import { openSync, closeSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { FileJournal } from '../../src/eval/index.ts';
import type { Journal } from '../../src/eval/index.ts';
import { M03, strictJson, payloadHash } from '../../src/wire/index.ts';
import type { Id } from '../../src/wire/contracts.ts';
import { namesForArm, validateInput, inventory } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
import { containerId, execArgs, inspectContainer } from './docker.ts';
import { execute } from './process.ts';
import type { Command, Exit } from './process.ts';
const requestSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.number().int(), z.string()]).optional(), method: z.string(), params: z.unknown().optional() }).strict();
const responseSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.number().int(), z.string(), z.null()]), result: z.unknown().optional(), error: z.unknown().optional() }).strict();
export class Lines {
  #bytes = Buffer.alloc(0); readonly #limit: number;
  readonly #consume: (bytes: Buffer) => void;
  constructor(limit: number, consume: (bytes: Buffer) => void) { this.#limit = limit; this.#consume = consume; }
  push(chunk: Buffer): void {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline;
      if (this.#bytes.length + end - start > this.#limit) throw new Error('LINE_LIMIT');
      this.#bytes = Buffer.concat([this.#bytes, chunk.subarray(start, end)]);
      if (newline < 0) break;
      const bytes = this.#bytes; this.#bytes = Buffer.alloc(0); this.#consume(bytes); start = newline + 1;
    }
  }
  end(): void { if (this.#bytes.length) throw new Error('TRUNCATED_LINE'); }
}
export function auditRelay(arm: Arm, journal: Journal, run: Id) {
  let calls = 0; const pending = new Map<string | number, { name: string; input: unknown }>();
  return {
    request(bytes: Buffer): void {
      const row = requestSchema.parse(strictJson(bytes));
      if (row.method !== 'tools/call') {
        if (!['initialize', 'notifications/initialized', 'tools/list', 'ping'].includes(row.method)) throw new Error('METHOD_DENIED');
        if (row.method === 'initialize') z.object({ protocolVersion: z.string(), capabilities: z.object({}).strict(), clientInfo: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).strict() }).strict().parse(row.params);
        else z.object({}).strict().parse(row.params ?? {});
        return;
      }
      const call = z.object({ name: z.string(), arguments: z.unknown() }).strict().parse(row.params);
      // Journal even denied tool calls BEFORE any container dispatch.
      journal.append({ kind: 'call', run_id: run, data: { phase: 'requested', sequence: ++calls, id: row.id ?? null, tool: call.name, input: call.arguments } });
      if (calls > M03.replayCallsMax.value) throw new Error('CALL_BUDGET');
      if (row.id === undefined || pending.size || !namesForArm(arm).includes(call.name as never)) throw new Error('TOOL_DENIED');
      validateInput(call.name, call.arguments); pending.set(row.id, { name: call.name, input: call.arguments });
    },
    response(bytes: Buffer): void {
      const row = responseSchema.parse(strictJson(bytes));
      if (row.id === null) throw new Error('RESPONSE_DENIED');
      const request = pending.get(row.id);
      if (request) {
        journal.append({ kind: 'call', run_id: run, data: { phase: 'response', id: row.id, tool: request.name, input: request.input, response: row } });
        pending.delete(row.id);
      }
    },
  };
}
export interface BridgeOptions { id: string; arm: Arm; run: Id; journal: Journal; docker: Command; env: NodeJS.ProcessEnv; cwd: string; input: Readable; output: Writable }
export async function relay(options: BridgeOptions): Promise<Exit> {
  await inspectContainer(options.docker, options.id, options.env, options.cwd);
  const execution = execute(options.docker, execArgs(options.id, options.arm), options.env, options.cwd);
  const audit = auditRelay(options.arm, options.journal, options.run);
  let failed = false;
  const fail = () => { failed = true; execution.stop(); };
  const requestLines = new Lines(M03.ingressBodyMax.value * 1024, (bytes) => { audit.request(bytes); if (!execution.child.stdin.write(Buffer.concat([bytes, Buffer.from('\n')]))) options.input.pause(); });
  const responseLines = new Lines(M03.citationFetchTotalMax.value * 1024, (bytes) => { audit.response(bytes); if (!options.output.write(Buffer.concat([bytes, Buffer.from('\n')]))) execution.child.stdout.pause(); });
  const onInput = (bytes: Buffer) => { try { requestLines.push(bytes); } catch { fail(); } };
  const onEnd = () => { try { requestLines.end(); execution.child.stdin.end(); } catch { fail(); } };
  const onDrain = () => execution.child.stdout.resume();
  options.output.on('drain', onDrain); options.output.on('error', fail);
  execution.child.stdin.on('drain', () => options.input.resume());
  options.input.on('data', onInput); options.input.once('end', onEnd); options.input.once('error', fail);
  execution.child.stdout.on('data', (bytes: Buffer) => { try { responseLines.push(bytes); } catch { fail(); } });
  // Never expose arbitrary Docker stderr through model protocol stdout.
  execution.child.stderr.resume();
  const result = await execution.done;
  options.input.off('data', onInput); options.input.off('end', onEnd); options.input.off('error', fail); options.input.pause();
  options.output.off('drain', onDrain); options.output.off('error', fail);
  try { responseLines.end(); } catch { failed = true; }
  return failed ? { ...result, code: 1 } : result;
}
/** Atomically claims this attempt. A restart never receives a fresh call budget. */
export function claimBridge(binding: { id: string; arm: Arm; lock: string }, args: string[]): void {
  containerId.parse(binding.id);
  if (args.length !== 2 || args[0] !== binding.id || args[1] !== binding.arm || !['A', 'B', 'C'].includes(binding.arm)) throw new Error('LAUNCH_ARGUMENT_DENIED');
  closeSync(openSync(binding.lock, 'wx', 0o600));
}
/** Called by a generated immutable launcher with bound paths, never a general CLI. */
export async function launchBoundBridge(binding: { id: string; arm: Arm; run: Id; journal: string; lock: string; cwd: string; dockerConfig: string }, args: string[]): Promise<void> {
  claimBridge(binding, args);
  const journal = new FileJournal(binding.journal);
  try {
    const result = await relay({ ...binding, journal, docker: { executable: 'docker', prefix: [] },
      env: { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', HOME: binding.cwd, DOCKER_CONFIG: binding.dockerConfig }, input: process.stdin, output: process.stdout });
    process.exitCode = result.code ?? 1;
  } finally { journal.close(); }
}
/** MCP-only preflight, before inference. Does NOT assert complete model inventory. */
export async function probeBridge(options: Omit<BridgeOptions, 'input' | 'output'>): Promise<void> {
  const input = new PassThrough(), output = new PassThrough(); let initialized = false, listed = false;
  const lines = new Lines(M03.citationFetchTotalMax.value * 1024, (bytes) => {
    const row = responseSchema.parse(strictJson(bytes));
    if (row.error) throw new Error('MCP_PREFLIGHT_FAILED');
    if (row.id === 1 && row.result) { initialized = true; input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'); }
    if (row.id === 2) {
      const result = z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional(), inputSchema: z.unknown() }).strict()) }).strict().parse(row.result);
      const ordered = (tools: typeof result.tools) => tools.map(({ name, inputSchema }) => ({ name, inputSchema })).sort((a, b) => a.name.localeCompare(b.name));
      if (payloadHash(ordered(result.tools)) !== payloadHash(ordered(inventory(options.arm)))) throw new Error('MCP_INVENTORY_MISMATCH');
      listed = true; input.end();
    }
  });
  let invalid = false;
  output.on('data', (bytes: Buffer) => { try { lines.push(bytes); } catch { invalid = true; input.end(); } });
  const running = relay({ ...options, input, output });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aab-preflight', version: '1' } } }) + '\n');
  const exit = await running; lines.end();
  if (invalid || exit.code !== 0 || !initialized || !listed) throw new Error('MCP_PREFLIGHT_FAILED');
}
