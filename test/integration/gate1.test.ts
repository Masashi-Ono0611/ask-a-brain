import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, settle } from './harness.ts';
import { M03, canonicalBytes, bytesHash } from '../../src/wire/index.ts';
import { id } from '../../scripts/integration/synthetic.ts';

test('real wire + seller + broker + TestSigner + FakeRpc + receipts/outcomes complete once', async t => {
  const h = await harness(); t.after(() => h.cleanup());
  const pending = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  assert.equal(pending.payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
  const result = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(result.delivery_state, 'delivered'); assert.equal(result.payment_state, 'payment_finalized');
  assert.deepEqual(result.dispositions.map(r => r.status), ['declined', 'ready']);
  const receipt = h.store.read('receipts', result.receipt_id)!.value;
  assert.equal(receipt.seller_atomic, String(M03.sellerAtomic.value)); assert.equal(receipt.fee_atomic, String(M03.marketplaceAtomic.value));
  assert.ok(Object.values(receipt.verified).every(v => v === true));
  const before = bytesHash(canonicalBytes(receipt)); await h.reopen();
  const recovered = await h.broker.market.status(h.buyer, { consult_id: result.consult_id });
  assert.deepEqual(recovered.answer, result.answer); assert.equal(bytesHash(canonicalBytes(h.store.read('receipts', result.receipt_id)!.value)), before);
  assert.equal(h.counts.sign, 1); assert.equal(h.store.scan('settlements', { limit: 100 }).length, 1);
  const feedback = await h.broker.market.feedback(h.buyer, { consult_id: result.consult_id, useful: true, reason_code: 'prevented_missed_check' });
  assert.equal(feedback.source, 'agent'); assert.equal(feedback.eligible_for_trust, false);
  await assert.rejects(h.broker.market.feedback(h.buyer, { consult_id: result.consult_id, useful: true, reason_code: 'prevented_missed_check' }));
  const report = await h.broker.market.report(h.buyer, { date_utc: h.clock.now().slice(0,10) }); assert.match(report.markdown, /unrated/i);
});

test('forbidden question and invalid fields cause zero seller/RPC/sign/broadcast; approved decline is free', async t => {
  const h = await harness(); t.after(() => h.cleanup());
  await assert.rejects(h.broker.market.consult(h.buyer, { ...h.request(), question_id: id('forbidden') }));
  await assert.rejects(h.broker.market.consult(h.buyer, { ...h.request(), question: 'attached text' } as never));
  assert.deepEqual(h.counts, { accounts: 0, seller: 0, sign: 0, broadcast: 0, rpc: 0, approve: 0 });
  const clean = await settle(h, h.broker.market.consult(h.buyer, h.request(2)));
  assert.equal(clean.consult_state, 'declined'); assert.equal(clean.purchase_amount_atomic, '0'); assert.equal(clean.network_fee_lamports, '0');
  assert.ok(h.counts.seller > 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
});

test('lost signer, broadcast and answer responses preserve WAL/reservations and recover same bytes after reopen', async t => {
  const h = await harness(); t.after(() => h.cleanup()); h.faults.lostSign = true;
  const pending = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  assert.equal(pending.payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 0);
  assert.equal(h.store.scan('reservations', { limit: 100 })[0]!.value.status, 'held');
  await h.reopen(); h.faults.lostSign = false; h.faults.lostBroadcast = true;
  await settle(h, h.broker.resume());
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
  const wal = canonicalBytes(h.store.scan('signed_transactions', { limit: 100 })[0]!.value);
  h.primary.state.status = 'confirmed';
  await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(h.counts.broadcast, 2); assert.equal(new Set(h.broadcastBytes).size, 1);
  assert.equal(h.store.scan('reservations', { limit: 100 })[0]!.value.status, 'held');
  h.primary.state.status = 'finalized'; h.faults.lostAnswer = true;
  const lost = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(lost.payment_state, 'payment_finalized'); assert.equal(lost.answer, null); assert.equal(lost.refund_state, 'refund_pending');
  const expectedAnswer = (await h.sellerRows[1]!.controller.answer(h.buyer, h.proof().quote_id)); assert.equal(expectedAnswer.status, 'ready');
  await h.reopen(); h.faults.lostAnswer = false;
  const recovered = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(recovered.delivery_state, 'delivered');
  if (expectedAnswer.status === 'ready') assert.equal(recovered.answer?.text, expectedAnswer.answer.payload.answer);
  assert.deepEqual(canonicalBytes(h.store.scan('signed_transactions', { limit: 100 })[0]!.value), wal);
  const receipt = canonicalBytes(h.store.read('receipts', recovered.receipt_id)!.value);
  await h.reopen(); const repeated = await h.broker.market.status(h.buyer, { consult_id: pending.consult_id });
  assert.deepEqual(repeated.answer, recovered.answer); assert.deepEqual(canonicalBytes(h.store.read('receipts', recovered.receipt_id)!.value), receipt);
  assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 2);
});

test('failed second leg rolls back principal and retains fee; new clean fixture delivers (simulator only)', async t => {
  const bad = await harness(), clean = await harness(); t.after(() => { bad.cleanup(); clean.cleanup(); }); bad.faults.failSecond = true;
  const view = await settle(bad, bad.broker.market.consult(bad.buyer, bad.request()));
  const result = await settle(bad, bad.broker.market.status(bad.buyer, { consult_id: view.consult_id }));
  assert.equal(result.payment_state, 'payment_failed'); assert.equal(result.answer, null); assert.equal(result.purchase_amount_atomic, '0');
  assert.equal(BigInt(result.network_fee_lamports!), bad.primary.state.feesCharged); assert.ok(bad.primary.state.feesCharged > 0n);
  const tx = [...bad.primary.state.transactions.values()][0]!;
  assert.deepEqual(tx.meta.err, { InstructionError: [1, { Custom: 17 }] }); assert.deepEqual(tx.meta.preTokenBalances, tx.meta.postTokenBalances);
  await bad.reopen(); assert.equal((await bad.broker.market.status(bad.buyer, { consult_id: view.consult_id })).payment_state, 'payment_failed');
  const good = await settle(clean, clean.broker.market.consult(clean.buyer, clean.request()));
  assert.equal((await settle(clean, clean.broker.market.status(clean.buyer, { consult_id: good.consult_id }))).delivery_state, 'delivered');
});

test('storage refusal before signing holds armed reservation; restored storage permits one exact signature', async t => {
  const h = await harness(); t.after(() => h.cleanup()); h.faults.failBeforeSign = true;
  const pending = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0); assert.equal(pending.payment_state, 'payment_pending');
  assert.equal(h.store.scan('arms', { limit: 100 }).length, 1); assert.equal(h.store.scan('reservations', { limit: 100 })[0]!.value.status, 'held');
  h.faults.failBeforeSign = false; await h.reopen(); await settle(h, h.broker.resume());
  const clean = await settle(h, h.broker.market.status(h.buyer, { consult_id: pending.consult_id }));
  assert.equal(clean.delivery_state, 'delivered'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});

test('denied offer blocks signing/broadcast; distinct permitted control passes', async t => {
  const bad = await harness(), good = await harness(); t.after(() => { bad.cleanup(); good.cleanup(); }); bad.faults.denyApproval = true;
  const denied = await settle(bad, bad.broker.market.consult(bad.buyer, bad.request())); assert.equal(denied.consult_state, 'cancelled');
  assert.equal(bad.counts.approve, 1); assert.equal(bad.counts.sign, 0); assert.equal(bad.counts.broadcast, 0);
  const allowed = await settle(good, good.broker.market.consult(good.buyer, good.request())); assert.equal(allowed.payment_state, 'payment_pending'); assert.equal(good.counts.sign, 1);
});

test('same-payer concurrent attempt and cap hold across midnight/reopen; clean capacity permits purchase', async t => {
  const h = await harness(), clean = await harness(); t.after(() => { h.cleanup(); clean.cleanup(); });
  Object.assign(h.deps.policy, { principal_per_day: String(M03.totalAtomic.value) }); h.rebuild(); h.faults.lostSign = true;
  const attempts = await settle(h, Promise.allSettled([h.broker.market.consult(h.buyer,h.request(0)),h.broker.market.consult(h.buyer,h.request(1))]));
  assert.ok(attempts.some(r => r.status === 'rejected' && r.reason.code === 'RATE_LIMITED')); assert.equal(h.counts.sign,1);
  h.clock.advance(60_000); await h.reopen();
  const second = await settle(h,h.broker.market.consult(h.buyer,h.request(1)));
  assert.equal(second.consult_state,'cancelled'); assert.equal(h.counts.sign,1); assert.equal(h.counts.broadcast,0);
  const reservations = h.store.scan('reservations',{limit:100}); assert.equal(reservations.length,1); assert.equal(reservations[0]!.value.status,'held'); assert.equal(reservations[0]!.value.day_utc,'2026-10-09');
  clean.faults.lostSign = true; await settle(clean,clean.broker.market.consult(clean.buyer,clean.request(0))); clean.clock.advance(60_000); await clean.reopen();
  const positive = await settle(clean,clean.broker.market.consult(clean.buyer,clean.request(1))); assert.equal(positive.payment_state,'payment_pending'); assert.equal(clean.counts.sign,2);
});

test('tampered answer is withheld with durable liability; unchanged signed answer passes after restart', async t => {
  const h = await harness(); t.after(() => h.cleanup()); h.faults.corruptAnswer = true;
  const p = await settle(h,h.broker.market.consult(h.buyer,h.request()));
  const bad = await settle(h,h.broker.market.status(h.buyer,{consult_id:p.consult_id}));
  assert.equal(bad.answer,null); assert.equal(bad.refund_state,'refund_pending'); assert.equal(bad.payment_state,'payment_finalized');
  await h.reopen(); h.faults.corruptAnswer = false;
  const good = await settle(h,h.broker.market.status(h.buyer,{consult_id:p.consult_id})); assert.equal(good.delivery_state,'delivered'); assert.equal(h.counts.sign,1);
  // Recovery does not erase the previously recorded financial obligation.
  assert.equal(h.store.read('receipts',good.receipt_id)!.value.refund_state,'refund_pending');
});

test('wallet-return message substitution prevents broadcast; durable original recovers once',async t=>{
 const h=await harness();t.after(()=>h.cleanup());h.faults.substituteSign=true;
 const bad=await settle(h,h.broker.market.consult(h.buyer,h.request()));assert.equal(bad.payment_state,'payment_pending');assert.equal(h.counts.sign,1);assert.equal(h.counts.broadcast,0);
 assert.equal(h.store.scan('signed_transactions',{limit:100}).length,0);assert.equal(h.store.scan('reservations',{limit:100})[0]!.value.status,'held');
 h.faults.substituteSign=false;await h.reopen();await settle(h,h.broker.resume());
 const good=await settle(h,h.broker.market.status(h.buyer,{consult_id:bad.consult_id}));assert.equal(good.delivery_state,'delivered');assert.equal(h.counts.sign,1);assert.equal(h.counts.broadcast,1);
});
