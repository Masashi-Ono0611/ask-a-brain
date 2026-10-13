/** TEST ONLY: a process-level Docker double. Never resolves an actual Docker. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveRestrictedMcp, StrictStdioTransport } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
import { createTaskTools, parseFixture, parseCorpus } from '../../src/eval/index.ts';
import { source } from '../../scripts/eval/synthetic.ts';
import { M03 } from '../../src/wire/index.ts';
import type { FrozenRun } from '../../src/wire/contracts.ts';
const directory = process.argv[2]!;
const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { mode: string; spec: FrozenRun };
const args = process.argv.slice(3);
if (args[0] !== '--context' || args[1] !== 'colima-aab-probe') process.exit(9);
appendFileSync(join(directory, 'docker.log'), JSON.stringify(args) + '\n');
const id = 'a'.repeat(64);
const operation = args[2];
if (operation === 'create') {
  const token = args.find((arg) => arg.startsWith('aab.replay.token='))!.split('=')[1]!;
  const image = args.find((arg) => arg.includes('@sha256:'))!;
  writeFileSync(join(directory, 'container.json'), JSON.stringify({ token, image })); console.log(id);
} else if (operation === 'inspect') {
  if (settings.mode === 'absent') process.exit(1);
  const { token, image } = JSON.parse(readFileSync(join(directory, 'container.json'), 'utf8')) as { token: string; image: string };
  const row = { id, image, running: true, user: '65532:65532', role: 'buyer_mcp', token, network: 'none', readonly: true, privileged: false,
    caps: ['ALL'], add_caps: null, security: ['no-new-privileges:true'], pid: '', ipc: 'private', devices: [], ports: {}, restart: 'no',
    memory: M03.workerMemoryMax.value * 1024 ** 3, swap: M03.workerMemoryMax.value * 1024 ** 3, pids: 64, cpus: 1_000_000_000,
    mounts: [{ Type: 'volume', Name: `aab-task-${token}`, Source: '/var/lib/docker/volumes/task/_data', Destination: '/task', Driver: 'local', Mode: 'z', RW: true, Propagation: '' }] };
  if (settings.mode === 'network') row.network = 'bridge';
  if (settings.mode === 'host_home') row.mounts[0]!.Type = 'bind';
  if (settings.mode === 'host_home') row.mounts[0]!.Source = '/home/synthetic-host';
  console.log(JSON.stringify(row));
} else if (operation === 'exec' && args.includes('-e')) {
  if (settings.mode === 'gateway_absent') process.exit(1);
} else if (operation === 'exec') {
  if (settings.mode === 'broken') process.exit(1);
  const arm = args.at(-1) as Arm;
  const controller = createTaskTools(parseFixture(source.fixture(settings.spec.fixture_id)), parseCorpus(source.corpus()), arm,
    { now: () => settings.spec.started_at, monotonicMs: () => 0, sleep: async () => {} }, settings.spec.run_id);
  await serveRestrictedMcp({ async call(tool, input) { const fn = controller.tools[tool as keyof typeof controller.tools] as (input: unknown) => Promise<unknown>; return fn(input); } },
    new StrictStdioTransport(process.stdin, process.stdout), arm);
} else if (!['start', 'rm', 'volume'].includes(operation ?? '')) process.exit(9);
