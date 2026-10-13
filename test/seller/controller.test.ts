import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSellerService } from '../../src/seller/index.ts';
import type { SellerQuoteRow } from '../../src/seller/index.ts';
import type { Address, Id, IsoTime, QuoteRequest, Sha256, Signature, Store } from '../../src/wire/contracts.ts';
import { M03 } from '../../src/wire/constants.ts';
import { fixture, settle, purchase, hash, payloadHash, bytes } from './support.ts';

test('offline startup, independent authority/journal and stale/future acknowledgment guards with clean restart', async (t) => {
  const f = fixture(t); assert.equal(await f.service.ready(), false);
  await assert.rejects(f.service.page('slice' as Id, 'p1' as Id), /NOT_READY/);
  f.setAuthorityError(true); await assert.rejects(f.service.start()); f.setAuthorityError(false);
  f.setJournalError(true); await assert.rejects(f.service.start()); f.setJournalError(false);
  for (const age of [(M03.lineageAcknowledgementMaxAge.value * 3600 + 1) * 1000, -(M03.clockSkewMax.value + 1) * 1000]) {
    f.setAcknowledged(new Date(Date.parse(f.clock.now()) - age).toISOString() as IsoTime); await assert.rejects(f.service.start(), /NOT_READY/);
  }
  f.setAcknowledged(f.clock.now()); await f.service.start(); assert.equal(await f.service.ready(), true);
  assert.ok((await f.service.page('slice' as Id, 'p1' as Id)).length > 0);
  f.clock.advance((M03.lineageAcknowledgementMaxAge.value * 3600 + 1) * 1000); assert.equal(await f.service.ready(), false);
  f.setAcknowledged(f.clock.now()); await f.restart(); assert.equal(await f.service.ready(), true);
});
test('ready response is padded, contains no answer/salt/spans and is durably signed before return', async (t) => {
  const f = fixture(t); await f.service.start(); const request = f.request(); const before = f.clock.monotonicMs();
  const result = await settle(f, f.service.quote(f.buyer, request)); assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  assert.ok(f.clock.monotonicMs() - before >= M03.readyDeclineResponseMin.value * 1000);
  const serialized = Buffer.from(bytes(result)).toString(); for (const forbidden of ['commitment_salt', 'byte_start', 'excerpt', '確認']) assert.ok(!serialized.includes(forbidden));
  const stored = f.store.read('quotes', result.quote.payload.quote_id)!.value; assert.equal((stored as SellerQuoteRow).payment_state, 'not_applicable'); assert.equal(payloadHash(stored.answer!.payload), result.quote.payload.answer_sha256);
  f.wire.verify('answer', stored.answer!, f.config.listing.signing_key); assert.equal(f.counts.seals, 2);
  assert.deepEqual(await settle(f, f.service.quote(f.buyer, request)), result); assert.equal(f.counts.preparations, 1);
  await assert.rejects(settle(f, f.service.quote(f.buyer, { ...request, request_nonce: 'changed' })), /IDEMPOTENCY_CONFLICT/);
  await f.restart(); assert.deepEqual(await settle(f, f.service.quote(f.buyer, request)), result); assert.equal(f.counts.preparations, 1);
});
test('decline has zero signer/chain/worker calls for unsupported text; approved supported counterpart succeeds', async (t) => {
  const f = fixture(t); await f.service.start(); const request = { ...f.request(), question: 'unsupported exact bytes' };
  const before = f.clock.monotonicMs(); const result = await settle(f, f.service.quote(f.buyer, request));
  assert.equal(result.status, 'declined'); assert.equal(f.counts.seals, 0); assert.equal(f.counts.rpcReads, 0); assert.equal(f.counts.preparations, 0);
  assert.ok(f.clock.monotonicMs() - before >= M03.readyDeclineResponseMin.value * 1000);
  assert.equal((await settle(f, f.service.quote(f.buyer, f.request()))).status, 'ready');
});
test('DB failure rolls back both payable quote and answer; restored store can issue one ready quote', async (t) => {
  const f = fixture(t); let fail = false;
  const proxy: Store = { ...f.store, read: f.store.read.bind(f.store), scan: f.store.scan.bind(f.store), checkpoint: f.store.checkpoint.bind(f.store), close() {}, transaction(body) {
    return f.store.transaction((tx) => body({ ...tx, insert(table, key, row) { tx.insert(table, key, row); if (fail && table === 'quotes') throw new Error('DISK_FAULT'); } }));
  } };
  const service = createSellerService({ ...f.deps, store: proxy }); await service.start(); fail = true; const request = f.request();
  await assert.rejects(settle(f, service.quote(f.buyer, request)), /DISK_FAULT/); assert.equal(f.store.scan('quotes', { limit: 1 }).length, 0);
  assert.equal(f.store.scan('consults', { limit: 1 }).length, 0); fail = false;
  assert.equal((await settle(f, service.quote(f.buyer, request))).status, 'ready');
});
test('worker substitution and scanner failure reject before payable quote; clean restored capability passes', async (t) => {
  const f = fixture(t); const worker = f.config.worker; let tamper = true; let scannerFail = false;
  const service = createSellerService({ ...f.deps, config: { ...f.config, worker: { async prepare(...args) {
    const result = await worker.prepare(...args); if (tamper && 'answer' in result) return { ...result, answer: { ...result.answer, answer: 'invented' } }; return result;
  } }, async scanOutput() { if (scannerFail) throw new Error('SCAN_FAILED'); } } });
  await service.start(); await assert.rejects(settle(f, service.quote(f.buyer, f.request())), /VERIFICATION_FAILED/);
  assert.equal(f.counts.seals, 0); tamper = false; scannerFail = true;
  await assert.rejects(settle(f, service.quote(f.buyer, f.request())), /SCAN_FAILED/); assert.equal(f.counts.seals, 0);
  scannerFail = false; assert.equal((await settle(f, service.quote(f.buyer, f.request()))).status, 'ready');
});
test('auth identity, one unarmed quote, dedup, arm template/hash/expiry guards preserve clean one-message control', async (t) => {
  const f = fixture(t); await f.service.start();
  await assert.rejects(f.service.quote(f.buyer, f.request(0, f.other)), /UNAUTHORIZED/);
  await assert.rejects(f.service.quote(f.buyer, { ...f.request(), network: 'mainnet-beta' }), /POLICY_DENIED/);
  const p = await purchase(f);
  await assert.rejects(f.service.arm(f.other, p.armInput), /UNAUTHORIZED/);
  await assert.rejects(f.service.arm(f.buyer, { ...p.armInput, message_sha256: hash('changed') }), /PAYMENT_INVALID/);
  await assert.rejects(f.service.arm(f.buyer, { ...p.armInput, recent_blockhash: 'other' as Address }), /IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(await f.service.arm(f.buyer, p.armInput), p.arm); await f.restart(); assert.deepEqual(await f.service.arm(f.buyer, p.armInput), p.arm);
  await assert.rejects(settle(f, f.service.quote(f.buyer, f.request())), /IDEMPOTENCY_CONFLICT/);
  // A different approved question may get one unarmed quote while the original stays armed.
  const second = await settle(f, f.service.quote(f.buyer, f.request(1))); assert.equal(second.status, 'ready'); if (second.status !== 'ready') return;
  await assert.rejects(settle(f, f.service.quote(f.buyer, f.request(2))), /RATE_LIMITED/);
  f.clock.advance((M03.quoteTtl.value - M03.armRemainingMin.value + 1) * 1000);
  const message = Buffer.from(`synthetic:${second.quote.payload.quote_id}:${f.buyer.payer}`);
  await assert.rejects(f.service.arm(f.buyer, { ...p.armInput, quote_id: second.quote.payload.quote_id, message_base64: message.toString('base64'), message_sha256: hash(message) }), /QUOTE_EXPIRED/);
  assert.deepEqual(await f.service.arm(f.buyer, p.armInput), p.arm); // Exact recovery does not mint a new arm.
});
test('seller independently observes pending/null/confirmed/errors; exact finalized split reveals same presigned answer after restart', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); const sealed = f.store.read('quotes', p.quote.payload.quote_id)!.value.answer;
  for (const mode of ['pending', 'confirmed', 'throw'] as const) {
    f.setMode(mode); assert.equal((await f.service.payment(f.buyer, p.proof)).payment_state, 'payment_pending'); assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'pending');
  }
  f.setMode('invalid'); await assert.rejects(f.service.payment(f.buyer, p.proof), /PAYMENT_INVALID/);
  f.setMode('finalized'); assert.equal((await f.service.payment(f.buyer, p.proof)).payment_state, 'payment_finalized');
  assert.ok(f.counts.rpcReads >= 8); const counts = f.counts;
  await f.restart(); assert.deepEqual(await f.service.answer(f.buyer, p.quote.payload.quote_id), { status: 'ready', answer: sealed });
  assert.deepEqual(await f.service.answer(f.buyer, p.quote.payload.quote_id), { status: 'ready', answer: sealed });
  assert.equal(f.counts.preparations, counts.preparations); assert.equal(f.counts.seals, counts.seals);
  assert.equal(f.store.scan('settlements', { limit: 10 }).length, 1);
  assert.equal((await f.service.payment(f.buyer, p.proof)).payment_state, 'payment_finalized');
});
test('wrong proof bindings and other-buyer access reject; correct locator/control passes without trusting supplied evidence', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f);
  for (const proof of [{ ...p.proof, quote_sha256: hash('wrong') }, { ...p.proof, arm_ticket_sha256: hash('wrong') }, { ...p.proof, network: 'mainnet-beta' as const }, { ...p.proof, genesis_hash: 'wrong' as Address }, { ...p.proof, message_sha256: hash('wrong') }]) await assert.rejects(f.service.payment(f.buyer, proof), /PAYMENT_INVALID/);
  await assert.rejects(f.service.payment(f.other, p.proof), /UNAUTHORIZED/); await assert.rejects(f.service.answer(f.other, p.quote.payload.quote_id), /UNAUTHORIZED/);
  assert.equal(f.counts.rpcReads, 0); f.setMode('finalized'); assert.equal((await f.service.payment(f.buyer, p.proof)).payment_state, 'payment_finalized');
  await assert.rejects(f.service.payment(f.buyer, { ...p.proof, transaction_signature: 'another' as Signature }), /IDEMPOTENCY_CONFLICT/);
});
for (const state of ['ready', 'armed', 'paid', 'cache'] as const) test(`revoked ${state}: quote/arm/page/manifest/reveal/restart blocked; liabilities preserved`, async (t) => {
  const f = fixture(t); await f.service.start();
  const p = state === 'ready' ? null : await purchase(f);
  const disposition = p ? { status: 'ready' as const, quote: p.quote } : await settle(f, f.service.quote(f.buyer, f.request())); assert.equal(disposition.status, 'ready'); if (disposition.status !== 'ready') return;
  if (state === 'paid' || state === 'cache') { f.setMode('finalized'); await f.service.payment(f.buyer, p!.proof); }
  if (state === 'cache') assert.equal((await f.service.answer(f.buyer, p!.quote.payload.quote_id)).status, 'ready');
  const revocation = f.revocation(); await f.service.revoke(revocation);
  assert.equal(await f.service.ready(), false);
  await assert.rejects(settle(f, f.service.quote(f.buyer, f.request(1))), /CONTENT_REVOKED/);
  await assert.rejects(f.service.page('slice' as Id, 'p1' as Id), /CONTENT_REVOKED/); await assert.rejects(f.service.manifest('slice' as Id), /CONTENT_REVOKED/);
  assert.equal((await f.service.answer(f.buyer, disposition.quote.payload.quote_id)).status, 'withheld');
  if (p) await assert.rejects(f.service.arm(f.buyer, p.armInput), /CONTENT_REVOKED/);
  if (state === 'armed') { f.setMode('finalized'); const view = await f.service.payment(f.buyer, p!.proof); assert.equal(view.payment_state, 'payment_finalized'); assert.equal(view.delivery_state, 'recovery_required'); }
  await f.restart(); assert.equal(await f.service.ready(), false); assert.equal((await f.service.answer(f.buyer, disposition.quote.payload.quote_id)).status, 'withheld');
  if (p) { const row = f.store.read('quotes', p.quote.payload.quote_id)!.value as SellerQuoteRow; assert.equal(row.payment_state, 'payment_finalized'); assert.equal(row.refund_state, 'refund_pending'); assert.equal(row.requested_recovery_atomic, M03.totalAtomic.value.toString()); }
  // Each rejected state has a separate clean fixture, with no tombstone rollback.
  const clean = fixture(t); await clean.service.start(); const cp = await purchase(clean); clean.setMode('finalized'); await clean.service.payment(clean.buyer, cp.proof); assert.equal((await clean.service.answer(clean.buyer, cp.quote.payload.quote_id)).status, 'ready');
});
test('old content backup + newest independent tombstone never restores serving; clean backup lost-response recovery works', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof);
  const backup = join(f.directory, 'old.db'); f.store.backup(backup, payloadHash([]));
  await f.service.revoke(f.revocation()); await f.restart(backup); assert.equal(await f.service.ready(), false);
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'withheld');
  assert.equal((f.store.read('quotes', p.quote.payload.quote_id)!.value as SellerQuoteRow).requested_recovery_atomic, p.quote.payload.total_atomic);
  const clean = fixture(t); await clean.service.start(); const cp = await purchase(clean); clean.setMode('finalized'); await clean.service.payment(clean.buyer, cp.proof);
  const cleanBackup = join(clean.directory, 'safe.db'); clean.store.backup(cleanBackup, payloadHash([])); await clean.restart(cleanBackup);
  assert.equal((await clean.service.answer(clean.buyer, cp.quote.payload.quote_id)).status, 'ready');
});
test('local tombstone survives failed independent append and rejects stale journal on restart', async (t) => {
  const f = fixture(t); await f.service.start(); const revocation = f.revocation(); f.setJournalError(true);
  await assert.rejects(f.service.revoke(revocation)); await assert.rejects(f.service.page('slice' as Id, 'p1' as Id), /CONTENT_REVOKED/);
  f.setJournalError(false); await assert.rejects(f.restart(), /NOT_READY/); f.setJournal([revocation]);
  // Generation attestation must also catch up; protected append repairs that, never removes a flag.
  await f.deps.tombstones.append(revocation); await f.restart(); assert.equal(await f.service.ready(), false);
  const clean = fixture(t); await clean.service.start(); assert.equal(await clean.service.ready(), true);
});
test('revocation linearizes with final delivery: before flag may release, after flag always withholds', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof);
  const before = f.service.answer(f.buyer, p.quote.payload.quote_id); const revoked = f.service.revoke(f.revocation()); const after = f.service.answer(f.buyer, p.quote.payload.quote_id);
  assert.equal((await before).status, 'ready'); await revoked; assert.equal((await after).status, 'withheld');
});
test('corrupt cached answer fails without regeneration; restoring exact original signed bytes recovers', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof);
  const id = p.quote.payload.quote_id; const original = f.store.read('quotes', id)!; const originalAnswer = original.value.answer!;
  f.store.transaction((tx) => tx.compareAndSet('quotes', id, original.version, { ...original.value, answer: { ...originalAnswer, payload: { ...originalAnswer.payload, answer: 'corrupt' } } }));
  assert.deepEqual(await f.service.answer(f.buyer, id), { status: 'withheld', code: 'VERIFICATION_FAILED' }); const counts = f.counts;
  const current = f.store.read('quotes', id)!; f.store.transaction((tx) => tx.compareAndSet('quotes', id, current.version, { ...current.value, answer: original.value.answer }));
  assert.equal((await f.service.answer(f.buyer, id)).status, 'ready'); assert.deepEqual(f.counts, counts);
});
test('unresolved paid non-delivery suspends new tests and keeps principal owed after restart', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, p.proof);
  f.clock.advance(M03.nonDeliveryAfterFinality.value * 60000); await f.service.reconcilePending();
  const row = f.store.read('quotes', p.quote.payload.quote_id)!.value as SellerQuoteRow; assert.equal(row.refund_state, 'refund_pending');
  await assert.rejects(settle(f, f.service.quote(f.buyer, f.request(1))), /NOT_READY/);
  await f.restart(); assert.equal((f.store.read('quotes', p.quote.payload.quote_id)!.value as SellerQuoteRow).requested_recovery_atomic, p.quote.payload.total_atomic);
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'ready');
});

