import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../src/wire/constants.ts';
import type { SellerHttpRequest } from '../../src/seller/index.ts';
import { nodeListener } from '../../scripts/seller/runtime.ts';
import { fixture, settle, purchase, bytes } from './support.ts';

function request(f: ReturnType<typeof fixture>, overrides: Partial<SellerHttpRequest> = {}): SellerHttpRequest {
  return { method: 'POST', path: '/v1/quotes', origin: f.config.origin, peerIp: 'synthetic-peer', authorization: `Bearer ${f.token}`, contentType: 'application/json', body: bytes(f.request()), ...overrides };
}
test('route allowlist: no admin, enrolment, arbitrary URL/path/query or alternate methods; public controls pass', async (t) => {
  const f = fixture(t); await f.service.start(); const handler = f.handler();
  for (const path of ['/admin', '/v1/revoke', '/v1/enrol', '/v1/quotes/x/status', '/v1/slices/slice/pages/../key', '/v1/slices/slice/pages/%2e%2e', '/v1/slices/slice/pages/p1?url=http://outside']) {
    assert.notEqual((await handler(request(f, { method: 'GET', path, body: new Uint8Array() }))).status, 200);
  }
  assert.equal((await handler(request(f, { method: 'DELETE' }))).status, 404);
  for (const path of ['/healthz', '/readyz', '/v1/slices/slice/manifest', '/v1/slices/slice/pages/p1', `/v1/slices/slice/eligibility/${f.config.listing.slice.manifest_sha256}`]) {
    const response = await handler(request(f, { method: 'GET', path, body: new Uint8Array(), authorization: '' })); assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const path of ['/healthz', '/readyz']) { const value = Buffer.from((await handler(request(f, { method: 'GET', path, body: new Uint8Array() }))).body).toString(); assert.ok(!value.includes('p1')); assert.ok(!value.includes('slice')); }
});
test('origin-specific invitation plus server buyer ownership on every private route; valid owner controls', async (t) => {
  const f = fixture(t); await f.service.start(); const handler = f.handler(); const q = f.request();
  assert.equal((await handler(request(f, { authorization: 'Bearer wrong', body: bytes(q) }))).status, 401);
  assert.equal((await handler(request(f, { origin: 'https://other.invalid', body: bytes(q) }))).status, 400);
  assert.equal((await handler(request(f, { authorization: `Bearer ${f.otherToken}`, body: bytes(q) }))).status, 401);
  const p = await purchase(f, q);
  for (const [method, suffix, body] of [['POST', 'arm', bytes(p.armInput)], ['POST', 'payment', bytes(p.proof)], ['GET', 'answer', new Uint8Array()]] as const) {
    const base = { method, path: `/v1/quotes/${p.quote.payload.quote_id}/${suffix}`, body };
    assert.equal((await handler(request(f, { ...base, authorization: `Bearer ${f.otherToken}` }))).status, 401);
    assert.equal((await handler(request(f, base))).status, 200);
  }
  const again = await settle(f, handler(request(f, { body: bytes(q) }))); assert.equal(again.status, 200);
});
test('strict body duplicate/unknown/UTF-8/version/size and route-body ID checks fire before signing; clean input passes', async (t) => {
  const f = fixture(t); await f.service.start(); const handler = f.handler(); const input = f.request();
  for (const body of [Buffer.from('{"v":1,"v":1}'), Buffer.from('{"v":1,"\\u0076":1}'), Uint8Array.of(0xff), bytes({ ...input, attachments: [] }), bytes({ ...input, v: 2 }), Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 97)]) {
    assert.equal((await handler(request(f, { body }))).status, 400);
  }
  assert.equal(f.counts.seals, 0);
  assert.equal((await handler(request(f, { contentType: 'text/plain' }))).status, 400);
  assert.equal((await handler(request(f, { method: 'GET', path: '/healthz' }))).status, 400);
  const p = await purchase(f, input);
  assert.equal((await handler(request(f, { path: '/v1/quotes/wrong/arm', body: bytes(p.armInput) }))).status, 400);
  assert.equal((await handler(request(f, { path: `/v1/quotes/${p.quote.payload.quote_id}/arm`, body: bytes(p.armInput) }))).status, 200);
});
test('revoked public/ready and private cache routes return no prose; liveness stays content-free', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof); const handler = f.handler();
  const answerRequest = request(f, { method: 'GET', path: `/v1/quotes/${p.quote.payload.quote_id}/answer`, body: new Uint8Array() });
  assert.match(Buffer.from((await handler(answerRequest)).body).toString(), /確認/);
  await f.service.revoke(f.revocation());
  for (const path of ['/readyz', '/v1/slices/slice/manifest', '/v1/slices/slice/pages/p1', answerRequest.path]) {
    const response = await handler({ ...answerRequest, path }); assert.ok(!Buffer.from(response.body).toString().includes('確認'));
  }
  assert.equal((await handler({ ...answerRequest, path: '/healthz' })).status, 200);
});
test('plain HTTP requires explicit isolated exact loopback; HTTPS and enrolled loopback controls accepted', (t) => {
  const f = fixture(t); const handler = f.handler();
  for (const origin of ['http://seller.invalid', 'http://127.0.0.1', 'http://192.168.1.1']) assert.throws(() => nodeListener(handler, origin), /INVALID_ORIGIN/);
  assert.throws(() => nodeListener(handler, 'http://192.168.1.1', true), /INVALID_ORIGIN/);
  assert.equal(typeof nodeListener(handler, 'http://127.0.0.1', true), 'function'); assert.equal(typeof nodeListener(handler, f.config.origin), 'function');
});
