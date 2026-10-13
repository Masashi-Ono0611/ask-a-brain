/** Protected host supervisor. Live launch remains BLOCKED until the missing
 * documentation, complete inventory and isolated gateway contracts are supplied.
 * Dry mode is injected programmatically by tests; the CLI has no bypass flag. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FileJournal, gradeAttempt, unrunResult } from '../../src/eval/index.ts';
import type { Journal, JournalEvent } from '../../src/eval/index.ts';
import { bytesHash, M03 } from '../../src/wire/index.ts';
import type { ArtifactSource, AttemptResult, FrozenRun, ReplayGrade } from '../../src/wire/contracts.ts';
import { candidateConfig, codexArgv, readPin, writeConfig } from './config.ts';
import type { Documentation } from './config.ts';
import { capture, execute } from './process.ts';
import type { Command, Deadline, Exit } from './process.ts';
import { context, containerId, createArgs, inspectContainer } from './docker.ts';
import { probeBridge, Lines } from './bridge.ts';
import { recordedObservation, usageObserver } from './observations.ts';
import { loadRequest } from './request.ts';
import { parseFixture } from '../../src/eval/index.ts';
export const liveBlockers = Object.freeze([
  'COMPLETE_MODEL_TOOL_INVENTORY_UNVERIFIED', 'ISOLATED_GATEWAY_TRANSPORT_UNAVAILABLE',
  'CLI_EVENT_SCHEMA_UNVERIFIED', 'SUBSCRIPTION_AUTH_AND_EFFECTIVE_MODEL_UNVERIFIED',
]);
export interface RuntimeEvidence { mode: 'dry_run' | 'blocked_live'; exit: Exit | null; usage_schema: 'UNVERIFIED'; tokens_enforced: false; model_inventory_complete: false; cleanup: string; blocked: readonly string[] }
export interface SupervisedResult { attempt: AttemptResult; grade: ReplayGrade; runtime: RuntimeEvidence }
/** Trusted host inputs only. Not an MCP input/ability to select commands. */
export interface AttemptOptions {
  spec: FrozenRun; source: ArtifactSource; journal: Journal; directory: string; image: string;
  documentation?: Documentation;
}
/** Test-only port, never populated from CLI, environment or JSON. */
export interface DryRuntime {
  docker: Command; codex: Command; env: NodeJS.ProcessEnv; deadline?: Deadline;
  documentation: (candidate: ReturnType<typeof candidateConfig>) => Documentation;
  /** Stub manager invokes a stub bridge; events come from the fake container. */
  bridgeEvents: () => readonly JournalEvent[];
}
export async function runAttempt(options: AttemptOptions, dry?: DryRuntime, purpose: 'attempt' | 'inventory' = 'attempt'): Promise<SupervisedResult> {
  const { spec, source, journal } = options;
  if (journal.read().some((e) => e.run_id === spec.run_id)) throw new Error('ATTEMPT_EXISTS');
  // Synchronous durable start precedes config validation, mounts, process launch.
  journal.append({ kind: 'start', run_id: spec.run_id, data: { spec, mode: dry ? 'dry_run' : 'blocked_live', purpose, at: new Date().toISOString(), limits: {
    wall_ms: M03.replayWallTimeMax.value * 60_000, calls: M03.replayCallsMax.value, observed_tokens: M03.replayBuyerTokensMax.value } } });
  const began = performance.now(); const token = randomBytes(16).toString('hex');
  let id: string | null = null, created = false, exit: Exit | null = null, reason = 'OBSERVATION_FAILED', cleanup = 'not_created';
  let blocked: readonly string[] = [], observation: AttemptResult['observation'] = null, calls = 0, rejected = 0;
  const usage = usageObserver(); let configHash = spec.config_sha256;
  const docker = dry?.docker ?? { executable: 'docker', prefix: [] };
  const env = dry?.env ?? { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', HOME: options.directory };
  let manager = options.directory;
  try {
    mkdirSync(options.directory, { mode: 0o700 });
    manager = join(options.directory, 'manager'); mkdirSync(manager, { mode: 0o700 });
    for (const [bytes, digest] of [[source.fixture(spec.fixture_id), spec.fixture_sha256], [source.corpus(), spec.corpus_sha256], [source.rubric(spec.fixture_id), spec.rubric_sha256]] as const)
      if (bytesHash(bytes) !== digest) throw new Error('FROZEN_ARTIFACT_CHANGED');
    const launcher = join(options.directory, 'bridge-launcher');
    // Documentation audit can run before creating any Docker object. Placeholder
    // is only for reporting; the final config is bound to the returned full ID.
    const preview = candidateConfig(spec.arm, launcher, '0'.repeat(64));
    if (!dry) {
      const report = writeConfig(join(options.directory, 'config'), preview, options.documentation);
      blocked = [...report.blocked, ...liveBlockers]; reason = 'LIVE_PREFLIGHT_BLOCKED';
      throw new Error(reason);
    }
    created = true;
    const createdId = await capture(docker, createArgs(options.image, token), env, manager);
    id = containerId.parse(createdId.toString('utf8').trim()); created = true;
    await capture(docker, [...context, 'start', id], env, manager);
    await inspectContainer(docker, id, env, manager, { token, image: options.image });
    const binding = { id, arm: spec.arm, run: spec.run_id, journal: join(options.directory, 'bridge.jsonl'), lock: join(options.directory, 'bridge.once'), cwd: manager, dockerConfig: join(options.directory, 'docker-public-context') };
    const module = pathToFileURL(fileURLToPath(new URL('./bridge.ts', import.meta.url))).href;
    writeFileSync(launcher, `#!${process.execPath}\nimport { launchBoundBridge } from ${JSON.stringify(module)};\nawait launchBoundBridge(${JSON.stringify(binding)}, process.argv.slice(2));\n`, { flag: 'wx', mode: 0o500 });
    const candidate = candidateConfig(spec.arm, launcher, id);
    const report = writeConfig(join(options.directory, 'config'), candidate, dry.documentation(candidate)); configHash = report.config_sha256;
    if (report.blocked.length) { blocked = report.blocked; throw new Error('CONFIG_BLOCKED'); }
    // Separate preflight journal: zero tools/call, no budget reset after inference.
    const preflight = new FileJournal(join(options.directory, 'preflight.jsonl'));
    try { await probeBridge({ id, arm: spec.arm, run: spec.run_id, journal: preflight, docker, env, cwd: manager }); } finally { preflight.close(); }
    // Live gateway readiness cannot be inferred from MCP initialize/tools/list.
    // The fake exercises a fixed socket-ready probe. Real live is blocked above.
    await capture(docker, [...context, 'exec', id, 'node', '-e', "if (!require('node:fs').statSync('/run/aab/gateway.sock').isSocket()) process.exit(1)"], env, manager);
    const pin = readPin(); if (spec.model !== pin.requested_model) throw new Error('MODEL_PIN_MISMATCH');
    const execution = execute(dry.codex, codexArgv(candidate, manager), { ...env, HOME: manager, CODEX_HOME: join(options.directory, 'config') }, manager, dry.deadline);
    let invalidOutput = false;
    const lines = new Lines(M03.citationFetchTotalMax.value * 1024, (bytes) => {
      journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'codex_event', sha256: bytesHash(bytes) } }); usage.accept(bytes);
    });
    execution.child.stdout.on('data', (bytes: Buffer) => { try { lines.push(bytes); } catch { invalidOutput = true; execution.stop(); } });
    execution.child.stderr.resume();
    const fixture = parseFixture(source.fixture(spec.fixture_id));
    execution.child.stdin.end((purpose === 'inventory' ? 'Reply with OK. Do not call any tools.' : fixture.prompt) + '\n');
    exit = await execution.done;
    try { lines.end(); } catch { invalidOutput = true; }
    const events = dry.bridgeEvents(); let responses = 0;
    for (const event of events) {
      if (event.run_id !== spec.run_id || event.kind !== 'call') throw new Error('BRIDGE_EVENT_DENIED');
      journal.append(event);
      const data = event.data as { phase?: string; response?: { error?: unknown; result?: { isError?: boolean } } };
      if (data.phase === 'requested') calls++;
      if (data.phase === 'response') { responses++; if (data.response?.error || data.response?.result?.isError) rejected++; }
    }
    rejected += Math.max(0, calls - responses);
    try { observation = await recordedObservation(spec, source, events); } catch { reason = 'OBSERVATION_FAILED'; }
    const corruptObservation = events.some((e) => (e.data as { phase?: string }).phase === 'response') && observation === null;
    reason = exit.timed_out ? 'WALL_BUDGET' : invalidOutput ? 'CLI_EVENT_INVALID' : exit.code !== 0 ? 'CODEX_EXIT_FAILED' : usage.snapshot().failed ? 'CODEX_TURN_FAILED' :
      usage.snapshot().tokens === null ? 'USAGE_UNKNOWN' : usage.snapshot().tokens! > M03.replayBuyerTokensMax.value ? 'TOKEN_BUDGET' :
      calls > M03.replayCallsMax.value ? 'CALL_BUDGET' : corruptObservation ? 'OBSERVATION_FAILED' : !observation?.finished ? 'NO_COMPLETION' : 'COMPLETED';
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    reason = /^[A-Z][A-Z_]+$/.test(code) ? code : 'PREFLIGHT_FAILED';
  } finally {
    if (created) {
      try {
        await capture(docker, [...context, 'rm', '-f', id ?? `aab-replay-${token}`], env, manager);
        await capture(docker, [...context, 'volume', 'rm', `aab-task-${token}`], env, manager); cleanup = 'removed_own_role_and_volume';
      } catch { cleanup = 'FAILED_RETAINED_FOR_LEAD'; }
    }
  }
  const tokens = usage.snapshot().tokens;
  const attempt: AttemptResult = { ...unrunResult(spec), status: reason === 'COMPLETED' ? 'completed' : 'failed', reason_code: reason,
    calls, rejected_calls: rejected, tokens, elapsed_ms: Math.floor(performance.now() - began), observation, evidence: observation?.actions.map((a) => a.evidence) ?? [],
    usage: tokens === null ? null : { effective_model: dry ? spec.model : 'UNVERIFIED', config_sha256: configHash, tokens, model_ms: null, human_active_ms: null, chain_ms: null,
      model_expense_usd: null, rpc_expense_usd: null, hosting_expense_usd: null },
    limitations: ['DRY_RUN_OR_BLOCKED_LIVE', 'TOKEN_ENFORCEMENT_UNVERIFIED', 'MODEL_INVENTORY_UNVERIFIED', 'NO_M10_COMPLIANCE_OR_HISTORICAL_CREDIT'] };
  const runtime: RuntimeEvidence = { mode: dry ? 'dry_run' : 'blocked_live', exit, usage_schema: 'UNVERIFIED', tokens_enforced: false, model_inventory_complete: false, cleanup, blocked };
  // Keep T8 result shape; lifecycle evidence is a separate event, not a second result.
  journal.append({ kind: 'call', run_id: spec.run_id, data: { phase: 'runtime_exit', ...runtime } });
  journal.append({ kind: 'result', run_id: spec.run_id, data: attempt });
  const grade = await gradeAttempt(attempt, source);
  return { attempt, grade, runtime };
}
/** No arbitrary external executable or test bypass accepted by the CLI. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [requestPath, ...extra] = process.argv.slice(2);
  if (!requestPath || extra.length) throw new Error('ONE_OPERATOR_REQUEST_REQUIRED');
  const request = loadRequest(requestPath); const journal = new FileJournal(request.journalPath);
  try {
    const result = await runAttempt({ ...request, journal });
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.attempt.status === 'completed' ? 0 : 2;
  } finally { journal.close(); }
}
