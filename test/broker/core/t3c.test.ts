import test from 'node:test';
import assert from 'node:assert/strict';
import { FoundationError } from '../../../src/common/index.ts';
import { M03 } from '../../../src/wire/index.ts';
import { bindBroker } from '../../../src/broker/index.ts';
import { buyer, harness, input } from './harness.ts';

for (const pending of [true, false]) test(`F1 pending then ready=${pending}: delivered without temporary refund liability`, async t => {
  const h = harness(); t.after(() => h.cleanup());
  const first = await h.api().consult(buyer, input()); h.settle();
  if (pending) {
    h.behavior.reveal = 'pending';
    const waiting = await h.api().status(buyer, { consult_id: first.consult_id });
    assert.equal(waiting.answer, null);
    // Check the reported bad combination after recovery, not merely the first failure.
    h.reopen(); h.behavior.reveal = 'valid';
  }
  const delivered = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal(delivered.delivery_state, 'delivered'); assert.equal(delivered.refund_state, 'none');
  assert.equal(h.store.read('receipts', delivered.receipt_id)!.value.refund_state, 'none');
  h.clock.advance(M03.dedupWindow.value * 60000 + 1);
  await h.api().consult(buyer, input(2)); assert.equal(h.counts.sign, 2);
});

for (const revoked of [false, true]) test(`F3 cached delivery eligibility outage; revoked=${revoked}`, async t => {
  const h = harness(); t.after(() => h.cleanup());
  const first = await h.api().consult(buyer, input()); h.settle();
  const delivered = await h.api().status(buyer, { consult_id: first.consult_id }); assert.ok(delivered.answer);
  h.clock.advance(M03.nonDeliveryAfterFinality.value * 60000);
  const seller = h.deps.sellers.get('https://b.invalid')!; const original = seller.eligibility;
  seller.eligibility = async () => { throw new FoundationError(revoked ? 'CONTENT_REVOKED' : 'SELLER_UNAVAILABLE'); };
  const hidden = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(hidden.answer, null);
  assert.equal(hidden.refund_state, revoked ? 'refund_pending' : 'none');
  if (!revoked) assert.deepEqual(h.store.read('consults', first.consult_id)!.value.view!.answer, delivered.answer);
  seller.eligibility = original; h.reopen();
  const restored = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.deepEqual(restored.answer, revoked ? null : delivered.answer);
  assert.equal(h.counts.answer, 1); assert.equal(h.counts.sign, 1);
});

for (const expired of [true, false]) test(`F4 armed height expired=${expired}: no signing and zero reservation on expiry`, async t => {
  const h = harness(); t.after(() => h.cleanup());
  h.deps.primaryRpc.finalizedHeight = async () => expired ? 101 : 100;
  const result = await h.api().consult(buyer, input());
  const reservation = h.store.read('reservations', result.consult_id)!.value;
  assert.equal(h.counts.sign, expired ? 0 : 1);
  assert.equal(reservation.status, expired ? 'resolved' : 'held');
  if (expired) { assert.equal(result.consult_state, 'quote_expired'); assert.equal(reservation.actualPrincipal, '0'); assert.equal(reservation.actualFee, '0'); }
});

test('F4 lost arm reply expires before any signer call; restart resolves 0/0', async t => {
  const h = harness(); t.after(() => h.cleanup());
  const seller = h.deps.sellers.get('https://b.invalid')!; const original = seller.arm;
  seller.arm = async () => { throw new FoundationError('SELLER_UNAVAILABLE'); };
  const result = await h.api().consult(buyer, input()); assert.equal(h.counts.sign, 0);
  assert.equal(h.store.read('reservations', result.consult_id)!.value.status, 'held');
  h.clock.advance(M03.quoteTtl.value * 1000); h.reopen();
  await bindBroker(h.ports).resumePending(h.deps);
  const reservation = h.store.read('reservations', result.consult_id)!.value;
  assert.equal(reservation.status, 'resolved'); assert.equal(reservation.actualPrincipal, '0'); assert.equal(reservation.actualFee, '0');
  seller.arm = original; await h.api().consult(buyer, input(2)); assert.equal(h.counts.sign, 1);
});