test('same request after expiry cannot regenerate or refresh signed expiry; deliberate new request after dedup window passes', async (t) => {
  const f = fixture(t); await f.service.start(); const request = f.request(); const original = await settle(f, f.service.quote(f.buyer, request));
  f.clock.advance(M03.quoteTtl.value * 1000 + 1); assert.deepEqual(await settle(f, f.service.quote(f.buyer, request)), original); assert.equal(f.counts.preparations, 1);
  f.clock.advance(M03.dedupWindow.value * 60000); assert.equal((await settle(f, f.service.quote(f.buyer, f.request()))).status, 'ready'); assert.equal(f.counts.preparations, 2);
});
test('arm rejects wrong exact template despite matching input hash; correct message arms once', async (t) => {
  const f = fixture(t); await f.service.start(); const result = await settle(f, f.service.quote(f.buyer, f.request())); assert.equal(result.status, 'ready'); if (result.status !== 'ready') return;
  const bad = Buffer.from('synthetic:wrong:payer'); const id = result.quote.payload.quote_id;
  const input = { quote_id: id, message_base64: bad.toString('base64'), message_sha256: hash(bad), recent_blockhash: 'blockhash' as Address, last_valid_block_height: 100 };
  await assert.rejects(f.service.arm(f.buyer, input), /PAYMENT_INVALID/); assert.equal(f.store.read('arms', id), null);
  const good = Buffer.from(`synthetic:${id}:${f.buyer.payer}`); assert.equal((await f.service.arm(f.buyer, { ...input, message_base64: good.toString('base64'), message_sha256: hash(good) })).payload.quote_id, id);
});
test('worker cannot substitute the controller salt; restored worker passes', async (t) => {
  const f = fixture(t); let tamper = true;
  const service = createSellerService({ ...f.deps, config: { ...f.config, worker: { async prepare(question, context, signal) { return f.config.worker.prepare(question, tamper ? { ...context, commitment_salt: 'predictable-salt' } : context, signal); } } } });
  await service.start(); await assert.rejects(settle(f, service.quote(f.buyer, f.request())), /VERIFICATION_FAILED/); assert.equal(f.counts.seals, 0);
  tamper = false; assert.equal((await settle(f, service.quote(f.buyer, f.request()))).status, 'ready');
});
test('oversize signed envelope is rejected before quote commit; normal signature succeeds', async (t) => {
  const f = fixture(t); let tamper = true;
  const service = createSellerService({ ...f.deps, signer: { async sign(kind, payload, authorization) {
    const signed = await f.deps.signer.sign(kind, payload, authorization);
    return tamper ? { ...signed, padding: 'x'.repeat(M03.signedEnvelopeMax.value * 1024) } : signed;
  } } });
  await service.start(); await assert.rejects(settle(f, service.quote(f.buyer, f.request())), /VERIFICATION_FAILED/); assert.equal(f.store.scan('quotes', { limit: 1 }).length, 0);
  tamper = false; assert.equal((await settle(f, service.quote(f.buyer, f.request()))).status, 'ready');
});
test('failed finalized payment preserves actual fee evidence atomically and never reveals; clean finalized control passes', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('failure');
  assert.equal((await f.service.payment(f.buyer, p.proof)).payment_state, 'payment_failed');
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'pending');
  await f.restart(); const row = f.store.read('quotes', p.quote.payload.quote_id)!.value as SellerQuoteRow;
  assert.ok(row.failure_evidence_sha256); const record = f.store.read('artifacts', row.failure_evidence_sha256)!.value;
  assert.equal(JSON.parse(Buffer.from(record.bytes_base64, 'base64').toString()).actualFee, '1');
  const clean = fixture(t); await clean.service.start(); const cp = await purchase(clean); clean.setMode('finalized'); await clean.service.payment(clean.buyer, cp.proof); assert.equal((await clean.service.answer(clean.buyer, cp.quote.payload.quote_id)).status, 'ready');
});
test('replaying one chain signature against a second quote cannot settle twice; distinct clean signature passes', async (t) => {
  const f = fixture(t); await f.service.start(); const first = await purchase(f); f.setMode('finalized'); await f.service.payment(f.buyer, first.proof); await f.service.answer(f.buyer, first.quote.payload.quote_id);
  const second = await purchase(f, f.request(1)); await assert.rejects(f.service.payment(f.buyer, second.proof), /PAYMENT_INVALID/);
  assert.equal(f.store.scan('settlements', { limit: 10 }).length, 1);
  // Immutable locator cannot be replaced: clean counterpart uses a separate deliberate request.
  const clean = fixture(t); await clean.service.start(); const cp = await purchase(clean); clean.setMode('finalized'); assert.equal((await clean.service.payment(clean.buyer, { ...cp.proof, transaction_signature: 'distinct' as Signature })).payment_state, 'payment_finalized');
});
test('authority digest and generation rollback block restore; current consistent authority passes', async (t) => {
  const f = fixture(t); let bad = true;
  const service = createSellerService({ ...f.deps, config: { ...f.config, async authority() { const authority = await f.config.authority(); return bad ? { ...authority, tombstones_sha256: hash('wrong') } : authority; } } });
  await assert.rejects(service.start(), /NOT_READY/); assert.equal(await service.ready(), false); bad = false; await service.start(); assert.equal(await service.ready(), true);
  const key = `slice:${f.config.listing.slice.manifest_sha256}`; const old = f.store.read('eligibility', key)!;
  f.store.transaction((tx) => tx.compareAndSet('eligibility', key, old.version, { ...old.value, generation: 2 }));
  await assert.rejects(f.restart(), /NOT_READY/);
  const fresh = fixture(t); await fresh.service.start(); assert.equal(await fresh.service.ready(), true);
});
test('revocation while preparation is paused prevents quote commit; fresh eligible controller passes', async (t) => {
  const f = fixture(t); let release!: () => void; const pause = new Promise<void>((r) => { release = r; });
  const service = createSellerService({ ...f.deps, config: { ...f.config, worker: { async prepare(...args) { await pause; return f.config.worker.prepare(...args); } } } });
  await service.start(); const pending = service.quote(f.buyer, f.request()); const rejected = assert.rejects(settle(f, pending), /CONTENT_REVOKED/);
  await new Promise<void>((r) => setImmediate(r)); await service.revoke(f.revocation()); release(); await rejected;
  assert.equal(f.store.scan('quotes', { limit: 1 }).length, 0);
  const clean = fixture(t); await clean.service.start(); assert.equal((await settle(clean, clean.service.quote(clean.buyer, clean.request()))).status, 'ready');
});

