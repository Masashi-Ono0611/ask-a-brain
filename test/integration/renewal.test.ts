import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M03, payloadHash, canonicalBytes, parseWire } from '../../src/wire/index.ts';
import { openStore, createLogger, FoundationError } from '../../src/common/index.ts';
import { StoreSignJournal, buildLegacyPayment, generateThrowawayKey } from '../../src/chain/index.ts';
import { createCeremony } from '../../scripts/chain/human-live-ceremony.ts';
import { parseHumanRecovery } from '../../scripts/chain/human-live-runtime.ts';
import { renewUnsignedPurchase } from '../../src/broker/service.ts';
import { fixture } from '../chain/support.ts';
import { harness, buyer, input, hash, address } from '../broker/core/harness.ts';
import type { SignRequest, Sha256, SignResult } from '../../src/wire/contracts.ts';

// Proposed T11d contract fixture, not a production fallback. Lead must put this
// documented cap in M03 before the shipped composition can enable renewal.
const limits = { ...M03, messageRenewalsMax: { value: 3, unit: 'renewals/consult' } };
function fresh(request: SignRequest): SignRequest {
  const blockhash = { ...request.blockhash, blockhash: generateThrowawayKey().publicKey, lastValidBlockHeight: request.blockhash.lastValidBlockHeight + 100 };
  const payment = buildLegacyPayment(request.quote, { payer: request.expectedPayer, tokenAccount: fixturePayer(request) }, blockhash);
  return { ...request, blockhash, message: payment.message, messageHash: payment.messageHash,
    arm: { ...request.arm, payload: { ...request.arm.payload, message_sha256: payment.messageHash, recent_blockhash: blockhash.blockhash, last_valid_block_height: blockhash.lastValidBlockHeight } } };
}
import { validateSignRequest } from '../../src/chain/index.ts';
function fixturePayer(request: SignRequest) { return validateSignRequest(request).payer.tokenAccount; }

for (const ambiguous of [false, true]) test(`durable expiry / possible-signing restart guard: ambiguous=${ambiguous}`, async t => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), 'aab-renewal-'));
  let store = openStore(join(root, 'helper.db')), journal = new StoreSignJournal(store), loads = 0;
  t.after(() => { store.close(); f.key.keyBytes.fill(0); rmSync(root, { recursive: true, force: true }); });
  let height = 1, phrase = `approve ${f.request.messageHash}`;
  const make = (request: SignRequest) => createCeremony(request, { publicKey: f.key.publicKey, clock: f.clock, journal,
    finalizedHeight: async () => height, authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => { height = 101; return phrase; } },
    keyBytes: () => { loads++; return f.key.keyBytes; } });
  if (ambiguous) journal.begin(f.request);
  await assert.rejects(make(f.request).sign(), ambiguous ? /PAYMENT_UNCERTAIN/ : /EXPIRED_BEFORE_APPROVAL/);
  assert.equal(loads, 0); assert.equal(store.scan('signed_transactions', { limit: 1 }).length, 0);
  store.close(); store = openStore(join(root, 'helper.db')); journal = new StoreSignJournal(store);
  if (ambiguous) {
    assert.throws(() => journal.expired(f.request));
    assert.throws(() => journal.read(f.request.requestId, fresh(f.request).messageHash), /PAYMENT_UNCERTAIN/);
    // Restore with a clean independent ephemeral consult; never clear ambiguity.
    const clean = fixture(); t.after(() => clean.key.keyBytes.fill(0));
    assert.equal(journal.read(clean.request.requestId, clean.request.messageHash), null);
  } else {
    const refusal = journal.read(f.request.requestId, f.request.messageHash);
    assert.deepEqual(refusal, { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: f.request.messageHash });
    const next = fresh(f.request); height = 101;
    assert.equal((await make(next).sign()).result.status, 'denied'); assert.equal(loads, 0); // old exact phrase
    phrase = `approve ${next.messageHash}`;
    const signed = await make(next).sign(); assert.equal(signed.result.status, 'signed'); assert.equal(loads, 1);
    assert.throws(() => journal.expired(next));
    assert.deepEqual(journal.read(next.requestId, next.messageHash), signed.result);
    assert.throws(() => journal.read(next.requestId, fresh(next).messageHash), /IDEMPOTENCY_CONFLICT/);
  }
});

