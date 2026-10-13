import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { M03 } from '../../../src/wire/constants.ts';
import { bindBroker } from '../../../src/broker/index.ts';
import { journals } from '../../../src/broker/journal.ts';
import { reservations } from '../../../src/broker/reservations.ts';
import type { Store } from '../../../src/wire/contracts.ts';
import { harness, buyer, input } from './harness.ts';

test('real abrupt process exit at offer review, signing intent, and prebroadcast keeps durable crash boundary', async (t) => {
  for (const boundary of ['beforeApproval', 'beforeSign', 'beforeBroadcast'] as const) {
    const h = harness(); t.after(() => h.cleanup()); h.store.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { harness, buyer, input } from ${JSON.stringify(new URL('./harness.ts', import.meta.url).href)};
      const h = harness(process.argv[1]);
      h.behavior[process.argv[2]] = () => process.exit(77);
      await h.api().consult(buyer, input());
      process.exit(99);
    `, h.dir, boundary], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 77, child.stderr); h.reopen();
    const row = journals(h.store)[0]!;
    const summary = await bindBroker(h.ports).resumePending(h.deps);
    assert.equal(summary.failed, 0); assert.equal(h.counts.quote, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.approval, 0);
    if (boundary === 'beforeApproval') { assert.equal(row.broker.stage, 'reviewing'); assert.equal(summary.resolved, 1); assert.equal(reservations(h.store, buyer.payer).length, 0); }
    else if (boundary === 'beforeSign') { assert.equal(row.broker.stage, 'signing'); assert.equal(summary.pending, 1); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held'); assert.equal(h.counts.broadcast, 0); }
    else {
      assert.equal(row.broker.stage, 'signed'); assert.equal(summary.pending, 1); assert.equal(h.counts.broadcast, 1);
      const saved = h.store.read('signed_transactions', row.view.consult_id)!.value.transaction_base64; assert.equal(h.broadcastBytes[0], saved);
      h.reopen(); await h.api().status(buyer, { consult_id: row.view.consult_id }); assert.equal(h.broadcastBytes[1], saved);
      h.quotes.set(row.broker.quote!.payload.quote_id, row.broker.quote!); h.settle();
      const recovered = await h.api().status(buyer, { consult_id: row.view.consult_id }); assert.equal(recovered.delivery_state, 'delivered'); assert.equal(h.counts.sign, 0);
    }
  }
});

function failInsert(store: Store, tableToFail: string): Store {
  return { read: store.read.bind(store), scan: store.scan.bind(store), checkpoint: store.checkpoint.bind(store), close: store.close.bind(store), transaction: (body) => store.transaction((tx) => body({ ...tx, insert: (table, key, value) => { if (table === tableToFail) throw new Error('injected persistence failure'); tx.insert(table, key, value); } })) };
}
test('failed durable arm write blocks signing; failed signed-bytes write blocks broadcast; restoration recovers', async (t) => {
  for (const table of ['arms', 'signed_transactions']) {
    const h = harness(); t.after(() => h.cleanup()); const good = h.deps; h.deps = { ...good, store: failInsert(h.store, table) };
    const result = await h.api().consult(buyer, input()); assert.equal(h.counts.broadcast, 0); assert.equal(h.counts.sign, table === 'arms' ? 0 : 1); assert.equal(result.payment_state, 'payment_pending'); assert.equal(reservations(h.store, buyer.payer)[0]!.status, 'held');
    h.deps = good; h.reopen(); const recovered = await bindBroker(h.ports).resumePending(h.deps); assert.equal(recovered.failed, 0); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1); assert.equal(h.counts.quote, 2);
  }
});

test('receipt persistence failure blocks pre-sign success; clean store permits normal flow', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const good = h.ports;
  h.ports = { ...good, persistReceipt: () => { throw new Error('receipt store unavailable'); } };
  await assert.rejects(h.api().consult(buyer, input()), /receipt store unavailable/); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  h.ports = good; h.reopen(); await bindBroker(h.ports).resumePending(h.deps);
  h.clock.advance(M03.quoteTtl.value * 1000); assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
});

test('precheck timeout ignores late ready offer, keeps unavailable distinct, and clean seller call passes', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const seller = h.deps.sellers.get('https://b.invalid')!;
  let complete: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { complete = resolve; });
  const sellers = new Map(h.deps.sellers); sellers.set('https://b.invalid', { ...seller, async quote(context, request) { await wait; return seller.quote(context, request); } });
  const original = h.deps; h.deps = { ...h.deps, sellers };
  const consult = h.api().consult(buyer, input()); h.clock.advance(M03.precheckMax.value * 1000);
  const timeout = await consult; assert.deepEqual(timeout.dispositions.map((d) => d.status), ['declined', 'unavailable']); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  await assert.rejects(h.api().consult(buyer, input(2)), /RATE_LIMITED/);
  complete!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); assert.equal(h.counts.sign, 0); assert.equal((await h.api().consult(buyer, input())).consult_state, 'precheck_failed');
  await assert.rejects(h.api().consult(buyer, input(2)), /RATE_LIMITED/); // Late ready stays unarmed until expiry.
  h.clock.advance(M03.quoteTtl.value * 1000);
  h.deps = original; assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
});
