import type { SellerConfig } from '../../src/seller/index.ts';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FixedClock, openStore, atomicFromBigint, lamportsFromBigint, FoundationError } from '../../src/common/index.ts';
import { M03, payloadHash, bytesHash, canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { FakeRpcClient, generateThrowawayKey, TestSigner, StoreSignJournal, DEVNET_GENESIS, validateLegacyMessage, validateSignRequest, reconcilePayment, fakeMint, fakeTokenAccount } from '../../src/chain/index.ts';
import { createExtractiveWorker } from '../../src/seller/index.ts';
import { createSellerHttpClient } from '../../src/broker/index.ts';
import { composeSeller } from '../../scripts/seller.ts';
import { composeBroker } from '../../scripts/broker.ts';
import { syntheticMarket, wire, id } from '../../scripts/integration/synthetic.ts';
import type { BrokerDeps, BuyerContext, ConsultInput, RpcClient, Revocation, Signer, Store, StoreTx, ProofLocator } from '../../src/wire/contracts.ts';

export async function harness(restoreDirectory?: string, content?: string) {
  const directory = restoreDirectory ?? mkdtempSync(join(tmpdir(), 'aab-t11-'));
  const restored = restoreDirectory ? strictJson(readFileSync(join(directory,'public-recovery.json'))) as unknown as { clock: string; addresses: import('../../scripts/integration/synthetic.ts').Addresses; questions: import('../../src/wire/contracts.ts').QuestionPolicy; registry: import('../../src/wire/contracts.ts').Registry; sellers: {listing: import('../../src/wire/contracts.ts').Listing; bundle: Omit<import('../../src/wire/contracts.ts').SealedBundle,'files'> & {files:[string,string][]}}[] } : null;
  const clock = new FixedClock(restored?.clock ?? '2026-10-09T23:59:00.000Z');
  const key = restored ? { publicKey: restored.addresses.buyer, keyBytes: new Uint8Array() } : generateThrowawayKey(), pub = () => generateThrowawayKey().publicKey;
  const addresses = restored?.addresses ?? { buyer: key.publicKey, seller: pub(), marketplace: pub(), mint: pub(), buyerAta: pub(), sellerAta: pub(), marketplaceAta: pub() };
  const fixture = restored ? { questions: restored.questions, registry: restored.registry, sellers: restored.sellers.map(s=>({...s,bundle:{...s.bundle,files:new Map(s.bundle.files.map(([k,v])=>[k,Buffer.from(v,'base64')]))},signer:{async sign():Promise<never>{throw new Error('RECOVERY_MUST_NOT_RESEAL');}}})) } : syntheticMarket(clock, addresses, ['https://decline.invalid', 'https://ready.invalid'], [generateThrowawayKey().keyBytes, generateThrowawayKey().keyBytes], content);
  const buyer: BuyerContext = { buyer_id: id('test-buyer'), payer: key.publicKey, session_id: id('test-session') };
  const counts = { accounts: 0, seller: 0, sign: 0, broadcast: 0, rpc: 0, approve: 0 };
  const faults = { lostSign: false, substituteSign: false, lostBroadcast: false, lostAnswer: false, failSecond: false, denyApproval: false, failStorage: false, failBeforeSign: false, corruptAnswer: false, accountFault: '' as '' | 'owner' | 'mint' | 'decimals', freshObservations: false };
  const broadcastBytes: string[] = [];
  let primary: FakeRpcClient | undefined, secondary: FakeRpcClient | undefined;
  const blockhash = { blockhash: pub(), lastValidBlockHeight: 100, observedAt: clock.now() };
  const rpc = (which: 'primary' | 'secondary'): RpcClient & { origin: string } => {
    const get = () => which === 'primary' ? primary! : secondary!;
    return { origin: `https://${which}.invalid`, async genesis() { counts.rpc++; return DEVNET_GENESIS; }, async latestBlockhash() { counts.rpc++; return { ...blockhash, observedAt: clock.now() }; }, async finalizedHeight() { counts.rpc++; return primary?.state.height ?? 1; }, async feeForMessage() { counts.rpc++; return lamportsFromBigint(5000n); }, async accounts(a) {
      counts.rpc++; counts.accounts++;
      const rows = new Map([
        [addresses.mint, fakeMint(addresses.mint)],
        [addresses.buyerAta, fakeTokenAccount(addresses.buyerAta, addresses.mint, addresses.buyer, M03.devnetPrincipalPerDay.value)],
        [addresses.sellerAta, fakeTokenAccount(addresses.sellerAta, addresses.mint, addresses.seller, 0n)],
        [addresses.marketplaceAta, fakeTokenAccount(addresses.marketplaceAta, addresses.mint, addresses.marketplace, 0n)],
      ]);
      if (faults.accountFault === 'owner') rows.set(addresses.sellerAta, fakeTokenAccount(addresses.sellerAta, addresses.mint, addresses.buyer, 0n));
      if (faults.accountFault === 'mint') rows.set(addresses.sellerAta, fakeTokenAccount(addresses.sellerAta, addresses.buyer, addresses.seller, 0n));
      if (faults.accountFault === 'decimals') { const mint = rows.get(addresses.mint)!; const data = Buffer.from(mint.data); data[44] = M03.tokenDecimals.value + 1; rows.set(addresses.mint, { ...mint, data }); }
      return { slot: 1, observedAt: clock.now(), accounts: a.map(key => rows.get(key) ?? null) };
    }, async signatureStatus(s) { counts.rpc++; return get().signatureStatus(s); }, async finalizedTransaction(s) {
      counts.rpc++; const tx = await get().finalizedTransaction(s); if (!tx) return null;
      if (faults.freshObservations) clock.advance(1);
      return { ...tx, observedAt: faults.freshObservations ? clock.now() : tx.observedAt,
        meta: tx.meta };
    }, async broadcastIdentical(b) {
      counts.broadcast++; broadcastBytes.push(Buffer.from(b).toString('base64'));
      const result = await get().broadcastIdentical(b); if (faults.lostBroadcast) throw new Error('INJECTED_LOST_BROADCAST_RESPONSE'); return result;
    } };
  };
  const primaryRpc = rpc('primary'), secondaryRpc = rpc('secondary');
  let brokerStore = openStore(join(directory, 'broker.db')), signerStore = openStore(join(directory, 'signer.db'));
  const store: Store = { read: (...args) => brokerStore.read(...args), scan: (...args) => brokerStore.scan(...args), checkpoint: () => brokerStore.checkpoint(), close: () => brokerStore.close(), transaction<T>(body: (tx: StoreTx) => T): T {
    if (faults.failStorage) throw new FoundationError('RECEIPT_STORE_UNAVAILABLE'); return brokerStore.transaction(tx => body({ ...tx, compareAndSet(table, k, version, row) {
      if (faults.failBeforeSign && table === 'consults' && 'broker' in row && row.broker?.stage === 'signing') throw new FoundationError('RECEIPT_STORE_UNAVAILABLE');
      tx.compareAndSet(table, k, version, row);
    } }));
  } };
  if (restored) {
    const journal = brokerStore.scan('consults',{limit:100}).find(r=>r.value.broker?.messageHash)?.value.broker;
    if(!journal?.quote || !journal.blockhash || !journal.messageHash) throw new Error('MISSING_CRASH_JOURNAL');
    const expected={quote:journal.quote,payer:{payer:addresses.buyer,tokenAccount:addresses.buyerAta},blockhash:journal.blockhash,messageHash:journal.messageHash};
    primary=new FakeRpcClient({origin:primaryRpc.origin,expected,clock,fee:lamportsFromBigint(5000n)});
    secondary=new FakeRpcClient({origin:secondaryRpc.origin,expected,clock,fee:lamportsFromBigint(5000n),state:primary.state});
  }
  let realSigner = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: key.publicKey, keyBytes: () => key.keyBytes }, new StoreSignJournal(signerStore));
  const signer: Signer = { publicKey: () => realSigner.publicKey(), recover: (r,h) => realSigner.recover(r,h), async sign(request) {
    counts.sign++; const expected = validateSignRequest(request);
    primary = new FakeRpcClient({ origin: primaryRpc.origin, expected, clock, fee: request.estimatedFee });
    secondary = new FakeRpcClient({ origin: secondaryRpc.origin, expected, clock, fee: request.estimatedFee, state: primary.state });
    if (faults.failSecond) { const a = primary.state.accounts.get(addresses.marketplaceAta)!; const data = Buffer.from(a.data); data[108] = 2; primary.state.accounts.set(a.address, { ...a, data }); }
    const result = await realSigner.sign(request); if (faults.lostSign) throw new Error('INJECTED_LOST_SIGN_RESPONSE'); return faults.substituteSign && result.status === 'signed' ? { ...result, messageHash: bytesHash(Buffer.from('substitution')) } : result;
  } };
  const sellerRows = await Promise.all(fixture.sellers.map(async (s, n) => {
    let db = openStore(join(directory, `seller-${n}.db`)); const token = randomUUID(); const tombstones: Revocation[] = [];
    const config: SellerConfig = { rpcOrigins: [primaryRpc.origin, secondaryRpc.origin], origin: s.listing.endpoint, limits: M03, wire, listing: s.listing, registryVersion: fixture.registry.registry_version,
      invitations: [{ origin: s.listing.endpoint, buyer, token_sha256: bytesHash(Buffer.from(token)) }], sealActor: 'test',
      authority: async () => ({ generation: tombstones.reduce((g,r) => Math.max(g,r.generation),0), tombstones_sha256: payloadHash(tombstones), acknowledged_at: clock.now() }), clockSkewMs: () => 0,
      payerAccounts: () => ({ payer: buyer.payer, tokenAccount: addresses.buyerAta }), validateMessage: validateLegacyMessage, reconcile: reconcilePayment,
      worker: createExtractiveWorker(s.bundle, { origin: s.listing.endpoint, limits: M03, wire }), scanOutput: async () => {} };
    const deps = () => ({ bundle: s.bundle, config, signer: s.signer, store: db, clock, primaryRpc, secondaryRpc, tombstones: { readAll: async () => structuredClone(tombstones), append: async (r: Revocation) => { tombstones.push(r); } } });
    let composed = await composeSeller(deps());
    const fetchPort: typeof fetch = async (input, init) => {
      counts.seller++; const url = new URL(String(input)), headers = new Headers(init?.headers);
      const result = await composed.handler({ method: init?.method ?? 'GET', origin: url.origin, path: url.pathname, peerIp: 'synthetic-peer', body: init?.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0), authorization: headers.get('authorization') ?? '', contentType: headers.get('content-type') ?? '', options: init?.signal ? { signal: init.signal } : {} });
      if (faults.lostAnswer && url.pathname.endsWith('/answer')) throw new Error('INJECTED_LOST_ANSWER_RESPONSE');
      let body = result.body;
      if (faults.corruptAnswer && url.pathname.endsWith('/answer')) body = Buffer.from(Buffer.from(body).toString().replace('確認', '改変'));
      return new Response(Buffer.from(body), { status: result.status, headers: result.headers });
    };
    const client = createSellerHttpClient({ origin: s.listing.endpoint, invitation: token, clock, fetch: fetchPort });
    return { ...s, client, config, tombstones, journal: deps().tombstones, get store() { return db; }, get controller() { return composed.controller; }, async reopen(restoredPath?: string) { db.close(); db = openStore(restoredPath ?? join(directory, `seller-${n}.db`)); composed = await composeSeller(deps()); }, close() { db.close(); } };
  }));
  const deps: BrokerDeps = { store, clock, signer, primaryRpc, secondaryRpc, registry: fixture.registry, questionPolicy: fixture.questions, sellers: new Map(sellerRows.map(s => [s.listing.endpoint, s.client])),
    policy: { policy_id: id('test-policy'), buyer, registry_sha256: payloadHash(fixture.registry), question_policy_sha256: payloadHash(fixture.questions), networks: ['devnet'], principal_per_call: atomicFromBigint(M03.devnetPrincipalPerCall.value), principal_per_day: atomicFromBigint(M03.devnetPrincipalPerDay.value), fee_per_call: lamportsFromBigint(M03.feePerPurchaseMax.value), fee_per_day: lamportsFromBigint(M03.devnetFeePerDayMax.value), mainnet_enabled: false },
    offerApproval: { async review(offer) { counts.approve++; return { status: faults.denyApproval ? 'denied' : 'approved', actor: 'test', at: clock.now(), reviewedHash: offer.quoteHash, approvalRef: id('test-offer') }; } },
    receiptImporter: { async importReceipt() { return { status: 'import_pending', code: 'NOT_READY' }; }, async readback() { return null; } } };
  const options = { payer: { payer: buyer.payer, tokenAccount: addresses.buyerAta }, rpcOrigins: [primaryRpc.origin, secondaryRpc.origin] as const, authorizeHuman: () => false,
    verifyRun: async (): Promise<never> => { throw new Error('NO_CHECKER_AUTHORITY'); }, verifyRefund: async (): Promise<never> => { throw new Error('NO_REFUND_AUTHORITY'); } };
  let broker = composeBroker(deps, options);
  return { directory, clock, fixture, addresses, buyer, counts, faults, broadcastBytes, store, deps, sellerRows,
    get broker() { return broker; }, get primary() { return primary!; }, get secondary() { return secondary!; },
    request(question = 0): ConsultInput { return { request_id: randomUUID() as ConsultInput['request_id'], question_id: id(`q${question}`), max_price: { network: 'devnet', asset_id: addresses.mint, amount_atomic: atomicFromBigint(M03.totalAtomic.value) } }; },
    proof(): ProofLocator { const row = store.scan('consults', { limit: 100 }).find(r => r.value.broker?.quote)?.value; if (!row?.broker?.quote || !row.view) throw new Error('NO_QUOTE'); const signed = store.read('signed_transactions', row.view.consult_id)!.value, arm = store.read('arms', row.view.consult_id)!.value.arm;
      return { v: 1, consult_id: row.view.consult_id, quote_id: row.broker.quote.payload.quote_id, quote_sha256: payloadHash(row.broker.quote.payload), arm_ticket_sha256: payloadHash(arm.payload), network: 'devnet', genesis_hash: DEVNET_GENESIS, transaction_signature: signed.signature, message_sha256: signed.message_sha256 }; },
    rebuild() { broker = composeBroker(deps, options); },
    async reopen() { brokerStore.close(); signerStore.close(); brokerStore = openStore(join(directory, 'broker.db')); signerStore = openStore(join(directory, 'signer.db')); realSigner = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: key.publicKey, keyBytes: () => key.keyBytes }, new StoreSignJournal(signerStore)); for (const row of sellerRows) await row.reopen(); broker = composeBroker(deps, options); },
    savePublicRecovery() { writeFileSync(join(directory,'public-recovery.json'),canonicalBytes({clock:clock.now(),addresses,questions:fixture.questions,registry:fixture.registry,sellers:fixture.sellers.map(s=>({listing:s.listing,bundle:{...s.bundle,files:[...s.bundle.files].map(([k,v])=>[k,Buffer.from(v).toString('base64')])}}))}),{mode:0o600}); },
    cleanup() { brokerStore.close(); signerStore.close(); for (const row of sellerRows) row.close(); key.keyBytes.fill(0); rmSync(directory, { recursive: true, force: true }); } };
}
export async function settle<T>(h: Pick<Awaited<ReturnType<typeof harness>>, 'clock'>, action: Promise<T>): Promise<T> {
  let done = false; void action.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 1000 && !done; i++) { await new Promise<void>(resolve => setImmediate(resolve)); h.clock.advance(10); }
  if (!done) throw new Error('SYNTHETIC_DEADLOCK'); return action;
}
