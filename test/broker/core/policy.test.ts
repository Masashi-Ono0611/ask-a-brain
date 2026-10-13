import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../../src/wire/constants.ts';
import type { ConsultInput, Listing, Signed, Quote } from '../../../src/wire/contracts.ts';
import { admit } from '../../../src/broker/policy.ts';
import { harness, buyer, input, id, amount, hash, sha, address } from './harness.ts';

test('approved question fan-out: one decline, one ready, one selected purchase, durable order', async (t) => {
  const h = harness(); t.after(() => h.cleanup());
  h.behavior.beforeApproval = () => {
    const row = h.store.scan('consults', { limit: 1 })[0]!.value as unknown as { broker: { stage: string; quote: Signed<Quote> } };
    assert.equal(row.broker.stage, 'reviewing'); assert.equal(row.broker.quote.payload.seller_id, 'b'); assert.equal(h.counts.sign, 0);
  };
  h.behavior.beforeSign = () => { assert.equal(h.store.scan('reservations', { limit: 1 })[0]!.value.status, 'held'); assert.equal(h.store.scan('arms', { limit: 1 }).length, 1); assert.equal(h.counts.broadcast, 0); };
  h.behavior.beforeBroadcast = () => { assert.equal(h.store.scan('signed_transactions', { limit: 1 }).length, 1); };
  const view = await h.api().consult(buyer, input());
  assert.deepEqual(view.dispositions.map((d) => d.status), ['declined', 'ready']);
  assert.equal(view.payment_state, 'payment_pending'); assert.equal(view.purchase_amount_atomic, null); assert.equal(view.network_fee_lamports, null);
  assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
  assert.ok(h.requests.every((r) => r.question === h.deps.questionPolicy.questions[0]!.text)); assert.notEqual(h.requests[0]!.nonce, h.requests[1]!.nonce);
});

test('unknown question, arbitrary slot, attachment, raw text, cap+1 and invalid UTF8 reject before ALL seller/sign/broadcast I/O; restored clean passes', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const api = h.api();
  const bad: unknown[] = [ { ...input(), question_id: 'unknown' }, { ...input(), template_values: { extra: 'private' } }, { ...input(), attachment: 'private' }, { ...input(), question: 'rewritten' }, { ...input(), max_price: { ...input().max_price, amount_atomic: amount(M03.devnetPrincipalPerCall.value + 1n) } }, { ...input(), max_price: { ...input().max_price, extra: true } }, { ...input(), question_id: '\ud800' } ];
  for (const value of bad) await assert.rejects(api.consult(buyer, value as ConsultInput));
  for (const bytes of [Buffer.from('{"request_id":"a","request_id":"b"}'), Buffer.from('{"request_id":"a","\\u0072equest_id":"b"}'), Uint8Array.from([0xff])]) assert.throws(() => admit(h.deps, h.ports, bytes));
  assert.equal(h.counts.quote, 0); assert.equal(h.counts.eligibility, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0); assert.equal(h.store.scan('consults', { limit: 1 }).length, 0);
  assert.equal((await api.consult(buyer, input())).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
});

test('authenticated context and immutable registry/question policy reject substitution; clean counterpart passes', async (t) => {
  const h = harness(); t.after(() => h.cleanup());
  await assert.rejects(h.api().consult({ ...buyer, buyer_id: id('attacker') }, input()), /UNAUTHORIZED/);
  await assert.rejects(h.api().consult({ ...buyer, session_id: id('other') }, input()), /UNAUTHORIZED/);
  const good = h.deps;
  h.deps = { ...good, registry: { ...good.registry, registry_version: id('changed') } }; assert.throws(() => h.api(), /VERIFICATION_FAILED/);
  h.deps = { ...good, questionPolicy: { ...good.questionPolicy, policy_id: id('changed') } }; assert.throws(() => h.api(), /VERIFICATION_FAILED/);
  h.deps = good; const api = h.api();
  const found = await api.find(buyer, { topic: 'topic' }); assert.equal(found.listings.length, 2); assert.equal(h.counts.quote, 0);
  assert.equal((await api.consult(buyer, input())).payment_state, 'payment_pending');
});

