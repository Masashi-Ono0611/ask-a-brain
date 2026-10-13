import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ArmRow, ConsultRow, FreeCheckRow, Id, IsoTime, QuoteRow, Receipt, ReservationRow, Revocation, Sha256, SignedTransactionRow, SettlementEvidence } from '../../src/wire/contracts.ts';
import { openStore, FOUNDATION_MIGRATIONS, STORE_MIGRATIONS } from '../../src/common/index.ts';
import { M03, parseWire } from '../../src/wire/index.ts';
const id = (s: string): Id => s as Id;
const at = '2026-10-09T00:00:00.000Z' as IsoTime;
const hash = 'a'.repeat(64) as Sha256;
function path(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'aab-contract-db-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return join(dir, 'store.db');
}
const fixture = (file: string): Uint8Array => readFileSync(new URL(`../../fixtures/wire/${file}.json`, import.meta.url));
const quote = parseWire('quote', fixture('quote')), answer = parseWire('answer', fixture('answer'));
const arm = parseWire('arm', fixture('arm'));
const receipt = parseWire('receipt', fixture('receipt'));
const settlement = JSON.parse(Buffer.from(fixture('settlement')).toString()) as SettlementEvidence;
const free: FreeCheckRow = { buyer_id: quote.payload.buyer_id, seller_id: quote.payload.seller_id, window: 'active', count: 1 };
const reservation: ReservationRow = { consult_id: id('consult'), payer: quote.payload.payer, day_utc: '2026-10-08', principal: quote.payload.total_atomic, maximum_fee: '5000' as ReservationRow['maximum_fee'], status: 'held' };
const quoteRow: QuoteRow = { seller_request_key: 'request', quote, answer };
const tombstone: Revocation = { slice_id: quote.payload.slice_id, manifest_sha256: quote.payload.manifest_sha256, generation: 1, revoked_at: at, reason: 'rights', approval_id: id('approval') };

test('002 upgrades populated 001 without inventing financial facts or dropping worker journal fields', (t) => {
  const file = path(t); const old = openStore(file, { migrations: FOUNDATION_MIGRATIONS });
  const broker = { v: 1, stage: 'signing', messageHash: hash }; // opaque pre-migration extension
  const consult = { buyer_id: quote.payload.buyer_id, request_id: quote.payload.request_id, body_sha256: hash, view: null, broker } as unknown as ConsultRow;
  const signed = { request_id: quote.payload.request_id, quote_id: quote.payload.quote_id, genesis: quote.payload.genesis_hash, signature: settlement.signature, message_sha256: hash, transaction_base64: 'cHVibGlj' } as SignedTransactionRow;
  old.transaction((tx) => {
    tx.insert('consults', 'consult', consult); tx.insert('free_checks', 'lease', free);
    tx.insert('reservations', 'pending', reservation);
    tx.insert('reservations', 'known', { ...reservation, consult_id: id('known'), status: 'resolved', network: 'devnet', actualPrincipal: quote.payload.total_atomic, actualFee: '5000' as ReservationRow['maximum_fee'] });
    tx.insert('signed_transactions', 'signed', signed); tx.insert('quotes', quote.payload.quote_id, quoteRow);
    tx.insert('arms', 'arm', { quote_id: quote.payload.quote_id, message_sha256: arm.payload.message_sha256, arm });
    tx.insert('receipts', receipt.receipt_id, receipt); tx.insert('tombstones', 'tombstone', tombstone);
    tx.insert('settlements', 'settlement', settlement);
  }); old.close();
  const current = openStore(file); t.after(() => current.close());
  assert.equal(current.diagnostics().schemaVersion, STORE_MIGRATIONS.length);
  assert.deepEqual(current.read('consults', 'consult')?.value.broker, broker);
  assert.deepEqual(current.read('reservations', 'pending')?.value, { ...reservation, network: null, actualPrincipal: null, actualFee: null });
  assert.equal(current.read('reservations', 'known')?.value.actualPrincipal, quote.payload.total_atomic);
  assert.equal(current.read('reservations', 'known')?.value.day_utc, reservation.day_utc);
  assert.equal(current.read('signed_transactions', 'signed')?.value.transaction_base64, signed.transaction_base64);
  assert.equal(current.read('signed_transactions', 'signed')?.value.transaction_sha256, null);
  assert.equal(current.read('signed_transactions', 'signed')?.value.approval_ref, null);
  assert.equal(current.read('receipts', receipt.receipt_id)?.value.approval_ref, null);
  assert.equal(current.read('arms', 'arm')?.value.expected, null);
  assert.equal(current.read('free_checks', 'lease')?.value.consultId, null);
  assert.equal(current.read('free_checks', 'lease')?.value.expiresAt, null);
  assert.deepEqual(current.read('quotes', quote.payload.quote_id)?.value.answer, answer);
  assert.deepEqual(current.read('tombstones', 'tombstone')?.value, tombstone);
  assert.deepEqual(current.scan('settlements', { where: { quote_id: quote.payload.quote_id }, limit: 1 })[0]?.value, settlement);
  assert.equal(current.scan('reservations', { where: { network: 'devnet' }, limit: 1 }).length, 1);
  current.close();
  assert.throws(() => openStore(file, { migrations: FOUNDATION_MIGRATIONS }), /STATE_CONFLICT/);
  const restarted = openStore(file); assert.equal(restarted.diagnostics().schemaVersion, STORE_MIGRATIONS.length); restarted.close();
});

