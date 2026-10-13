/** Origin-pinned HTTP transport. Host supplies invitation and fetch capability;
 * callers cannot choose URLs, redirect destinations or authorization headers. */
import { FoundationError, withDeadline } from '../common/index.ts';
import { M03, canonicalBytes, parseWire, strictJson, validateWire } from '../wire/index.ts';
import type { Clock, Id, SellerCallOptions, SellerClient } from '../wire/contracts.ts';
export interface SellerHttpClientConfig {
  readonly origin: string; readonly invitation: string; readonly clock: Clock;
  readonly fetch: typeof fetch; readonly isolatedLoopback?: boolean;
}
export function createSellerHttpClient(config: SellerHttpClientConfig): SellerClient {
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || (origin.protocol !== 'https:' && !(config.isolatedLoopback && origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new FoundationError('POLICY_DENIED');
  function segment(id: Id): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new FoundationError('INVALID_INPUT'); return id;
  }
  async function request(path: string, body: unknown, authenticated: boolean, options?: SellerCallOptions, page = false): Promise<Uint8Array> {
    return withDeadline(config.clock, M03.precheckMax.value * 1000, async (call) => {
      const bytes = body === undefined ? undefined : canonicalBytes(body);
      if (bytes && bytes.length > M03.ingressBodyMax.value * 1024) throw new FoundationError('INVALID_INPUT');
      const response = await config.fetch(`${config.origin}${path}`, { method: bytes ? 'POST' : 'GET', redirect: 'error', signal: call.signal,
        headers: { ...(authenticated ? { authorization: `Bearer ${config.invitation}` } : {}), ...(bytes ? { 'content-type': 'application/json' } : {}) },
        ...(bytes ? { body: Buffer.from(bytes) } : {}) });
      if (response.redirected) throw new FoundationError('SELLER_UNAVAILABLE');
      const reader = response.body?.getReader(); if (!reader) throw new FoundationError('INVALID_INPUT');
      const limit = (response.ok && page ? M03.citedPageMax.value : M03.ingressBodyMax.value) * 1024;
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          call.signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
          size += part.value.length; if (size > limit) throw new FoundationError('INVALID_INPUT'); chunks.push(part.value);
        }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
      call.signal.throwIfAborted();
      const result = Buffer.concat(chunks);
      if (!response.ok) {
        // Only the fixed, strict seller revocation envelope conveys revocation.
        // Never trust or reflect arbitrary server prose, fields or error codes.
        let revoked = false;
        try {
          const error: unknown = strictJson(result, { integerNumbersOnly: true });
          if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
            const fields = error as Record<string, unknown>;
            revoked = response.status === 503 && Object.keys(fields).sort().join(',') === 'code,consult_id,message,retryable'
              && fields.code === 'CONTENT_REVOKED' && fields.message === 'CONTENT_REVOKED'
              && fields.retryable === false && fields.consult_id === null;
          }
        } catch { /* Malformed errors convey no trusted state. */ }
        throw new FoundationError(revoked ? 'CONTENT_REVOKED' : 'SELLER_UNAVAILABLE');
      }
      return result;
    }, options);
  }
  const json = async (path: string, body: unknown, auth: boolean, options?: SellerCallOptions) => strictJson(await request(path, body, auth, options), { integerNumbersOnly: true });
  return {
    async quote(_context, input, _ip, options) { return validateWire('quote_disposition', await json('/v1/quotes', input, true, options)); },
    async arm(_context, input, options) { return parseWire('arm', await request(`/v1/quotes/${segment(input.quote_id)}/arm`, input, true, options)); },
    async payment(_context, input, options) { return validateWire('payment_view', await json(`/v1/quotes/${segment(input.quote_id)}/payment`, input, true, options)); },
    async answer(_context, quoteId, options) { return validateWire('answer_disposition', await json(`/v1/quotes/${segment(quoteId)}/answer`, undefined, true, options)); },
    async manifest(sliceId, options) { return parseWire('manifest', await request(`/v1/slices/${segment(sliceId)}/manifest`, undefined, false, options)); },
    async page(sliceId, pageId, options) { return request(`/v1/slices/${segment(sliceId)}/pages/${segment(pageId)}`, undefined, false, options, true); },
    async eligibility(sliceId, hash, options) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new FoundationError('INVALID_INPUT');
      return validateWire('eligibility', await json(`/v1/slices/${segment(sliceId)}/eligibility/${hash}`, undefined, false, options));
    },
  };
}
