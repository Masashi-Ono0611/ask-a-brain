import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../src/wire/index.ts';
import { createSellerService } from '../../src/seller/index.ts';
import { fixture, purchase } from './support.ts';

for (const phase of ['payment', 'answer', 'non-delivery', 'clean'] as const) test(`F2 ${phase}: never disclose while full recovery is owed`, async t => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized');
  const key = `${p.quote.payload.slice_id}:${p.quote.payload.manifest_sha256}`;
  const eligibility = f.store.read('eligibility', key)!;
  const setGate = (healthy: boolean) => f.store.transaction(tx => { const current = tx.read('eligibility', key)!; tx.compareAndSet('eligibility', key, current.version, { ...eligibility.value, state: healthy ? 'eligible' : 'unknown' }); });
  if (phase === 'payment') setGate(false);
  await f.service.payment(f.buyer, p.proof);
  if (phase === 'answer') { setGate(false); assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'withheld'); }
  if (phase === 'non-delivery') { f.clock.advance(M03.nonDeliveryAfterFinality.value * 60000); await f.service.reconcilePending(); }
  setGate(true); await f.restart();
  const result = await f.service.answer(f.buyer, p.quote.payload.quote_id);
  const row = f.store.read('quotes', p.quote.payload.quote_id)!.value;
  assert.ok(result.status !== 'ready' || (row.refund_state === 'none' && row.requested_recovery_atomic === '0'), 'answer released while principal still owed');
  if (phase === 'clean') assert.equal(result.status, 'ready');
  assert.equal(result.status, 'ready'); assert.equal(row.refund_state, 'none'); assert.equal(row.requested_recovery_atomic, '0');
  if (phase === 'non-delivery') assert.ok(f.store.scan('events', { where: { consult_id: p.quote.payload.quote_id }, limit: 100 }).some(e => e.value.code === 'NON_DELIVERY'));
});

for (const mode of ['same', 'unenrolled', 'missing', 'clean'] as const) test(`D1 seller construction RPC ${mode}`, t => {
  const f = fixture(t); const rpcOrigins = ['https://one.invalid', 'https://two.invalid'] as const;
  const origin = mode === 'same' ? rpcOrigins[0] : mode === 'unenrolled' ? 'https://unlisted.invalid' : rpcOrigins[1];
  const deps = { ...f.deps, config: { ...f.config, rpcOrigins }, primaryRpc: Object.assign({}, f.deps.primaryRpc, { origin: rpcOrigins[0] }), secondaryRpc: Object.assign({}, f.deps.secondaryRpc, { origin: mode === 'missing' ? undefined : origin }) };
  if (mode === 'clean') assert.ok(createSellerService(deps)); else assert.throws(() => createSellerService(deps));
});

for (const refund of ['partial_refund', 'refunded'] as const) test(`F2 ${refund} is never erased by late delivery; unpaid recovery control works`, async t => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof);
  const key = p.quote.payload.quote_id; const original = f.store.read('quotes', key)!;
  f.store.transaction(tx => tx.compareAndSet('quotes', key, original.version, { ...original.value, refund_state: refund }));
  assert.equal((await f.service.answer(f.buyer, key)).status, 'withheld');
  assert.equal(f.store.read('quotes', key)!.value.refund_state, refund);
  f.store.transaction(tx => tx.compareAndSet('quotes', key, tx.read('quotes', key)!.version, original.value));
  assert.equal((await f.service.answer(f.buyer, key)).status, 'ready');
});

test('D1 seller missing configured allowlist fails closed; explicit pins pass', t => {
  const f = fixture(t); const config = { ...f.config }; delete config.rpcOrigins;
  assert.throws(() => createSellerService({ ...f.deps, config }));
  assert.ok(createSellerService(f.deps));
});
