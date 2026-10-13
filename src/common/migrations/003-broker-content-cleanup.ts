import { STORE_MIGRATIONS as PREVIOUS } from './002-contract-reconciliation.ts';
import type { Migration } from './001-foundation.ts';
/** Content erasure is a narrow exception to artifact immutability. Financial
 * tables, event history and independent tombstones retain their existing guards. */
export const BROKER_CLEANUP_MIGRATION: Migration = Object.freeze({
  version: 3, name: 'broker-content-cleanup', sql: `
CREATE TABLE content_redactions (sha256 TEXT PRIMARY KEY NOT NULL, redacted_at TEXT NOT NULL) STRICT;
DROP TRIGGER artifacts_no_update;
CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts
WHEN NOT (NEW.key = OLD.key AND NEW.version = OLD.version + 1
  AND json_extract(NEW.value, '$.sha256') = json_extract(OLD.value, '$.sha256')
  AND json_extract(NEW.value, '$.bytes_base64') = ''
  AND json_extract(NEW.value, '$.redacted_at') = (SELECT redacted_at FROM content_redactions WHERE sha256 = OLD.key)
  AND json_type(OLD.value, '$.redacted_at') IS NULL)
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER receipt_no_unredact BEFORE UPDATE ON receipts
WHEN json_type(OLD.value, '$.content_redacted_at') IS 'text'
 AND (json_extract(NEW.value, '$.content_redacted_at') IS NOT json_extract(OLD.value, '$.content_redacted_at')
 OR json_extract(NEW.value, '$.question') IS NOT ''
 OR json_extract(NEW.value, '$.artifact_refs') IS NOT '{}')
BEGIN SELECT RAISE(ABORT, 'CONTENT_REDACTED'); END;
CREATE TRIGGER consult_no_unredact BEFORE UPDATE ON consults
WHEN json_type(OLD.value, '$.broker.contentRedactedAt') IS 'text'
 AND (json_extract(NEW.value, '$.broker.contentRedactedAt') IS NOT json_extract(OLD.value, '$.broker.contentRedactedAt')
 OR json_extract(NEW.value, '$.broker.question.text') IS NOT ''
 OR json_type(NEW.value, '$.view.answer') IS NOT 'null'
 OR json_type(NEW.value, '$.broker.answerArtifact') IS NOT 'null'
 OR json_type(NEW.value, '$.broker.manifestArtifact') IS NOT 'null'
 OR json_extract(NEW.value, '$.broker.pageArtifacts') IS NOT '[]')
BEGIN SELECT RAISE(ABORT, 'CONTENT_REDACTED'); END;
` });
export const STORE_MIGRATIONS: readonly Migration[] = Object.freeze([...PREVIOUS, BROKER_CLEANUP_MIGRATION]);
