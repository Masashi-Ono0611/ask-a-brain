import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { M03, canonicalBytes, strictJson } from '../wire/index.ts';
import { object, requireInput } from './protocol.ts';
/** SDK default JSON.parse loses duplicate keys. Validate exact bytes first. */
/** Codex 0.160.0 attaches an informational `_meta` to tools/list and tools/call (measured, decision L8): ids, a progress token and a
 * flat turn-metadata record. It is validated for shape and size and then ignored; unknown keys, nested objects and long strings are refused. */
const META_ID_KEYS = ['callId', 'itemId', 'sessionId', 'threadId', 'windowId'];
function codexMeta(value: unknown): void {
  const meta = object(value, [], [...META_ID_KEYS, 'progressToken', 'x-codex-turn-metadata']);
  for (const key of META_ID_KEYS) if (meta[key] !== undefined) requireInput(typeof meta[key] === 'string' && (meta[key] as string).length <= 200);
  if (meta.progressToken !== undefined) requireInput(Number.isSafeInteger(meta.progressToken) && (meta.progressToken as number) >= 0);
  if (meta['x-codex-turn-metadata'] !== undefined) {
    const turn = meta['x-codex-turn-metadata'];
    requireInput(turn !== null && typeof turn === 'object' && !Array.isArray(turn) && Object.keys(turn as object).length <= 32);
    for (const [k, v] of Object.entries(turn as Record<string, unknown>)) {
      requireInput(k.length <= 64 && (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v)) || (typeof v === 'string' && v.length <= 200)));
    }
  }
}

export class StrictStdioTransport implements Transport {
  onmessage?: NonNullable<Transport['onmessage']>; onerror?: (error: Error) => void; onclose?: () => void;
  readonly input: Readable; readonly output: Writable;
  #buffer = Buffer.alloc(0); #started = false; #closed = false;
  constructor(input: Readable, output: Writable) { this.input = input; this.output = output; }
  async start(): Promise<void> {
    requireInput(!this.#started); this.#started = true;
    this.input.on('data', this.#data); this.input.once('end', this.#end); this.input.once('error', this.#fail);
  }
  #end = (): void => { if (this.#buffer.length) this.#fail(); else void this.close(); };
  #fail = (): void => { this.onerror?.(new Error('INVALID_REQUEST')); void this.close(); };
  #data = (chunk: Buffer): void => {
    if (this.#closed) return;
    try {
      // Consume one line at a time; a huge chunk cannot bypass the per-line bound.
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline;
        requireInput(this.#buffer.length + end - start <= M03.ingressBodyMax.value * 1024);
        this.#buffer = Buffer.concat([this.#buffer, chunk.subarray(start, end)]);
        if (newline < 0) break;
        const value = strictJson(this.#buffer, { integerNumbersOnly: true }); this.#buffer = Buffer.alloc(0);
        const row = object(value, ['jsonrpc', 'method'], ['id', 'params']); requireInput(row.jsonrpc === '2.0');
        const params = row.params ?? {};
        switch (row.method) {
          case 'initialize': {
            const init = object(params, ['protocolVersion', 'capabilities', 'clientInfo']);
            // Codex 0.160.0 declares exactly these two client capabilities (measured on the wire, decision L6/L8). Both are inert
      // for this server (it never sends elicitation or auth-change requests); anything else, or any non-empty value, is refused.
      const caps = object(init.capabilities, [], ['experimental', 'elicitation']);
      if (caps.experimental !== undefined) { const e = object(caps.experimental, [], ['codex/auth-change']); if (e['codex/auth-change'] !== undefined) object(e['codex/auth-change'], []); }
      if (caps.elicitation !== undefined) { const e = object(caps.elicitation, [], ['form', 'url']); for (const k of ['form', 'url']) if (e[k] !== undefined) object(e[k], []); }
      const client = object(init.clientInfo, ['name', 'version'], ['title']);
            requireInput(typeof init.protocolVersion === 'string' && typeof client.name === 'string' && typeof client.version === 'string'); break;
          }
          case 'tools/call': {
            const p = object(params, ['name', 'arguments'], ['_meta']);
            if (p._meta !== undefined) codexMeta(p._meta);
            break;
          }
          case 'tools/list': case 'ping': case 'notifications/initialized': {
            // Codex 0.160.0 sends tools/list with params {_meta:{progressToken:<int>}} (measured, decision L8). Only that exact shape is added.
            const p = object(params, [], ['_meta']);
            if (p._meta !== undefined) codexMeta(p._meta);
            break;
          }
          default: throw new Error('METHOD_DENIED');
        }
        this.onmessage?.(JSONRPCMessageSchema.parse(value)); start = newline + 1;
      }
    } catch { this.#fail(); }
  };
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.#closed) return;
    await new Promise<void>((resolve, reject) => this.output.write(Buffer.concat([canonicalBytes(message), Buffer.from('\n')]), (error) => error ? reject(error) : resolve()));
  }
  async close(): Promise<void> {
    if (this.#closed) return; this.#closed = true; this.#buffer = Buffer.alloc(0);
    this.input.off('data', this.#data); this.input.off('end', this.#end); this.input.off('error', this.#fail);
    this.input.pause(); this.onclose?.();
  }
}
