import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from '../../scripts/check/boundaries.ts';
import { M03 } from '../../src/wire/index.ts';
import { M03 as canonical } from '../../src/wire/constants.ts';
test('M03 public export is identical; broker public import passes and private constant import fails', () => {
  assert.equal(M03, canonical);
  assert.equal(checkSource('broker/control.ts', "import { M03 } from '../wire/index.ts';"), 1);
  assert.throws(() => checkSource('broker/control.ts', "import { M03 } from '../wire/constants.ts';"), /IMPORT_BOUNDARY/);
  assert.equal(checkSource('broker/control.ts', "import { M03 } from '../wire/index.ts';"), 1);
});
test('contracts-only exception cannot smuggle runtime imports; allowed type import restores control', () => {
  assert.throws(() => checkSource('broker/control.ts', "import { Clock } from '../wire/contracts.ts';"), /CONTRACT_TYPE_ONLY/);
  assert.equal(checkSource('broker/control.ts', "import type { Clock } from '../wire/contracts.ts';"), 1);
  assert.throws(() => checkSource('broker/control.ts', "await import('../wire/contracts.ts');"), /CONTRACT_TYPE_ONLY/);
  assert.equal(checkSource('broker/control.ts', "await import('../wire/index.ts');"), 1);
});
