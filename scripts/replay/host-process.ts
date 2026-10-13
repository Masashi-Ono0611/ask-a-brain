import { spawn } from 'node:child_process';
import { M03 } from '../../src/wire/index.ts';
import { HostLines } from './host-lines.ts';
import type { Command, Deadline } from './process.ts';
import { wallDeadline } from './process.ts';
export async function runProcess(command: Command, args: string[], env: NodeJS.ProcessEnv, cwd: string, prompt: string,
  output: (line: Buffer) => void, deadline: Deadline = wallDeadline, onStop?: (stop: () => void) => void) {
  const child = spawn(command.executable, [...command.prefix, ...args], { cwd, env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let timeout = false, invalid = false, stderr = '', stderrBytes = 0;
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } };
  onStop?.(stop);
  const cancel = deadline(() => { timeout = true; stop(); }, M03.replayWallTimeMax.value * 60_000);
  const lines = new HostLines(M03.sealedPayloadMax.value * 1024 * 1024, output);
  child.stdin.on('error', () => {});
  child.stdout.on('data', (b: Buffer) => { try { lines.push(b); } catch { invalid = true; stop(); } });
  child.stderr.on('data', (b: Buffer) => { stderrBytes += b.length; if (stderrBytes > M03.sealedPayloadMax.value * 1024 * 1024) { invalid = true; stop(); } else stderr += b.toString('utf8'); });
  child.stdin.end(prompt);
  return await new Promise<{ code: number | null; signal: string | null; timeout: boolean; invalid: boolean; stderr: string }>((resolve) => {
    let settled = false;
    const done = (code: number | null, signal: string | null) => { if (settled) return; settled = true; cancel(); stop();
      try { lines.end(); } catch { invalid = true; }
      resolve({ code, signal, timeout, invalid, stderr }); };
    child.once('error', () => done(null, null)); child.once('close', done);
  });
}
