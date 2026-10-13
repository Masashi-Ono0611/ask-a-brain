import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, AnswerMap, GenesisHash, Id, IsoTime, JsonValue, Revocation, Sha256, TombstoneAttestation } from '../../src/wire/contracts.ts';
import { M03, payloadHash } from '../../src/wire/index.ts';
import { parseAnswerMap, parseGenesisHash, verifyTombstoneAttestation } from '../../src/common/index.ts';
const id = (s: string): Id => s as Id;
const hash = 'a'.repeat(64) as Sha256;
const at = '2026-10-09T00:00:00.000Z' as IsoTime;
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const genesis: GenesisHash = parseGenesisHash('EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
// @ts-expect-error A genesis identifier is not a validated 32-byte address.
const address: Address = genesis;
void address;
test('genesis lexical type accepts 32..44 base58 characters without imposing public-key width', () => {
  for (const length of [32, 44]) assert.equal(parseGenesisHash('2'.repeat(length)), '2'.repeat(length));
  for (const bad of ['2'.repeat(31), '2'.repeat(45), '0'.repeat(32), 'O'.repeat(32), 'I'.repeat(32), 'l'.repeat(32), `${genesis}\n`, null, 32]) {
    assert.throws(() => parseGenesisHash(bad), /INVALID_INPUT/); assert.equal(parseGenesisHash(genesis), genesis);
  }
});
const clean: AnswerMap = { v: 1, engine_version: id('extractive-1'), entries: [{ question_id: id('q1'), question_sha256: hash, support: 'supported', spans: [{ page_id: id('p1'), byte_start: 0, byte_end: 3 }] }] };
const badMaps: readonly [string, (map: Record<string, any>) => void][] = [
  ['unknown root field', (m) => { m.extra = true; }], ['version', (m) => { m.v = 2; }],
  ['engine id', (m) => { m.engine_version = '../bad'; }], ['entries type', (m) => { m.entries = {}; }],
  ['entry field', (m) => { m.entries[0].extra = 1; }], ['question id', (m) => { m.entries[0].question_id = ''; }],
  ['question hash', (m) => { m.entries[0].question_sha256 = 'bad'; }], ['support', (m) => { m.entries[0].support = 'invented'; }],
  ['duplicate question/hash', (m) => { m.entries.push(m.entries[0]); }], ['non-supported spans', (m) => { m.entries[0].support = 'declined'; }],
  ['span count', (m) => { m.entries[0].spans = Array(M03.sectionsMax.value + 1).fill(m.entries[0].spans[0]); }],
  ['spans type', (m) => { m.entries[0].spans = {}; }], ['span field', (m) => { m.entries[0].spans[0].extra = 1; }],
  ['page id', (m) => { m.entries[0].spans[0].page_id = '../p'; }], ['negative offset', (m) => { m.entries[0].spans[0].byte_start = -1; }],
  ['fractional offset', (m) => { m.entries[0].spans[0].byte_start = 0.5; }], ['empty exclusive span', (m) => { m.entries[0].spans[0].byte_end = 0; }],
];
for (const [name, mutate] of badMaps) test(`answer map rejects ${name}; restored canonical shape passes`, () => {
  const bad = structuredClone(clean); mutate(bad); assert.throws(() => parseAnswerMap(bytes(bad)));
  assert.deepEqual(parseAnswerMap(bytes(clean)), clean);
});
test('answer map rejects duplicate keys, invalid UTF-8, scalar surrogates and oversized inventory; clean passes', () => {
  const text = JSON.stringify(clean);
  for (const bad of [new TextEncoder().encode(text.replace('"v":1', '"v":1,"v":1')), Uint8Array.of(255), bytes({ ...clean, engine_version: '\ud800' }), new Uint8Array(M03.sealedPayloadMax.value * 1024 * 1024 + 1)]) {
    assert.throws(() => parseAnswerMap(bad)); assert.deepEqual(parseAnswerMap(bytes(clean)), clean);
  }
  for (const support of ['declined', 'stale', 'contradictory'] as const) assert.equal(parseAnswerMap(bytes({ ...clean, entries: [{ ...clean.entries[0], support, spans: [] }] })).entries[0]?.support, support);
});
const row: Revocation = { slice_id: id('slice'), manifest_sha256: hash, generation: 1, revoked_at: at, reason: 'rights', approval_id: id('approved') };
const digest = (rows: readonly Revocation[]): Sha256 => payloadHash([...rows].sort((a, b) => `${a.slice_id}:${a.manifest_sha256}` < `${b.slice_id}:${b.manifest_sha256}` ? -1 : 1) as unknown as JsonValue);
const snapshot: TombstoneAttestation = { generation: 1, tombstones_sha256: digest([row]), acknowledged_at: at };
const badSnapshots: readonly [string, object][] = [
  ['unknown field', { extra: 1 }], ['generation rollback', { generation: 0 }], ['generation ahead', { generation: 2 }],
  ['negative generation', { generation: -1 }], ['fractional generation', { generation: 0.5 }],
  ['digest mismatch', { tombstones_sha256: 'b'.repeat(64) }], ['digest syntax', { tombstones_sha256: 'bad' }],
  ['time syntax', { acknowledged_at: 'yesterday' }], ['time normalization', { acknowledged_at: '2026-02-30T00:00:00.000Z' }],
  ['stale lineage', { acknowledged_at: new Date(Date.parse(at) - M03.lineageAcknowledgementMaxAge.value * 3600000 - 1).toISOString() }],
  ['future lineage', { acknowledged_at: new Date(Date.parse(at) + M03.clockSkewMax.value * 1000 + 1).toISOString() }],
];
for (const [name, patch] of badSnapshots) test(`newest-state attestation rejects ${name}; clean session acknowledgement passes`, () => {
  assert.throws(() => verifyTombstoneAttestation([row], { ...snapshot, ...patch }, at));
  assert.doesNotThrow(() => verifyTombstoneAttestation([row], snapshot, at));
});
test('journal digest uses deterministic sorted JCS; duplicate, malformed and missing rows fail', () => {
  const other = { ...row, slice_id: id('Slice_2'), generation: 2 };
  const state = { ...snapshot, generation: 2, tombstones_sha256: digest([row, other]) };
  assert.doesNotThrow(() => verifyTombstoneAttestation([row, other], state, at));
  assert.doesNotThrow(() => verifyTombstoneAttestation([other, row], state, at));
  for (const rows of [[row, row], [row, { ...other, generation: 1 }], [], [{ ...row, extra: 1 }], [{ ...row, reason: 'invented' }], [{ ...row, generation: 0 }], [{ ...row, slice_id: '../bad' }]]) {
    assert.throws(() => verifyTombstoneAttestation(rows as readonly Revocation[], snapshot, at));
    assert.doesNotThrow(() => verifyTombstoneAttestation([row], snapshot, at));
  }
  assert.doesNotThrow(() => verifyTombstoneAttestation([], { ...snapshot, generation: 0, tombstones_sha256: digest([]) }, at));
});
