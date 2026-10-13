import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../../src/wire/constants.ts';
import type { ConsultInput, Listing, QuestionPolicy, Registry } from '../../../src/wire/contracts.ts';
import { createBroker, resumePending } from '../../../src/broker/index.ts';
import { readJournal } from '../../../src/broker/journal.ts';
import { harness, buyer, input, id, amount, fee, hash, sha, iso } from './harness.ts';

test('frozen named factories fail closed without composition ports; adapter and authenticated clean find work', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); assert.throws(() => createBroker(h.deps), /NOT_READY/); await assert.rejects(resumePending(h.deps), /NOT_READY/);
  const deps = { ...h.deps, brokerPorts: h.ports }; assert.equal((await createBroker(deps).find(buyer, { topic: 'topic' })).listings.length, 2); assert.deepEqual(await resumePending(deps), { pending: 0, resolved: 0, failed: 0 });
  await assert.rejects(createBroker(deps).find(buyer, { topic: 'topic', admin: true } as { topic: string }), /INVALID_INPUT/); assert.equal(h.counts.quote, 0);
  await assert.rejects(createBroker(deps).feedback(buyer, { consult_id: id('missing'), useful: true, reason_code: 'other' }), /NOT_READY/);
});

test('unknown/undefined template values and oversized raw ingress cannot silently become approved empty slots', async (t) => {
  const h = harness(); t.after(() => h.cleanup());
  for (const template_values of [{ ignored: undefined }, { ignored: NaN }, { ignored: '\ud800' }, { ignored: 'x'.repeat(M03.ingressBodyMax.value * 1024) }]) await assert.rejects(h.api().consult(buyer, { ...input(), template_values } as unknown as ConsultInput));
  assert.equal(h.counts.quote, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  assert.equal((await h.api().consult(buyer, input())).payment_state, 'payment_pending');
});

test('one unarmed ready quote is durable across restart; expiry permits a fresh deliberate request', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); h.behavior.approval = 'denied';
  await h.api().consult(buyer, input()); h.reopen(); await assert.rejects(h.api().consult(buyer, input(2)), /RATE_LIMITED/); assert.equal(h.counts.quote, 2); assert.equal(h.counts.sign, 0);
  h.clock.advance(M03.quoteTtl.value * 1000); h.behavior.approval = 'approved'; assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1);
});

test('quote skew, expired quote and excessive TTL reject before arm; unchanged bounded quote passes', async (t) => {
  for (const mode of ['skew', 'expired', 'ttl'] as const) {
    const h = harness(); t.after(() => h.cleanup());
    h.behavior.mutateQuote = (q) => ({ ...q, payload: { ...q.payload, ...(mode === 'skew' ? { issued_at: iso(new Date(Date.parse(h.clock.now()) + M03.clockSkewMax.value * 1000 + 1).toISOString()) } : mode === 'expired' ? { expires_at: h.clock.now() } : { expires_at: iso(new Date(Date.parse(q.payload.issued_at) + M03.quoteTtl.value * 1000 + 1).toISOString()) }) } });
    assert.equal((await h.api().consult(buyer, input())).dispositions[1]!.code, 'QUOTE_EXPIRED'); assert.equal(h.counts.arm, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
    h.behavior.mutateQuote = null; assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending');
  }
});

test('unknown/stale eligibility fails before arm; current clean eligibility passes', async (t) => {
  for (const mode of ['unknown', 'stale'] as const) {
    const h = harness(); t.after(() => h.cleanup()); const original = h.deps;
    if (mode === 'unknown') h.behavior.eligibility = 'unknown';
    else {
      const sellers = new Map(h.deps.sellers), good = sellers.get('https://b.invalid')!;
      sellers.set('https://b.invalid', { ...good, async eligibility(...args) { return { ...await good.eligibility(...args), acknowledged_at: iso(new Date(Date.parse(h.clock.now()) - M03.lineageAcknowledgementMaxAge.value * 3600000 - 1).toISOString()) }; } }); h.deps = { ...h.deps, sellers };
    }
    await h.api().consult(buyer, input()); assert.equal(h.counts.arm, 0); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
    h.deps = original; h.behavior.eligibility = 'eligible'; h.clock.advance(M03.quoteTtl.value * 1000); assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending');
  }
});

test('cached prose tampering fails its stored signed commitment; clean immutable artifacts allow same-consult recovery', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input()); h.settle(); await h.api().status(buyer, { consult_id: first.consult_id });
  const record = readJournal(h.store, first.consult_id); assert.ok(record.value.broker.answerArtifact);
  h.store.transaction((tx) => tx.compareAndSet('consults', first.consult_id, record.version, { ...record.value, view: { ...record.value.view, answer: { ...record.value.view.answer!, text: 'corrupted cache' } } }));
  h.reopen(); const blocked = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(blocked.answer, null); assert.equal(blocked.refund_state, 'refund_pending');
  const recovered = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(recovered.answer?.text, 'public evidence'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});