async function pending(t: { after(fn: () => void): void }) {
  const h = harness(); t.after(() => h.cleanup()); h.ports = { ...h.ports, limits };
  let request: SignRequest | undefined, result: SignResult | null = null, height = 50, window = 100;
  const original = h.deps.signer;
  h.deps = { ...h.deps, signer: { ...original, async sign(r) {
    request = r; h.counts.sign++; result = { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: r.messageHash };
    throw new FoundationError('EXPIRED_BEFORE_APPROVAL');
  }, async recover() { return result; } }, primaryRpc: { ...h.deps.primaryRpc, finalizedHeight: async () => height,
    latestBlockhash: async () => ({ blockhash: address(`block-${window}`), lastValidBlockHeight: window, observedAt: h.clock.now() }) },
    secondaryRpc: { ...h.deps.secondaryRpc, finalizedHeight: async () => height } };
  const view = await h.api().consult(buyer, input()); assert.ok(request); assert.equal(h.counts.broadcast, 0);
  const armHash = () => hash(h.store.read('arms', view.consult_id)!.value.arm.payload);
  return { h, view, armHash, original, get request() { return request!; }, set result(r: SignResult | null) { result = r; },
    expire() { height = window + 1; window += 100; }, renew: (old = armHash()) => renewUnsignedPurchase(h.deps, h.ports, view.consult_id, old) };
}

for (const guard of ['null', 'wrong-hash', 'possible-signature', 'live-window', 'quote-expired', 'cap-missing', 'fee', 'stale-cas', 'secondary'] as const) test(`broker renewal guard ${guard}: refused, clean restoration passes`, async t => {
  const f = await pending(t), { h } = f;
  const held = h.store.read('reservations', f.view.consult_id)!, old = f.armHash(), request = f.request;
  f.expire(); const goodDeps = h.deps, goodPorts = h.ports;
  if (guard === 'null') f.result = null;
  if (guard === 'wrong-hash') f.result = { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: hash('wrong') };
  if (guard === 'possible-signature') f.result = { status: 'signed', messageHash: request.messageHash, publicKey: buyer.payer, signature: 'possible-signature' as never, approvalRef: request.offerApproval.approvalRef };
  if (guard === 'live-window') h.deps = { ...h.deps, primaryRpc: { ...h.deps.primaryRpc, finalizedHeight: async () => request.blockhash.lastValidBlockHeight } };
  if (guard === 'secondary') h.deps = { ...h.deps, secondaryRpc: { ...h.deps.secondaryRpc, finalizedHeight: async () => { throw new Error('RPC_UNAVAILABLE'); } } };
  if (guard === 'quote-expired') h.clock.advance(M03.quoteTtl.value * 1000);
  if (guard === 'cap-missing') { const { messageRenewalsMax: _removed, ...withoutCap } = M03; h.ports = { ...h.ports, limits: withoutCap as unknown as typeof M03 }; }
  if (guard === 'fee') h.behavior.feeEstimate = (M03.feePerPurchaseMax.value + 1n).toString() as never;
  await assert.rejects(f.renew(guard === 'stale-cas' ? hash('wrong') : old));
  assert.deepEqual(h.store.read('reservations', f.view.consult_id), held); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 0);
  if (guard === 'quote-expired') {
    const clean = await pending(t); clean.expire(); await clean.renew(); assert.equal(clean.h.counts.sign, 2); return;
  }
  h.deps = goodDeps; h.ports = goodPorts; h.behavior.feeEstimate = '1' as never;
  f.result = { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: request.messageHash };
  await f.renew(old); assert.equal(h.counts.sign, 2); assert.notEqual(f.armHash(), old); assert.equal(h.counts.quote, 2); assert.equal(h.counts.approval, 1);
  assert.deepEqual(h.store.read('reservations', f.view.consult_id), held);
});

