import test from 'node:test';
import assert from 'node:assert/strict';
import { FoundationError } from '../../src/common/index.ts';
import { M03, bytesHash } from '../../src/wire/index.ts';
import { harness, settle } from './harness.ts';
import { id } from '../../scripts/integration/synthetic.ts';

for (const fault of ['owner', 'mint', 'decimals'] as const) test(`core broker rejects wrong account ${fault} before sign; restored accounts pass`, async t => {
  const h = await harness(); t.after(() => h.cleanup()); h.faults.accountFault = fault;
  const bad = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  assert.ok(h.counts.accounts > 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  assert.equal(h.store.scan('signed_transactions', { limit: 10 }).length, 0);
  assert.equal(bad.payment_state, 'payment_pending');
  h.faults.accountFault = ''; await h.reopen();
  await settle(h, h.broker.resume());
  const clean = await settle(h, h.broker.market.status(h.buyer, { consult_id: bad.consult_id }));
  assert.equal(clean.payment_state, 'payment_finalized'); assert.equal(clean.delivery_state, 'delivered');
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});

test('changing RPC observation timestamps still finalizes through the unadapted broker and seller', async t => {
  const h = await harness(); t.after(() => h.cleanup()); h.faults.freshObservations = true;
  const pending = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  const clean = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(clean.payment_state, 'payment_finalized'); assert.equal(clean.delivery_state, 'delivered');
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});

for (const when of ['pending', 'delivered'] as const) test(`HTTP revocation after ${when} stays revoked across restart and retains liability`, async t => {
  const h = await harness(); t.after(() => h.cleanup());
  const pending = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  const seller = h.sellerRows[1]!, slice = seller.listing.slice;
  assert.equal((await seller.client.eligibility(slice.id, slice.manifest_sha256)).state, 'eligible');
  if (when === 'delivered') {
    const clean = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
    assert.equal(clean.delivery_state, 'delivered'); assert.ok(clean.answer);
  }
  await seller.controller.revoke({ slice_id: slice.id, manifest_sha256: slice.manifest_sha256, generation: 1, revoked_at: h.clock.now(), reason: 'rights', approval_id: id('t3b-revoke') });
  await assert.rejects(seller.client.eligibility(slice.id, slice.manifest_sha256), e => e instanceof FoundationError && e.code === 'CONTENT_REVOKED');
  for (let attempt = 0; attempt < 2; attempt++) {
    const bad = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
    assert.equal(bad.payment_state, 'payment_finalized'); assert.equal(bad.content_state, 'revoked'); assert.equal(bad.answer, null);
    assert.equal(bad.delivery_state, 'recovery_required'); assert.equal(bad.refund_state, 'refund_pending');
    assert.equal(bad.purchase_amount_atomic, String(M03.totalAtomic.value));
    assert.equal(h.store.read('receipts', bad.receipt_id)!.value.content_state, 'revoked');
    const key = bytesHash(Buffer.from(`${slice.id}\n${slice.manifest_sha256}`));
    assert.equal(h.store.read('eligibility', key)!.value.state, 'revoked');
    await h.reopen();
  }
  // An old eligible response cannot undo a revocation already learned durably.
  const prior = h.deps.sellers.get(seller.listing.endpoint)!;
  (h.deps.sellers as Map<string, typeof prior>).set(seller.listing.endpoint, { ...prior, async eligibility() {
    return { slice_id: slice.id, manifest_sha256: slice.manifest_sha256, generation: 0, state: 'eligible', acknowledged_at: h.clock.now(), checked_at: h.clock.now() };
  } });
  h.rebuild();
  const restored = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(restored.content_state, 'revoked'); assert.equal(restored.answer, null);
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});
