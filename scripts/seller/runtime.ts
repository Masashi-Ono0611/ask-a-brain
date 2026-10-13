/** Composition helpers only. Host owns HTTPS, isolated worker IPC, scanner,
 * signer IPC, independent RPCs and current authority attestation. No live defaults.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { M03 } from '../../src/wire/constants.ts';
import { createSellerHandler, createSellerService } from '../../src/seller/index.ts';
import type { SellerDependencies } from '../../src/seller/index.ts';
export async function composeSeller(deps: Omit<SellerDependencies, 'config'> & { config: Omit<SellerDependencies['config'], 'limits'> }) {
  const config = { ...deps.config, limits: M03 };
  const controller = createSellerService({ ...deps, config }); await controller.start();
  return { controller, handler: createSellerHandler(controller, config.wire, M03, config.origin) };
}
export function nodeListener(handler: ReturnType<typeof createSellerHandler>, origin: string, isolatedHttpLoopback = false) {
  const endpoint = new URL(origin);
  if (endpoint.origin !== origin || (endpoint.protocol !== 'https:' && !(isolatedHttpLoopback && endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('INVALID_ORIGIN');
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // Host/TLS termination must preserve this exact origin; ignore forwarding headers.
    if (request.headers.host !== endpoint.host || (request.headers.origin !== undefined && request.headers.origin !== origin)) { response.writeHead(400); response.end(); return; }
    const chunks: Buffer[] = []; let size = 0;
    // Forward client disconnects so a slow handler is cancelled and its lease released.
    const abort = new AbortController();
    const onClose = (): void => { if (!response.writableEnded) abort.abort(); };
    request.once('aborted', onClose); response.once('close', onClose);
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
        if (size > M03.ingressBodyMax.value * 1024) { response.writeHead(413); response.end(); return; }
        chunks.push(bytes);
      }
      const result = await handler({ method: request.method ?? '', path: request.url ?? '', origin, peerIp: request.socket.remoteAddress ?? 'unknown-peer', body: Buffer.concat(chunks), options: { signal: abort.signal },
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), ...(request.headers['content-type'] ? { contentType: request.headers['content-type'] } : {}) });
      response.writeHead(result.status, { ...result.headers, 'content-type': result.contentType }); response.end(result.body);
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
    finally { request.off('aborted', onClose); response.off('close', onClose); }
  };
}
