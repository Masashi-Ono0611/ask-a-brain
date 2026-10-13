import test from 'node:test';
import assert from 'node:assert/strict';
import { Admission } from '../../src/seller/admission.ts';
import { M03 } from '../../src/wire/constants.ts';
import { createSellerService } from '../../src/seller/index.ts';
import type { BuyerContext, Id } from '../../src/wire/contracts.ts';
import { fixture, settle } from './support.ts';

test('buyer minute/day counters persist, reject cap+1 and restored UTC window accepts clean control', async (t) => {
  const f = fixture(t); const seller = f.config.listing.seller_id;
  let admission = new Admission(f.store, f.clock, M03, seller);
  for (let i = 0; i < M03.buyerSellerChecksPerMinute.value; i++) admission.reserve(f.buyer, 'ip');
  assert.throws(() => admission.reserve(f.buyer, 'ip'), /RATE_LIMITED/);
  await f.restart(); admission = new Admission(f.store, f.clock, M03, seller); assert.throws(() => admission.reserve(f.buyer, 'ip'), /RATE_LIMITED/);
  f.clock.advance(60000); admission.reserve(f.buyer, 'ip');
  for (let i = M03.buyerSellerChecksPerMinute.value + 1; i < M03.buyerSellerChecksPerDay.value; i++) { f.clock.advance(60000); admission.reserve(f.buyer, 'ip'); }
  f.clock.advance(60000); assert.throws(() => admission.reserve(f.buyer, 'ip'), /RATE_LIMITED/);
  f.clock.advance(24 * 3600 * 1000); admission.reserve(f.buyer, 'ip');
});
test('IP minute and seller day ceilings reject at shared caps; fresh permitted windows pass', (t) => {
  const f = fixture(t); const admission = new Admission(f.store, f.clock, M03, f.config.listing.seller_id);
  const buyer = (i: number): BuyerContext => ({ ...f.buyer, buyer_id: `synthetic-${i}` as Id });
  for (let i = 0; i < M03.ipChecksPerMinute.value; i++) admission.reserve(buyer(i), 'same-ip');
  assert.throws(() => admission.reserve(buyer(999), 'same-ip'), /RATE_LIMITED/); f.clock.advance(60000);
  for (let i = M03.ipChecksPerMinute.value; i < M03.sellerChecksPerDay.value; i++) admission.reserve(buyer(i), `synthetic-ip-${i}`);
  assert.throws(() => admission.reserve(buyer(999), 'different-ip'), /RATE_LIMITED/);
  f.clock.advance(24 * 3600 * 1000); admission.reserve(buyer(999), 'same-ip');
});
test('one active per buyer, two seller jobs, queue bound and timeout with released clean control', async (t) => {
  const f = fixture(t); const admission = new Admission(f.store, f.clock, M03, f.config.listing.seller_id);
  const releaseA = await admission.enter('a' as Id); await assert.rejects(admission.enter('a' as Id), /RATE_LIMITED/);
  const releaseB = await admission.enter('b' as Id); const queued = Array.from({ length: M03.queueMax.value }, (_, i) => admission.enter(`q${i}` as Id));
  // Attach handlers before advancing the virtual clock to avoid unhandled rejections.
  const timed = queued.map((p) => assert.rejects(p, /SELLER_UNAVAILABLE/));
  await assert.rejects(admission.enter('overflow' as Id), /RATE_LIMITED/);
  f.clock.advance(M03.queueWaitMax.value * 1000); await Promise.all(timed); releaseA(); releaseB();
  const release = await admission.enter('a' as Id); release();
});
test('queue handoff cancels timeout and preserves capacity for allowed next job', async (t) => {
  const f = fixture(t); const admission = new Admission(f.store, f.clock, M03, f.config.listing.seller_id);
  const a = await admission.enter('a' as Id); const b = await admission.enter('b' as Id); const queued = admission.enter('c' as Id);
  a(); const c = await queued; f.clock.advance(M03.queueWaitMax.value * 1000); c(); b();
  const good = await admission.enter('c' as Id); good();
});
test('30-second deadline cannot issue a late quote or release a still-running worker slot', async (t) => {
  const f = fixture(t); let unblock!: () => void; const paused = new Promise<void>((resolve) => { unblock = resolve; }); let slow = true;
  const worker = f.config.worker;
  const service = createSellerService({ ...f.deps, config: { ...f.config, worker: { async prepare(...args) { if (slow) await paused; return worker.prepare(...args); } } } });
  await service.start(); const pending = service.quote(f.buyer, f.request()); const rejected = assert.rejects(pending, /SELLER_UNAVAILABLE/);
  await new Promise<void>((r) => setImmediate(r)); f.clock.advance(M03.precheckMax.value * 1000); await rejected;
  assert.equal(f.store.scan('quotes', { limit: 1 }).length, 0);
  await assert.rejects(settle(f, service.quote(f.buyer, f.request(1))), /RATE_LIMITED/);
  slow = false; unblock(); await new Promise<void>((r) => setImmediate(r)); f.clock.advance(60000);
  assert.equal((await settle(f, service.quote(f.buyer, f.request(1)))).status, 'ready');
});
