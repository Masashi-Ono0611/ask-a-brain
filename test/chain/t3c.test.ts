import test from 'node:test';
import assert from 'node:assert/strict';
import { FoundationError } from '../../src/common/index.ts';
import { attachSignature, reconcilePayment, HumanCliSigner, HumanSigningHelper, MemorySignJournal, handleHumanSignerMessage } from '../../src/chain/index.ts';
import { fixture } from './support.ts';

for (const landed of [true, false]) test(`F5 height before absence; landed during height read=${landed}`, async () => {
  const f = fixture(); const signed = attachSignature(f.payment, await f.signer.sign(f.request));
  const height = f.payment.expected.blockhash.lastValidBlockHeight + 1;
  // Old concurrent ordering takes absent/null before this call catches up and lands.
  f.primary.finalizedHeight = async () => {
    await Promise.resolve();
    if (landed) await f.primary.broadcastIdentical(signed.transaction);
    return height;
  };
  f.secondary.finalizedHeight = f.primary.finalizedHeight;
  const result = await reconcilePayment(f.payment.expected, signed.signature, f.primary, f.secondary);
  assert.equal(result.status, landed ? 'finalized_success' : 'expired');
});

test('D1 same origin cannot finalize a payment, distinct provider control succeeds', async () => {
  const f = fixture(); const signed = attachSignature(f.payment, await f.signer.sign(f.request)); await f.primary.broadcastIdentical(signed.transaction);
  assert.equal((await reconcilePayment(f.payment.expected, signed.signature, f.primary, f.primary)).status, 'pending');
  assert.equal((await reconcilePayment(f.payment.expected, signed.signature, f.primary, f.secondary)).status, 'finalized_success');
});

test('F4 helper pre-sign refusal is explicit; transport loss and journal failure stay uncertain; clean signs', async () => {
  const f = fixture(); let refuse = true; let loads = 0;
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => { loads++; return f.key.keyBytes; }, clock: f.clock, journal: new MemorySignJournal(),
    authorize: async () => { if (refuse) throw new FoundationError('QUOTE_EXPIRED'); }, terminal: { isTTY: () => true, approve: async () => `approve ${f.request.messageHash}` } });
  const config = { endpoint: '/injected-only.sock', expectedPublicKey: f.key.publicKey };
  const client = new HumanCliSigner(config, bytes => handleHumanSignerMessage(bytes, helper));
  assert.deepEqual(await client.sign(f.request), { status: 'denied', reason: 'QUOTE_EXPIRED' }); assert.equal(loads, 0);
  refuse = false; assert.equal((await client.sign(f.request)).status, 'signed'); assert.equal(loads, 1);
  const lost = new HumanCliSigner(config, async bytes => { await handleHumanSignerMessage(bytes, helper); throw new Error('transport lost'); });
  await assert.rejects(lost.sign(f.request), /transport lost/);
  assert.equal((await client.recover(f.request.requestId, f.request.messageHash))?.status, 'signed');
  const broken = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal: { read: () => null, write: () => { throw new Error('disk failure after signature'); } }, authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => `approve ${f.request.messageHash}` } });
  await assert.rejects(new HumanCliSigner(config, bytes => handleHumanSignerMessage(bytes, broken)).sign(f.request));
});
