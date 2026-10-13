/** Host supplies protected ports; only explicit isolated loopback uses plaintext. */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { composeSeller, nodeListener } from './seller/runtime.ts';
export { composeSeller, nodeListener } from './seller/runtime.ts';
export async function startSeller(deps: Parameters<typeof composeSeller>[0]) {
  const endpoint = new URL(deps.config.origin);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port) throw new Error('EXPLICIT_ISOLATED_LOOPBACK_REQUIRED');
  const composed = await composeSeller(deps);
  const server: Server = createServer(nodeListener(composed.handler, deps.config.origin, true));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(endpoint.port), endpoint.hostname.replace(/[\[\]]/g, ''), () => { server.off('error', reject); resolve(); }); });
  return { ...composed, server, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
