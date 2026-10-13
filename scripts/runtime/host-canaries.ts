/** LEAD ONLY inside an isolated probe container, not the runtime tool inventory.
 * Fixed synthetic targets only. Never points at a real home/key/database.
 * Lead must first prove dummy targets/listeners exist outside the boundary.
 * A denial without the external positive control is UNVERIFIED. */
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M03 } from '../../src/wire/index.ts';
export const canaryPaths = Object.freeze([
  '/probe-denied/host-home/canary', '/probe-denied/broker/db', '/probe-denied/keys/fake-key.json',
  '/probe-denied/seller-key/canary', '/probe-denied/rubric', '/probe-denied/other-arm',
  '/probe-denied/docker.sock', '/probe-denied/model-auth/canary',
]);
export async function runHostCanaries() {
  if (process.platform !== 'linux') throw new Error('LINUX_HOST_PROBE_REQUIRED');
  // Contents are compared in memory and never printed.
  const positive = readFileSync('/task/probe-clean.txt', 'utf8') === 'AAB_SYNTHETIC_CLEAN\n';
  const files = canaryPaths.map((path) => {
    try { readFileSync(path); return { path, denied: false }; }
    catch (error) { const code = (error as NodeJS.ErrnoException).code; return { path, denied: code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' }; }
  });
  const blocked = (host: string, port: number): Promise<boolean> => new Promise((resolve) => {
    const socket = connect({ host, port }); let done = false;
    const finish = (denied: boolean): void => { if (done) return; done = true; socket.destroy(); resolve(denied); };
    socket.once('connect', () => finish(false)); socket.once('error', () => finish(true));
    socket.setTimeout(M03.queueWaitMax.value * 1000, () => finish(true));
  });
  // Reserved documentation subnet, populated only in the lead's isolated probe
  // namespace. Never an Internet callback or production admin endpoint.
  const adminDenied = await blocked('192.0.2.2', 18081), networkDenied = await blocked('192.0.2.2', 18082);
  const status = readFileSync('/proc/self/status', 'utf8');
  const capsDropped = /^CapEff:\s+0+$/m.test(status), noNewPrivileges = /^NoNewPrivs:\s+1$/m.test(status);
  const unprivileged = process.getuid?.() !== 0;
  const passed = positive && files.every((f) => f.denied) && adminDenied && networkDenied && capsDropped && noNewPrivileges && unprivileged;
  return { passed, external_positive_controls: 'LEAD_EVIDENCE_REQUIRED', positive, files, adminDenied, networkDenied, capsDropped, noNewPrivileges, unprivileged };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runHostCanaries(); console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
}