test('three renewals cap, midnight, restart and concurrent CAS preserve original accounting and immutable archives', async t => {
  const f = await pending(t), { h } = f, held = h.store.read('reservations', f.view.consult_id)!;
  const quote = h.store.read('consults', f.view.consult_id)!.value.broker!.quote;
  const checks = h.store.scan('free_checks', { limit: 100 });
  h.clock.advance(61000); h.reopen();
  for (let n = 0; n < limits.messageRenewalsMax.value; n++) {
    f.expire(); const old = f.armHash(), oldArm = h.store.read('arms', f.view.consult_id)!.value.arm;
    const results = await Promise.allSettled([f.renew(old), f.renew(old)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(h.store.read('artifacts', hash(oldArm)));
    assert.deepEqual(h.store.read('reservations', f.view.consult_id), held);
    h.reopen();
  }
  f.expire(); await assert.rejects(f.renew(), /BUDGET_EXCEEDED/);
  assert.equal(h.store.read('consults', f.view.consult_id)!.value.broker!.renewalCount, limits.messageRenewalsMax.value);
  assert.deepEqual(h.store.read('consults', f.view.consult_id)!.value.broker!.quote, quote);
  assert.deepEqual(h.store.scan('free_checks', { limit: 100 }), checks);
  assert.equal(h.counts.quote, 2); assert.equal(h.counts.approval, 1); assert.equal(h.counts.broadcast, 0);
});

test('lost seller renewal reply resumes persisted replacement once, then clean signing/broadcast', async t => {
  const f = await pending(t), { h } = f; f.expire(); const old = f.armHash();
  const seller = h.deps.sellers.get('https://b.invalid')!; let lost = true;
  const arms: string[] = [];
  h.deps = { ...h.deps, sellers: new Map(h.deps.sellers).set('https://b.invalid', { ...seller, async arm(c, r, o) {
    arms.push(r.message_sha256); const result = await seller.arm(c, r, o); if (lost) throw new Error('LOST_REPLY'); return result;
  } }) };
  await f.renew(old); assert.equal(h.store.read('consults', f.view.consult_id)!.value.broker!.stage, 'arming');
  h.reopen(); lost = false; h.deps = { ...h.deps, signer: f.original };
  await f.renew(old); assert.equal(new Set(arms).size, 1); assert.equal(h.counts.broadcast, 1);
  assert.equal(h.store.read('consults', f.view.consult_id)!.value.broker!.renewalCount, 1);
  await assert.rejects(f.renew(old), /PAYMENT_UNCERTAIN/); assert.equal(h.counts.broadcast, 1);
});

test('strict expiry recovery reply and renewal wire fields reject malformed input with clean counterparts', () => {
  const f = fixture(); const result = { status: 'denied', reason: 'EXPIRED_BEFORE_APPROVAL', messageHash: f.request.messageHash };
  const good = canonicalBytes({ ok: true, result });
  for (const bad of [canonicalBytes({ ok: true, result: { ...result, messageHash: payloadHash('wrong') } }), canonicalBytes({ ok: true, result: { ...result, extra: 1 } }), Buffer.from('{"ok":true,"ok":false,"result":null}'), Uint8Array.of(255)]) {
    assert.throws(() => parseHumanRecovery(bad, f.request)); assert.deepEqual(parseHumanRecovery(good, f.request), result);
  }
  const arm = { quote_id: f.request.quoteId, message_base64: Buffer.from(f.request.message).toString('base64'), message_sha256: f.request.messageHash, recent_blockhash: f.request.blockhash.blockhash, last_valid_block_height: f.request.blockhash.lastValidBlockHeight,
    renewal: { previous_arm_sha256: payloadHash(f.request.arm.payload), unsigned_message_sha256: f.request.messageHash } };
  assert.throws(() => parseWire('arm_request', canonicalBytes({ ...arm, renewal: { ...arm.renewal, unknown: true } })));
  assert.deepEqual(parseWire('arm_request', canonicalBytes(arm)), arm);
  const lines: string[] = []; const log = createLogger(f.clock, s => lines.push(s));
  assert.throws(() => log({ code: 'made-up' as never })); log({ code: 'EXPIRED_BEFORE_APPROVAL' }); assert.equal(lines.length, 1);
  f.key.keyBytes.fill(0);
});

test('real seller wire/template renewal: CAS races, both-provider expiry, cap, archives and restart', async t => {
  const { harness: integrated, settle } = await import('./harness.ts');
  const h = await integrated(); t.after(() => h.cleanup());
  h.faults.failBeforeSign = true;
  const view = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  assert.equal(h.counts.sign, 0);
  const seller = h.sellerRows[1]!, quote = h.store.read('consults', view.consult_id)!.value.broker!.quote!;
  const get = () => seller.store.read('arms', quote.payload.quote_id)!.value;
  let height = 100;
  h.deps.primaryRpc.finalizedHeight = async () => height;
  h.deps.secondaryRpc.finalizedHeight = async () => height;
  const { createSellerService } = await import('../../src/seller/index.ts');
  const start = async () => {
    const service = createSellerService({ bundle: seller.bundle, config: { ...seller.config, limits }, signer: seller.signer,
      store: seller.store, clock: h.clock, primaryRpc: h.deps.primaryRpc, secondaryRpc: h.deps.secondaryRpc, tombstones: seller.journal });
    await service.start(); return service;
  };
  let controller = await start();
  for (let i = 0; i < limits.messageRenewalsMax.value; i++) {
    const old = get(), blockhash = { blockhash: generateThrowawayKey().publicKey, lastValidBlockHeight: old.arm.payload.last_valid_block_height + 100, observedAt: h.clock.now() };
    const payment = buildLegacyPayment(quote, { payer: h.buyer.payer, tokenAccount: h.addresses.buyerAta }, blockhash);
    const request = { quote_id: quote.payload.quote_id, message_base64: Buffer.from(payment.message).toString('base64'), message_sha256: payment.messageHash, recent_blockhash: blockhash.blockhash, last_valid_block_height: blockhash.lastValidBlockHeight,
      renewal: { previous_arm_sha256: payloadHash(old.arm.payload), unsigned_message_sha256: old.message_sha256 } };
    await assert.rejects(controller.arm(h.buyer, request)); assert.deepEqual(get(), old);
    height = old.arm.payload.last_valid_block_height + 1;
    await assert.rejects(controller.arm(h.buyer, { ...request, renewal: { ...request.renewal, previous_arm_sha256: payloadHash('wrong') } }));
    const alternative = { ...blockhash, blockhash: generateThrowawayKey().publicKey };
    const other = buildLegacyPayment(quote, payment.expected.payer, alternative);
    const outcomes = await Promise.allSettled([controller.arm(h.buyer, request), controller.arm(h.buyer, { ...request, message_base64: Buffer.from(other.message).toString('base64'), message_sha256: other.messageHash, recent_blockhash: alternative.blockhash })]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1, outcomes.map(o => o.status === 'rejected' ? String(o.reason) : 'ok').join(','));
    assert.equal(get().message_sha256, request.message_sha256);
    assert.ok(seller.store.read('artifacts', payloadHash(old)));
    assert.deepEqual(await controller.arm(h.buyer, request), get().arm); // identical retry
    await seller.reopen(); controller = await start(); assert.equal(get().renewalCount, i + 1);
    height = blockhash.lastValidBlockHeight;
  }
  const old = get(), blockhash = { blockhash: generateThrowawayKey().publicKey, lastValidBlockHeight: old.arm.payload.last_valid_block_height + 100, observedAt: h.clock.now() };
  const payment = buildLegacyPayment(quote, { payer: h.buyer.payer, tokenAccount: h.addresses.buyerAta }, blockhash);
  height++;
  await assert.rejects(controller.arm(h.buyer, { quote_id: quote.payload.quote_id, message_base64: Buffer.from(payment.message).toString('base64'), message_sha256: payment.messageHash, recent_blockhash: blockhash.blockhash, last_valid_block_height: blockhash.lastValidBlockHeight,
    renewal: { previous_arm_sha256: payloadHash(old.arm.payload), unsigned_message_sha256: old.message_sha256 } }));
  assert.deepEqual(get(), old); assert.equal(h.counts.sign, 0); assert.equal(h.counts.broadcast, 0);
});

test('real broker + seller + chain renews a never-dispatched expired arm and broadcasts one fresh transaction', async t => {
  const { harness: integrated, settle } = await import('./harness.ts');
  const { createSellerService } = await import('../../src/seller/index.ts');
  const h = await integrated(); t.after(() => h.cleanup()); h.faults.failBeforeSign = true;
  const original = await settle(h, h.broker.market.consult(h.buyer, h.request()));
  const held = h.store.read('reservations', original.consult_id), old = h.store.read('arms', original.consult_id)!.value.arm;
  const s = h.sellerRows[1]!;
  const seller = createSellerService({ store: s.store, bundle: s.bundle, config: { ...s.config, limits }, signer: s.signer, clock: h.clock,
    primaryRpc: h.deps.primaryRpc, secondaryRpc: h.deps.secondaryRpc, tombstones: s.journal }); await seller.start();
  const next = { blockhash: generateThrowawayKey().publicKey, lastValidBlockHeight: 200, observedAt: h.clock.now() };
  h.deps.primaryRpc.finalizedHeight = async () => 101; h.deps.secondaryRpc.finalizedHeight = async () => 101;
  h.deps.primaryRpc.latestBlockhash = async () => next;
  h.faults.failBeforeSign = false;
  const deps = { ...h.deps, sellers: new Map(h.deps.sellers).set(s.listing.endpoint, seller) };
  const fresh = await settle(h, renewUnsignedPurchase(deps, { ...h.broker.ports, limits }, original.consult_id, payloadHash(old.payload)));
  assert.equal(fresh.payment_state, 'payment_pending'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
  assert.notEqual(h.store.read('arms', original.consult_id)!.value.message_sha256, old.payload.message_sha256);
  assert.deepEqual(h.store.read('reservations', original.consult_id), held);
  assert.equal(h.store.scan('signed_transactions', { limit: 10 }).length, 1);
  const { bindBroker } = await import('../../src/broker/index.ts');
  const api = bindBroker({ ...h.broker.ports, limits }).createBroker(deps);
  const settled = await settle(h, api.status(h.buyer, { consult_id: fresh.consult_id }));
  assert.equal(settled.delivery_state, 'delivered'); assert.equal(h.counts.sign, 1); assert.equal(h.counts.broadcast, 1);
});
