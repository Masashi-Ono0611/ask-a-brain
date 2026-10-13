/** Byte-oriented transport; socket peer/origin are supplied by the trusted listener,
 * never X-Forwarded-For or buyer JSON. No admin/enrolment/URL-fetch routes exist.
 */
import { FoundationError, transportError } from '../common/index.ts';
import type { Id, Sha256, SellerCallOptions } from '../wire/contracts.ts';
import type { SellerLimits, SellerWire } from './ports.ts';
import { SellerController } from './controller.ts';
import { jsonValue } from './ports.ts';
export interface SellerHttpRequest { readonly options?: SellerCallOptions; readonly method: string; readonly path: string; readonly origin: string; readonly peerIp: string; readonly authorization?: string; readonly contentType?: string; readonly body: Uint8Array }
export interface SellerHttpResponse { readonly status: number; readonly contentType: string; readonly body: Uint8Array; readonly headers: Readonly<Record<string, string>> }
export function createSellerHandler(controller: SellerController, wire: SellerWire, limits: SellerLimits, origin: string) {
  const response = (status: number, value: unknown, contentType = 'application/json'): SellerHttpResponse => ({ status, contentType, body: value instanceof Uint8Array ? value : wire.canonical(jsonValue(value)), headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return async (request: SellerHttpRequest): Promise<SellerHttpResponse> => {
    try {
      if (request.origin !== origin || request.body.length > limits.ingressBodyMax.value * 1024 || request.path.includes('%') || request.path.includes('?') || request.path.includes('#')) throw new FoundationError('INVALID_INPUT');
      if (request.method === 'GET' && request.body.length !== 0) throw new FoundationError('INVALID_INPUT');
      if (request.method === 'GET' && request.path === '/healthz') return response(200, { alive: true });
      if (request.method === 'GET' && request.path === '/readyz') { const ready = await controller.ready(); return response(ready ? 200 : 503, { ready }); }
      const publicRoute = /^\/v1\/slices\/([A-Za-z0-9_-]+)\/(manifest|pages\/([A-Za-z0-9_-]+)|eligibility\/([a-f0-9]{64}))$/.exec(request.path);
      if (request.method === 'GET' && publicRoute) {
        const slice = publicRoute[1] as Id;
        if (publicRoute[2] === 'manifest') return response(200, await controller.manifest(slice, request.options));
        if (publicRoute[3]) return response(200, await controller.page(slice, publicRoute[3] as Id, request.options), 'text/plain; charset=utf-8');
        return response(200, await controller.eligibility(slice, publicRoute[4] as Sha256, request.options));
      }
      const privateRoute = /^\/v1\/quotes(?:\/([A-Za-z0-9_-]+)\/(arm|payment|answer))?$/.exec(request.path);
      if (!privateRoute || !((request.method === 'POST' && privateRoute[2] !== 'answer') || (request.method === 'GET' && privateRoute[2] === 'answer'))) return response(404, { code: 'INVALID_INPUT' });
      if (!request.authorization?.startsWith('Bearer ')) throw new FoundationError('UNAUTHORIZED');
      const buyer = controller.authenticate(request.origin, request.authorization.slice('Bearer '.length));
      const id = privateRoute[1] as Id;
      if (request.method === 'GET') return response(200, await controller.answer(buyer, id, request.options));
      if (request.contentType !== 'application/json') throw new FoundationError('INVALID_INPUT');
      if (!privateRoute[2]) return response(200, await controller.quote(buyer, wire.parse('quote_request', request.body), request.peerIp, request.options));
      if (privateRoute[2] === 'arm') {
        const input = wire.parse('arm_request', request.body); if (input.quote_id !== id) throw new FoundationError('INVALID_INPUT');
        return response(200, await controller.arm(buyer, input, request.options));
      }
      const proof = wire.parse('proof', request.body); if (proof.quote_id !== id) throw new FoundationError('INVALID_INPUT');
      return response(200, await controller.payment(buyer, proof, request.options));
    } catch (error) {
      const safe = transportError(error);
      // Parse errors have no raw body/stack reflection.
      const code = error instanceof FoundationError ? safe.code : 'INVALID_INPUT';
      return response(code === 'UNAUTHORIZED' ? 401 : ['NOT_READY', 'CONTENT_REVOKED', 'SELLER_UNAVAILABLE'].includes(code) ? 503 : code === 'RATE_LIMITED' ? 429 : 400, { ...safe, code, message: code });
    }
  };
}
