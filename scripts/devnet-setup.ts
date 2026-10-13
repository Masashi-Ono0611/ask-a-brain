/** Lead-run only. --dry-run uses ONLY memory and FakeSetupRpc (no fetch/files). */
import { mkdirSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemClock } from '../src/common/index.ts';
import { DEVNET_GENESIS, createRpcClient, fetchRpcTransport, generateThrowawayKey, runDevnetSetup } from '../src/chain/index.ts';
import type { SetupKeys, SetupLimits, SetupState } from '../src/chain/index.ts';
import { FakeSetupRpc } from './chain/fake-setup-rpc.ts';
import { fileSetupJournal, loadSetupKeys, privateDirectory, writePrivate } from './chain/setup-storage.ts';
import { requireChain } from '../src/chain/legacy.ts';
export async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/devnet-setup.ts --dry-run|--execute --run-set ID [--rpc HTTPS_URL] --airdrop-lamports 1000000000 --backoff-ms 15000,30000,60000 --initial-atomic 1000000 --reserve-lamports 1000000 --response-bytes 1048576'); return;
  }
  const flags = new Map<string, string>(); let mode: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!; requireChain(!flags.has(key));
    if (key === '--execute' || key === '--dry-run') { requireChain(mode === undefined); mode = key; continue; }
    requireChain(['--run-set', '--rpc', '--airdrop-lamports', '--backoff-ms', '--initial-atomic', '--reserve-lamports', '--response-bytes'].includes(key));
    const value = args[++i]; requireChain(value !== undefined && !value.startsWith('--')); flags.set(key, value);
  }
  requireChain(mode === '--execute' || mode === '--dry-run'); const runSet = flags.get('--run-set'); requireChain(runSet && /^[A-Za-z0-9_-]+$/.test(runSet));
  const amount = (name: string): bigint => { const value = flags.get(name); requireChain(value && /^(0|[1-9][0-9]*)$/.test(value)); return BigInt(value); };
  const backoffs = flags.get('--backoff-ms'); requireChain(backoffs && /^[0-9]+(,[0-9]+)*$/.test(backoffs));
  const limits: SetupLimits = { airdropLamports: amount('--airdrop-lamports'), initialAtomic: amount('--initial-atomic'), suiteReserveLamports: amount('--reserve-lamports'), airdropBackoffMs: backoffs.split(',').map(Number) };
  const responseBytesMax = Number(amount('--response-bytes')); requireChain(Number.isSafeInteger(responseBytesMax) && responseBytesMax > 0);
  const clock = new SystemClock();
  if (mode === '--dry-run') {
    const rpc = new FakeSetupRpc(); let state: SetupState | null = null;
    const keys: SetupKeys = { buyer: generateThrowawayKey().keyBytes, seller: generateThrowawayKey().keyBytes, marketplace: generateThrowawayKey().keyBytes, mint: generateThrowawayKey().keyBytes, seal: generateThrowawayKey().keyBytes };
    const result = await runDevnetSetup({ rpc, keys, limits, clock: { now: () => clock.now(), monotonicMs: () => 0, sleep: async () => {} }, journal: { read: () => state, write: value => { state = structuredClone(value); } } });
    console.log(JSON.stringify({ evidence: 'SYNTHETIC_DRY_RUN_NOT_DEVNET', genesis: result.genesis, addresses: result.addresses, finalizedSetupTransactions: result.entries.length, airdrops: rpc.airdrops })); return;
  }
  const endpoint = flags.get('--rpc'); requireChain(endpoint);
  const root = resolve('.local', 'devnet', runSet);
  // Verify cluster BEFORE provisioning any throwaway key on disk.
  const rpc = createRpcClient({ endpoint, genesis: DEVNET_GENESIS, clock, responseBytesMax, transport: fetchRpcTransport(responseBytesMax) }); await rpc.genesis();
  privateDirectory(root); const lock = join(root, 'setup.lock'); mkdirSync(lock, { mode: 0o700 });
  try {
    const keys = loadSetupKeys(root); const journal = fileSetupJournal(root); let evidenceSequence = 0;
    const evidenceRoot = privateDirectory(join(root, `evidence-${Date.now()}`));
    const observedRpc = createRpcClient({ endpoint, genesis: DEVNET_GENESIS, clock, responseBytesMax, transport: fetchRpcTransport(responseBytesMax), evidence: (method, bytes) => writePrivate(join(evidenceRoot, `${++evidenceSequence}-${method}.json`), bytes) });
    const result = await runDevnetSetup({ rpc: observedRpc, clock, keys, journal, limits });
    console.log(JSON.stringify({ evidence: 'DEVNET_SETUP_RPC_OBSERVATIONS', journal: join(root, 'setup.json'), rawRpc: evidenceRoot, addresses: result.addresses, entries: result.entries.map(e => ({ name: e.name, signature: e.signature, state: e.state, fee: e.fee })) }));
  } finally { rmdirSync(lock); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error('DEVNET_SETUP_STOPPED: retain keys/journal; reconcile pending signatures before retry; no secret output'); process.exitCode = 1; });
