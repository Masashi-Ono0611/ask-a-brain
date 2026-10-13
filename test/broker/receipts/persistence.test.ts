import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalBytes, bytesHash } from '../../../src/wire/index.ts';
import type { Receipt, StoreTx } from '../../../src/wire/contracts.ts';
import { parseReceipt, readArtifact } from '../../../src/broker/receipts/index.ts';
import { declined, fixture, id } from './fixture.ts';

test('receipt, full signed artifacts, pages and outbox commit together before success and survive reopen', (t) => {
  const h = fixture(t); let returned = false;
  assert.throws(() => h.store.transaction((tx) => {
    const failing: StoreTx = { ...tx, insert(table, key, row) { if (table === 'outbox') throw new Error('injected outbox disk failure'); tx.insert(table, key, row); } };
    h.persist(failing, h.receipt, h.artifacts); returned = true;
  }), /outbox disk failure/);
  assert.equal(returned, false); assert.equal(h.store.read('receipts', h.receipt.receipt_id), null);
  assert.equal(h.store.scan('artifacts', { limit: 1000 }).length, 0); assert.equal(h.store.scan('events', { limit: 1000 }).length, 0);
  assert.equal(h.save(), h.receipt.receipt_id); returned = true;
  assert.equal(returned, true); h.reopen();
  assert.equal(h.current().approval_ref, 'test-approval'); assert.equal(h.current().delivery_state, 'delivered');
  assert.equal(h.store.read('outbox', h.receipt.receipt_id)?.value.state, 'import_pending');
  for (const [hash, bytes] of h.artifacts.blobs) assert.deepEqual(readArtifact(h.store, hash), bytes);
  assert.deepEqual(parseReceipt(canonicalBytes(h.current())), h.current());
  const version = h.store.read('receipts', h.receipt.receipt_id)!.version;
  h.save(); assert.equal(h.store.read('receipts', h.receipt.receipt_id)!.version, version);
});

test('strict receipt parsing rejects duplicate keys, unknown fields, invalid UTF-8 and approval forgery; clean passes', (t) => {
  const h = fixture(t), clean = canonicalBytes(h.receipt), text = Buffer.from(clean).toString();
  assert.throws(() => parseReceipt(Buffer.from(text.replace('"v":1', '"v":1,"v":1'))), /DUPLICATE_KEY/);
  assert.throws(() => parseReceipt(canonicalBytes({ ...h.receipt, source: 'human' })));
  assert.throws(() => parseReceipt(Buffer.from([0xff, 0xfe])));
  assert.throws(() => h.save({ ...h.receipt, approval_ref: id('forged') }), /VERIFICATION_FAILED/);
  assert.equal(h.store.read('receipts', h.receipt.receipt_id), null);
  h.save(); assert.equal(parseReceipt(canonicalBytes(h.current())).approval_ref, h.receipt.approval_ref);
});

test('missing, mismatched, malformed and incorrectly signed artifacts block delivery; restored bytes pass', (t) => {
  const h = fixture(t), hash = h.receipt.artifact_refs.answer!;
  const missing = new Map(h.artifacts.blobs); missing.delete(hash);
  assert.throws(() => h.save(h.receipt, { blobs: missing }), /VERIFICATION_FAILED/);
  const corrupt = new Map(h.artifacts.blobs); corrupt.set(hash, Buffer.from('corrupt'));
  assert.throws(() => h.save(h.receipt, { blobs: corrupt }), /VERIFICATION_FAILED/);
  for (const bytes of [Buffer.from('{"payload":1,"payload":2}'), Buffer.from([0xff]), canonicalBytes({ ...h.answer, signature: { ...h.answer.signature, value: Buffer.alloc(64).toString('base64url') } })]) {
    const badHash = bytesHash(bytes), blobs = new Map(h.artifacts.blobs); blobs.set(badHash, bytes);
    assert.throws(() => h.save({ ...h.receipt, artifact_refs: { ...h.receipt.artifact_refs, answer: badHash } }, { blobs }));
    assert.equal(h.store.read('receipts', h.receipt.receipt_id), null);
  }
  h.save(); h.reopen(); assert.equal(h.current().verified.source_hashes, true);
});