test('duplicate legacy leases abort entire 002 transaction; explicit repair preserves count and permits upgrade', (t) => {
  const file = path(t); const old = openStore(file, { migrations: FOUNDATION_MIGRATIONS });
  old.transaction((tx) => { tx.insert('free_checks', 'a', free); tx.insert('free_checks', 'b', free); tx.insert('reservations', 'pending', reservation); }); old.close();
  assert.throws(() => openStore(file), /free_check_lease_unique/);
  const unchanged = openStore(file, { migrations: FOUNDATION_MIGRATIONS });
  assert.equal(unchanged.diagnostics().schemaVersion, 1); assert.deepEqual(unchanged.read('reservations', 'pending')?.value, reservation);
  assert.equal(unchanged.read('free_checks', 'a')?.value.count, 1); assert.equal(unchanged.read('free_checks', 'b')?.value.count, 1);
  unchanged.transaction((tx) => tx.compareAndSet('free_checks', 'b', 1, { ...free, window: 'separate-real-window' })); unchanged.close();
  const restored = openStore(file); assert.equal(restored.diagnostics().schemaVersion, STORE_MIGRATIONS.length); restored.close();
});

test('lease uniqueness and original reservation day guards fire; valid updates survive restart', (t) => {
  const file = path(t); const store = openStore(file); t.after(() => store.close());
  store.transaction((tx) => { tx.insert('free_checks', 'a', free); tx.insert('reservations', 'pending', reservation); });
  assert.throws(() => store.transaction((tx) => tx.insert('free_checks', 'b', free)), /free_check_lease_unique/);
  store.transaction((tx) => tx.insert('free_checks', 'b', { ...free, window: 'ready', consultId: id('consult'), expiresAt: at }));
  assert.throws(() => store.transaction((tx) => tx.compareAndSet('free_checks', 'b', 1, free)), /free_check_lease_unique/);
  store.transaction((tx) => tx.compareAndSet('free_checks', 'b', 1, { ...free, window: 'ready', count: 0, consultId: null, expiresAt: null }));
  assert.throws(() => store.transaction((tx) => tx.compareAndSet('reservations', 'pending', 1, { ...reservation, day_utc: '2026-10-09' })), /RESERVATION_DAY_IMMUTABLE/);
  store.transaction((tx) => tx.compareAndSet('reservations', 'pending', 1, { ...reservation, status: 'resolved', network: 'devnet', actualPrincipal: quote.payload.total_atomic, actualFee: '5000' as ReservationRow['maximum_fee'] }));
  store.close(); const reopened = openStore(file);
  assert.equal(reopened.read('reservations', 'pending')?.value.day_utc, '2026-10-08'); assert.equal(reopened.read('reservations', 'pending')?.value.status, 'resolved'); reopened.close();
});

function retentionFixture(t: { after(fn: () => void): void }) {
  const file = path(t); const store = openStore(file); t.after(() => store.close());
  const sentinel = 'PUBLIC_THROWAWAY_RETENTION_CONTENT_6ee4e912';
  const row = { ...quoteRow, answer: { ...answer, payload: { ...answer.payload, answer: sentinel } } };
  store.transaction((tx) => tx.insert('quotes', quote.payload.quote_id, row));
  const request = { quote_id: quote.payload.quote_id, expectedVersion: 1, now: at };
  return { file, store, sentinel, row, request };
}

