import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../../src/wire/constants.ts';
import { bindBroker } from '../../../src/broker/index.ts';
import { reservations, reserve } from '../../../src/broker/reservations.ts';
import { consultKey, readJournal } from '../../../src/broker/journal.ts';
import { harness, buyer, input, amount, fee, id, uuid } from './harness.ts';

test('atomic competing sessions on one payer: principal cap permits one reservation and rejects the other', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.deps = { ...h.deps, policy: { ...h.deps.policy, principal_per_day: amount(M03.totalAtomic.value) } };
  const other = { ...buyer, buyer_id: id('other-approved-buyer'), session_id: id('other-session') };
  const api2 = bindBroker(h.ports).createBroker({ ...h.deps, policy: { ...h.deps.policy, buyer: other } });
  const results = await Promise.all([h.api().consult(buyer, input()), api2.consult(other, input(2))]);
  assert.deepEqual(results.map((r) => r.payment_state).sort(), ['not_applicable', 'payment_pending']);
  assert.equal(reservations(h.store, buyer.payer).length, 1); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});

test('maximum fee is reserved independently: concurrent fee cap rejects a second affordable principal', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.deps = { ...h.deps, policy: { ...h.deps.policy, fee_per_day: fee(M03.feePerPurchaseMax.value) } };
  const other = { ...buyer, buyer_id: id('other-approved-buyer'), session_id: id('other-session') };
  const api2 = bindBroker(h.ports).createBroker({ ...h.deps, policy: { ...h.deps.policy, buyer: other } });
  const result = await Promise.all([h.api().consult(buyer, input()), api2.consult(other, input(2))]);
  assert.equal(result.filter((r) => r.payment_state === 'payment_pending').length, 1); assert.equal(h.counts.sign, 1);
  assert.equal(reservations(h.store, buyer.payer)[0]!.maximum_fee, M03.feePerPurchaseMax.value.toString());
});

test('request replay across restart returns same consult; changed body conflicts without seller or signer I/O', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const original = await h.api().consult(buyer, input());
  h.reopen(); assert.deepEqual(await h.api().consult(buyer, input()), original);
  await assert.rejects(h.api().consult(buyer, { ...input(), max_price: { ...input().max_price, amount_atomic: amount(M03.totalAtomic.value + 1n) } }), /IDEMPOTENCY_CONFLICT/);
  assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1); assert.equal(h.store.scan('reservations', { limit: 10 }).length, 1);
});

test('pending exposure crosses UTC midnight and restart; finalized failure releases principal but consumes actual fee', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.deps = { ...h.deps, policy: { ...h.deps.policy, principal_per_day: amount(M03.totalAtomic.value), fee_per_day: fee(M03.feePerPurchaseMax.value) } };
  const first = await h.api().consult(buyer, input()); h.clock.advance(60000); h.reopen();
  assert.equal((await h.api().consult(buyer, input(2))).consult_id, first.consult_id); assert.equal(h.counts.sign, 1);
  // Exercise the money guard independently of the pending-question dedup guard.
  const original = readJournal(h.store, first.consult_id).value, candidateId = consultKey(buyer.buyer_id, uuid(50));
  const candidate = { ...original, request_id: uuid(50), view: { ...original.view, consult_id: candidateId }, broker: { ...original.broker, stage: 'approved' as const } };
  h.store.transaction((tx) => tx.insert('consults', candidateId, candidate));
  assert.throws(() => reserve(h.deps, h.ports, candidateId), /BUDGET_EXCEEDED/); assert.equal(h.store.read('reservations', candidateId), null);
  const cancelled = { ...candidate, broker: { ...candidate.broker, stage: 'closed' as const } };
  h.store.transaction((tx) => tx.compareAndSet('consults', candidateId, 1, cancelled));
  const held = reservations(h.store, buyer.payer)[0]!; assert.equal(held.day_utc, '2026-10-09'); assert.equal(held.status, 'held');
  h.settle(false, 7n); const failed = await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal(failed.payment_state, 'payment_failed'); assert.equal(failed.purchase_amount_atomic, '0'); assert.equal(failed.network_fee_lamports, '7');
  const resolved = reservations(h.store, buyer.payer)[0]!; assert.equal(resolved.actualFee, '7'); assert.equal(resolved.actualPrincipal, '0'); assert.equal(resolved.day_utc, '2026-10-09');
  h.clock.advance(M03.quoteTtl.value * 1000); h.behavior.reconciliation = { status: 'pending', reason: 'PAYMENT_UNCERTAIN' };
  assert.equal((await h.api().consult(buyer, input(3))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 2);
});

