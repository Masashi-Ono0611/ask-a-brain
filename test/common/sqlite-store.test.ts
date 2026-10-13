import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FreeCheckRow, Id, Receipt, Sha256, StoreQuery, StoreTx, Uuid } from '../../src/wire/contracts.ts';
import { openStore, FOUNDATION_MIGRATIONS, STORE_MIGRATIONS } from '../../src/common/index.ts';
const id = (value: string): Id => value as Id;
const hash = 'a'.repeat(64) as Sha256;
function directory(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'aab-store-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
const counter: FreeCheckRow = { buyer_id: id('buyer'), seller_id: id('seller'), window: '2026-10-09', count: 1 };
test('SQLite file opens, migrates, persists, rolls back, and applies durability pragmas', (t) => {
  const dir = directory(t); const path = join(dir, 'store.db'); const store = openStore(path); t.after(() => store.close());
  const settings = store.diagnostics(); assert.match(settings.sqliteVersion, /^3\./);
  assert.equal(settings.schemaVersion, STORE_MIGRATIONS.length); assert.equal(settings.foreignKeys, 1);
  assert.equal(settings.journalMode, 'wal'); assert.equal(settings.synchronous, 2); assert.equal(settings.busyTimeout, 5000);
  store.transaction((tx) => tx.insert('free_checks', 'a', counter));
  assert.ok(existsSync(`${path}-wal`)); assert.equal(store.read('free_checks', 'a')?.value.count, 1);
  assert.throws(() => store.transaction((tx) => { tx.insert('free_checks', 'rollback', { ...counter, window: 'rollback' }); throw new Error('fixture rollback'); }), /fixture rollback/);
  assert.equal(store.read('free_checks', 'rollback'), null);
  store.checkpoint(); store.close();
  const reopened = openStore(path); try { assert.equal(reopened.read('free_checks', 'a')?.value.count, 1); } finally { reopened.close(); }
});
test('CAS conflicts, uniqueness, append-only records and bounded indexed scans', (t) => {
  const store = openStore(join(directory(t), 'store.db')); t.after(() => store.close());
  store.transaction((tx) => { tx.insert('free_checks', 'a', counter); tx.insert('free_checks', 'b', { ...counter, window: 'different-window', count: 2 }); });
  store.transaction((tx) => tx.compareAndSet('free_checks', 'a', 1, { ...counter, count: 3 }));
  assert.equal(store.read('free_checks', 'a')?.version, 2);
  assert.throws(() => store.transaction((tx) => tx.compareAndSet('free_checks', 'a', 1, counter)), /STATE_CONFLICT/);
  assert.throws(() => store.transaction((tx) => tx.insert('free_checks', 'a', counter)));
  assert.equal(store.scan('free_checks', { where: { buyer_id: id('buyer') }, limit: 1, cursor: 'a' })[0]?.value.count, 2);
  for (const query of [{ limit: 0 }, { limit: 1001 }, { limit: 1, where: { count: 1 } }, { limit: 1, sql: 'SELECT 1' }]) assert.throws(() => store.scan('free_checks', query as StoreQuery<'free_checks'>), /INVALID_INPUT/);
  store.transaction((tx) => tx.insert('artifacts', hash, { sha256: hash, bytes_base64: 'cHVibGlj' }));
  assert.throws(() => store.transaction((tx) => {
    // @ts-expect-error Positive compile/runtime control: artifacts are immutable.
    tx.compareAndSet('artifacts', hash, 1, { sha256: hash, bytes_base64: '' });
  }), /STATE_CONFLICT/);
  const consult = { buyer_id: id('buyer'), request_id: '00000000-0000-4000-8000-000000000001' as Uuid, body_sha256: hash, view: null };
  store.transaction((tx) => tx.insert('consults', 'first', consult));
  assert.throws(() => store.transaction((tx) => tx.insert('consults', 'duplicate', { ...consult, body_sha256: 'b'.repeat(64) as Sha256 })));
});
test('foreign keys prevent orphan outbox and failed transaction rolls back receipt as well', (t) => {
  const store = openStore(join(directory(t), 'store.db')); t.after(() => store.close());
  const outbox = { receipt_id: id('receipt'), mode: 'metadata_only' as const, attempts: 0, state: 'import_pending' as const };
  assert.throws(() => store.transaction((tx) => tx.insert('outbox', 'job', outbox)), /FOREIGN KEY/);
  // Storage-level fixture only; full receipt schema validation belongs to T1.
  const receipt = { receipt_id: id('receipt'), request_id: 'request', buyer_id: id('buyer') } as unknown as Receipt;
  assert.throws(() => store.transaction((tx) => { tx.insert('receipts', 'receipt', receipt); tx.insert('outbox', 'bad', { ...outbox, receipt_id: id('missing') }); }), /FOREIGN KEY/);
  assert.equal(store.read('receipts', 'receipt'), null);
  store.transaction((tx) => { tx.insert('receipts', 'receipt', receipt); tx.insert('outbox', 'job', outbox); });
  assert.equal(store.read('outbox', 'job')?.value.receipt_id, 'receipt');
});
test('thenable/async callbacks roll back and escaped transaction capabilities are invalidated', async (t) => {
  const store = openStore(join(directory(t), 'store.db')); t.after(() => store.close()); let escaped: StoreTx | undefined;
  assert.throws(() => store.transaction((tx) => { escaped = tx; tx.insert('free_checks', 'async', counter); return Promise.resolve('bad'); }), /STATE_CONFLICT/);
  assert.equal(store.read('free_checks', 'async'), null);
  assert.throws(() => escaped!.insert('free_checks', 'late', counter), /STATE_CONFLICT/);
  assert.throws(() => store.transaction(() => store.transaction(() => 1)), /STATE_CONFLICT/);
  let lateRejected = false;
  assert.throws(() => store.transaction(async (tx) => {
    tx.insert('free_checks', 'before-await', counter); await Promise.resolve();
    try { tx.insert('free_checks', 'after-await', counter); } catch { lateRejected = true; }
  }), /STATE_CONFLICT/);
  await Promise.resolve(); assert.equal(lateRejected, true);
  assert.equal(store.read('free_checks', 'before-await'), null); assert.equal(store.read('free_checks', 'after-await'), null);
  store.transaction((tx) => tx.insert('free_checks', 'good', counter)); assert.ok(store.read('free_checks', 'good'));
});
test('failed numbered migration rolls back DDL/version and a repaired migration can run', (t) => {
  const path = join(directory(t), 'store.db'); const initial = openStore(path, { migrations: FOUNDATION_MIGRATIONS }); initial.close();
  const bad = { version: 2, name: 'fixture', sql: 'CREATE TABLE fixture(value TEXT); INSERT INTO missing_table VALUES (1);' };
  assert.throws(() => openStore(path, { migrations: [...FOUNDATION_MIGRATIONS, bad] }), /missing_table/);
  const unchanged = openStore(path, { migrations: FOUNDATION_MIGRATIONS }); assert.equal(unchanged.diagnostics().schemaVersion, 1); unchanged.close();
  const fixed = { ...bad, sql: 'CREATE TABLE fixture(value TEXT);' };
  const migrated = openStore(path, { migrations: [...FOUNDATION_MIGRATIONS, fixed] }); assert.equal(migrated.diagnostics().schemaVersion, 2); migrated.close();
  assert.throws(() => openStore(path, { migrations: FOUNDATION_MIGRATIONS }), /STATE_CONFLICT/); // Newer than known schema.
  assert.throws(() => openStore(path, { migrations: [...FOUNDATION_MIGRATIONS, { ...fixed, sql: 'SELECT 1;' }] }), /STATE_CONFLICT/); // Unknown history.
});
test('unknown unversioned database and unknown user_version refuse startup', (t) => {
  const dir = directory(t); const path = join(dir, 'store.db'); const store = openStore(path); store.checkpoint(); store.close();
  // Deliberately corrupt only the public SQLite header in an isolated fixture.
  const bytes = readFileSync(path); bytes.writeUInt32BE(999, 60); writeFileSync(path, bytes);
  assert.throws(() => openStore(path), /STATE_CONFLICT/);
  bytes.writeUInt32BE(0, 60); writeFileSync(path, bytes);
  assert.throws(() => openStore(path), /STATE_CONFLICT/);
  bytes.writeUInt32BE(STORE_MIGRATIONS.length, 60); writeFileSync(path, bytes); // Restore positive control.
  const restored = openStore(path); assert.equal(restored.diagnostics().schemaVersion, STORE_MIGRATIONS.length); restored.close();
});
test('backup is readable, hash-matched, never overwrites and requires tombstone reconciliation', (t) => {
  const dir = directory(t); const store = openStore(join(dir, 'store.db')); t.after(() => store.close());
  store.transaction((tx) => tx.insert('free_checks', 'a', counter));
  const destination = join(dir, 'backup.db'); const manifest = store.backup(destination, hash);
  assert.equal(manifest.sha256, createHash('sha256').update(readFileSync(destination)).digest('hex'));
  assert.equal(manifest.restoreRequiresNewestTombstones, true); assert.equal(manifest.independentTombstonesSha256, hash);
  assert.deepEqual(JSON.parse(readFileSync(`${destination}.manifest.json`, 'utf8')), manifest);
  assert.throws(() => store.backup(destination, hash));
  const backup = openStore(destination); try { assert.equal(backup.read('free_checks', 'a')?.value.count, 1); } finally { backup.close(); }
  assert.throws(() => store.transaction(() => store.backup(join(dir, 'bad.db'), hash)), /STATE_CONFLICT/);
});
