import test from 'node:test';
import assert from 'node:assert/strict';
import { createSellerHttpClient } from '../../../src/broker/index.ts';
import { FixedClock, FoundationError } from '../../../src/common/index.ts';
import { M03, canonicalBytes } from '../../../src/wire/index.ts';
import { id, sha } from './harness.ts';

test('only a bounded strict revocation error preserves CONTENT_REVOKED; eligible success still passes', async () => {
  const clock = new FixedClock('2026-10-09T00:00:00.000Z');
  const revoked = { code: 'CONTENT_REVOKED', message: 'CONTENT_REVOKED', retryable: false, consult_id: null };
  let status = 503, body: Uint8Array = canonicalBytes(revoked);
  const client = createSellerHttpClient({ origin: 'https://seller.invalid', invitation: 'synthetic-only', clock,
    fetch: async () => new Response(Buffer.from(body), { status }) });
  const read = () => client.eligibility(id('slice'), sha('manifest'));
  const code = (expected: string) => (e: unknown) => e instanceof FoundationError && e.code === expected;
  for (const bad of [
    Buffer.from('{"code":"CONTENT_REVOKED","code":"CONTENT_REVOKED","message":"CONTENT_REVOKED","retryable":false,"consult_id":null}'),
    Uint8Array.of(0xff),
    canonicalBytes({ ...revoked, extra: 'untrusted' }),
    canonicalBytes({ ...revoked, code: 'UNKNOWN_REMOTE_CODE' }),
    canonicalBytes({ ...revoked, message: 'remote prose' }),
    canonicalBytes({ ...revoked, retryable: true }),
    canonicalBytes({ ...revoked, consult_id: 'unbound' }),
    canonicalBytes({ code: 'CONTENT_REVOKED' }),
  ]) {
    body = bad; await assert.rejects(read(), code('SELLER_UNAVAILABLE'));
    body = canonicalBytes(revoked); await assert.rejects(read(), code('CONTENT_REVOKED'));
  }
  status = 400; await assert.rejects(read(), code('SELLER_UNAVAILABLE'));
  status = 503; await assert.rejects(read(), code('CONTENT_REVOKED'));
  body = Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 0x20);
  await assert.rejects(read(), code('INVALID_INPUT'));
  body = canonicalBytes(revoked); await assert.rejects(read(), code('CONTENT_REVOKED'));
  status = 200;
  const eligible = { slice_id: id('slice'), manifest_sha256: sha('manifest'), state: 'eligible', generation: 0, acknowledged_at: clock.now(), checked_at: clock.now() };
  body = canonicalBytes(eligible); assert.deepEqual(await read(), eligible);
});
