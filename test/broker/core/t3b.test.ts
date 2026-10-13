import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, buyer, input, iso, fee } from './harness.ts';
import { FoundationError } from '../../../src/common/index.ts';
import { bindBroker } from '../../../src/broker/index.ts';

test('settlement compares every immutable field but permits a later observation time', async t => {
  const h = harness(); t.after(() => h.cleanup());
  const first = await h.api().consult(buyer, input()); h.settle();
  const result = h.behavior.reconciliation;
  assert.equal(result.status, 'finalized_success');
  if (result.status !== 'finalized_success') throw new Error('fixture');
  const original = result.evidence;
  const changed = { ...original, observed_at: iso('2026-10-10T00:00:00.000Z') };
  for (const field of Object.keys(original).filter(k => k !== 'observed_at')) {
    const value = original[field as keyof typeof original];
    const mutation = { ...changed, [field]: typeof value === 'number' ? value + 1 : field === 'actual_fee' ? fee(2n) : `${value}-changed` };
    h.ports = { ...h.ports, verifyFinalizedPayment: () => mutation };
    await assert.rejects(h.api().status(buyer, { consult_id: first.consult_id }), /PAYMENT_INVALID/, field);
    assert.equal(h.store.scan('settlements', { limit: 10 }).length, 0, field);
    assert.equal(h.store.read('reservations', first.consult_id)!.value.status, 'held', field);
  }
  h.ports = { ...h.ports, verifyFinalizedPayment: () => changed };
  const clean = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal(clean.payment_state, 'payment_finalized');
  assert.equal(clean.delivery_state, 'delivered');
  assert.equal(h.store.read('settlements', first.consult_id)!.value.observed_at, original.observed_at);
  h.reopen();
  assert.equal((await h.api().status(buyer, { consult_id: first.consult_id })).delivery_state, 'delivered');
  assert.equal(h.counts.sign, 1);
});

test('injected account validation runs before signing and on armed restart; rejection preserves the reservation', async t => {
  const h = harness(); t.after(() => h.cleanup());
  let valid = false, validations = 0;
  h.ports = { ...h.ports, async validatePaymentAccounts(expected, rpc) {
    validations++; assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
    assert.equal(rpc, h.deps.primaryRpc); assert.equal(expected.payer.payer, buyer.payer);
    assert.equal(h.store.scan('arms', { limit: 10 }).length, 1);
    assert.equal(h.store.scan('signed_transactions', { limit: 10 }).length, 0);
    if (!valid) throw new FoundationError('PAYMENT_INVALID');
  } };
  const pending = await h.api().consult(buyer, input());
  assert.equal(validations, 1); assert.equal(h.counts.sign, 0);
  assert.equal(h.store.read('reservations', pending.consult_id)!.value.status, 'held');
  h.reopen(); await bindBroker(h.ports).resumePending(h.deps);
  assert.equal(validations, 2); assert.equal(h.counts.sign, 0);
  valid = true; await bindBroker(h.ports).resumePending(h.deps);
  assert.equal(validations, 3); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});
