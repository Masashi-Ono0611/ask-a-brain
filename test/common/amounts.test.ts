import test from 'node:test';
import assert from 'node:assert/strict';
import { U64_MAX, decodeAmount, atomicFromBigint, lamportsFromBigint, parseAtomic, parseLamports } from '../../src/common/index.ts';
test('amount codecs round-trip zero, boundaries and integer values without floating point', () => {
  for (const value of [0n, 1n, 10000n, 9007199254740993n, U64_MAX]) {
    assert.equal(decodeAmount(atomicFromBigint(value)), value);
    assert.equal(decodeAmount(lamportsFromBigint(value)), value);
    assert.equal(parseAtomic(value.toString()), value.toString());
    assert.equal(parseLamports(value.toString()), value.toString());
  }
});
test('amount codecs reject signs, floats, leading zeros, whitespace, nondecimal and overflow', () => {
  for (const value of ['-1', '+1', '1.0', '1e3', '00', '01', ' 1', '1\n', '', '0x10', '１', '18446744073709551616', '9'.repeat(100), 1, 1n, null, {}]) assert.throws(() => decodeAmount(value));
  for (const value of [-1n, U64_MAX + 1n]) assert.throws(() => atomicFromBigint(value));
  // Runtime callers cannot bypass the bigint-only encoder using type erasure.
  assert.throws(() => atomicFromBigint(1.5 as unknown as bigint));
});
