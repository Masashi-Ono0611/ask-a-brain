import type { Driver, RunnerDependencies, Arm } from '../../src/eval/index.ts';
import { createReplayRunner, MemoryJournal, planRuns } from '../../src/eval/index.ts';
import { FixedClock } from '../../src/common/index.ts';
import { loadStudy, source, buyer, syntheticDriver, syntheticMarket } from '../../scripts/eval/synthetic.ts';
export function setup(arm: Arm = 'A', overrides: Partial<RunnerDependencies> = {}) {
  const study = overrides.study ?? loadStudy();
  const clock = new FixedClock('2026-10-09T00:00:00.000Z'); const journal = new MemoryJournal();
  const deps: RunnerDependencies = { study, clock, journal, source, buyer, driver: syntheticDriver(study), market: syntheticMarket(), ...overrides };
  const plan = planRuns(study, clock.now()), spec = plan.find((s) => s.fixture_id === 's1' && s.arm === arm)!;
  return { deps, clock, journal, plan, spec, runner: createReplayRunner(deps) };
}
export function driver(execute: Driver['execute']): Driver { return { execute }; }