test('all declines are free; outage is unavailable, never an abstention; receipts survive restart', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.quote.set('b', 'declined');
  const first = await h.api().consult(buyer, input()); assert.equal(first.consult_state, 'declined'); assert.equal(first.purchase_amount_atomic, '0'); assert.equal(first.network_fee_lamports, '0');
  assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0); assert.ok(h.store.read('receipts', first.receipt_id));
  h.reopen(); assert.deepEqual(await h.api().consult(buyer, input()), first); assert.equal(h.counts.quote, 2);
  h.behavior.quote.set('b', 'throw'); const outage = await h.api().consult(buyer, input(2)); assert.equal(outage.consult_state, 'precheck_failed'); assert.deepEqual(outage.dispositions.map((d) => d.status), ['declined', 'unavailable']);
  assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
});

test('forbidden signed payee/network/memo/amount/quote buyer never reaches signer; clean quote does', async (t) => {
  const mutations: ((q: Signed<Quote>) => Signed<Quote>)[] = [
    (q) => ({ ...q, payload: { ...q.payload, seller_owner: address('forbidden') } }),
    (q) => ({ ...q, payload: { ...q.payload, network: 'mainnet-beta' } }),
    (q) => ({ ...q, payload: { ...q.payload, memo: 'wrong memo' } }),
    (q) => ({ ...q, payload: { ...q.payload, fee_atomic: amount(M03.marketplaceAtomic.value + 1n) } }),
    (q) => ({ ...q, payload: { ...q.payload, buyer_id: id('forbidden') } }),
    (q) => ({ ...q, signature: { ...q.signature, value: 'wrong seal' } }),
  ];
  for (const mutate of mutations) {
    const h = harness(); t.after(() => h.cleanup()); h.behavior.mutateQuote = mutate;
    const result = await h.api().consult(buyer, input()); assert.equal(result.dispositions[1]!.status, 'unavailable'); assert.equal(h.counts.arm, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
    h.behavior.mutateQuote = null; assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
  }
});

test('fan-out max, deterministic seller-ID tie, no paid fan-out', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.quote.set('a', 'ready');
  const original = h.deps.registry.listings; const extra = [ 'c', 'd' ].map((name) => ({ ...original[0]!, seller_id: id(name), endpoint: `https://${name}.invalid` } satisfies Listing));
  const registry = { ...h.deps.registry, listings: [...extra, ...original].reverse() };
  const questionPolicy = { ...h.deps.questionPolicy, questions: h.deps.questionPolicy.questions.map((q) => ({ ...q, allowed_origins: registry.listings.map((l) => l.endpoint) })) };
  h.deps = { ...h.deps, registry, questionPolicy, policy: { ...h.deps.policy, registry_sha256: hash(registry), question_policy_sha256: hash(questionPolicy) } };
  const result = await h.api().consult(buyer, input());
  assert.equal(result.dispositions.length, M03.checksPerConsultMax.value); assert.deepEqual(result.dispositions.map((d) => d.seller_id), ['a', 'b', 'c']); assert.equal(h.counts.sign, 1); assert.equal(h.counts.arm, 1);
  assert.equal(h.store.scan('signed_transactions', { limit: 1 })[0]!.value.quote_id.includes('q-a-'), true);
});

test('approved-byte mutation and question scalar/UTF8 limits fail locally with clean boundary', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const base = h.deps;
  for (const text of ['x'.repeat(M03.questionScalarsMax.value + 1), '界'.repeat(M03.questionScalarsMax.value)]) {
    const questionPolicy = { ...base.questionPolicy, questions: base.questionPolicy.questions.map((q) => ({ ...q, text, question_sha256: sha(text) })) };
    h.deps = { ...base, questionPolicy, policy: { ...base.policy, question_policy_sha256: hash(questionPolicy) } };
    await assert.rejects(h.api().consult(buyer, input()));
  }
  const text = 'x'.repeat(M03.questionScalarsMax.value);
  const questionPolicy = { ...base.questionPolicy, questions: base.questionPolicy.questions.map((q) => ({ ...q, text, question_sha256: sha(text) })) };
  h.deps = { ...base, questionPolicy, policy: { ...base.policy, question_policy_sha256: hash(questionPolicy) } }; h.behavior.quote.set('b', 'declined');
  assert.equal((await h.api().consult(buyer, input())).consult_state, 'declined'); assert.equal(h.counts.quote, 2);
});
