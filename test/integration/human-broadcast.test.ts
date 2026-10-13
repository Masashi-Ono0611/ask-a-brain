import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../chain/support.ts';
import { HumanSigningHelper, HumanCliSigner, MemorySignJournal, handleHumanSignerMessage, createRpcClient, DEVNET_GENESIS } from '../../src/chain/index.ts';
import { observedRpcTransport } from '../../scripts/chain/human-live-runtime.ts';
import { canonicalBytes, M03, strictJson } from '../../src/wire/index.ts';

for (const mode of ['rpc-error', 'transport-error', 'clean'] as const) test(`send evidence captures request and ${mode} before client parsing`, async () => {
  const f = fixture(), events: {method: string; bytes: Uint8Array}[] = [];
  const result = await f.signer.sign(f.request); assert.equal(result.status, 'signed');
  if (result.status !== 'signed') return;
  const { attachSignature } = await import('../../src/chain/index.ts');
  const signed = attachSignature(f.payment, result);
  let successHooks = 0;
  const rpc = createRpcClient({ endpoint: 'https://primary.example/', genesis: DEVNET_GENESIS, clock: f.clock,
    responseBytesMax: M03.sealedPayloadMax.value * 1024 * 1024, evidence: () => { successHooks++; },
    transport: observedRpcTransport(async (_endpoint, body) => {
      const input = strictJson(body) as {method: string; id: number};
      if (input.method === 'getGenesisHash') return canonicalBytes({jsonrpc: '2.0', id: input.id, result: f.request.genesis});
      if (mode === 'transport-error') throw new Error('private transport details must not appear');
      return canonicalBytes(mode === 'rpc-error' ? {jsonrpc: '2.0', id: input.id, error: {code: -32002, message: 'Blockhash not found'}} : {jsonrpc: '2.0', id: input.id, result: signed.signature});
    }, (method, bytes) => events.push({method, bytes})),
  });
  if (mode === 'clean') assert.equal(await rpc.broadcastIdentical(signed.transaction), signed.signature);
  else await assert.rejects(rpc.broadcastIdentical(signed.transaction));
  assert.equal(successHooks, mode === 'clean' ? 2 : 1);
  assert.deepEqual(events.map(e => e.method), ['getGenesisHashRequest', 'getGenesisHashResponse', 'sendTransactionRequest', mode === 'transport-error' ? 'sendTransactionTransportError' : 'sendTransactionResponse']);
  const sent = strictJson(events[2]!.bytes) as {params: string[]}; assert.equal(sent.params[0], Buffer.from(signed.transaction).toString('base64'));
  assert.ok(!Buffer.concat(events.map(e => Buffer.from(e.bytes))).toString().includes('private transport'));
  f.key.keyBytes.fill(0);
});

