import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, GenesisHash, OutcomeSource } from '../../src/wire/contracts.ts';
import { canonicalBytes, parseWire, settlementSchema, validateWire } from '../../src/wire/index.ts';
import { address, genesis } from '../../src/wire/primitives.ts';
import { readGolden } from './golden-fixture.ts';
import { readFileSync } from 'node:fs';

const fixture = readGolden();
test('receipt approval_ref admits Id, null and legacy omission; malformed values still reject', () => {
  const { approval_ref: _approval, ...legacy } = fixture.receipt;
  assert.deepEqual(parseWire('receipt', canonicalBytes(legacy)), legacy);
  for (const approval_ref of ['synthetic-approval', null]) {
    const clean = { ...legacy, approval_ref };
    assert.deepEqual(parseWire('receipt', canonicalBytes(clean)), clean);
    for (const bad of ['', '../approval', 1, {}, false]) {
      assert.throws(() => parseWire('receipt', canonicalBytes({ ...clean, approval_ref: bad })), /INVALID_WIRE_RECORD/);
      assert.deepEqual(parseWire('receipt', canonicalBytes(clean)), clean);
    }
    assert.throws(() => parseWire('receipt', canonicalBytes({ ...clean, approval_extra: true })), /INVALID_WIRE_RECORD/);
    assert.deepEqual(parseWire('receipt', canonicalBytes(clean)), clean);
  }
});

const sources = ['agent', 'human', 'task_check', 'replay', 'service_failure'] as const satisfies readonly OutcomeSource[];
for (const source of sources) test(`outcome admits ${source}; unknown source and forged eligibility reject`, () => {
  const original = parseWire('outcome', readFileSync(new URL('../../fixtures/wire/outcome.json', import.meta.url)));
  const clean = { ...original, source };
  for (const patch of [{ source: 'unknown' }, { source: 'task-check' }, { eligible_for_trust: true }, { exclusion_reason: null }, { unexpected: 1 }]) {
    assert.throws(() => parseWire('outcome', canonicalBytes({ ...clean, ...patch })), /INVALID_WIRE_RECORD/);
    assert.deepEqual(parseWire('outcome', canonicalBytes(clean)), clean);
  }
});

test('genesis has the frozen lexical brand and 32..44 base58 range; addresses retain decoded width', () => {
  const check = (value: string): void => {
    const parsed: GenesisHash = genesis.parse(value);
    // @ts-expect-error GenesisHash must not silently masquerade as a public key.
    const notAnAddress: Address = parsed;
    void notAnAddress;
    assert.equal(parsed, value);
    const q = fixture.quote;
    assert.equal(validateWire('quote', { ...q, payload: { ...q.payload, genesis_hash: value } }).payload.genesis_hash, value);
    assert.equal(validateWire('listing', { ...fixture.registry.listings[0], payment: { ...fixture.registry.listings[0]!.payment, genesis_hash: value } }).payment.genesis_hash, value);
    assert.equal(validateWire('proof', { ...fixture.proof, genesis_hash: value }).genesis_hash, value);
    assert.equal(settlementSchema.parse({ ...fixture.settlement, genesis: value }).genesis, value);
    assert.equal(validateWire('receipt', { ...fixture.receipt, settlement: { ...fixture.settlement, genesis: value } }).settlement?.genesis, value);
  };
  for (const clean of ['1'.repeat(32), '1'.repeat(33), 'z'.repeat(44), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1', '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']) check(clean);
  for (const bad of ['', '1'.repeat(31), '1'.repeat(45), ...['0', 'O', 'I', 'l', ' ', '\n', '日'].map((c) => '1'.repeat(31) + c)]) {
    assert.throws(() => genesis.parse(bad));
    assert.throws(() => validateWire('quote', { ...fixture.quote, payload: { ...fixture.quote.payload, genesis_hash: bad } }), /INVALID_WIRE_RECORD/);
    check('1'.repeat(32));
  }
  for (const badKey of ['1'.repeat(33), 'z'.repeat(44), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1']) {
    assert.throws(() => address.parse(badKey));
    assert.throws(() => validateWire('quote', { ...fixture.quote, payload: { ...fixture.quote.payload, payer: badKey } }), /INVALID_WIRE_RECORD/);
    assert.equal(address.parse(fixture.quote.payload.payer), fixture.quote.payload.payer);
  }
});