test('free decline keeps zero amounts and null/not-applicable evidence, without inventing a verification pass', (t) => {
  const h = fixture(t), clean = declined(h.receipt);
  const row = h.store.read('consults', h.consultId)!;
  h.store.transaction((tx) => tx.compareAndSet('consults', h.consultId, row.version, { ...h.row, broker: { ...h.row.broker, quote: null, approval: null }, view: { ...h.row.view, answer: null } }));
  assert.throws(() => h.save({ ...clean, verified: { ...clean.verified, chain: true } }));
  assert.throws(() => h.save({ ...clean, total_atomic: h.receipt.total_atomic }));
  h.save(clean); h.reopen();
  assert.equal(h.current().quote_id, null); assert.equal(h.current().approval_ref, null);
  assert.equal(h.current().verified.chain, 'not_applicable'); assert.equal(h.current().network_fee_lamports, '0');
});

test('selected unpaid and ambiguous pending receipts do not fabricate settlement or zero unknown spend', (t) => {
  const h = fixture(t), free = declined(h.receipt);
  const selected: Receipt = { ...free, seller_id: h.receipt.seller_id, quote_id: h.receipt.quote_id, quote_sha256: h.receipt.quote_sha256,
    answer_sha256: h.receipt.answer_sha256, manifest_sha256: h.receipt.manifest_sha256, artifact_refs: h.receipt.artifact_refs,
    dispositions: h.receipt.dispositions, verified: { chain: false, seller_signature: true, answer_commitment: false, source_hashes: false } };
  h.save(selected); assert.equal(h.current().payment_state, 'not_applicable');
  const pending: Receipt = { ...selected, payment_state: 'payment_pending', delivery_state: 'pending', total_atomic: null, seller_atomic: null, fee_atomic: null, network_fee_lamports: null };
  assert.throws(() => h.save({ ...pending, verified: { ...pending.verified, chain: true } }));
  h.save(pending); h.reopen(); assert.equal(h.current().total_atomic, null); assert.equal(h.current().network_fee_lamports, null);
  h.save(); assert.equal(h.current().payment_state, 'payment_finalized');
  assert.throws(() => h.save(pending), /STATE_CONFLICT/); assert.equal(h.current().payment_state, 'payment_finalized');
});

test('same receipt cannot change question, buyer, identity, settlement or independence; clean repeat is idempotent', (t) => {
  const h = fixture(t); h.save();
  for (const mutation of [{ question: 'changed' }, { buyer_id: id('other') }, { quote_id: id('different') }, { classification: 'independent' as const },
    { settlement: { ...h.receipt.settlement!, slot: h.receipt.finalized_slot! + 1 }, finalized_slot: h.receipt.finalized_slot! + 1 }]) assert.throws(() => h.save({ ...h.receipt, ...mutation }));
  h.save(); assert.equal(h.current().classification, 'technical_verification'); assert.equal(h.current().question, h.receipt.question);
});

test('abrupt process exit before commit exposes no receipt; exit after commit preserves receipt, artifacts and retryable outbox', (t) => {
  const h = fixture(t), packet = join(h.dir, 'public-packet.json');
  writeFileSync(packet, canonicalBytes({ receipt: h.receipt, blobs: [...h.artifacts.blobs].map(([hash, bytes]) => [hash, Buffer.from(bytes).toString('base64')]) }));
  const worker = fileURLToPath(new URL('./crash-worker.ts', import.meta.url));
  const run = (mode: string) => {
    h.store.close();
    const result = spawnSync(process.execPath, [worker, h.path, packet, mode], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined); h.reopen(); return result;
  };
  assert.equal(run('before-commit').status, 23);
  assert.equal(h.store.read('receipts', h.receipt.receipt_id), null); assert.equal(h.store.scan('artifacts', { limit: 1 }).length, 0);
  assert.equal(run('after-commit').status, 24);
  assert.equal(h.current().delivery_state, 'delivered'); assert.equal(h.store.read('outbox', h.receipt.receipt_id)?.value.state, 'import_pending');
  assert.deepEqual(readArtifact(h.store, h.receipt.artifact_refs.answer!), h.artifacts.blobs.get(h.receipt.artifact_refs.answer!));
});
