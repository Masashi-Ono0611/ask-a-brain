import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { M03 } from '../../../src/wire/constants.ts';
import { bindBroker } from '../../../src/broker/index.ts';
import { readJournal } from '../../../src/broker/journal.ts';
import { reservations } from '../../../src/broker/reservations.ts';
import { harness, buyer, input, sha, fee, address, iso } from './harness.ts';

test('lost wallet response recovers existing signature after restart, never signs or buys again', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.signer = 'lost';
  const result = await h.api().consult(buyer, input()); assert.equal(result.payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 0);
  assert.equal(readJournal(h.store, result.consult_id).value.broker.stage, 'signing'); h.reopen();
  const summary = await bindBroker(h.ports).resumePending(h.deps); assert.deepEqual(summary, { pending: 1, resolved: 0, failed: 0 });
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.recover, 1); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.quote, 2);
  const bytes = h.broadcastBytes[0]; await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(h.broadcastBytes[1], bytes);
  h.settle(); const complete = await h.api().status(buyer, { consult_id: result.consult_id });
  assert.equal(complete.payment_state, 'payment_finalized'); assert.equal(complete.delivery_state, 'delivered'); assert.equal(complete.answer?.text, 'public evidence'); assert.ok(h.store.read('receipts', complete.receipt_id));
  h.reopen(); const restored = await h.api().status(buyer, { consult_id: result.consult_id }); assert.deepEqual(restored, complete); assert.equal(h.counts.sign, 1); assert.equal(h.counts.answer, 1);
});

test('missing signer recovery and RPC null stay pending across expiry, no replacement or released fee', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.signer = 'lost'; const result = await h.api().consult(buyer, input()); h.signatures.clear(); h.clock.advance(M03.quoteTtl.value * 1000 * 2); h.reopen();
  const status = await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(status.payment_state, 'payment_pending'); assert.equal(status.purchase_amount_atomic, null); assert.equal(status.network_fee_lamports, null);
  assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 0); assert.equal(h.counts.quote, 2);
  // Clean counterpart supplies the wallet's existing message, no new sign call.
  const row = readJournal(h.store, result.consult_id).value;
  h.signatures.set(row.request_id, { status: 'signed', messageHash: row.broker.messageHash!, publicKey: buyer.payer, signature: 'recovered-signature' as import('../../../src/wire/contracts.ts').Signature, approvalRef: 'recovered' as import('../../../src/wire/contracts.ts').Id });
  await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.sign, 1);
});

test('wallet message substitution blocks broadcast; restoring exact journaled signature recovers once', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.signer = 'substitute'; const result = await h.api().consult(buyer, input());
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 0); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held');
  h.reopen(); await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.sign, 1);
});

test('arm message binding rejects tamper before signing; same selected quote recovers without failover', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.mutateArm = (arm) => ({ ...arm, payload: { ...arm.payload, message_sha256: sha('bad') } });
  const result = await h.api().consult(buyer, input()); assert.equal(h.counts.arm, 1); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0); assert.equal(readJournal(h.store, result.consult_id).value.broker.stage, 'arming');
  h.behavior.mutateArm = null; h.reopen(); assert.deepEqual(await bindBroker(h.ports).resumePending(h.deps), { pending: 1, resolved: 0, failed: 0 });
  assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.arm, 2);
});

test('expiry release requires two distinct pinned origins, matching genesis/signature, finalized height and absence', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const result = await h.api().consult(buyer, input());
  const signed = h.store.read('signed_transactions', result.consult_id)!.value;
  const observations = h.ports.rpcOrigins.map((origin) => ({ origin, genesis: signed.genesis, finalizedHeight: 101, signature: { signature: signed.signature, status: 'absent' as const, slot: null, err: null, observedAt: h.clock.now() } })) as unknown as readonly [import('../../../src/wire/contracts.ts').ExpiryObservation, import('../../../src/wire/contracts.ts').ExpiryObservation];
  const good = observations as unknown as readonly [import('../../../src/wire/contracts.ts').ExpiryObservation, import('../../../src/wire/contracts.ts').ExpiryObservation];
  const bad = [ [good[0], good[0]], [good[0], { ...good[1], finalizedHeight: 100 }], [good[0], { ...good[1], genesis: address('wrong') }], [good[0], { ...good[1], signature: { ...good[1].signature, status: 'confirmed' } }], [good[0], { ...good[1], origin: 'https://not-enrolled.invalid' }] ];
  for (const pair of bad) {
    h.behavior.reconciliation = { status: 'expired', observations: pair as unknown as typeof good };
    await assert.rejects(h.api().status(buyer, { consult_id: result.consult_id }), /PAYMENT_UNCERTAIN/); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held');
  }
  h.behavior.reconciliation = { status: 'expired', observations: good }; h.reopen();
  const expired = await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(expired.payment_state, 'payment_failed'); assert.equal(expired.purchase_amount_atomic, '0'); assert.equal(expired.network_fee_lamports, '0'); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'resolved'); assert.equal(h.counts.sign, 1);
});

test('finalized failure preserves charged fee and requires exact signed transaction/message', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const result = await h.api().consult(buyer, input()); h.settle(false, 3n);
  const good = h.behavior.reconciliation; assert.equal(good.status, 'finalized_failure'); if (good.status !== 'finalized_failure') return;
  h.behavior.reconciliation = { ...good, transaction: { ...good.transaction, message: Buffer.from('wrong') } };
  await assert.rejects(h.api().status(buyer, { consult_id: result.consult_id }), /PAYMENT_INVALID/); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held');
  h.behavior.reconciliation = good; const failed = await h.api().status(buyer, { consult_id: result.consult_id }); assert.equal(failed.network_fee_lamports, '3'); assert.equal(failed.purchase_amount_atomic, '0'); assert.equal(h.counts.answer, 0);
});