test('F4 unknown signer transport remains held after expiry, explicit refusal closes without broadcast', async t => {
  const h = harness(); t.after(() => h.cleanup());
  const signer = h.deps.signer; signer.sign = async () => { throw new Error('transport lost'); };
  const result = await h.api().consult(buyer, input()); h.clock.advance(M03.quoteTtl.value * 1000); h.reopen();
  await h.api().status(buyer, { consult_id: result.consult_id });
  assert.equal(h.store.read('reservations', result.consult_id)!.value.status, 'held');
  signer.recover = async () => ({ status: 'denied', reason: 'QUOTE_EXPIRED' });
  const refused = await h.api().status(buyer, { consult_id: result.consult_id });
  assert.equal(h.store.read('reservations', result.consult_id)!.value.status, 'resolved');
  assert.match(refused.message, /signing_refused/); assert.equal(h.counts.broadcast, 0);
});

for (const mode of ['same', 'unenrolled', 'missing', 'clean'] as const) test(`D1 broker construction RPC ${mode}`, t => {
  const h = harness(); t.after(() => h.cleanup());
  const origin = mode === 'same' ? h.ports.rpcOrigins[0] : mode === 'unenrolled' ? 'https://unlisted.invalid' : h.ports.rpcOrigins[1];
  h.deps = { ...h.deps, primaryRpc: Object.assign({}, h.deps.primaryRpc, { origin: h.ports.rpcOrigins[0] }), secondaryRpc: Object.assign({}, h.deps.secondaryRpc, { origin: mode === 'missing' ? undefined : origin }) };
  if (mode === 'clean') assert.ok(h.api()); else assert.throws(() => h.api());
});

test('F4 malformed height is not expiry evidence; clean height permits signing', async t => {
  const h = harness(); t.after(() => h.cleanup());
  h.deps.primaryRpc.finalizedHeight = async () => NaN;
  const result = await h.api().consult(buyer, input());
  assert.equal(h.store.read('reservations', result.consult_id)!.value.status, 'held'); assert.equal(h.counts.sign, 0);
  h.deps.primaryRpc.finalizedHeight = async () => 100; h.reopen();
  await bindBroker(h.ports).resumePending(h.deps); assert.equal(h.counts.sign, 1);
});

test('F4 explicit signer refusal releases 0/0 without broadcast; allowed control signs', async t => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.signer = 'denied';
  const result = await h.api().consult(buyer, input());
  const reservation = h.store.read('reservations', result.consult_id)!.value;
  assert.equal(reservation.status, 'resolved'); assert.equal(reservation.actualPrincipal, '0'); assert.equal(reservation.actualFee, '0');
  assert.equal(result.message, 'signing_refused'); assert.equal(h.counts.broadcast, 0);
  h.behavior.signer = 'normal'; h.clock.advance(M03.quoteTtl.value * 1000);
  await h.api().consult(buyer, input(2)); assert.equal(h.counts.broadcast, 1);
});

test('F1 temporary eligibility outage becomes non-delivery only at M03 deadline; cached delivery remains exempt', async t => {
  const h = harness(); t.after(() => h.cleanup());
  const first = await h.api().consult(buyer, input()); h.settle();
  const seller = h.deps.sellers.get('https://b.invalid')!; const original = seller.eligibility;
  seller.eligibility = async () => { throw new FoundationError('SELLER_UNAVAILABLE'); };
  const waiting = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal(waiting.refund_state, 'none'); assert.equal(waiting.answer, null);
  h.clock.advance(M03.nonDeliveryAfterFinality.value * 60000); h.reopen();
  const overdue = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal(overdue.delivery_state, 'delivery_failed'); assert.equal(overdue.refund_state, 'refund_pending');
  seller.eligibility = original;
});