test('actual fee above reserved maximum is retained and latches new purchases closed', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const first = await h.api().consult(buyer, input()); h.settle(false, M03.feePerPurchaseMax.value + 1n);
  const result = await h.api().status(buyer, { consult_id: first.consult_id }); assert.equal(result.network_fee_lamports, (M03.feePerPurchaseMax.value + 1n).toString()); assert.ok(h.store.read('events', 'broker_budget_fault'));
  h.clock.advance(24 * 3600000); h.reopen(); assert.equal((await h.api().consult(buyer, input(2))).consult_state, 'cancelled'); assert.equal(h.counts.sign, 1);
  const clean = harness(); t.after(() => clean.cleanup()); assert.equal((await clean.api().consult(buyer, input())).payment_state, 'payment_pending');
});

test('mainnet policy guard and demo payee rejection; synthetic founder approval latches one attempt across restart', async (t) => {
  // Policy-only simulation: no keys, Solana bytes, RPC, funds or human approval.
  const h = harness(); t.after(() => h.cleanup()); const mainnet = { ...input(), max_price: { ...input().max_price, network: 'mainnet-beta' as const } };
  await assert.rejects(h.api().consult(buyer, mainnet), /NETWORK_MISMATCH/); assert.equal(h.counts.quote, 0); assert.equal(h.counts.sign, 0);
  const original = h.deps;
  const registry: Registry = { ...original.registry, listings: original.registry.listings.map((l) => ({ ...l, listing_kind: 'demo', payment: { ...l.payment, network: 'mainnet-beta', asset: 'USDC' } } as Listing)) };
  const questionPolicy: QuestionPolicy = { ...original.questionPolicy, questions: original.questionPolicy.questions.map((q) => ({ ...q, allowed_networks: ['mainnet-beta'] })) };
  h.deps = { ...original, registry, questionPolicy, policy: { ...original.policy, networks: ['mainnet-beta'], mainnet_enabled: true, registry_sha256: hash(registry), question_policy_sha256: hash(questionPolicy) }, offerApproval: { async review(offer) { return { status: 'approved', reviewedHash: offer.quoteHash, actor: 'human', at: h.clock.now(), approvalRef: id('synthetic-human-branch') }; } } };
  h.behavior.mutateQuote = (q) => ({ ...q, payload: { ...q.payload, network: 'mainnet-beta', asset: 'USDC' } });
  const denied = await h.api().consult(buyer, mainnet); assert.equal(denied.dispositions[1]!.status, 'ready'); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
  h.clock.advance(M03.quoteTtl.value * 1000);
  const founderRegistry = { ...registry, listings: registry.listings.map((l) => ({ ...l, listing_kind: 'founder' as const })) };
  h.deps = { ...h.deps, registry: founderRegistry, policy: { ...h.deps.policy, registry_sha256: hash(founderRegistry) } };
  const first = await h.api().consult(buyer, { ...mainnet, request_id: input(2).request_id }); assert.equal(first.payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1); assert.ok(h.store.read('events', 'broker_mainnet_attempt'));
  h.settle(false); assert.equal((await h.api().status(buyer, { consult_id: first.consult_id })).payment_state, 'payment_failed');
  h.reopen(); h.clock.advance(24 * 3600000); assert.equal((await h.api().consult(buyer, { ...mainnet, request_id: input(3).request_id })).consult_state, 'cancelled'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});
