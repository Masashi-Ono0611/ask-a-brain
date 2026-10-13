import test from 'node:test';
import assert from 'node:assert/strict';
import type { FinalizedTransaction, RpcClient, Signature } from '../../src/wire/contracts.ts';
import { M03 } from '../../src/wire/index.ts';
import { attachSignature, FakeRpcClient, MAINNET_GENESIS, reconcilePayment, validatePaymentAccounts, verifyFinalizedPayment } from '../../src/chain/index.ts';
import { fixture } from './support.ts';
async function paid() { const f = fixture(); const signed = attachSignature(f.payment, await f.signer.sign(f.request)); await f.primary.broadcastIdentical(signed.transaction); const tx = (await f.primary.finalizedTransaction(signed.signature))!; return { ...f, signed, tx }; }
test('finalized transaction-local delta proof; repeated broadcast and restart keep one fee/settlement', async () => {
  const f = await paid(); const proof = verifyFinalizedPayment(f.tx, f.payment.expected);
  assert.equal(proof.payer_debit, String(M03.totalAtomic.value)); assert.equal(proof.seller_credit, String(M03.sellerAtomic.value)); assert.equal(proof.marketplace_credit, String(M03.marketplaceAtomic.value));
  const restarted = new FakeRpcClient({ origin: f.primary.origin, expected: f.payment.expected, clock: f.clock, fee: f.primary.fee, state: structuredClone(f.primary.state) });
  await restarted.broadcastIdentical(f.signed.transaction); assert.equal(restarted.state.feesCharged, BigInt(f.primary.fee));
  assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, restarted, f.secondary)).status, 'finalized_success');
});
const changes: Record<string, (tx: FinalizedTransaction) => FinalizedTransaction> = {
  genesis: t => ({ ...t, genesis: MAINNET_GENESIS }), finality: t => ({ ...t, commitment: 'confirmed' as never }), error: t => ({ ...t, meta: { ...t.meta, err: { InstructionError: [1, 'fail'] } } }),
  signature: t => ({ ...t, signature: '1'.repeat(64) as Signature }), bytes: t => ({ ...t, message: Uint8Array.from([...t.message, 0]) }),
  accounts: t => ({ ...t, accountKeys: [...t.accountKeys].reverse() }), instructions: t => ({ ...t, instructions: [...t.instructions].reverse() }),
  mint: t => ({ ...t, meta: { ...t.meta, postTokenBalances: t.meta.postTokenBalances.map(b => ({ ...b, mint: t.accountKeys[0]! })) } }),
  owner: t => ({ ...t, meta: { ...t.meta, preTokenBalances: t.meta.preTokenBalances.map(b => ({ ...b, owner: t.accountKeys[0]! })) } }),
  program: t => ({ ...t, meta: { ...t.meta, postTokenBalances: t.meta.postTokenBalances.map(b => ({ ...b, programId: t.accountKeys[0]! })) } }),
  decimals: t => ({ ...t, meta: { ...t.meta, preTokenBalances: t.meta.preTokenBalances.map(b => ({ ...b, decimals: 9 })) } }),
  delta: t => ({ ...t, meta: { ...t.meta, postTokenBalances: t.meta.postTokenBalances.map(b => ({ ...b, amount: '1' as never })) } }),
  missing: t => ({ ...t, meta: { ...t.meta, preTokenBalances: t.meta.preTokenBalances.slice(1) } }),
  duplicate: t => ({ ...t, meta: { ...t.meta, preTokenBalances: [t.meta.preTokenBalances[0]!, t.meta.preTokenBalances[0]!, t.meta.preTokenBalances[2]!] } }),
};
for (const [name, change] of Object.entries(changes)) test(`settlement guard ${name} rejects bad proof and clean passes`, async () => {
  const f = await paid(); assert.throws(() => verifyFinalizedPayment(change(structuredClone(f.tx)), f.payment.expected));
  assert.equal(verifyFinalizedPayment(f.tx, f.payment.expected).signature, f.signed.signature);
});
test('proof replay against different quote/message cannot settle; original proof still works', async () => {
  const f = await paid(); const other = fixture(); assert.throws(() => verifyFinalizedPayment(f.tx, other.payment.expected));
  assert.equal(verifyFinalizedPayment(f.tx, f.payment.expected).quote_id, f.quote.payload.quote_id);
});
test('second-leg simulated failure rolls back BOTH principal legs and retains actual fee; thawed fresh control succeeds', async () => {
  const f = fixture(); const target = f.primary.state.accounts.get(f.quote.payload.marketplace_token_account)!;
  const frozen = Uint8Array.from(target.data); frozen[108] = 2; f.primary.state.accounts.set(target.address, { ...target, data: frozen });
  await assert.rejects(validatePaymentAccounts(f.payment.expected, f.primary));
  const signed = attachSignature(f.payment, await f.signer.sign(f.request)); await f.primary.broadcastIdentical(signed.transaction);
  const tx = (await f.primary.finalizedTransaction(signed.signature))!;
  assert.deepEqual(tx.meta.err, { InstructionError: [1, { Custom: 17 }] }); assert.deepEqual(tx.meta.preTokenBalances, tx.meta.postTokenBalances);
  const result = await reconcilePayment(f.payment.expected, signed.signature, f.primary, f.secondary);
  assert.equal(result.status, 'finalized_failure'); if (result.status === 'finalized_failure') assert.equal(result.actualFee, f.primary.fee);
  f.primary.state.accounts.set(target.address, target); await validatePaymentAccounts(f.payment.expected, f.primary);
  const clean = await paid(); assert.equal((await reconcilePayment(clean.payment.expected, clean.signed.signature, clean.primary, clean.secondary)).status, 'finalized_success');
});
test('null/confirmed/processed/RPC errors/provider disagreement remain pending; restored finalized control passes', async () => {
  const f = await paid();
  for (const status of ['confirmed', 'processed'] as const) { f.primary.state.status = status; assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, f.primary, f.secondary)).status, 'pending'); }
  f.primary.state.status = 'finalized'; f.secondary.unavailable = true;
  assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, f.primary, f.secondary)).status, 'pending'); f.secondary.unavailable = false;
  const other = new FakeRpcClient({ origin: f.secondary.origin, expected: f.payment.expected, clock: f.clock, fee: f.primary.fee });
  assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, f.primary, other)).status, 'pending');
  other.state.transactions.set(f.signed.signature, { ...f.tx, meta: { ...f.tx.meta, fee: '999' as never } });
  assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, f.primary, other)).status, 'pending');
  assert.equal((await reconcilePayment(f.payment.expected, f.signed.signature, f.primary, f.secondary)).status, 'finalized_success');
});
test('expiry requires distinct origins, two absent signatures, finalized heights > expiry, matching genesis; clean expires', async () => {
  const f = fixture(); const result = await f.signer.sign(f.request); assert.equal(result.status, 'signed'); if (result.status !== 'signed') return;
  const reconcile = (secondary: RpcClient = f.secondary) => reconcilePayment(f.payment.expected, result.signature, f.primary, secondary);
  assert.equal((await reconcile()).status, 'pending'); f.primary.state.height = f.payment.expected.blockhash.lastValidBlockHeight;
  assert.equal((await reconcile()).status, 'pending'); f.primary.state.height++;
  assert.equal((await reconcile(f.primary)).status, 'pending');
  const sameOrigin = new FakeRpcClient({ origin: `${f.primary.origin}/other-path`, expected: f.payment.expected, clock: f.clock, fee: f.primary.fee, state: f.primary.state });
  assert.equal((await reconcile(sameOrigin)).status, 'pending');
  const unknownOrigin: RpcClient = { genesis: f.secondary.genesis.bind(f.secondary), latestBlockhash: f.secondary.latestBlockhash.bind(f.secondary), finalizedHeight: f.secondary.finalizedHeight.bind(f.secondary), accounts: f.secondary.accounts.bind(f.secondary), feeForMessage: f.secondary.feeForMessage.bind(f.secondary), signatureStatus: f.secondary.signatureStatus.bind(f.secondary), finalizedTransaction: f.secondary.finalizedTransaction.bind(f.secondary), broadcastIdentical: f.secondary.broadcastIdentical.bind(f.secondary) };
  assert.equal((await reconcile(unknownOrigin)).status, 'pending');
  const expired = await reconcile(); assert.equal(expired.status, 'expired');
  f.secondary.unavailable = true; assert.equal((await reconcile()).status, 'pending'); f.secondary.unavailable = false; assert.equal((await reconcile()).status, 'expired');
});
for (const field of ['mint', 'owner', 'program', 'decimals', 'delegate', 'native', 'frozen', 'close-authority', 'balance', 'missing'] as const) test(`account admission ${field}: rejection then restored clean passes`, async () => {
  const f = fixture(); const key = field === 'decimals' ? f.quote.payload.mint : f.payment.expected.payer.tokenAccount;
  const original = f.primary.state.accounts.get(key)!; const data = Buffer.from(original.data); let mutated = { ...original, data };
  if (field === 'mint') data[0] = data[0]! ^ 1;
  if (field === 'owner') data[32] = data[32]! ^ 1;
  if (field === 'program') mutated = { ...mutated, owner: f.quote.payload.mint };
  if (field === 'decimals') data[44] = data[44]! + 1;
  if (field === 'delegate') data.writeUInt32LE(1, 72);
  if (field === 'native') data.writeUInt32LE(1, 109);
  if (field === 'frozen') data[108] = 2;
  if (field === 'close-authority') data.writeUInt32LE(1, 129);
  if (field === 'balance') data.writeBigUInt64LE(M03.totalAtomic.value - 1n, 64);
  f.primary.state.accounts.set(key, mutated); if (field === 'missing') f.primary.state.accounts.delete(key);
  await assert.rejects(validatePaymentAccounts(f.payment.expected, f.primary)); f.primary.state.accounts.set(key, original); await validatePaymentAccounts(f.payment.expected, f.primary);
});