test('unarmed retention blocks early deletion, redacts at boundary, preserves metadata and forbids restoration', (t) => {
  const f = retentionFixture(t);
  const deadline = Date.parse(quote.payload.expires_at) + M03.unarmedExpiredRetention.value * 3600000;
  assert.throws(() => f.store.cleanupContent({ ...f.request, now: new Date(deadline - 1).toISOString() as IsoTime }), /NOT_READY/);
  assert.equal(f.store.read('quotes', quote.payload.quote_id)?.value.answer?.payload.answer, f.sentinel);
  assert.equal(f.store.cleanupContent({ ...f.request, now: new Date(deadline).toISOString() as IsoTime }).reason, 'expired_unarmed');
  const after = f.store.read('quotes', quote.payload.quote_id)!;
  assert.equal(after.value.answer, null); assert.deepEqual(after.value.quote, quote); assert.equal(after.value.seller_request_key, 'request');
  assert.throws(() => f.store.transaction((tx) => tx.compareAndSet('quotes', quote.payload.quote_id, after.version, f.row)), /CONTENT_REDACTED/);
  f.store.transaction((tx) => tx.compareAndSet('quotes', quote.payload.quote_id, after.version, { ...after.value, refund_state: 'refunded' }));
  assert.equal(f.store.cleanupContent({ ...f.request, expectedVersion: after.version + 1 }).reason, 'already_redacted');
  f.store.close(); assert.equal(readFileSync(f.file).includes(Buffer.from(f.sentinel)), false);
  const reopened = openStore(f.file); assert.equal(reopened.read('quotes', quote.payload.quote_id)?.value.answer, null); assert.equal(reopened.read('quotes', quote.payload.quote_id)?.value.refund_state, 'refunded'); reopened.close();
});

test('armed unresolved content is retained until revocation; redaction keeps proof, liabilities, WAL records and tombstones', (t) => {
  const f = retentionFixture(t);
  const proof = parseWire('proof', fixture('proof'));
  const saved = { ...f.row, payment_state: 'payment_pending' as const, refund_state: 'refund_pending' as const, requested_recovery_atomic: quote.payload.total_atomic, proof, failure_evidence_sha256: hash };
  f.store.transaction((tx) => {
    tx.compareAndSet('quotes', quote.payload.quote_id, 1, saved);
    tx.insert('arms', 'arm', { quote_id: quote.payload.quote_id, message_sha256: arm.payload.message_sha256, arm });
    tx.insert('reservations', 'pending', reservation);
  });
  const req = { ...f.request, expectedVersion: 2, now: '2027-01-01T00:00:00.000Z' as IsoTime };
  assert.throws(() => f.store.cleanupContent(req), /NOT_READY/);
  f.store.transaction((tx) => tx.insert('tombstones', 'revoked', tombstone));
  assert.equal(f.store.cleanupContent(req).reason, 'revoked');
  const result = f.store.read('quotes', quote.payload.quote_id)!.value;
  assert.deepEqual(result, { ...saved, answer: null, redacted_at: req.now });
  assert.deepEqual(f.store.read('tombstones', 'revoked')?.value, tombstone);
  assert.equal(f.store.read('reservations', 'pending')?.value.status, 'held'); assert.ok(f.store.read('arms', 'arm'));
});

test('paid retention uses finalized evidence and M03 age, not an asserted row status', (t) => {
  const f = retentionFixture(t);
  f.store.transaction((tx) => tx.compareAndSet('quotes', quote.payload.quote_id, 1, { ...f.row, payment_state: 'payment_finalized' }));
  const deadline = Date.parse(settlement.observed_at) + M03.safePaidRetention.value * 86400000;
  const req = { ...f.request, expectedVersion: 2, now: new Date(deadline).toISOString() as IsoTime };
  assert.throws(() => f.store.cleanupContent(req), /NOT_READY/);
  f.store.transaction((tx) => tx.insert('settlements', 'paid', settlement));
  assert.throws(() => f.store.cleanupContent({ ...req, now: new Date(deadline - 1).toISOString() as IsoTime }), /NOT_READY/);
  assert.equal(f.store.cleanupContent(req).reason, 'paid_retention');
  assert.deepEqual(f.store.read('settlements', 'paid')?.value, settlement);
});

