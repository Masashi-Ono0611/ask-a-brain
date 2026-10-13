import test from 'node:test';
import assert from 'node:assert/strict';
import type { FinalizedTransaction } from '../../src/wire/contracts.ts';
import { attachSignature, createRpcClient, DEVNET_GENESIS, MAINNET_GENESIS, verifyFinalizedPayment } from '../../src/chain/index.ts';
import type { RpcTransport } from '../../src/chain/index.ts';
import { fixture } from './support.ts';
function rawTransaction(tx: FinalizedTransaction) {
  const balances = (rows: FinalizedTransaction['meta']['preTokenBalances']) => rows.map(b => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, programId: b.programId, uiTokenAmount: { amount: b.amount, decimals: b.decimals, uiAmount: null, uiAmountString: '0' } }));
  return { slot: tx.slot, transaction: [Buffer.from(tx.transaction).toString('base64'), 'base64'], version: 'legacy', blockTime: null, meta: { err: tx.meta.err, fee: Number(tx.meta.fee), preTokenBalances: balances(tx.meta.preTokenBalances), postTokenBalances: balances(tx.meta.postTokenBalances), innerInstructions: [], loadedAddresses: { writable: [], readonly: [] } } };
}
async function rpcFixture() {
  const f = fixture(); const signed = attachSignature(f.payment, await f.signer.sign(f.request)); await f.primary.broadcastIdentical(signed.transaction); const tx = (await f.primary.finalizedTransaction(signed.signature))!;
  const methods: { method: string; params: unknown[] }[] = []; let mutate: ((value: unknown, method: string) => unknown) | undefined; let raw: ((text: string) => Uint8Array) | undefined;
  const transport: RpcTransport = async (_endpoint, bytes) => {
    const request = JSON.parse(Buffer.from(bytes).toString()); methods.push(request); let result: unknown;
    switch (request.method) {
      case 'getGenesisHash': result = DEVNET_GENESIS; break;
      case 'getLatestBlockhash': result = { context: { slot: 1 }, value: { blockhash: f.payment.expected.blockhash.blockhash, lastValidBlockHeight: 100 } }; break;
      case 'getBlockHeight': result = 101; break;
      case 'getFeeForMessage': result = { context: { slot: 1 }, value: 5000 }; break;
      case 'getSignatureStatuses': result = { context: { slot: 1 }, value: [{ slot: 1, confirmations: null, confirmationStatus: 'finalized', err: null }] }; break;
      case 'getMultipleAccounts': result = { context: { slot: 1, apiVersion: '3.0' }, value: request.params[0].map((key: string) => { const a = f.primary.state.accounts.get(key as never); return a ? { owner: a.owner, data: [Buffer.from(a.data).toString('base64'), 'base64'], executable: false, lamports: Number(a.lamports), space: a.data.length } : null; }) }; break;
      case 'getTransaction': result = rawTransaction(tx); break;
      case 'sendTransaction': result = signed.signature; break;
      default: throw new Error('UNEXPECTED_METHOD');
    }
    const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: mutate ? mutate(result, request.method) : result });
    return raw ? raw(response) : Buffer.from(response);
  };
  const rpc = createRpcClient({ endpoint: 'https://primary.example/rpc', genesis: DEVNET_GENESIS, clock: f.clock, responseBytesMax: 1_048_576, transport });
  return { ...f, signed, tx, methods, rpc, setMutate(fn?: typeof mutate) { mutate = fn; }, setRaw(fn?: typeof raw) { raw = fn; } };
}
test('injected JSON RPC round-trips raw finalized base64 proof, accounts/status/fee; broadcasts exact bytes with no preflight bypass', async () => {
  const f = await rpcFixture(); assert.equal(f.rpc.origin, 'https://primary.example'); assert.equal(await f.rpc.genesis(), DEVNET_GENESIS);
  assert.equal((await f.rpc.latestBlockhash()).lastValidBlockHeight, 100); assert.equal(await f.rpc.finalizedHeight(), 101); assert.equal(await f.rpc.feeForMessage(f.payment.message), '5000');
  assert.equal((await f.rpc.accounts([f.quote.payload.mint])).accounts[0]?.owner, f.quote.payload.token_program);
  assert.equal((await f.rpc.signatureStatus(f.signed.signature)).status, 'finalized');
  const tx = (await f.rpc.finalizedTransaction(f.signed.signature))!; assert.equal(verifyFinalizedPayment(tx, f.payment.expected).payer_debit, f.quote.payload.total_atomic);
  assert.equal(await f.rpc.broadcastIdentical(f.signed.transaction), f.signed.signature);
  const sent = f.methods.find(m => m.method === 'sendTransaction')!; assert.equal(sent.params[0], Buffer.from(f.signed.transaction).toString('base64')); assert.deepEqual(sent.params[1], { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 });
  assert.ok(f.methods.filter(m => m.method === 'getTransaction').every(m => (m.params[1] as { commitment: string }).commitment === 'finalized'));
});
for (const name of ['duplicate', 'unknown', 'utf8', 'wrong-id', 'both-result-error'] as const) test(`RPC strict envelope ${name} rejects, clean restore passes`, async () => {
  const f = await rpcFixture();
  f.setRaw(text => {
    if (name === 'duplicate') return Buffer.from(text.replace('"jsonrpc":', '"jsonrpc":"2.0","jsonrpc":'));
    if (name === 'unknown') return Buffer.from(text.replace('{', '{"unknown":1,'));
    if (name === 'utf8') return Uint8Array.of(0xff);
    if (name === 'wrong-id') return Buffer.from(text.replace(/"id":\d+/, '"id":999999'));
    return Buffer.from(text.replace('{', '{"error":{},'));
  });
  await assert.rejects(f.rpc.genesis()); f.setRaw(); assert.equal(await f.rpc.genesis(), DEVNET_GENESIS);
});
test('wrong cluster is rejected before broadcast, and clean restoration sends exact signature', async () => {
  const f = await rpcFixture(); f.setMutate((value, method) => method === 'getGenesisHash' ? MAINNET_GENESIS : value);
  await assert.rejects(f.rpc.broadcastIdentical(f.signed.transaction)); assert.equal(f.methods.filter(m => m.method === 'sendTransaction').length, 0);
  f.setMutate(); assert.equal(await f.rpc.broadcastIdentical(f.signed.transaction), f.signed.signature);
});
test('real cluster responses carry transactionIndex: accepted; an unknown extra field is still rejected', async () => {
  const f = await rpcFixture();
  f.setMutate((value, method) => method === 'getTransaction' ? { ...rawTransaction(f.tx), transactionIndex: 7 } : value);
  assert.equal((await f.rpc.finalizedTransaction(f.signed.signature))?.signature, f.signed.signature);
  f.setMutate((value, method) => method === 'getTransaction' ? { ...rawTransaction(f.tx), transactionIndexx: 7 } : value);
  await assert.rejects(f.rpc.finalizedTransaction(f.signed.signature));
});
for (const name of ['version', 'trailing-bytes', 'extra-instructions-meta', 'lookup-accounts', 'unsafe-fee', 'unknown-field', 'missing-owner'] as const) test(`RPC transaction ${name} rejects while clean finalized metadata succeeds`, async () => {
  const f = await rpcFixture(); f.setMutate((value, method) => {
    if (method !== 'getTransaction') return value;
    const tx = rawTransaction(f.tx);
    if (name === 'version') return { ...tx, version: 0 };
    if (name === 'trailing-bytes') return { ...tx, transaction: [Buffer.concat([f.signed.transaction, Buffer.from([0])]).toString('base64'), 'base64'] };
    if (name === 'extra-instructions-meta') return { ...tx, meta: { ...tx.meta, innerInstructions: [{ index: 0, instructions: [] }] } };
    if (name === 'lookup-accounts') return { ...tx, meta: { ...tx.meta, loadedAddresses: { writable: [f.key.publicKey], readonly: [] } } };
    if (name === 'unsafe-fee') return { ...tx, meta: { ...tx.meta, fee: Number.MAX_SAFE_INTEGER + 1 } };
    if (name === 'unknown-field') return { ...tx, extra: true };
    return { ...tx, meta: { ...tx.meta, preTokenBalances: tx.meta.preTokenBalances.map(({ owner: _owner, ...rest }) => rest) } };
  });
  await assert.rejects(f.rpc.finalizedTransaction(f.signed.signature)); f.setMutate(); assert.equal((await f.rpc.finalizedTransaction(f.signed.signature))?.signature, f.signed.signature);
});
test('null transaction/status/fee remain unknown; unknown status and nested fields reject then clean passes', async () => {
  const f = await rpcFixture();
  f.setMutate((value, method) => method === 'getTransaction' ? null : method === 'getFeeForMessage' ? { context: { slot: 1 }, value: null } : method === 'getSignatureStatuses' ? { context: { slot: 1 }, value: [null] } : value);
  assert.equal(await f.rpc.finalizedTransaction(f.signed.signature), null); assert.equal(await f.rpc.feeForMessage(f.payment.message), null); assert.equal((await f.rpc.signatureStatus(f.signed.signature)).status, 'absent');
  f.setMutate((value, method) => method === 'getSignatureStatuses' ? { context: { slot: 1 }, value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: 'invented' }] } : value);
  await assert.rejects(f.rpc.signatureStatus(f.signed.signature));
  f.setMutate(); assert.equal((await f.rpc.signatureStatus(f.signed.signature)).status, 'finalized');
});
test('RPC refuses unpinned HTTP/credential/fragment URLs and oversized response; clean configured HTTPS succeeds', async () => {
  const f = fixture(); const base = { genesis: DEVNET_GENESIS, clock: f.clock, responseBytesMax: 1, transport: async () => Buffer.from('oversize') };
  for (const endpoint of ['http://example.com/', 'https://user:password@example.com/', 'https://example.com/#fragment']) assert.throws(() => createRpcClient({ ...base, endpoint }));
  await assert.rejects(createRpcClient({ ...base, endpoint: 'https://example.com/' }).genesis());
  const clean = await rpcFixture(); assert.equal(await clean.rpc.genesis(), DEVNET_GENESIS);
});