test('expiry rejects one lagging height, wrong provider genesis and unrelated absent signature; two agreeing observations expire', async () => {
  const f = fixture(); const result = await f.signer.sign(f.request); assert.equal(result.status, 'signed'); if (result.status !== 'signed') return;
  f.primary.state.height = f.payment.expected.blockhash.lastValidBlockHeight + 1;
  const other = new FakeRpcClient({ origin: f.secondary.origin, expected: f.payment.expected, clock: f.clock, fee: f.primary.fee, state: structuredClone(f.primary.state) });
  other.state.height--;
  assert.equal((await reconcilePayment(f.payment.expected, result.signature, f.primary, other)).status, 'pending'); other.state.height++;
  const wrongNetwork = new FakeRpcClient({ origin: f.secondary.origin, expected: { ...f.payment.expected, quote: { ...f.quote, payload: { ...f.quote.payload, genesis_hash: MAINNET_GENESIS } } }, clock: f.clock, fee: f.primary.fee, state: other.state });
  assert.equal((await reconcilePayment(f.payment.expected, result.signature, f.primary, wrongNetwork)).status, 'pending');
  assert.equal((await reconcilePayment(f.payment.expected, '1'.repeat(64) as Signature, f.primary, other)).status, 'pending');
  assert.equal((await reconcilePayment(f.payment.expected, result.signature, f.primary, other)).status, 'expired');
});
