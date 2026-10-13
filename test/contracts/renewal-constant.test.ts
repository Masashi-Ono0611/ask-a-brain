import test from 'node:test';
import assert from 'node:assert/strict';
import { M03 } from '../../src/wire/index.ts';

test('message renewal cap is a shared M03 constant and is exactly 3 per consult', () => {
  assert.equal(M03.messageRenewalsMax.value, 3);
  assert.equal(M03.messageRenewalsMax.unit, 'renewals/consult');
});
