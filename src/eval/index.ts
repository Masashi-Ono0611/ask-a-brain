/** Protected composition entrypoint; never mount the eval source tree in a buyer. */
export type * from './types.ts';
export { parseFixture, parseRubric, parseCorpus, checklist } from './fixtures.ts';
export { createTaskTools } from './tools.ts';
export { parseStudy, planRuns, armOrder, toolsForArm, replayLimits } from './arms.ts';
export { createReplayRunner, runFrozenStudy, collectAttempts, unrunResult } from './runner.ts';
export { gradeAttempt, gradeRun } from './grader.ts';
export { summarizeReplay, renderDetailedReplayReport, renderReplayReport } from './report.ts';
export { FileJournal, MemoryJournal } from './journal.ts';
