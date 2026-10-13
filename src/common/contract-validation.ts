/** Shared admission helpers for the reconciled contracts. No I/O or new crypto. */
import type { AnswerMap, GenesisHash, Id, IsoTime, JsonValue, Revocation, Sha256, TombstoneAttestation } from '../wire/contracts.ts';
import { M03, payloadHash, strictJson } from '../wire/index.ts';
import { FoundationError } from './errors.ts';

export function parseGenesisHash(value: unknown): GenesisHash {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new FoundationError('INVALID_INPUT');
  return value as GenesisHash;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) throw new FoundationError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
function id(value: unknown): Id {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new FoundationError('INVALID_INPUT');
  return value as Id;
}
function hash(value: unknown): Sha256 {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new FoundationError('INVALID_INPUT');
  return value as Sha256;
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new FoundationError('INVALID_INPUT');
  return Number(value);
}
function time(value: unknown): IsoTime {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new FoundationError('INVALID_INPUT');
  return value as IsoTime;
}
/** Shape admission only. Serving must also verify policy membership, approved page
 * hashes, UTF-8 boundaries, citations and byte/scalar caps against the bundle. */
export function parseAnswerMap(bytes: Uint8Array): AnswerMap {
  if (bytes.length > M03.sealedPayloadMax.value * 1024 * 1024) throw new FoundationError('INVALID_INPUT');
  const map = object(strictJson(bytes, { integerNumbersOnly: true }), ['v', 'engine_version', 'entries']);
  if (map.v !== 1 || !Array.isArray(map.entries)) throw new FoundationError('INVALID_INPUT');
  const seen = new Set<string>();
  const entries = map.entries.map((input) => {
    const entry = object(input, ['question_id', 'question_sha256', 'support', 'spans']);
    const question_id = id(entry.question_id), question_sha256 = hash(entry.question_sha256);
    const key = `${question_id}:${question_sha256}`;
    if (seen.has(key) || !['supported', 'declined', 'stale', 'contradictory'].includes(String(entry.support)) ||
        !Array.isArray(entry.spans) || entry.spans.length > M03.sectionsMax.value ||
        (entry.support !== 'supported' && entry.spans.length !== 0)) throw new FoundationError('INVALID_INPUT');
    seen.add(key);
    const spans = entry.spans.map((inputSpan) => {
      const span = object(inputSpan, ['page_id', 'byte_start', 'byte_end']);
      const byte_start = integer(span.byte_start), byte_end = integer(span.byte_end);
      if (byte_end <= byte_start) throw new FoundationError('INVALID_INPUT');
      return { page_id: id(span.page_id), byte_start, byte_end };
    });
    return { question_id, question_sha256, support: entry.support as AnswerMap['entries'][number]['support'], spans };
  });
  return { v: 1, engine_version: id(map.engine_version), entries };
}
/** Verifies a protected newest-state assertion; cannot discover a newer external
 * file or grant operator authority. Caller provides this session's trusted value. */
export function verifyTombstoneAttestation(rows: readonly Revocation[], input: TombstoneAttestation, now: IsoTime): void {
  const attestation = object(input, ['generation', 'tombstones_sha256', 'acknowledged_at']);
  const generation = integer(attestation.generation), digest = hash(attestation.tombstones_sha256);
  const age = Date.parse(time(now)) - Date.parse(time(attestation.acknowledged_at));
  if (age < -M03.clockSkewMax.value * 1000 || age > M03.lineageAcknowledgementMaxAge.value * 3600000) throw new FoundationError('NOT_READY');
  const sorted = validateTombstones(rows);
  if (generation !== rows.reduce((n, row) => Math.max(n, row.generation), 0) ||
      digest !== payloadHash(sorted as unknown as JsonValue)) throw new FoundationError('NOT_READY');
}

/** Strict row validation and deterministic code-point ordering, independent of locale. */
export function validateTombstones(rows: readonly Revocation[]): Revocation[] {
  const keys = new Set<string>(), generations = new Set<number>();
  for (const inputRow of rows) {
    const row = object(inputRow, ['slice_id', 'manifest_sha256', 'generation', 'revoked_at', 'reason', 'approval_id']);
    const key = `${id(row.slice_id)}:${hash(row.manifest_sha256)}`;
    id(row.approval_id); time(row.revoked_at); integer(row.generation, 1);
    if (keys.has(key) || generations.has(Number(row.generation)) || !['safety', 'rights'].includes(String(row.reason))) throw new FoundationError('NOT_READY');
    keys.add(key); generations.add(Number(row.generation));
  }
  const key = (row: Revocation): string => `${row.slice_id}:${row.manifest_sha256}`;
  const sorted = [...rows].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return sorted;
}
