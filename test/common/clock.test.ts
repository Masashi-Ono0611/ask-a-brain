import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock, SystemClock } from '../../src/common/index.ts';
test('fixed clock only advances explicitly and wakes virtual sleepers', async () => {
  const clock = new FixedClock('2026-10-09T00:00:00.000Z');
  let woke = false; const sleep = clock.sleep(20).then(() => { woke = true; });
  clock.advance(19); await Promise.resolve(); assert.equal(woke, false);
  clock.advance(1); await sleep;
  assert.equal(clock.now(), '2026-10-09T00:00:00.020Z'); assert.equal(clock.monotonicMs(), 20);
  assert.throws(() => clock.advance(-1)); assert.throws(() => clock.advance(0.5));
  assert.throws(() => new FixedClock('invalid'));
});
test('fixed and system sleep honor abort and system clock emits UTC', async () => {
  const fixed = new FixedClock('2026-10-09T00:00:00Z'); const system = new SystemClock();
  for (const clock of [fixed, system]) {
    const controller = new AbortController(); const sleeping = clock.sleep(1000, controller.signal);
    controller.abort(); await assert.rejects(sleeping);
    await assert.rejects(clock.sleep(1, controller.signal));
    assert.match(clock.now(), /^\d{4}-\d\d-\d\dT.*Z$/);
  }
  const before = system.monotonicMs(); await system.sleep(1); assert.ok(system.monotonicMs() >= before);
  fixed.advance(1000); // cancelled waiter must have been removed.
});
