import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Clock } from '../../src/wire/contracts.ts';
import { M03 } from '../../src/wire/index.ts';
import { FixedClock } from '../../src/common/index.ts';
import { generateThrowawayKey, MAINNET_GENESIS, runDevnetSetup } from '../../src/chain/index.ts';
import type { SetupKeys, SetupLimits, SetupState } from '../../src/chain/index.ts';
import { FakeSetupRpc } from '../../scripts/chain/fake-setup-rpc.ts';
import { fileSetupJournal, loadSetupKeys, privateDirectory, readPrivate } from '../../scripts/chain/setup-storage.ts';
function setupFixture() {
  const fixed = new FixedClock('2026-10-09T00:00:00Z'); const waits: number[] = [];
  const clock: Clock = { now: () => fixed.now(), monotonicMs: () => fixed.monotonicMs(), sleep: async ms => { waits.push(ms); fixed.advance(ms); } };
  const keys: SetupKeys = { buyer: generateThrowawayKey().keyBytes, seller: generateThrowawayKey().keyBytes, marketplace: generateThrowawayKey().keyBytes, mint: generateThrowawayKey().keyBytes, seal: generateThrowawayKey().keyBytes };
  // Explicit E06 operator inputs; production has no hardcoded setup-cap defaults.
  const limits: SetupLimits = { airdropLamports: 1_000_000_000n, initialAtomic: 1_000_000n, suiteReserveLamports: 1_000_000n, airdropBackoffMs: [15000, 30000, 60000] };
  let state: SetupState | null = null; const rpc = new FakeSetupRpc();
  const journal = { read: () => structuredClone(state), write: (value: SetupState) => { state = structuredClone(value); } };
  const run = () => runDevnetSetup({ rpc, clock, keys, journal, limits });
  return { rpc, clock, keys, journal, limits, run, waits };
}
function directory(t: { after(fn: () => void): void }) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'aab-setup-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
test('setup creates 6-decimal mint and exactly 3 ATAs, records supply/fees; rerun creates nothing and never remints', async () => {
  const f = setupFixture(); const state = await f.run(); assert.equal(f.rpc.airdrops, 1); assert.equal(state.entries.length, 5); assert.equal(state.entries.filter(e => e.name.startsWith('ata-')).length, 3); assert.ok(state.entries.every(e => e.state === 'finalized' && e.fee === '5000'));
  const mint = f.rpc.accounts.get(state.addresses.mint!)!; assert.equal(mint.data[44], M03.tokenDecimals.value); assert.equal(mint.data.readBigUInt64LE(36), f.limits.initialAtomic);
  const sends = f.rpc.sends; assert.deepEqual(await f.run(), state); assert.equal(f.rpc.sends, sends); assert.equal(f.rpc.airdrops, 1);
  // Purchase-like redistribution does not trigger a top-up on rerun.
  f.rpc.accounts.get(state.addresses.buyerAta!)!.data.writeBigUInt64LE(f.limits.initialAtomic - M03.totalAtomic.value, 64);
  await f.run(); assert.equal(f.rpc.sends, sends);
});
test('wrong genesis rejects BEFORE faucet or setup calls; clean devnet restore provisions', async () => {
  const f = setupFixture(); f.rpc.genesisHash = MAINNET_GENESIS; await assert.rejects(f.run()); assert.deepEqual(f.rpc.calls, ['genesis']); assert.equal(f.journal.read(), null);
  const clean = setupFixture(); assert.equal((await clean.run()).entries.length, 5);
});
test('lost broadcast reply resumes identical signed setup bytes, no new mint identity/signature', async () => {
  const f = setupFixture(); f.rpc.lostResponse = true; await assert.rejects(f.run(), /LOST_SEND_RESPONSE/);
  const first = f.journal.read()!.entries[0]!; assert.equal(first.state, 'pending'); const resumed = await f.run();
  assert.equal(resumed.entries[0]!.signature, first.signature); assert.equal(resumed.entries[0]!.transactionBase64, first.transactionBase64); assert.equal(resumed.entries.length, 5); assert.equal(f.rpc.transactions.size, 5); assert.equal(f.rpc.airdrops, 1);
});
test('pending setup/expired unknown never gets replacement; restored finalized observation resumes', async () => {
  const f = setupFixture(); f.rpc.hideTransaction = true; await assert.rejects(f.run(), /SETUP_PENDING/);
  const entry = f.journal.read()!.entries[0]!; f.rpc.height = entry.lastValidBlockHeight + 1; const sends = f.rpc.sends;
  await assert.rejects(f.run(), /SETUP_EXPIRED_RECONCILE_REQUIRED/); assert.equal(f.rpc.sends, sends); assert.equal(f.journal.read()!.entries[0]!.signature, entry.signature);
  f.rpc.hideTransaction = false; assert.equal((await f.run()).entries.length, 5);
});
test('bounded faucet 429 retries stop after configured attempts; restarting does not reset quota; funded same buyer continues', async () => {
  const f = setupFixture(); f.rpc.rateLimits = f.limits.airdropBackoffMs.length;
  await assert.rejects(f.run(), /AIRDROP_LIMIT/); assert.equal(f.rpc.airdrops, f.limits.airdropBackoffMs.length); assert.deepEqual(f.waits, f.limits.airdropBackoffMs);
  await assert.rejects(f.run(), /AIRDROP_LIMIT/); assert.equal(f.rpc.airdrops, f.limits.airdropBackoffMs.length);
  f.rpc.balance = Number(f.limits.airdropLamports); assert.equal((await f.run()).entries.length, 5);
});
test('ambiguous faucet error holds uncertainty instead of requesting more; observed funding restores same identity', async () => {
  const f = setupFixture(); f.rpc.airdropTimeout = true; await assert.rejects(f.run(), /AIRDROP_UNCERTAIN/); const identities = f.journal.read()!.addresses;
  await assert.rejects(f.run(), /AIRDROP_UNCERTAIN/); assert.equal(f.rpc.airdrops, 1); f.rpc.balance = Number(f.limits.airdropLamports); f.rpc.airdropTimeout = false;
  assert.deepEqual((await f.run()).addresses, identities); assert.equal(f.rpc.airdrops, 1);
});
for (const field of ['mint-decimals', 'mint-authority', 'freeze-authority', 'ata-owner', 'ata-program', 'supply'] as const) test(`setup existing ${field} mismatch rejects with no new sends; restored original continues`, async () => {
  const f = setupFixture(); const state = await f.run(); const address = field.startsWith('ata') ? state.addresses.sellerAta! : state.addresses.mint!;
  const original = f.rpc.accounts.get(address)!; const changed = { ...original, data: Buffer.from(original.data) };
  if (field === 'mint-decimals') changed.data[44] = 9;
  if (field === 'mint-authority') changed.data[4] = changed.data[4]! ^ 1;
  if (field === 'freeze-authority') changed.data[50] = changed.data[50]! ^ 1;
  if (field === 'ata-owner') changed.data[32] = changed.data[32]! ^ 1;
  if (field === 'ata-program') changed.owner = state.addresses.buyer!;
  if (field === 'supply') changed.data.writeBigUInt64LE(f.limits.initialAtomic + 1n, 36);
  f.rpc.accounts.set(address, changed); const sends = f.rpc.sends; await assert.rejects(f.run()); assert.equal(f.rpc.sends, sends);
  f.rpc.accounts.set(address, original); assert.deepEqual(await f.run(), state);
});
test('missing durable setup journal blocks first signature dispatch; clean journal succeeds', async () => {
  const f = setupFixture(); await assert.rejects(runDevnetSetup({ ...f, journal: { read: () => null, write: () => { throw new Error('DISK_FULL'); } } }), /DISK_FULL/);
  assert.equal(f.rpc.sends, 0); assert.equal(f.rpc.airdrops, 0); assert.equal((await f.run()).entries.length, 5);
});
test('temporary private key files and canonical setup journal survive restart; duplicate/unknown JSON and symlinks/modes reject', async t => {
  const root = directory(t); const keys = loadSetupKeys(root); const copy = loadSetupKeys(root); assert.deepEqual(keys, copy);
  const f = setupFixture(); const journal = fileSetupJournal(root); const state = await runDevnetSetup({ ...f, keys, journal });
  assert.deepEqual(await runDevnetSetup({ ...f, keys: copy, journal: fileSetupJournal(root) }), state);
  const path = join(root, 'setup.json'); const original = readFileSync(path);
  for (const text of ['{"v":1,"v":1}', JSON.stringify({ ...state, extra: true })]) { writeFileSync(path, text); assert.throws(() => fileSetupJournal(root).read()); writeFileSync(path, original); assert.deepEqual(fileSetupJournal(root).read(), state); }
  const keyPath = join(root, 'buyer.json'); chmodSync(keyPath, 0o644); assert.throws(() => readPrivate(keyPath)); chmodSync(keyPath, 0o600); assert.ok(readPrivate(keyPath).length);
  const link = join(root, 'symlink'); symlinkSync(root, link); assert.throws(() => privateDirectory(link)); assert.equal(privateDirectory(root), root);
});
test('devnet-setup --dry-run executes full fake setup without creating .local or touching network', () => {
  const child = spawnSync(process.execPath, ['scripts/devnet-setup.ts', '--dry-run', '--run-set', 't2-dry', '--airdrop-lamports', '1000000000', '--backoff-ms', '15000,30000,60000', '--initial-atomic', '1000000', '--reserve-lamports', '1000000', '--response-bytes', '1048576'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const evidence = JSON.parse(child.stdout); assert.equal(evidence.evidence, 'SYNTHETIC_DRY_RUN_NOT_DEVNET'); assert.equal(evidence.finalizedSetupTransactions, 5);
});

test('setup limits cannot change after initial journal, preventing faucet counter bypass; original limits resume', async () => {
  const f = setupFixture(); await f.run(); const sends = f.rpc.sends;
  await assert.rejects(runDevnetSetup({ ...f, limits: { ...f.limits, airdropBackoffMs: [...f.limits.airdropBackoffMs, 1] } }));
  assert.equal(f.rpc.sends, sends); assert.equal((await f.run()).entries.length, 5);
});
test('interrupted complete journal rename recovers; truncated pre-dispatch write restores previous state and reruns cleanly', async t => {
  const root = directory(t); const f = setupFixture(); const journal = fileSetupJournal(root); const state = await runDevnetSetup({ ...f, journal });
  const path = join(root, 'setup.json'); const next = `${path}.next`;
  writeFileSync(next, readFileSync(path), { mode: 0o600 }); assert.deepEqual(fileSetupJournal(root).read(), state);
  writeFileSync(next, '{"v":', { mode: 0o600 }); assert.deepEqual(fileSetupJournal(root).read(), state);
  assert.deepEqual(await runDevnetSetup({ ...f, journal: fileSetupJournal(root) }), state);
});