test('offer denial, offer timeout/arm margin, unavailable fee and fee cap+1 do not sign; clean restoration passes', async (t) => {
  for (const mode of ['denied', 'margin', 'fee-null', 'fee-high'] as const) {
    const h = harness(); t.after(() => h.cleanup());
    if (mode === 'denied') h.behavior.approval = 'denied';
    if (mode === 'margin') h.behavior.beforeApproval = () => h.clock.advance((M03.quoteTtl.value - M03.armRemainingMin.value) * 1000 + 1);
    if (mode === 'fee-null') h.behavior.feeEstimate = null;
    if (mode === 'fee-high') h.behavior.feeEstimate = fee(M03.feePerPurchaseMax.value + 1n);
    const result = await h.api().consult(buyer, input()); assert.ok(['cancelled', 'quote_expired'].includes(result.consult_state)); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
    h.behavior.approval = 'approved'; h.behavior.beforeApproval = null; h.behavior.feeEstimate = fee(1n); h.clock.advance(M03.quoteTtl.value * 1000);
    assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
  }
});

test('revocation before arm prevents signing; paid cache revocation remains sticky through restart', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.eligibility = 'revoked';
  await h.api().consult(buyer, input()); assert.equal(h.counts.arm, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  // Independent clean fixture, not a rollback of the revoked listing.
  const clean = harness(); t.after(() => clean.cleanup()); const first = await clean.api().consult(buyer, input()); clean.settle();
  const delivered = await clean.api().status(buyer, { consult_id: first.consult_id }); assert.equal(delivered.answer?.text, 'public evidence');
  clean.behavior.eligibility = 'revoked'; assert.equal((await clean.api().status(buyer, { consult_id: first.consult_id })).answer, null);
  clean.reopen(); clean.behavior.eligibility = 'eligible';
  const withheld = await clean.api().status(buyer, { consult_id: first.consult_id }); assert.equal(withheld.content_state, 'revoked'); assert.equal(withheld.payment_state, 'payment_finalized'); assert.equal(withheld.refund_state, 'refund_pending'); assert.equal(withheld.answer, null); assert.equal(clean.counts.sign, 1);
});

test('corrupt committed answer never returns; exact same answer can recover without payment retry', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input()); h.settle(); h.behavior.reveal = 'corrupt';
  const invalid = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(invalid.answer, null); assert.equal(invalid.delivery_state, 'verification_failed'); assert.equal(invalid.refund_state, 'refund_pending');
  h.behavior.reveal = 'valid'; h.reopen(); const recovered = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(recovered.answer?.text, 'public evidence'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.quote, 2); assert.equal(h.counts.broadcast, 1);
});

test('reveal budget is durable and bounded across restarts; no fresh quote, signature or unbounded retry', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input()); h.settle(); h.behavior.reveal = 'pending';
  for (let n = 0; n < M03.revealRetriesMax.value + 4; n++) { h.reopen(); await h.api().status(buyer, { consult_id: first.consult_id }); }
  assert.equal(h.counts.answer, 1 + M03.revealRetriesMax.value); assert.equal(h.counts.sign, 1); assert.equal(h.counts.quote, 2);
  h.clock.advance(M03.nonDeliveryAfterFinality.value * 60000); const failed = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(failed.delivery_state, 'delivery_failed'); assert.equal(failed.refund_state, 'refund_pending');
});

test('new UUID cannot replace pending purchase after dedup window; durable alias conflicts and resolves original receipt', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input());
  h.clock.advance(M03.dedupWindow.value * 60000 + 1); h.reopen();
  const alias = await h.api().consult(buyer, input(2)); assert.equal(alias.consult_id, first.consult_id); assert.equal(alias.receipt_id, first.receipt_id); assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 1);
  await assert.rejects(h.api().consult(buyer, { ...input(2), max_price: { ...input(2).max_price, amount_atomic: (M03.totalAtomic.value + 1n).toString() as import('../../../src/wire/contracts.ts').Atomic } }), /IDEMPOTENCY_CONFLICT/);
  h.settle(); const delivered = await h.api().status(buyer, { consult_id: first.consult_id }); h.reopen();
  assert.deepEqual(await h.api().consult(buyer, input(2)), delivered); assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 1);
});

test('corrupt stored signed bytes never rebroadcast; restoring exact bytes passes after restart', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input());
  const signed = h.store.read('signed_transactions', first.consult_id)!;
  h.store.transaction((tx) => tx.compareAndSet('signed_transactions', first.consult_id, signed.version, { ...signed.value, transaction_base64: Buffer.from('corrupt').toString('base64') }));
  h.reopen(); await assert.rejects(h.api().status(buyer, { consult_id: first.consult_id }), /VERIFICATION_FAILED/); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.sign, 1); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held');
  h.store.transaction((tx) => tx.compareAndSet('signed_transactions', first.consult_id, signed.version + 1, signed.value));
  h.reopen(); await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(h.counts.broadcast, 2); assert.equal(h.broadcastBytes[1], h.broadcastBytes[0]); assert.equal(h.counts.sign, 1);
});
