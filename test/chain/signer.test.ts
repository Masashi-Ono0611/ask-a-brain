import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Address, Signer, SignRequest, Store } from '../../src/wire/contracts.ts';
import { bytesHash, M03 } from '../../src/wire/index.ts';
import { openStore } from '../../src/common/index.ts';
import { attachSignature, createHumanCliSigner, DEVNET_GENESIS, generateThrowawayKey, HumanSigningHelper, importCliKey, MAINNET_GENESIS, MemorySignJournal, parseCliKey, renderFrozenMessage, serveHumanSigner, StoreSignJournal, TestSigner } from '../../src/chain/index.ts';
import { fixture } from './support.ts';
function directory(t: { after(fn: () => void): void }) { const path = mkdtempSync(join(tmpdir(), 'aab-chain-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
test('CLI key parser accepts ephemeral full keypair; malformed, seed-only, wrong public half and invalid UTF8 reject', () => {
  const key = generateThrowawayKey(); const bytes = Buffer.from(JSON.stringify([...key.keyBytes]));
  assert.equal(importCliKey(parseCliKey(bytes)).publicKey, key.publicKey);
  for (const bad of [Buffer.from('{}'), Buffer.from('[1,1]'), Buffer.from('[1,1,]'), Uint8Array.of(0xff), Buffer.from(JSON.stringify([...key.keyBytes].map((v, i) => i === 0 ? -1 : v)))]) assert.throws(() => parseCliKey(bad));
  const altered = Uint8Array.from(key.keyBytes); altered[63] = altered[63]! ^ 1; assert.throws(() => importCliKey(altered));
  assert.throws(() => importCliKey(key.keyBytes.slice(0, 32))); assert.throws(() => importCliKey(key.keyBytes, generateThrowawayKey().publicKey));
  assert.equal(importCliKey(parseCliKey(bytes)).publicKey, key.publicKey);
});
test('TestSigner rejects mainnet, disguised mainnet genesis and unknown cluster before loading any key; clean devnet signs', async () => {
  const f = fixture(); let loads = 0;
  const config = { network: 'devnet' as const, genesis: DEVNET_GENESIS, publicKey: f.key.publicKey, keyBytes: () => { loads++; return f.key.keyBytes; } };
  const signer = new TestSigner(config);
  for (const patch of [{ network: 'mainnet-beta' }, { genesis: MAINNET_GENESIS }, { genesis: f.key.publicKey }]) {
    assert.deepEqual(await signer.sign({ ...f.request, ...patch } as SignRequest), { status: 'denied', reason: 'NETWORK_MISMATCH' }); assert.equal(loads, 0);
  }
  assert.throws(() => new TestSigner({ ...config, genesis: MAINNET_GENESIS }));
  const signed = await signer.sign(f.request); assert.equal(signed.status, 'signed'); assert.equal(loads, 1); attachSignature(f.payment, signed);
  assert.deepEqual(await signer.recover(f.request.requestId, f.request.messageHash), signed);
});
for (const field of ['requestId', 'quoteId', 'messageHash', 'manifestHash', 'registryHash', 'reservationId', 'arm', 'offerApproval', 'maximumFee', 'estimatedFee', 'extra'] as const) test(`sign request binding ${field} rejects before key use, clean counterpart signs`, async () => {
  const f = fixture(); let reads = 0; const signer = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: f.key.publicKey, keyBytes: () => { reads++; return f.key.keyBytes; } });
  let bad: SignRequest = structuredClone(f.request);
  switch (field) {
    case 'arm': bad = { ...bad, arm: { ...bad.arm, payload: { ...bad.arm.payload, last_valid_block_height: bad.blockhash.lastValidBlockHeight + 1 } } }; break;
    case 'offerApproval': bad = { ...bad, offerApproval: { ...bad.offerApproval, status: 'denied' } }; break;
    case 'maximumFee': bad = { ...bad, maximumFee: String(M03.feePerPurchaseMax.value + 1n) as never }; break;
    case 'estimatedFee': bad = { ...bad, estimatedFee: String(M03.feePerPurchaseMax.value + 1n) as never }; break;
    default: bad = { ...bad, [field]: field === 'reservationId' ? 'bad\ncontrol' : 'invalid' }; break;
  }
  await assert.rejects(signer.sign(bad)); assert.equal(reads, 0); assert.equal((await signer.sign(f.request)).status, 'signed'); assert.equal(reads, 1);
});
test('human exact digest TTY approval, pinned authorization, pre/post display check, frozen copy and no second prompt after recovery', async () => {
  const f = fixture(); let prompts = 0; let loads = 0; let checks = 0; let tty = false;
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => { loads++; return f.key.keyBytes; }, clock: f.clock, journal: new MemorySignJournal(),
    authorize: async () => { checks++; }, terminal: { isTTY: () => tty, approve: async display => { prompts++; assert.ok(display.includes(Buffer.from(f.payment.message).toString('base64'))); return `approve ${f.request.messageHash}`; } } });
  assert.equal((await helper.sign(f.request)).status, 'denied'); assert.equal(loads, 0); assert.equal(prompts, 0);
  tty = true; const result = await helper.sign(f.request); assert.equal(result.status, 'signed'); assert.equal(checks, 3); assert.equal(loads, 1); assert.equal(prompts, 1);
  assert.deepEqual(await helper.sign(f.request), result); assert.deepEqual(await helper.recover(f.request.requestId, f.request.messageHash), result); assert.equal(prompts, 1);
  await assert.rejects(helper.recover(f.request.requestId, bytesHash(Buffer.from('changed'))));
  attachSignature(f.payment, result); assert.ok(renderFrozenMessage(f.request).includes('marketplaceTokenAccount'));
});
for (const mode of ['wrong-approval', 'expired-during-review', 'authorization-failure', 'store-failure'] as const) test(`human ${mode} returns no signature; clean restored control persists before returning`, async () => {
  const f = fixture(); let bad = true; let reads = 0; let writes = 0; const memory = new MemorySignJournal();
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => { reads++; return f.key.keyBytes; }, clock: f.clock,
    journal: { read: (id, hash) => memory.read(id, hash), write: (r, s) => { if (bad && mode === 'store-failure') throw new Error('STORE_FAILED'); memory.write(r, s); writes++; } },
    authorize: async () => { if (bad && mode === 'authorization-failure') throw new Error('REVOKED_OR_POLICY'); },
    terminal: { isTTY: () => true, approve: async () => { if (bad && mode === 'expired-during-review') f.clock.advance(M03.quoteTtl.value * 1000); return bad && mode === 'wrong-approval' ? 'yes' : `approve ${f.request.messageHash}`; } } });
  if (mode === 'wrong-approval') assert.equal((await helper.sign(f.request)).status, 'denied'); else await assert.rejects(helper.sign(f.request));
  assert.equal(writes, 0); assert.equal(await helper.recover(f.request.requestId, f.request.messageHash), null); assert.equal(reads, mode === 'store-failure' ? 1 : 0);
  bad = false;
  const clean = mode === 'expired-during-review' ? fixture() : f;
  const control = new HumanSigningHelper({ publicKey: clean.key.publicKey, keyBytes: () => clean.key.keyBytes, clock: clean.clock, journal: memory, authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => `approve ${clean.request.messageHash}` } });
  assert.equal((await control.sign(clean.request)).status, 'signed'); assert.ok(await control.recover(clean.request.requestId, clean.request.messageHash));
});
test('FULL/WAL journal survives helper restart/lost reply; concurrent same request signs once; changed request cannot replace it', async t => {
  const f = fixture(); const path = join(directory(t), 'helper.db'); let store = openStore(path); t.after(() => store.close()); let prompts = 0;
  const make = (s: Store) => new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal: new StoreSignJournal(s), authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => { prompts++; return `approve ${f.request.messageHash}`; } } });
  const helper = make(store); const [first, duplicate] = await Promise.all([helper.sign(f.request), helper.sign(f.request)]); assert.deepEqual(first, duplicate); assert.equal(prompts, 1);
  store.close(); store = openStore(path); const recovered = await make(store).recover(f.request.requestId, f.request.messageHash); assert.deepEqual(recovered, first); assert.equal(prompts, 1);
  await assert.rejects(make(store).recover(f.request.requestId, bytesHash(Buffer.from('substitution'))));
  assert.ok(store.read('signed_transactions', f.request.requestId)?.value.transaction_base64); attachSignature(f.payment, recovered!);
});
test('caller cannot substitute bytes while helper awaits approval; sign frozen original and reject changed attachment', async () => {
  const f = fixture(); let release: ((value: string) => void) | undefined;
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal: new MemorySignJournal(), authorize: async () => {}, terminal: { isTTY: () => true, approve: () => new Promise(resolve => { release = resolve; }) } });
  const input = structuredClone(f.request); const pending = helper.sign(input);
  while (!release) await new Promise(resolve => setImmediate(resolve)); input.message[0] = input.message[0]! ^ 1; release(`approve ${f.request.messageHash}`);
  const result = await pending; attachSignature(f.payment, result); await assert.rejects(helper.sign(input));
});
test('protected Unix IPC signs/retrieves same signature; insecure socket parent and malicious helper substitution fail', async t => {
  const f = fixture(); const root = directory(t); const endpoint = join(root, 'signer.sock');
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal: new MemorySignJournal(), authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => `approve ${f.request.messageHash}` } });
  let server;
  try { server = await serveHumanSigner(endpoint, helper); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('UNVERIFIED: sandbox denies Unix socket listen (EPERM); lead must run on host'); return; } throw error; }
  t.after(() => server.close());
  const client = createHumanCliSigner({ endpoint, expectedPublicKey: f.key.publicKey }); assert.equal(await client.publicKey(), f.key.publicKey);
  const signed = await client.sign(f.request); assert.deepEqual(await client.recover(f.request.requestId, f.request.messageHash), signed); attachSignature(f.payment, signed);
  chmodSync(root, 0o755); await assert.rejects(client.publicKey()); chmodSync(root, 0o700); assert.equal(await client.publicKey(), f.key.publicKey);
  const malicious: Signer = { publicKey: async () => f.key.publicKey, recover: async () => null, sign: async () => ({ ...signed, status: 'signed', publicKey: f.quote.payload.seller_owner } as never) };
  const otherPath = join(root, 'bad.sock'); const badServer = await serveHumanSigner(otherPath, malicious); t.after(() => badServer.close());
  await assert.rejects(createHumanCliSigner({ endpoint: otherPath, expectedPublicKey: f.key.publicKey }).sign(f.request));
  assert.deepEqual(await client.sign(f.request), signed);
});

