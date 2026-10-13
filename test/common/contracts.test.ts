import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Clock, HumanSignerIpcConfig, RpcClient, Sha256, Signer, SignRequest, TestSignerConfig, Uuid } from '../../src/wire/contracts.ts';
import { createTestSigner, FixedClock } from '../../src/common/index.ts';
const address = '11111111111111111111111111111111' as Address;
const hash = 'a'.repeat(64) as Sha256;
// These compile-only consumers enforce the exact callable port surfaces.
const rpc: RpcClient = {
  async genesis(_signal) { return address; },
  async latestBlockhash(_signal) { return { blockhash: address, lastValidBlockHeight: 1, observedAt: clock.now() }; },
  async finalizedHeight(_signal) { return 1; },
  async feeForMessage(_message, _signal) { return null; },
  async accounts(addresses, _signal) { return { slot: 1, observedAt: clock.now(), accounts: addresses.map(() => null) }; },
  async signatureStatus(signature, _signal) { return { signature, status: 'absent', slot: null, err: null, observedAt: clock.now() }; },
  async finalizedTransaction(_signature, _signal) { return null; },
  async broadcastIdentical(_bytes, _signal) { throw new Error('fixture has no broadcasting capability'); },
};
const clock: Clock = new FixedClock('2026-10-09T00:00:00Z');
const humanConfig: HumanSignerIpcConfig = { endpoint: 'protected-ipc-fixture', expectedPublicKey: address };
void humanConfig;
test('RPC/Clock typed stub consumers and TestSigner are inert and do not read key source', async () => {
  let sourceReads = 0;
  const config: TestSignerConfig = { publicKey: address, network: 'devnet', genesis: address, keyBytes: () => { sourceReads++; throw new Error('must never be called by stub'); } };
  const signer: Signer = createTestSigner(config);
  assert.equal(await signer.publicKey(), address);
  // Partial fixture intentionally proves network rejection precedes other fields.
  assert.deepEqual(await signer.sign({ network: 'mainnet-beta' } as SignRequest), { status: 'denied', reason: 'NETWORK_MISMATCH' });
  assert.deepEqual(await signer.sign({ network: 'devnet', genesis: address } as SignRequest), { status: 'denied', reason: 'NOT_READY' });
  assert.equal(await signer.recover('00000000-0000-4000-8000-000000000001' as Uuid, hash), null);
  assert.equal(sourceReads, 0); assert.equal(await rpc.genesis(), address);
  assert.equal(await rpc.finalizedHeight(), 1);
  assert.throws(() => createTestSigner({ ...config, network: 'mainnet-beta' } as unknown as TestSignerConfig), /NETWORK_MISMATCH/);
});