for (const expireAt of ['before-prompt', 'approval', 'authorization', 'key-load', 'never'] as const) test(`human expiry at ${expireAt}: no stale signature; clean exact approval signs`, async () => {
  const f = fixture(), journal = new MemorySignJournal(); let height = 1, prompts = 0, loads = 0;
  if (expireAt === 'before-prompt') height = f.request.blockhash.lastValidBlockHeight + 1;
  const helper = new HumanSigningHelper({publicKey: f.key.publicKey, clock: f.clock, journal,
    finalizedHeight: async () => height,
    authorize: async () => {if(expireAt === 'authorization' && prompts) {height=f.request.blockhash.lastValidBlockHeight+1;throw new Error('EXPIRED_DURING_AUTHORIZE');}}, keyBytes: () => {loads++; if (expireAt === 'key-load') height = f.request.blockhash.lastValidBlockHeight + 1; return f.key.keyBytes;},
    terminal: {isTTY: () => true, approve: async display => {
      prompts++; assert.match(display, /Validity countdown: 99 finalized blocks remaining/);
      assert.ok(display.indexOf('Validity countdown:') < display.indexOf('Type approve'));
      if (expireAt === 'approval') height = f.request.blockhash.lastValidBlockHeight + 1;
      return `approve ${f.request.messageHash}`;
    }},
  });
  const client = new HumanCliSigner({endpoint: '/unused', expectedPublicKey: f.key.publicKey}, bytes => handleHumanSignerMessage(bytes, helper));
  if (expireAt === 'never') assert.equal((await client.sign(f.request)).status, 'signed');
  else {
    await assert.rejects(client.sign(f.request), /EXPIRED_BEFORE_APPROVAL/);
    assert.equal(await helper.recover(f.request.requestId, f.request.messageHash), null);
    assert.equal(prompts, expireAt === 'before-prompt' ? 0 : 1); assert.equal(loads, expireAt === 'key-load' ? 1 : 0);
    // Restore only the fake height; this is a guard control, not a live renewal.
    height = 1;
    const clean = new HumanSigningHelper({publicKey: f.key.publicKey, clock: f.clock, journal, finalizedHeight: async () => height,
      authorize: async () => {}, keyBytes: () => f.key.keyBytes, terminal: {isTTY: () => true, approve: async () => `approve ${f.request.messageHash}`}});
    assert.equal((await clean.sign(f.request)).status, 'signed');
  }
  f.key.keyBytes.fill(0);
});

for (const corruption of [true, false]) test(`restart before first dispatch: ${corruption ? 'corrupt' : 'exact'} durable bytes`, async t => {
  const {harness, buyer, input} = await import('../broker/core/harness.ts');
  const h = harness(); t.after(() => h.cleanup());
  const first = await h.api().consult(buyer, input());
  const saved = h.store.read('signed_transactions', first.consult_id)!;
  // Simulate a crash after signature commit, before dispatch metadata commit.
  const {broadcastAttempted: _, ...row} = saved.value as typeof saved.value & {broadcastAttempted?: boolean};
  h.store.transaction(tx => tx.compareAndSet('signed_transactions', first.consult_id, saved.version,
    {...row, transaction_base64: corruption ? Buffer.from('corrupt').toString('base64') : row.transaction_base64}));
  h.reopen(); let reconciliations = 0;
  h.ports = {...h.ports, reconcilePayment: async () => {reconciliations++; return {status: 'pending', reason: 'PAYMENT_UNCERTAIN'};}};
  if (corruption) {
    await assert.rejects(h.api().status(buyer, {consult_id: first.consult_id}), /VERIFICATION_FAILED/);
    assert.equal(h.counts.broadcast, 1); assert.equal(reconciliations, 0);
    const bad = h.store.read('signed_transactions', first.consult_id)!;
    h.store.transaction(tx => tx.compareAndSet('signed_transactions', first.consult_id, bad.version, row)); h.reopen();
  }
  await h.api().status(buyer, {consult_id: first.consult_id});
  assert.equal(h.counts.broadcast, 2); assert.equal(reconciliations, 0);
  assert.equal(new Set(h.broadcastBytes).size, 1); assert.equal(h.counts.sign, 1);
  assert.equal(h.store.read('reservations', first.consult_id)!.value.status, 'held');
});

test('expired approval stays visible with the same quote and held caps; restored clean signer succeeds', async t => {
  const {harness, buyer, input} = await import('../broker/core/harness.ts');
  const bad = harness(), good = harness(); t.after(() => {bad.cleanup(); good.cleanup();});
  bad.behavior.beforeSign = () => {throw new Error('EXPIRED_BEFORE_APPROVAL');};
  const request = input(), expired = await bad.api().consult(buyer, request);
  assert.match(expired.message, /^EXPIRED_BEFORE_APPROVAL:/); assert.equal(bad.counts.broadcast, 0);
  assert.equal(bad.store.scan('signed_transactions', {limit: 1}).length, 0);
  const held = bad.store.read('reservations', expired.consult_id)!.value; assert.equal(held.status, 'held');
  const quote = bad.store.read('consults', expired.consult_id)!.value.broker!.quote;
  bad.reopen(); await bad.api().consult(buyer, request); await bad.api().status(buyer, {consult_id: expired.consult_id});
  assert.deepEqual(bad.store.read('reservations', expired.consult_id)!.value, held);
  assert.deepEqual(bad.store.read('consults', expired.consult_id)!.value.broker!.quote, quote);
  assert.equal(bad.counts.quote, 2); assert.equal(bad.counts.broadcast, 0);
  await good.api().consult(buyer, request); assert.equal(good.counts.sign, 1); assert.equal(good.counts.broadcast, 1);
});

