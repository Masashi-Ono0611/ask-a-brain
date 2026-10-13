import { connect } from 'node:net';
import { M03, canonicalBytes, strictJson } from '../wire/index.ts';
import { object, requireInput, validateInput } from './protocol.ts';
import type { RuntimePort } from './protocol.ts';
/** Dedicated per-run Unix socket is the capability; never accept a model URL/path.
 * Host must provision only this socket, not its parent service state directory. */
export function createBrokerClient(socketPath: string): RuntimePort {
  requireInput(socketPath.startsWith('/') && !socketPath.includes('\0'));
  return Object.freeze({ async call(tool: string, input: unknown): Promise<unknown> {
    const request = canonicalBytes({ tool, input: validateInput(tool, input) });
    requireInput(request.length <= M03.ingressBodyMax.value * 1024);
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath); let bytes = Buffer.alloc(0);
      const fail = (): void => { socket.destroy(); reject(new Error('GATEWAY_UNAVAILABLE')); };
      socket.setTimeout(M03.replayWallTimeMax.value * 60_000, fail); socket.once('error', fail);
      socket.once('connect', () => socket.end(request));
      socket.on('data', (chunk: Buffer) => {
        if (bytes.length + chunk.length > M03.citationFetchTotalMax.value * 1024) { fail(); return; }
        bytes = Buffer.concat([bytes, chunk]);
      });
      socket.once('end', () => {
        try { const row = object(strictJson(bytes), ['ok', 'result']); requireInput(row.ok === true); resolve(row.result); }
        catch { fail(); }
      });
    });
  } });
}
