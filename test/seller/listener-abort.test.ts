import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { nodeListener } from '../../scripts/seller/runtime.ts';

type Handler = Parameters<typeof nodeListener>[0];

async function serve(handler: Handler): Promise<{ origin: string; close: () => Promise<void> }> {
  // Listen first on an ephemeral loopback port, then bind the listener to the exact origin.
  let listener: ReturnType<typeof nodeListener> | undefined;
  const server = createServer((req, res) => { void listener!(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  listener = nodeListener(handler, origin, true);
  return { origin, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

test('client disconnect aborts the seller handler signal; a completed request does not', async () => {
  let seen: AbortSignal | undefined; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handler = (async (req: { options?: { signal?: AbortSignal } }) => {
    seen = req.options?.signal; await gate;
    return { status: 200, headers: {}, contentType: 'application/json', body: new Uint8Array() };
  }) as unknown as Handler;
  const { origin, close } = await serve(handler);
  try {
    // Bad case: the client gives up while the handler is still running.
    const req = httpRequest(origin + '/x', { method: 'POST' }); req.on('error', () => {}); req.end('{}');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(seen, 'handler received a signal'); assert.equal(seen.aborted, false);
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(seen.aborted, true, 'disconnect must abort');
    release();
    // Clean control: a request that completes normally never aborts.
    const done = await new Promise<number>((resolve, reject) => {
      const ok = httpRequest(origin + '/y', { method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      ok.on('error', reject); ok.end('{}');
    });
    assert.equal(done, 200); assert.equal(seen.aborted, false);
  } finally { release(); await close(); }
});