for (const badHeight of [NaN, -1]) test(`invalid height ${String(badHeight)} cannot produce approval; restored observation passes`, async () => {
  const f = fixture(); let height = badHeight, loads = 0, prompts = 0;
  const helper = new HumanSigningHelper({publicKey: f.key.publicKey, clock: f.clock, journal: new MemorySignJournal(),
    finalizedHeight: async () => height, authorize: async () => {}, keyBytes: () => {loads++; return f.key.keyBytes;},
    terminal: {isTTY: () => true, approve: async () => {prompts++; return `approve ${f.request.messageHash}`;}}});
  await assert.rejects(helper.sign(f.request)); assert.equal(loads, 0); assert.equal(prompts, 0);
  height = f.request.blockhash.lastValidBlockHeight; // The final valid height is inclusive.
  assert.equal((await helper.sign(f.request)).status, 'signed'); assert.equal(loads, 1); f.key.keyBytes.fill(0);
});

test('a fresh blockhash changes the message hash and requires a new exact approval phrase', async () => {
  const f = fixture(); const {buildLegacyPayment, generateThrowawayKey} = await import('../../src/chain/index.ts');
  const blockhash = {...f.request.blockhash, blockhash: generateThrowawayKey().publicKey};
  const payment = buildLegacyPayment(f.quote, f.payment.expected.payer, blockhash);
  const request = {...f.request, blockhash, message: payment.message, messageHash: payment.messageHash,
    arm: {...f.request.arm, payload: {...f.request.arm.payload, message_sha256: payment.messageHash, recent_blockhash: blockhash.blockhash}}};
  assert.notEqual(request.messageHash, f.request.messageHash); assert.deepEqual(request.quote, f.request.quote);
  let phrase = `approve ${f.request.messageHash}`, loads = 0;
  const helper = new HumanSigningHelper({publicKey: f.key.publicKey, clock: f.clock, journal: new MemorySignJournal(),
    finalizedHeight: async () => 1, authorize: async () => {}, keyBytes: () => {loads++; return f.key.keyBytes;},
    terminal: {isTTY: () => true, approve: async () => phrase}});
  assert.deepEqual(await helper.sign(request), {status: 'denied', reason: 'APPROVAL_REQUIRED'}); assert.equal(loads, 0);
  phrase = `approve ${request.messageHash}`; assert.equal((await helper.sign(request)).status, 'signed'); assert.equal(loads, 1);
  f.key.keyBytes.fill(0);
});

test('RPC evidence rejects malformed request metadata before recording or dispatch; clean request passes', async () => {
  const clean = {jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: []};
  const bad = [canonicalBytes({...clean, extra: true}), canonicalBytes({...clean, method: '../escape'}),
    canonicalBytes({...clean, id: 0}), canonicalBytes({...clean, jsonrpc: '1.0'}), canonicalBytes({...clean, params: null}),
    Buffer.from('{"id":1,"id":2}'), Uint8Array.from([0xff])];
  for (const bytes of bad) {
    let records = 0, calls = 0;
    const transport = observedRpcTransport(async () => {calls++; return canonicalBytes({result: 'clean'});}, () => {records++;});
    await assert.rejects(transport('https://primary.example/', bytes, new AbortController().signal));
    assert.equal(records, 0); assert.equal(calls, 0);
    await transport('https://primary.example/', canonicalBytes(clean), new AbortController().signal);
    assert.equal(records, 2); assert.equal(calls, 1);
  }
});
