import { FOUNDATION_MIGRATIONS, INDEXED_FIELDS as V1_FIELDS } from './001-foundation.ts';
import type { Migration } from './001-foundation.ts';
import type { IndexedFields, TableName } from '../../wire/contracts.ts';

/** Never edit 001: its SQL digest is part of every existing database's history. */
export const INDEXED_FIELDS = {
  ...V1_FIELDS,
  reservations: [...V1_FIELDS.reservations, 'network'],
  settlements: [...V1_FIELDS.settlements, 'quote_id'],
} as const satisfies { [K in TableName]: readonly IndexedFields[K][] };

// json_insert preserves worker adapter fields already persisted under 001.
// Unknown financial facts stay null: migration must never fabricate settlement,
// authorization, network, or an apparently fresh lineage acknowledgement.
export const CONTRACT_MIGRATION: Migration = Object.freeze({
  version: 2,
  name: 'contract-reconciliation',
  sql: `
UPDATE consults SET value=json_insert(value, '$.broker', NULL, '$.quote_id', NULL, '$.disposition', NULL);
UPDATE free_checks SET value=json_insert(value, '$.consultId', NULL, '$.expiresAt', NULL);
UPDATE reservations SET value=json_insert(value, '$.network', NULL, '$.actualPrincipal', NULL, '$.actualFee', NULL);
UPDATE signed_transactions SET value=json_insert(value, '$.transaction_sha256', NULL, '$.approval_ref', NULL);
UPDATE receipts SET value=json_insert(value, '$.approval_ref', NULL);
UPDATE arms SET value=json_insert(value, '$.expected', NULL);
UPDATE quotes SET value=json_insert(value, '$.body_sha256', NULL, '$.dedup_sha256', NULL,
  '$.requested_recovery_atomic', NULL, '$.proof', NULL, '$.failure_evidence_sha256', NULL, '$.redacted_at', NULL);
CREATE UNIQUE INDEX free_check_lease_unique ON free_checks(json_extract(value, '$.buyer_id'), json_extract(value, '$.seller_id'), json_extract(value, '$.window'));
CREATE INDEX reservations_network ON reservations(json_extract(value, '$.network'));
CREATE INDEX settlements_quote_id ON settlements(json_extract(value, '$.quote_id'));
CREATE TRIGGER reservation_original_day BEFORE UPDATE ON reservations
WHEN json_extract(NEW.value, '$.day_utc') IS NOT json_extract(OLD.value, '$.day_utc')
BEGIN SELECT RAISE(ABORT, 'RESERVATION_DAY_IMMUTABLE'); END;
CREATE TRIGGER quote_no_unredact BEFORE UPDATE ON quotes
WHEN json_type(OLD.value, '$.answer') IS 'null' AND json_type(OLD.value, '$.redacted_at') IS 'text'
 AND (json_type(NEW.value, '$.answer') IS NOT 'null' OR json_extract(NEW.value, '$.redacted_at') IS NOT json_extract(OLD.value, '$.redacted_at'))
BEGIN SELECT RAISE(ABORT, 'CONTENT_REDACTED'); END;
`,
});
export const STORE_MIGRATIONS: readonly Migration[] = Object.freeze([...FOUNDATION_MIGRATIONS, CONTRACT_MIGRATION]);
