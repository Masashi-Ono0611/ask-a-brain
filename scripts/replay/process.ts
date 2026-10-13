/** No shell, no inherited environment, and termination targets one child only. */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { M03 } from '../../src/wire/index.ts';
export interface Exit { code: number | null; signal: NodeJS.Signals | null; timed_out: boolean }
export interface Command { executable: string; prefix: readonly string[] }
export interface Execution { child: ChildProcessWithoutNullStreams; done: Promise<Exit>; stop(): void }
export type Deadline = (kill: () => void, milliseconds: number) => () => void;
export const wallDeadline: Deadline = (kill, milliseconds) => { const timer = setTimeout(kill, milliseconds); return () => clearTimeout(timer); };
export function execute(command: Command, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string, deadline: Deadline = wallDeadline): Execution {
  const child = spawn(command.executable, [...command.prefix, ...args], { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  // EPIPE is an aborted child, never an uncaught exception in the journal owner.
  child.stdin.on('error', () => {});
  let timedOut = false;
  const cancel = deadline(() => { timedOut = true; child.kill('SIGKILL'); }, M03.replayWallTimeMax.value * 60_000);
  const done = new Promise<Exit>((resolve) => {
    child.once('error', () => { cancel(); resolve({ code: null, signal: null, timed_out: timedOut }); });
    child.once('close', (code, signal) => { cancel(); resolve({ code, signal, timed_out: timedOut }); });
  });
  return { child, done, stop: () => { child.kill('SIGKILL'); } };
}
export async function capture(command: Command, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Buffer> {
  const execution = execute(command, args, env, cwd); const chunks: Buffer[] = []; let length = 0, overflow = false;
  execution.child.stdout.on('data', (chunk: Buffer) => {
    length += chunk.length;
    if (length > M03.citationFetchTotalMax.value * 1024) { overflow = true; execution.stop(); } else chunks.push(chunk);
  });
  execution.child.stderr.resume(); execution.child.stdin.end();
  const result = await execution.done;
  if (result.code !== 0 || overflow || result.timed_out) throw new Error('COMMAND_FAILED');
  return Buffer.concat(chunks);
}