test('concurrent identical request joins one durable preparation; changed body conflicts while clean waiter succeeds', async (t) => {
  const f = fixture(t); await f.service.start(); const request = f.request();
  const one = f.service.quote(f.buyer, request); const two = f.service.quote(f.buyer, request);
  await assert.rejects(f.service.quote(f.buyer, { ...request, request_nonce: 'changed' }), /IDEMPOTENCY_CONFLICT/);
  const [a, b] = await settle(f, Promise.all([one, two])); assert.deepEqual(a, b); assert.equal(f.counts.preparations, 1);
  assert.equal(f.store.scan('quotes', { limit: 10 }).length, 1);
});

test('startup rejects deployment/payee/seal-policy substitutions; approved synthetic deployment passes', async (t) => {
  const f = fixture(t);
  for (const config of [
    { ...f.config, origin: `${f.config.origin}/path` },
    { ...f.config, listing: { ...f.config.listing, seller_id: 'wrong' as Id } },
    { ...f.config, listing: { ...f.config.listing, payment: { ...f.config.listing.payment, fee_bps: M03.marketplaceFeeBps.value + 1 } } },
    { ...f.config, listing: { ...f.config.listing, payment: { ...f.config.listing.payment, marketplace_owner: f.config.listing.payment.seller_owner } } },
    { ...f.config, listing: { ...f.config.listing, payment: { ...f.config.listing.payment, seller_owner: f.buyer.payer } } },
    { ...f.config, invitations: [{ ...f.config.invitations[0]!, origin: 'https://wrong.invalid' }] },
    { ...f.config, listing: { ...f.config.listing, payment: { ...f.config.listing.payment, network: 'mainnet-beta' as const } } },
  ]) await assert.rejects(createSellerService({ ...f.deps, config }).start(), /NOT_READY/);
  await f.service.start(); assert.equal(await f.service.ready(), true);
});
test('manifest signature substitution blocks startup; original seal control starts', async (t) => {
  const f = fixture(t); const bundle = { ...f.bundle, manifest: { ...f.bundle.manifest, signature: { ...f.bundle.manifest.signature, value: 'invalid' } } };
  await assert.rejects(createSellerService({ ...f.deps, bundle }).start(), /VERIFICATION_FAILED/);
  await f.service.start(); assert.equal(await f.service.ready(), true);
});

test('unknown or over-limit host clock skew blocks new purchases; measured in-limit control passes', async (t) => {
  const f = fixture(t); let skew = NaN;
  const service = createSellerService({ ...f.deps, config: { ...f.config, clockSkewMs: () => skew } }); await service.start();
  for (const value of [NaN, Infinity, M03.clockSkewMax.value * 1000 + 1, -M03.clockSkewMax.value * 1000 - 1]) {
    skew = value; assert.equal(await service.ready(), false); await assert.rejects(settle(f, service.quote(f.buyer, f.request())), /NOT_READY/);
  }
  skew = M03.clockSkewMax.value * 1000; assert.equal(await service.ready(), true); assert.equal((await settle(f, service.quote(f.buyer, f.request()))).status, 'ready');
});
