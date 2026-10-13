import type { IndexedFields, TableName } from '../../wire/contracts.ts';
export interface Migration { readonly version: number; readonly name: string; readonly sql: string }
export const INDEXED_FIELDS = {
  consults: ['buyer_id', 'request_id'], free_checks: ['buyer_id', 'seller_id', 'window'], quotes: ['seller_request_key'],
  arms: ['quote_id', 'message_sha256'], reservations: ['consult_id', 'payer', 'day_utc', 'status'],
  signed_transactions: ['request_id', 'quote_id', 'genesis', 'signature'], settlements: ['genesis', 'signature'],
  receipts: ['receipt_id', 'request_id', 'buyer_id'], artifacts: ['sha256'], outbox: ['receipt_id', 'state'],
  outcomes: ['consult_id', 'source'], refunds: ['consult_id', 'genesis', 'signature'],
  eligibility: ['slice_id', 'manifest_sha256'], tombstones: ['slice_id', 'manifest_sha256'], events: ['event_id', 'consult_id'],
} as const satisfies { [K in TableName]: readonly IndexedFields[K][] };
export const APPEND_ONLY: ReadonlySet<TableName> = new Set(['settlements', 'events', 'outcomes', 'refunds', 'tombstones', 'artifacts']);
const tables = Object.keys(INDEXED_FIELDS) as TableName[];
const sql = tables.map((table) => {
  const foreignKey = table === 'outbox'
    ? ", receipt_id TEXT GENERATED ALWAYS AS (json_extract(value, '$.receipt_id')) STORED NOT NULL REFERENCES receipts(key)" : '';
  const identity = table === 'receipts' ? ", CHECK (json_extract(value, '$.receipt_id') IS key)"
    : table === 'artifacts' ? ", CHECK (json_extract(value, '$.sha256') IS key)"
    : table === 'events' ? ", CHECK (json_extract(value, '$.event_id') IS key)" : '';
  const requiredIndexes = INDEXED_FIELDS[table].map((field) => `CHECK (json_type(value, '$.${field}') IS 'text')`).join(', ');
  const indexes = INDEXED_FIELDS[table].map((field) => `CREATE INDEX ${table}_${field} ON ${table}(json_extract(value, '$.${field}'));`).join('\n');
  const immutable = APPEND_ONLY.has(table) ? `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;` : '';
  return `CREATE TABLE ${table} (key TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version >= 1 AND version <= 9007199254740991), value TEXT NOT NULL CHECK(json_valid(value) AND json_type(value) = 'object')${foreignKey}, ${requiredIndexes}${identity}) STRICT;\n${indexes}${immutable}`;
}).join('\n');
export const FOUNDATION_MIGRATIONS: readonly Migration[] = Object.freeze([Object.freeze({
  version: 1,
  name: 'foundation-role-local-records',
  sql: `${sql}
CREATE UNIQUE INDEX consult_request_unique ON consults(json_extract(value, '$.buyer_id'), json_extract(value, '$.request_id'));
CREATE UNIQUE INDEX seller_request_unique ON quotes(json_extract(value, '$.seller_request_key'));
CREATE UNIQUE INDEX quote_arm_unique ON arms(json_extract(value, '$.quote_id'));
CREATE UNIQUE INDEX armed_message_unique ON arms(json_extract(value, '$.message_sha256'));
CREATE UNIQUE INDEX signed_request_unique ON signed_transactions(json_extract(value, '$.request_id'));
CREATE UNIQUE INDEX signed_quote_unique ON signed_transactions(json_extract(value, '$.quote_id'));
CREATE UNIQUE INDEX signed_signature_unique ON signed_transactions(json_extract(value, '$.genesis'), json_extract(value, '$.signature'));
CREATE UNIQUE INDEX settlement_unique ON settlements(json_extract(value, '$.genesis'), json_extract(value, '$.signature'));
CREATE UNIQUE INDEX receipt_unique ON receipts(json_extract(value, '$.receipt_id'));
CREATE UNIQUE INDEX outcome_original_unique ON outcomes(json_extract(value, '$.consult_id'), json_extract(value, '$.source')) WHERE json_extract(value, '$.corrects') IS NULL;
CREATE UNIQUE INDEX refund_signature_unique ON refunds(json_extract(value, '$.genesis'), json_extract(value, '$.signature'));
CREATE UNIQUE INDEX eligibility_digest_unique ON eligibility(json_extract(value, '$.slice_id'), json_extract(value, '$.manifest_sha256'));
CREATE UNIQUE INDEX tombstone_digest_unique ON tombstones(json_extract(value, '$.slice_id'), json_extract(value, '$.manifest_sha256'));
`,
})]);
