/** The ONLY source file permitted to import node:sqlite. Local disk, one owner.
 * Trusted migration SQL belongs to the lead; application callers get StoreTx.
 * Restoring a backup still requires newest independent tombstone reconciliation.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BrokerContentCleanupRequest, BrokerContentCleanupResult, Receipt, ContentCleanupRequest, ContentCleanupResult, LedgerEvent, MutableTable, RowTypes, Sha256, Store, StoreQuery, StoreTx, TableName, Versioned } from '../wire/contracts.ts';
import { assertUnicodeScalars } from './utf8.ts';
import { FoundationError } from './errors.ts';
import { APPEND_ONLY } from './migrations/001-foundation.ts';
import { INDEXED_FIELDS } from './migrations/002-contract-reconciliation.ts';
import { STORE_MIGRATIONS } from './migrations/003-broker-content-cleanup.ts';
import { M03, strictJson, validateWire, payloadHash } from '../wire/index.ts';
export { STORE_MIGRATIONS } from './migrations/003-broker-content-cleanup.ts';
import type { Migration } from './migrations/001-foundation.ts';
export type { Migration } from './migrations/001-foundation.ts';
export { FOUNDATION_MIGRATIONS } from './migrations/001-foundation.ts';
export interface StoreDiagnostics { readonly sqliteVersion: string; readonly schemaVersion: number; readonly foreignKeys: number; readonly journalMode: string; readonly synchronous: number; readonly busyTimeout: number }
export interface BackupManifest { readonly v: 1; readonly schemaVersion: number; readonly sqliteVersion: string; readonly sha256: Sha256; readonly createdAt: string; readonly independentTombstonesSha256: Sha256; readonly restoreRequiresNewestTombstones: true }
export interface SqliteStoreOptions { readonly migrations?: readonly Migration[] }
function sha(bytes: string | Uint8Array): Sha256 { return createHash('sha256').update(bytes).digest('hex') as Sha256; }
function name(table: TableName): string {
  if (!Object.hasOwn(INDEXED_FIELDS, table)) throw new FoundationError('INVALID_INPUT');
  return table;
}
function rowKey(key: string): void { if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) throw new FoundationError('INVALID_INPUT'); }
function stored<K extends TableName>(row: Record<string, unknown> | undefined): Versioned<RowTypes[K]> | null {
  if (row === undefined) return null;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || typeof row.value !== 'string') throw new FoundationError('RECEIPT_STORE_UNAVAILABLE');
  // Only trusted role-local records reach this adapter; T1 validates wire input.
  return { version: row.version, value: strictJson(new TextEncoder().encode(row.value), { integerNumbersOnly: true }) as unknown as RowTypes[K] };
}
function serialize(value: unknown): string {
  // Reject silent JSON loss (undefined, nonfinite numbers, typed arrays, classes).
  const seen = new Set<object>();
  function check(item: unknown): void {
    if (typeof item === 'string') { assertUnicodeScalars(item, { forbidBom: false }); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isSafeInteger(item)) return;
    if (typeof item !== 'object' || seen.has(item)) throw new FoundationError('INVALID_INPUT');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new FoundationError('INVALID_INPUT');
    seen.add(item);
    for (const [key, child] of Object.entries(item)) { assertUnicodeScalars(key, { forbidBom: false }); check(child); }
    seen.delete(item);
  }
  check(value);
  return JSON.stringify(value);
}
export class SqliteStore implements Store {
  readonly #db: DatabaseSync;
  #closed = false; #transaction = false;
  constructor(path: string, options: SqliteStoreOptions = {}) {
    if (!path || path === ':memory:') throw new FoundationError('INVALID_INPUT'); // WAL requires a file.
    const migrations = options.migrations ?? STORE_MIGRATIONS;
    if (migrations.length === 0 || migrations.some((m, i) => m.version !== i + 1 || !m.name || !m.sql)) throw new FoundationError('STATE_CONFLICT');
    this.#db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      this.#checkSchema(migrations); // Refuse unknown databases before changing journal/schema.
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      const before = this.#db.prepare('SELECT sqlite_version() AS version').get();
      if (typeof before?.version !== 'string') throw new FoundationError('NOT_READY');
      this.#db.exec('BEGIN IMMEDIATE; CREATE TABLE __aab_rollback_probe(value INTEGER); ROLLBACK;');
      if (this.#db.prepare("SELECT name FROM sqlite_master WHERE name='__aab_rollback_probe'").get()) throw new FoundationError('NOT_READY');
      this.#migrate(migrations);
      const settings = this.diagnostics();
      if (settings.foreignKeys !== 1 || settings.journalMode !== 'wal' || settings.synchronous !== 2 || settings.busyTimeout !== 5000) throw new FoundationError('NOT_READY');
    } catch (error) { this.#db.close(); this.#closed = true; throw error; }
  }
  #available(): void { if (this.#closed) throw new FoundationError('NOT_READY'); }
  #version(): number {
    const value = this.#db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new FoundationError('STATE_CONFLICT');
    return value;
  }
  #checkSchema(migrations: readonly Migration[]): void {
    const version = this.#version();
    if (version > migrations.length) throw new FoundationError('STATE_CONFLICT');
    const names = this.#db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    if (version === 0) { if (names.length !== 0) throw new FoundationError('STATE_CONFLICT'); return; }
    if (!names.some((row) => row.name === '__aab_migrations')) throw new FoundationError('STATE_CONFLICT');
    const history = this.#db.prepare('SELECT version, name, sha256 FROM __aab_migrations ORDER BY version').all();
    if (history.length !== version) throw new FoundationError('STATE_CONFLICT');
    history.forEach((row, i) => {
      const migration = migrations[i];
      if (!migration || row.version !== migration.version || row.name !== migration.name || row.sha256 !== sha(migration.sql)) throw new FoundationError('STATE_CONFLICT');
    });
  }
  #migrate(migrations: readonly Migration[]): void {
    const version = this.#version();
    for (const migration of migrations.slice(version)) {
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        if (migration.version === 1) this.#db.exec('CREATE TABLE __aab_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL) STRICT');
        this.#db.exec(migration.sql);
        this.#db.prepare('INSERT INTO __aab_migrations(version, name, sha256) VALUES (?, ?, ?)').run(migration.version, migration.name, sha(migration.sql));
        this.#db.exec(`PRAGMA user_version=${migration.version}`);
        this.#db.exec('COMMIT');
      } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    }
  }
  diagnostics(): StoreDiagnostics {
    this.#available();
    return { sqliteVersion: String(this.#db.prepare('SELECT sqlite_version() AS v').get()?.v), schemaVersion: this.#version(),
      foreignKeys: Number(this.#db.prepare('PRAGMA foreign_keys').get()?.foreign_keys), journalMode: String(this.#db.prepare('PRAGMA journal_mode').get()?.journal_mode),
      synchronous: Number(this.#db.prepare('PRAGMA synchronous').get()?.synchronous), busyTimeout: Number(this.#db.prepare('PRAGMA busy_timeout').get()?.timeout) };
  }
  read<K extends TableName>(table: K, key: string): Versioned<RowTypes[K]> | null {
    this.#available(); rowKey(key);
    return stored<K>(this.#db.prepare(`SELECT version, value FROM ${name(table)} WHERE key=?`).get(key));
  }
  scan<K extends TableName>(table: K, query: StoreQuery<K>): readonly Versioned<RowTypes[K]>[] {
    this.#available(); name(table);
    // Implementation resource bound; not a protocol/M03 cap.
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000 || Object.keys(query).some((key) => !['where', 'limit', 'cursor'].includes(key))) throw new FoundationError('INVALID_INPUT');
    const predicates: string[] = []; const parameters: (string | number)[] = [];
    for (const [field, value] of Object.entries(query.where ?? {})) {
      if (!(INDEXED_FIELDS[table] as readonly string[]).includes(field) || typeof value !== 'string') throw new FoundationError('INVALID_INPUT');
      predicates.push(`json_extract(value, '$.${field}')=?`); parameters.push(value);
    }
    if (query.cursor !== undefined) { rowKey(query.cursor); predicates.push('key>?'); parameters.push(query.cursor); }
    parameters.push(query.limit);
    return this.#db.prepare(`SELECT version, value FROM ${name(table)}${predicates.length ? ` WHERE ${predicates.join(' AND ')}` : ''} ORDER BY key LIMIT ?`).all(...parameters).map((row) => stored<K>(row)!);
  }
  transaction<T>(body: (tx: StoreTx) => T): T {
    this.#available();
    if (this.#transaction) throw new FoundationError('STATE_CONFLICT');
    this.#db.exec('BEGIN IMMEDIATE'); this.#transaction = true;
    let active = true;
    const check = (): void => { if (!active) throw new FoundationError('STATE_CONFLICT'); };
    const tx: StoreTx = {
      read: (table, key) => { check(); return this.read(table, key); },
      scan: (table, query) => { check(); return this.scan(table, query); },
      insert: (table, key, row) => { check(); rowKey(key); this.#db.prepare(`INSERT INTO ${name(table)}(key, version, value) VALUES (?, 1, ?)`).run(key, serialize(row)); },
      compareAndSet: <K extends MutableTable>(table: K, key: string, expectedVersion: number, row: RowTypes[K]): void => {
        check(); rowKey(key); name(table);
        if (APPEND_ONLY.has(table) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) throw new FoundationError('STATE_CONFLICT');
        const result = this.#db.prepare(`UPDATE ${name(table)} SET version=version+1, value=? WHERE key=? AND version=?`).run(serialize(row), key, expectedVersion);
        if (result.changes !== 1) throw new FoundationError('STATE_CONFLICT');
      },
      append: (event: LedgerEvent) => { check(); tx.insert('events', event.event_id, event); },
    };
    try {
      const result = body(tx);
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
        // Observe rejection but never await or commit. Escaped tx is invalidated.
        void Promise.resolve(result).catch(() => undefined);
        throw new FoundationError('STATE_CONFLICT');
      }
      this.#db.exec('COMMIT'); return result;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    finally { active = false; this.#transaction = false; }
  }
  cleanupContent(request: ContentCleanupRequest): ContentCleanupResult {
    this.#available();
    if (this.#transaction || Object.keys(request).some((key) => !['quote_id', 'expectedVersion', 'now'].includes(key)) ||
        !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(request.now) ||
        !Number.isFinite(Date.parse(request.now)) || new Date(request.now).toISOString() !== request.now) throw new FoundationError('INVALID_INPUT');
    const result = this.transaction((tx): ContentCleanupResult => {
      const current = tx.read('quotes', request.quote_id);
      if (!current || current.version !== request.expectedVersion) throw new FoundationError('STATE_CONFLICT');
      const row = current.value, quote = row.quote.payload;
      if (quote.quote_id !== request.quote_id) throw new FoundationError('STATE_CONFLICT');
      if (row.answer === null) return { quote_id: request.quote_id, redacted: false, reason: 'already_redacted' };
      const revoked = tx.scan('tombstones', { where: { slice_id: quote.slice_id, manifest_sha256: quote.manifest_sha256 }, limit: 1 }).length > 0;
      let reason: ContentCleanupResult['reason'];
      if (revoked) reason = 'revoked';
      else {
        const settlement = tx.scan('settlements', { where: { quote_id: quote.quote_id }, limit: 2 });
        const armed = tx.scan('arms', { where: { quote_id: quote.quote_id }, limit: 1 }).length > 0;
        if (settlement.length === 1) {
          const evidence = settlement[0]!.value;
          if (evidence.genesis !== quote.genesis_hash || evidence.payer_debit !== quote.total_atomic ||
              evidence.seller_credit !== quote.seller_atomic || evidence.marketplace_credit !== quote.fee_atomic ||
              evidence.commitment !== 'finalized' || evidence.meta_err !== null ||
              !(Date.parse(request.now) - Date.parse(evidence.observed_at) >= M03.safePaidRetention.value * 86400000)) throw new FoundationError('NOT_READY');
          reason = 'paid_retention';
        } else if (!armed && settlement.length === 0 && row.proof == null &&
            (row.payment_state === undefined || row.payment_state === 'not_applicable') &&
            Date.parse(request.now) - Date.parse(quote.expires_at) >= M03.unarmedExpiredRetention.value * 3600000) reason = 'expired_unarmed';
        else throw new FoundationError('NOT_READY');
      }
      tx.compareAndSet('quotes', request.quote_id, current.version, { ...row, answer: null, redacted_at: request.now });
      return { quote_id: request.quote_id, redacted: true, reason };
    });
    // secure_delete clears freed DB cells; truncate WAL after commit. A failure
    // here is surfaced even though logical redaction already committed. Retrying
    // also checkpoints; external backups remain the operator's responsibility.
    this.checkpoint();
    return result;
  }
  cleanupBrokerContent(request: BrokerContentCleanupRequest): BrokerContentCleanupResult {
    this.#available();
    if (this.#transaction || Object.keys(request).sort().join(',') !== 'expectedVersion,now,receipt_id' ||
        !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(request.now) ||
        !Number.isFinite(Date.parse(request.now)) || new Date(request.now).toISOString() !== request.now) throw new FoundationError('INVALID_INPUT');
    const result = this.transaction((tx): BrokerContentCleanupResult => {
      const current = tx.read('receipts', request.receipt_id);
      if (!current || current.version !== request.expectedVersion) throw new FoundationError('STATE_CONFLICT');
      const receipt = validateWire('receipt', current.value);
      if (receipt.content_redacted_at) return { receipt_id: request.receipt_id, redacted: false, artifacts_redacted: 0, reason: 'already_redacted' };
      const revoked = receipt.manifest_sha256 !== null && (tx.scan('tombstones', { where: { manifest_sha256: receipt.manifest_sha256 }, limit: 1 }).length > 0 ||
        tx.scan('eligibility', { where: { manifest_sha256: receipt.manifest_sha256 }, limit: 1000 }).some((r) => r.value.state === 'revoked'));
      const consults = this.#db.prepare('SELECT key, version, value FROM consults').all().map((raw) => ({ key: String(raw.key), ...stored<'consults'>(raw)! }));
      const owner = consults.find((row) => row.value.view?.receipt_id === receipt.receipt_id && !row.value.broker?.aliasOf);
      if (!owner?.value.broker) throw new FoundationError('STATE_CONFLICT');
      const journal = owner.value.broker;
      let reason: BrokerContentCleanupResult['reason'];
      if (revoked) reason = 'revoked';
      else if (receipt.settlement) {
        const evidence = tx.scan('settlements', { where: { quote_id: receipt.settlement.quote_id }, limit: 2 });
        if (evidence.length !== 1 || payloadHash(evidence[0]!.value) !== payloadHash(receipt.settlement) ||
            !(Date.parse(request.now) - Date.parse(receipt.settlement.observed_at) >= M03.safePaidRetention.value * 86400000)) throw new FoundationError('NOT_READY');
        reason = 'paid_retention';
      } else {
        if (receipt.payment_state !== 'not_applicable' || receipt.arm_ticket_sha256 !== null || receipt.transaction_signature !== null ||
            (receipt.quote_id !== null && tx.scan('arms', { where: { quote_id: receipt.quote_id }, limit: 1 }).length > 0) ||
            tx.scan('reservations', { where: { consult_id: owner.key as import('../wire/contracts.ts').Id, status: 'held' }, limit: 1 }).length > 0 ||
            !(Date.parse(request.now) - Date.parse(journal.quote?.payload.expires_at ?? journal.createdAt) >= M03.unarmedExpiredRetention.value * 3600000)) throw new FoundationError('NOT_READY');
        reason = 'expired_unarmed';
      }
      const receipts = this.#db.prepare('SELECT key, version, value FROM receipts').all().map((raw) => ({ key: String(raw.key), ...stored<'receipts'>(raw)! }));
      const affected = new Set([receipt.receipt_id]);
      // Same revoked manifest may occur in multiple purchases. Remove all controlled copies.
      if (revoked) for (const row of receipts) if (row.value.manifest_sha256 === receipt.manifest_sha256) affected.add(row.value.receipt_id);
      if (revoked) {
        let changed = true;
        while (changed) {
          changed = false;
          const revokedBytes = new Set(receipts.filter((r) => affected.has(r.value.receipt_id)).flatMap((r) => Object.entries(r.value.artifact_refs).filter(([name]) => name === 'answer' || name.startsWith('page:')).map(([, hash]) => hash)));
          for (const row of receipts) if (!affected.has(row.value.receipt_id) && Object.values(row.value.artifact_refs).some((hash) => revokedBytes.has(hash))) { affected.add(row.value.receipt_id); changed = true; }
        }
      }
      const hashes = new Set<string>();
      const contentRef = (name: string): boolean => ['answer', 'manifest', 'question_policy'].includes(name) || name.startsWith('page:');
      for (const row of receipts) if (affected.has(row.value.receipt_id)) for (const [name, hash] of Object.entries(row.value.artifact_refs)) if (contentRef(name)) hashes.add(hash);
      // Include legacy full receipt versions written as unindexed artifact blobs.
      const artifacts = this.#db.prepare('SELECT key, version, value FROM artifacts').all().map((raw) => ({ key: String(raw.key), ...stored<'artifacts'>(raw)! }));
      for (const row of artifacts) {
        if (row.value.redacted_at) continue;
        let value: unknown;
        try { value = strictJson(Buffer.from(row.value.bytes_base64, 'base64')); } catch { continue; }
        if (value && typeof value === 'object' && !Array.isArray(value) && 'receipt_id' in value && affected.has(value.receipt_id as import('../wire/contracts.ts').Id)) {
          hashes.add(row.key);
          const historical = value as unknown as Receipt;
          for (const [name, hash] of Object.entries(historical.artifact_refs ?? {})) if (contentRef(name)) hashes.add(hash);
        }
      }
      // Shared safe bytes retained by another receipt cannot be erased by a retention sweep.
      for (const row of receipts) if (!affected.has(row.value.receipt_id)) for (const hash of Object.values(row.value.artifact_refs)) hashes.delete(hash);
      for (const row of receipts) if (affected.has(row.value.receipt_id)) {
        tx.compareAndSet('receipts', row.key, row.version, { ...row.value, question: '', artifact_refs: {}, content_redacted_at: request.now,
          content_state: revoked ? 'revoked' : 'unknown', delivery_state: row.value.settlement ? 'recovery_required' : 'not_applicable' });
      }
      for (const row of consults) if (row.value.view && affected.has(row.value.view.receipt_id) && row.value.broker) {
        const j = row.value.broker;
        tx.compareAndSet('consults', row.key, row.version, { ...row.value, broker: { ...j, contentRedactedAt: request.now, question: { ...j.question, text: '' }, answerArtifact: null, manifestArtifact: null, pageArtifacts: [] },
          view: { ...row.value.view, answer: null, content_state: revoked ? 'revoked' : 'unknown', delivery_state: row.value.view.payment_state === 'payment_finalized' ? 'recovery_required' : 'not_applicable' } });
      }
      let erased = 0;
      for (const row of artifacts) if (hashes.has(row.key) && !row.value.redacted_at) {
        this.#db.prepare('INSERT INTO content_redactions(sha256, redacted_at) VALUES (?, ?)').run(row.key, request.now);
        this.#db.prepare('UPDATE artifacts SET version=version+1, value=? WHERE key=?').run(serialize({ sha256: row.value.sha256, bytes_base64: '', redacted_at: request.now }), row.key); erased++;
      }
      return { receipt_id: request.receipt_id, redacted: true, artifacts_redacted: erased, reason };
    });
    this.checkpoint(); return result;
  }
  checkpoint(): void {
    this.#available(); if (this.#transaction) throw new FoundationError('STATE_CONFLICT');
    const result = this.#db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (result?.busy !== 0) throw new FoundationError('STATE_CONFLICT');
  }
  /** Quiesced synchronous snapshot + fsynced content-free manifest, never overwrites.
   * Tombstone hash is caller attestation, not a restore/readiness authorization.
   */
  backup(destination: string, independentTombstonesSha256: Sha256): BackupManifest {
    this.#available(); if (this.#transaction || !/^[a-f0-9]{64}$/.test(independentTombstonesSha256)) throw new FoundationError('STATE_CONFLICT');
    const path = resolve(destination); const manifestPath = `${path}.manifest.json`;
    let created = false; let manifestCreated = false;
    try {
      const file = openSync(path, 'wx', 0o600); created = true; closeSync(file);
      this.checkpoint();
      this.#db.prepare('VACUUM INTO ?').run(path);
      const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      const diagnostics = this.diagnostics();
      const manifest: BackupManifest = { v: 1, schemaVersion: diagnostics.schemaVersion, sqliteVersion: diagnostics.sqliteVersion,
        sha256: sha(readFileSync(path)), createdAt: new Date().toISOString(), independentTombstonesSha256, restoreRequiresNewestTombstones: true };
      const manifestFd = openSync(manifestPath, 'wx', 0o600); manifestCreated = true;
      try { writeFileSync(manifestFd, `${JSON.stringify(manifest)}\n`); fsyncSync(manifestFd); } finally { closeSync(manifestFd); }
      const directoryFd = openSync(dirname(path), 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      return manifest;
    } catch (error) { if (manifestCreated) unlinkSync(manifestPath); if (created) unlinkSync(path); throw error; }
  }
  close(): void {
    if (this.#closed) return;
    if (this.#transaction) throw new FoundationError('STATE_CONFLICT');
    this.#db.close(); this.#closed = true;
  }
}
export function openStore(path: string, options: SqliteStoreOptions = {}): SqliteStore { return new SqliteStore(path, options); }