test('injected IPC uses identical strict envelope, rejects duplicate/unknown/UTF8 and returned substitution, clean signs and recovers', async () => {
  const { HumanCliSigner, handleHumanSignerMessage } = await import('../../src/chain/index.ts');
  const f = fixture(); const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal: new MemorySignJournal(), authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => `approve ${f.request.messageHash}` } });
  for (const bytes of [Buffer.from('{"operation":"publicKey","operation":"sign","value":null}'), Buffer.from('{"operation":"publicKey","value":null,"extra":true}'), Uint8Array.of(0xff)]) {
    assert.deepEqual(JSON.parse(Buffer.from(await handleHumanSignerMessage(bytes, helper)).toString()), { ok: false, result: null });
    assert.equal(JSON.parse(Buffer.from(await handleHumanSignerMessage(Buffer.from('{"operation":"publicKey","value":null}'), helper)).toString()).result, f.key.publicKey);
  }
  let substitute = true;
  const client = new HumanCliSigner({ endpoint: '/injected-only.sock', expectedPublicKey: f.key.publicKey }, async bytes => {
    const result = await handleHumanSignerMessage(bytes, helper);
    if (!substitute) return result;
    const row = JSON.parse(Buffer.from(result).toString()); if (row.result?.status === 'signed') row.result.messageHash = bytesHash(Buffer.from('substitution'));
    return Buffer.from(JSON.stringify(row));
  });
  await assert.rejects(client.sign(f.request)); substitute = false;
  const good = await client.sign(f.request); attachSignature(f.payment, good);
  assert.deepEqual(await client.recover(f.request.requestId, f.request.messageHash), good);
});

test('expiry during final asynchronous authorization blocks signature/journal; unchanged clock control succeeds', async () => {
  const f = fixture(); let checks = 0; const journal = new MemorySignJournal();
  const helper = new HumanSigningHelper({ publicKey: f.key.publicKey, keyBytes: () => f.key.keyBytes, clock: f.clock, journal,
    authorize: async () => { if (++checks === 3) f.clock.advance(M03.quoteTtl.value * 1000); }, terminal: { isTTY: () => true, approve: async () => `approve ${f.request.messageHash}` } });
  await assert.rejects(helper.sign(f.request), /QUOTE_EXPIRED/); assert.equal(await helper.recover(f.request.requestId, f.request.messageHash), null);
  const clean = fixture(); const control = new HumanSigningHelper({ publicKey: clean.key.publicKey, keyBytes: () => clean.key.keyBytes, clock: clean.clock, journal: new MemorySignJournal(), authorize: async () => {}, terminal: { isTTY: () => true, approve: async () => `approve ${clean.request.messageHash}` } });
  assert.equal((await control.sign(clean.request)).status, 'signed');
});