test('cleanup validates request and CAS before mutating; restored request succeeds', (t) => {
  const f = retentionFixture(t); f.store.transaction((tx) => tx.insert('tombstones', 'revoked', tombstone));
  for (const patch of [{ extra: true }, { expectedVersion: 0 }, { expectedVersion: 0.5 }, { expectedVersion: 2 }, { now: 'yesterday' }, { now: '2026-02-30T00:00:00.000Z' }, { quote_id: id('missing') }]) {
    assert.throws(() => f.store.cleanupContent({ ...f.request, ...patch } as typeof f.request));
    assert.equal(f.store.read('quotes', quote.payload.quote_id)!.version, 1);
  }
  assert.throws(() => f.store.transaction(() => f.store.cleanupContent(f.request)), /INVALID_INPUT/);
  assert.equal(f.store.cleanupContent(f.request).redacted, true);
});

test('stored duplicate-key JSON is rejected; Unicode loss rejected before insert, clean repair passes', (t) => {
  const file = path(t);
  const migration = { version: STORE_MIGRATIONS.length + 1, name: 'corrupt-fixture', sql: `INSERT INTO free_checks(key,version,value) VALUES ('bad',1,'{"buyer_id":"b","seller_id":"s","window":"w","count":1,"count":2}');` };
  const store = openStore(file, { migrations: [...STORE_MIGRATIONS, migration] }); t.after(() => store.close());
  assert.throws(() => store.read('free_checks', 'bad'), /DUPLICATE/);
  store.transaction((tx) => tx.compareAndSet('free_checks', 'bad', 1, free));
  assert.equal(store.read('free_checks', 'bad')?.value.count, 1);
  for (const bad of [{ ...free, window: '\ud800' }, { ...free, window: 'new', ['\ud800']: 'invalid' }]) {
    assert.throws(() => store.transaction((tx) => tx.insert('free_checks', 'unicode', bad)), /UNICODE/);
    assert.equal(store.read('free_checks', 'unicode'), null);
  }
  store.transaction((tx) => tx.insert('free_checks', 'unicode', { ...free, window: '日本語' }));
  assert.equal(store.read('free_checks', 'unicode')?.value.window, '日本語');
});

test('mismatched or ambiguous finalized evidence cannot authorize retention deletion; exact settlement passes', (t) => {
  const now = new Date(Date.parse(settlement.observed_at) + M03.safePaidRetention.value * 86400000).toISOString() as IsoTime;
  const badEvidence = [
    { genesis: 'wrong' }, { payer_debit: '0' }, { seller_credit: '0' }, { marketplace_credit: '0' },
    { commitment: 'confirmed' }, { meta_err: { error: true } }, { observed_at: 'invalid' },
  ];
  for (const patch of badEvidence) {
    const f = retentionFixture(t);
    f.store.transaction((tx) => tx.insert('settlements', 'bad', { ...settlement, ...patch } as SettlementEvidence));
    assert.throws(() => f.store.cleanupContent({ ...f.request, now }), /NOT_READY/);
    assert.notEqual(f.store.read('quotes', quote.payload.quote_id)!.value.answer, null);
    f.store.close(); // isolated failed fixture cannot change append-only evidence
    const control = retentionFixture(t); control.store.transaction((tx) => tx.insert('settlements', 'good', settlement));
    assert.equal(control.store.cleanupContent({ ...control.request, now }).reason, 'paid_retention');
  }
  const duplicate = retentionFixture(t);
  duplicate.store.transaction((tx) => {
    tx.insert('settlements', 'first', settlement);
    tx.insert('settlements', 'second', { ...settlement, signature: 'second' as SettlementEvidence['signature'] });
  });
  assert.throws(() => duplicate.store.cleanupContent({ ...duplicate.request, now }), /NOT_READY/);
  const control = retentionFixture(t); control.store.transaction((tx) => tx.insert('settlements', 'only', settlement));
  assert.equal(control.store.cleanupContent({ ...control.request, now }).reason, 'paid_retention');
});
