/** Host-only Docker control. All selectors are opaque; never passed by a model. */
import { z } from 'zod';
import { M03, strictJson } from '../../src/wire/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
import { capture } from './process.ts';
import { containerFlags } from '../runtime/config.ts';
import type { Command } from './process.ts';
export const context = ['--context', 'colima-aab-probe'] as const;
export const roleLabel = 'aab.replay.role';
export const containerId = z.string().regex(/^[a-f0-9]{64}$/);
export const imagePin = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
// CPU/PID pins belong to the existing T7 deployment plan (M03 delegates them).
const resourceFlags = containerFlags('buyer_mcp', `aab/placeholder@sha256:${'0'.repeat(64)}`);
export const resourcePins = Object.freeze({
  pids: Number(resourceFlags.find((flag) => flag.startsWith('--pids-limit='))!.split('=')[1]),
  cpus: Number(resourceFlags.find((flag) => flag.startsWith('--cpus='))!.split('=')[1]),
});
export const runToken = z.string().regex(/^[a-f0-9]{32}$/);
// Docker-owned objects have version-dependent fields. Select a fixed, explicit
// projection for validation; no ignored user-supplied config object is accepted.
export const safeInspectFormat = '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"user":{{json .Config.User}},"role":{{json (index .Config.Labels "aab.replay.role")}},"token":{{json (index .Config.Labels "aab.replay.token")}},"network":{{json .HostConfig.NetworkMode}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"add_caps":{{json .HostConfig.CapAdd}},"security":{{json .HostConfig.SecurityOpt}},"pid":{{json .HostConfig.PidMode}},"ipc":{{json .HostConfig.IpcMode}},"devices":{{json .HostConfig.Devices}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},"restart":{{json .HostConfig.RestartPolicy.Name}},"memory":{{json .HostConfig.Memory}},"swap":{{json .HostConfig.MemorySwap}},"pids":{{json .HostConfig.PidsLimit}},"cpus":{{json .HostConfig.NanoCpus}}}';
const mountSchema = z.object({ Type: z.literal('volume'), Name: z.string(), Source: z.string(), Destination: z.literal('/task'), Driver: z.literal('local'), Mode: z.string(), RW: z.literal(true), Propagation: z.string() }).strict();
const inspectSchema = z.object({ id: containerId, image: imagePin, running: z.literal(true), user: z.literal('65532:65532'),
  role: z.literal('buyer_mcp'), token: runToken, network: z.literal('none'), readonly: z.literal(true), privileged: z.literal(false),
  caps: z.tuple([z.literal('ALL')]), add_caps: z.union([z.null(), z.tuple([])]), security: z.tuple([z.literal('no-new-privileges:true')]),
  pid: z.literal(''), ipc: z.literal('private'), devices: z.union([z.null(), z.tuple([])]), mounts: z.tuple([mountSchema]),
  ports: z.union([z.null(), z.object({}).strict()]), restart: z.literal('no'), memory: z.literal(M03.workerMemoryMax.value * 1024 ** 3),
  swap: z.literal(M03.workerMemoryMax.value * 1024 ** 3), pids: z.literal(resourcePins.pids), cpus: z.literal(resourcePins.cpus * 1_000_000_000) }).strict();
export function validateContainer(bytes: Uint8Array, expected: { id: string; token?: string; image?: string }) {
  const row = inspectSchema.parse(strictJson(bytes));
  if (row.id !== expected.id || expected.token !== undefined && row.token !== expected.token || expected.image !== undefined && row.image !== expected.image ||
      row.mounts[0].Name !== `aab-task-${row.token}`) throw new Error('CONTAINER_IDENTITY_MISMATCH');
  return row;
}
export function createArgs(image: string, token: string): string[] {
  imagePin.parse(image); runToken.parse(token);
  return [...context, 'create', '--pull=never', '--name', `aab-replay-${token}`, '--label', `${roleLabel}=buyer_mcp`, '--label', `aab.replay.token=${token}`,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=65532:65532', '--ipc=private',
    `--pids-limit=${resourcePins.pids}`, `--cpus=${resourcePins.cpus}`, `--memory=${M03.workerMemoryMax.value}g`, `--memory-swap=${M03.workerMemoryMax.value}g`, '--restart=no',
    '--mount', `type=volume,src=aab-task-${token},dst=/task,volume-nocopy`, '--workdir=/task', '--entrypoint=node', image,
    '-e', 'setInterval(() => {}, 2147483647)'];
}
export function execArgs(id: string, arm: Arm): string[] {
  containerId.parse(id); if (!['A', 'B', 'C'].includes(arm)) throw new Error('ARM_DENIED');
  return [...context, 'exec', '-i', '--user=65532:65532', id, 'node', '/app/scripts/runtime/buyer.ts', arm];
}
export async function inspectContainer(command: Command, id: string, env: NodeJS.ProcessEnv, cwd: string, expected: { token?: string; image?: string } = {}) {
  containerId.parse(id);
  return validateContainer(await capture(command, [...context, 'inspect', '--format', safeInspectFormat, id], env, cwd), { id, ...expected });
}