test('same-day failed principal still spends fee: fee cap+1 rejects, increased clean cap admits', async (t) => {
  const h = harness(); t.after(() => h.cleanup());
  h.deps = { ...h.deps, policy: { ...h.deps.policy, fee_per_call: fee(10n), fee_per_day: fee(10n) } };
  const first = await h.api().consult(buyer, input()); h.settle(false, 1n); await h.api().status(buyer, { consult_id: first.consult_id });
  assert.equal((await h.api().consult(buyer, input(2))).consult_state, 'cancelled'); assert.equal(h.counts.sign, 1);
  h.deps = { ...h.deps, policy: { ...h.deps.policy, fee_per_day: fee(11n) } };
  h.clock.advance(M03.quoteTtl.value * 1000); h.behavior.reconciliation = { status: 'pending', reason: 'PAYMENT_UNCERTAIN' };
  assert.equal((await h.api().consult(buyer, input(3))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 2);
});

test('durable per-minute/per-day free quotas: fake clock, same identity, restart; clean next window passes', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.quote.set('b', 'declined');
  for (let n = 1; n <= M03.buyerSellerChecksPerMinute.value; n++) assert.equal((await h.api().consult(buyer, input(n))).consult_state, 'declined');
  h.reopen(); await assert.rejects(h.api().consult(buyer, input(4)), /RATE_LIMITED/); assert.equal(h.counts.quote, M03.buyerSellerChecksPerMinute.value * 2);
  h.clock.advance(60000); assert.equal((await h.api().consult(buyer, input(4))).consult_state, 'declined');
  // Count only the new day's checks (the fixture starts one minute before UTC midnight).
  for (let n = 5; n <= M03.buyerSellerChecksPerDay.value + 3; n++) { h.clock.advance(60000); await h.api().consult(buyer, input(n)); }
  h.clock.advance(60000); await assert.rejects(h.api().consult(buyer, input(100)), /RATE_LIMITED/); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  h.clock.advance(24 * 3600000); assert.equal((await h.api().consult(buyer, input(100))).consult_state, 'declined');
});

test('one active check per buyer/seller rejects overlapping request; clean completion restores admission', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.quote.set('b', 'declined'); const api = h.api();
  const first = api.consult(buyer, input()); await assert.rejects(api.consult(buyer, input(2)), /RATE_LIMITED/);
  await first; assert.equal((await api.consult(buyer, input(2))).consult_state, 'declined'); assert.equal(h.counts.quote, 4);
});

test('reservation and journal CAS rollback together on storage failure; clean retry succeeds', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const result = await h.api().consult(buyer, input());
  const original = readJournal(h.store, result.consult_id).value;
  const next = { ...original, request_id: uuid(2), view: { ...original.view, consult_id: id('reservation-cas') }, broker: { ...original.broker, stage: 'approved' as const } };
  h.store.transaction((tx) => tx.insert('consults', 'reservation-cas', next));
  const good = h.deps;
  h.deps = { ...good, store: { ...h.store, read: h.store.read.bind(h.store), scan: h.store.scan.bind(h.store), checkpoint: h.store.checkpoint.bind(h.store), close: h.store.close.bind(h.store), transaction: (body) => h.store.transaction((tx) => body({ ...tx, compareAndSet: () => { throw new Error('injected durable write failure'); } })) } };
  assert.throws(() => reserve(h.deps, h.ports, id('reservation-cas')), /durable write failure/); assert.equal(h.store.read('reservations', 'reservation-cas'), null);
  h.deps = good; reserve(h.deps, h.ports, id('reservation-cas')); assert.equal(h.store.read('reservations', 'reservation-cas')!.value.status, 'held');
});

test('reservation scan crosses the Store page boundary; held exposure beyond row 1000 cannot disappear', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.deps = { ...h.deps, policy: { ...h.deps.policy, principal_per_day: amount(M03.totalAtomic.value) } };
  const first = await h.api().consult(buyer, input()); h.settle(false, 0n); await h.api().status(buyer, { consult_id: first.consult_id });
  const original = readJournal(h.store, first.consult_id).value, candidateId = consultKey(buyer.buyer_id, uuid(90));
  const candidate = { ...original, request_id: uuid(90), view: { ...original.view, consult_id: candidateId }, broker: { ...original.broker, stage: 'approved' as const } };
  h.store.transaction((tx) => {
    tx.insert('consults', candidateId, candidate);
    for (let n = 0; n < 1000; n++) {
      const consult_id = id(`z_${n.toString().padStart(4, '0')}`), held = n === 999;
      const row: import('../../../src/broker/reservations.ts').BrokerReservation = { consult_id, payer: buyer.payer, day_utc: h.clock.now().slice(0, 10), principal: amount(held ? M03.totalAtomic.value : 0n), maximum_fee: fee(0n), status: held ? 'held' : 'resolved', network: 'devnet', actualPrincipal: held ? null : amount(0n), actualFee: held ? null : fee(0n) };
      tx.insert('reservations', consult_id, row);
    }
  });
  assert.equal(reservations(h.store, buyer.payer).length, 1001); assert.throws(() => reserve(h.deps, h.ports, candidateId), /BUDGET_EXCEEDED/); assert.equal(h.store.read('reservations', candidateId), null);
  const last = h.store.read('reservations', 'z_0999')!;
  const restored: import('../../../src/broker/reservations.ts').BrokerReservation = { ...last.value, network: 'devnet', status: 'resolved', actualPrincipal: amount(0n), actualFee: fee(0n) };
  h.store.transaction((tx) => tx.compareAndSet('reservations', 'z_0999', last.version, restored));
  reserve(h.deps, h.ports, candidateId); assert.equal(h.store.read('reservations', candidateId)!.value.status, 'held');
});
