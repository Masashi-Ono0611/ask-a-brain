import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../src/wire/constants.ts';
// Type sanity only: no independently derived/copy-pasted design values.
const principal: bigint = M03.totalAtomic.value;
const fee: bigint = M03.feePerPurchaseMax.value;
const scalars: number = M03.questionScalarsMax.value;
const finality: 'finalized' = M03.finality.value;
const polls: readonly number[] = M03.paymentPoll.value;
test('M03 entries retain explicit units and immutable typed values', () => {
  assert.equal(typeof principal, 'bigint'); assert.equal(typeof fee, 'bigint');
  assert.equal(typeof scalars, 'number'); assert.equal(typeof finality, 'string');
  assert.ok(Object.isFrozen(M03)); assert.ok(Object.isFrozen(polls));
  for (const entry of Object.values(M03)) { assert.equal(typeof entry.unit, 'string'); assert.ok(entry.unit.length > 0); assert.ok(Object.isFrozen(entry)); }
});
