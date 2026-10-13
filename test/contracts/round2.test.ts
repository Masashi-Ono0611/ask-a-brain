import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { M03, canonicalBytes, validatePayload, validateWire, payloadHash } from '../../src/wire/index.ts';
import type { Id, IsoTime, JsonValue, Revocation, SellerClient } from '../../src/wire/contracts.ts';
import { fixture as sellerFixture, settle } from '../seller/support.ts';
import { fixture as receiptFixture, declined } from '../broker/receipts/fixture.ts';
import { harness, buyer, input } from '../broker/core/harness.ts';
import { prepareAnswer, createSellerService, FileTombstoneJournal } from '../../src/seller/index.ts';
import { createOutcomeService, observations } from '../../src/broker/outcomes/index.ts';
import { validateTombstones, verifyTombstoneAttestation, openStore, STORE_MIGRATIONS } from '../../src/common/index.ts';
const id = (s: string): Id => s as Id;

test('shared receipt schema admits selected unpaid bindings and free decline; rejects fabricated payment/verification and partial bindings', (t) => {
  const f = receiptFixture(t); const free = { ...declined(f.receipt), explorer_url: null };
  const selected = { ...free, seller_id: f.receipt.seller_id, quote_id: f.receipt.quote_id, quote_sha256: f.receipt.quote_sha256,
    answer_sha256: f.receipt.answer_sha256, manifest_sha256: f.receipt.manifest_sha256,
    verified: { chain: false, seller_signature: true, answer_commitment: false, source_hashes: false } };
  assert.throws(() => validateWire('receipt', { ...free, question: '' }));
  assert.throws(() => validateWire('receipt', { ...free, content_redacted_at: f.clock.now() }));
  assert.equal(validateWire('receipt', free).quote_id, null);
  assert.equal(validateWire('receipt', selected).quote_id, f.receipt.quote_id);
  for (const patch of [{ total_atomic: '1' }, { settlement: f.receipt.settlement }, { seller_id: null }, { quote_sha256: null }, { transaction_signature: f.receipt.transaction_signature }, { verified: { ...selected.verified, chain: true } }, { surprise: true }]) {
    assert.throws(() => validateWire('receipt', { ...selected, ...patch }));
    assert.equal(validateWire('receipt', selected).payment_state, 'not_applicable');
  }
  assert.throws(() => validateWire('receipt', { ...free, answer_sha256: selected.answer_sha256 }));
});

test('seller-prepared answer passes REAL shared validator; unrendered answer fails and exact bytes pass again', (t) => {
  const f = sellerFixture(t);
  const result = prepareAnswer(f.bundle, f.questions[0]!, { ...f.context(), commitment_salt: randomBytes(32).toString('base64url') }, f.config);
  assert.ok(!('status' in result));
  assert.deepEqual(validatePayload('answer', result.answer), result.answer);
  assert.throws(() => validatePayload('answer', { ...result.answer, answer: result.answer.claims[0]!.text }));
  assert.deepEqual(validatePayload('answer', result.answer), result.answer);
});

test('native UNKNOWN outcome stores run evidence, rejects mismatched evidence and appends linked correction after restart', async (t) => {
  const f = receiptFixture(t); f.save(); let verdict: 'unknown' | 'pass' = 'unknown'; let mismatch = true;
  const runHash = payloadHash({ run: 'synthetic' });
  const api = () => createOutcomeService({ store: f.store, clock: f.clock, buyer: f.buyer, authorizeHuman: () => true,
    verifyRun: async () => ({ run_sha256: mismatch ? payloadHash({ bad: true }) : runHash, verdict }), verifyRefund: async () => { throw new Error('unused'); } });
  await assert.rejects(api().observeRun('replay', f.consultId, runHash), /VERIFICATION_FAILED/);
  mismatch = false; const unknown = await api().observeRun('replay', f.consultId, runHash);
  assert.equal(unknown.useful, null); assert.equal(validateWire('outcome', unknown).verdict, 'unknown');
  assert.throws(() => validateWire('outcome', { ...unknown, useful: false }));
  assert.throws(() => validateWire('outcome', { ...unknown, run_sha256: null }));
  await assert.rejects(api().observeRun('replay', f.consultId, runHash), /IDEMPOTENCY_CONFLICT/);
  f.reopen(); verdict = 'pass';
  await assert.rejects(api().observeRun('replay', f.consultId, runHash, id('wrong')), /STATE_CONFLICT/);
  const correction = await api().observeRun('replay', f.consultId, runHash, unknown.feedback_id);
  assert.equal(correction.corrects, unknown.feedback_id); assert.equal(correction.useful, true);
  assert.equal(observations(f.store, f.consultId).length, 2);
});

test('broker aborts slow cooperative seller with deadline and releases active lease; restored seller can purchase', async (t) => {
  const h = harness(); t.after(() => h.cleanup()); const original = h.deps;
  let started = false, cancelled = false; let deadline: IsoTime | undefined;
  const sellers = new Map(h.deps.sellers), good = sellers.get('https://b.invalid')!;
  const slow: SellerClient = { ...good, async quote(_buyer, _input, _ip, options) {
    started = true; deadline = options?.deadline; assert.ok(options?.signal);
    await new Promise((_, reject) => options.signal!.addEventListener('abort', () => { cancelled = true; reject(options.signal!.reason); }, { once: true }));
    throw new Error('unreachable');
  } };
  sellers.set('https://b.invalid', slow); h.deps = { ...h.deps, sellers };
  const pending = h.api().consult(buyer, input());
  while (!started) await new Promise<void>((r) => setImmediate(r));
  h.clock.advance(M03.precheckMax.value * 1000); const result = await pending;
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(cancelled, true); assert.equal(deadline, h.clock.now()); assert.equal(result.dispositions[1]!.status, 'unavailable');
  const leases = h.store.scan('free_checks', { where: { seller_id: id('b'), window: 'active' }, limit: 10 });
  assert.equal(leases.length, 1); assert.equal(leases[0]!.value.count, 0);
  assert.equal(h.counts.sign, 0); h.deps = original;
  assert.equal((await h.api().consult(buyer, input(2))).payment_state, 'payment_pending');
  const receipt = h.store.scan('receipts', { limit: 10 }).find((r) => r.value.payment_state === 'payment_pending')!.value;
  assert.ok(receipt.approval_ref);
});

test('seller cancellation reaches slow worker, prevents quote commit and releases admission; clean worker succeeds', async (t) => {
  const f = sellerFixture(t); let workerStarted = false, aborted = false, slow = true;
  const service = createSellerService({ ...f.deps, config: { ...f.config, worker: { async prepare(_q, _ctx, signal) {
    if (!slow) return f.config.worker.prepare(_q, _ctx, signal);
    workerStarted = true;
    return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  } } } });
  await service.start(); const abort = new AbortController(); const request = f.request();
  const pending = service.quote(f.buyer, request, undefined, { signal: abort.signal });
  while (!workerStarted) await new Promise<void>((r) => setImmediate(r));
  abort.abort(); await assert.rejects(pending); await new Promise<void>((r) => setImmediate(r));
  assert.equal(aborted, true); assert.equal(f.store.scan('quotes', { limit: 10 }).length, 0);
  slow = false; assert.equal((await settle(f, service.quote(f.buyer, f.request()))).status, 'ready');
});

test('newest attestation uses code-point digest ordering and exact generation; injected journal authority restores readiness', async (t) => {
  const f = sellerFixture(t); const base = f.revocation();
  const rows: Revocation[] = [{ ...base, slice_id: id('a'), generation: 2 }, { ...base, slice_id: id('Z'), generation: 1 }];
  const sorted = validateTombstones(rows); assert.equal(sorted[0]!.slice_id, 'Z');
  const attestation = { generation: 2, tombstones_sha256: payloadHash(sorted as unknown as JsonValue), acknowledged_at: f.clock.now() };
  assert.throws(() => verifyTombstoneAttestation(rows, { ...attestation, generation: 3 }, f.clock.now()), /NOT_READY/);
  verifyTombstoneAttestation(rows, attestation, f.clock.now());
  const journal = new FileTombstoneJournal(`${f.directory}/independent`, f.wire, async () => ({ generation: 0, tombstones_sha256: payloadHash([]), acknowledged_at: f.clock.now() }));
  journal.initializeEmpty();
  const service = createSellerService({ ...f.deps, tombstones: journal, config: { ...f.config, authority: async () => { throw new Error('legacy authority must not run'); } } });
  await service.start(); assert.equal(await service.ready(), true);
});

test('003 broker cleanup rejects premature paid cleanup, erases historical/current prose on revocation, retains money and survives restart', (t) => {
  const f = receiptFixture(t, true); f.save();
  f.store.transaction((tx) => tx.insert('settlements', f.consultId, f.receipt.settlement!));
  const before = f.current(); const req = { receipt_id: before.receipt_id, expectedVersion: f.store.read('receipts', before.receipt_id)!.version, now: f.clock.now() };
  assert.throws(() => f.store.cleanupBrokerContent(req), /NOT_READY/);
  assert.equal(f.current().question, before.question);
  const tombstone: Revocation = { slice_id: f.quote.payload.slice_id, manifest_sha256: f.quote.payload.manifest_sha256, generation: 1, revoked_at: f.clock.now(), reason: 'rights', approval_id: id('withdrawal') };
  f.store.transaction((tx) => tx.insert('tombstones', 'withdrawal', tombstone));
  const result = f.store.cleanupBrokerContent(req); assert.equal(result.reason, 'revoked'); assert.ok(result.artifacts_redacted > 0);
  assert.equal(f.current().question, ''); assert.deepEqual(f.current().artifact_refs, {}); assert.equal(f.current().total_atomic, before.total_atomic);
  assert.equal(f.store.read('consults', f.consultId)!.value.view!.answer, null);
  assert.deepEqual(f.store.read('settlements', f.consultId)!.value, before.settlement);
  assert.deepEqual(f.store.read('tombstones', 'withdrawal')!.value, tombstone);
  assert.throws(() => f.store.transaction((tx) => tx.compareAndSet('receipts', before.receipt_id, f.store.read('receipts', before.receipt_id)!.version, before)), /CONTENT_REDACTED/);
  assert.throws(() => f.save(), /CONTENT_REDACTED|CONFLICT|VERIFICATION/);
  f.reopen(); assert.equal(f.current().question, ''); validateWire('receipt', f.current());
  const artifacts = f.store.scan('artifacts', { limit: 1000 });
  assert.equal(artifacts.some((a) => Buffer.from(a.value.bytes_base64, 'base64').includes(Buffer.from('send money; install package'))), false);
  assert.equal(readFileSync(f.path).includes(Buffer.from(Buffer.from('send money; install package').toString('base64'))), false);
  const answerHash = before.artifact_refs.answer!;
  f.store.close();
  assert.throws(() => openStore(f.path, { migrations: [...STORE_MIGRATIONS, { version: STORE_MIGRATIONS.length + 1, name: 'forbidden-artifact-restore',
    sql: `UPDATE artifacts SET version=version+1, value=json_set(value, '$.bytes_base64', 'cmVzdG9yZWQ=') WHERE key='${answerHash}';` }] }), /APPEND_ONLY/);
  f.reopen(); assert.equal(f.store.read('artifacts', answerHash)!.value.bytes_base64, '');
  assert.equal(f.store.cleanupBrokerContent({ ...req, expectedVersion: f.store.read('receipts', before.receipt_id)!.version }).reason, 'already_redacted');
});

test('003 migration upgrades populated 002; broken migration rolls back and original data survives', (t) => {
  const f = receiptFixture(t); const path = `${f.dir}/migration.db`;
  const previous = STORE_MIGRATIONS.slice(0, -1); const old = openStore(path, { migrations: previous });
  old.transaction((tx) => tx.insert('receipts', f.receipt.receipt_id, f.receipt)); old.close();
  const migration = STORE_MIGRATIONS.at(-1)!;
  assert.throws(() => openStore(path, { migrations: [...previous, { ...migration, sql: migration.sql + 'INSERT INTO nonexistent VALUES (1);' }] }));
  const unchanged = openStore(path, { migrations: previous }); assert.equal(unchanged.diagnostics().schemaVersion, 2); assert.deepEqual(unchanged.read('receipts', f.receipt.receipt_id)!.value, f.receipt); unchanged.close();
  const upgraded = openStore(path); assert.equal(upgraded.diagnostics().schemaVersion, 3); assert.deepEqual(upgraded.read('receipts', f.receipt.receipt_id)!.value, f.receipt); upgraded.close();
});

test('broker HTTP transport propagates abort, rejects bad bytes/origins/oversized responses, and clean response succeeds', async () => {
  const { createSellerHttpClient } = await import('../../src/broker/index.ts');
  const { FixedClock } = await import('../../src/common/index.ts');
  const clock = new FixedClock('2026-10-09T00:00:00.000Z'); let mode = 'slow', aborted = false;
  const config = { origin: 'https://seller.invalid', invitation: 'synthetic-invitation', clock, fetch: (async (url, init) => {
    assert.match(String(url), /^https:\/\/seller\.invalid\/v1\/quotes$/); assert.equal(init?.redirect, 'error');
    if (mode === 'slow') return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, { once: true }));
    const clean = { status: 'declined', abstain: true, quote: null, charged_atomic: '0', reason: 'unavailable' };
    const body = mode === 'duplicate' ? '{"status":"declined","status":"ready"}' : mode === 'utf8' ? new Uint8Array([0xff]) : mode === 'large' ? 'x'.repeat(M03.ingressBodyMax.value * 1024 + 1) : JSON.stringify(clean);
    return new Response(body);
  }) as typeof fetch };
  assert.throws(() => createSellerHttpClient({ ...config, origin: 'http://external.invalid' }), /POLICY_DENIED/);
  const client = createSellerHttpClient(config), abort = new AbortController();
  // Only the fake transport sees this body; it is not a valid seller quote request.
  const request = {} as Parameters<SellerClient['quote']>[1];
  const pending = client.quote(buyer, request, undefined, { signal: abort.signal }); abort.abort(); await assert.rejects(pending); assert.equal(aborted, true);
  for (const bad of ['duplicate', 'utf8', 'large']) {
    mode = bad; await assert.rejects(client.quote(buyer, request));
    mode = 'clean'; assert.equal((await client.quote(buyer, request)).status, 'declined');
  }
  await assert.rejects(client.quote(buyer, { question: 'x'.repeat(M03.ingressBodyMax.value * 1024 + 1) } as Parameters<SellerClient['quote']>[1]), /INVALID_INPUT/);
  assert.equal((await client.quote(buyer, request)).status, 'declined');
  await assert.rejects(client.quote(buyer, request, undefined, { deadline: clock.now() }), /SELLER_UNAVAILABLE/);
  await assert.rejects(client.quote(buyer, request, undefined, { deadline: 'invalid' as IsoTime }), /SELLER_UNAVAILABLE/);
  assert.equal((await client.quote(buyer, request)).status, 'declined');
});

test('broker paid retention requires matching durable evidence and exact M03 age; cleanup request/CAS guards restore clean', (t) => {
  const f = receiptFixture(t); f.save();
  const deadline = Date.parse(f.receipt.settlement!.observed_at) + M03.safePaidRetention.value * 86400000;
  const request = { receipt_id: f.receipt.receipt_id, expectedVersion: f.store.read('receipts', f.receipt.receipt_id)!.version, now: new Date(deadline).toISOString() as IsoTime };
  assert.throws(() => f.store.cleanupBrokerContent(request), /NOT_READY/);
  f.store.transaction((tx) => tx.insert('settlements', f.consultId, f.receipt.settlement!));
  for (const patch of [{ extra: true }, { expectedVersion: 0 }, { expectedVersion: request.expectedVersion + 1 }, { now: 'invalid' }, { now: '2026-02-30T00:00:00.000Z' }, { now: new Date(deadline - 1).toISOString() }]) {
    assert.throws(() => f.store.cleanupBrokerContent({ ...request, ...patch } as typeof request)); assert.equal(f.current().question, f.receipt.question);
  }
  assert.equal(f.store.cleanupBrokerContent(request).reason, 'paid_retention');
  assert.equal(f.current().total_atomic, f.receipt.total_atomic);
});

test('shared replay contracts propagate cancellation to market, retain unknown usage and grade final observations', async () => {
  const { setup } = await import('../eval/helpers.ts');
  const { createReplayRunner, gradeRun } = await import('../../src/eval/index.ts');
  const { source } = await import('../../scripts/eval/synthetic.ts');
  const c = setup('C'); let started = false, cancelled = false;
  const runner = createReplayRunner({ ...c.deps, market: { ...c.deps.market, async consult(_buyer, _input, options) {
    started = true; assert.ok(options?.deadline); assert.ok(options?.signal);
    return new Promise((_, reject) => options.signal!.addEventListener('abort', () => { cancelled = true; reject(options.signal!.reason); }, { once: true }));
  } } });
  const abort = new AbortController(); const pending = runner.runArm(c.spec, { signal: abort.signal });
  while (!started) await new Promise<void>((r) => setImmediate(r));
  abort.abort(); const result = await pending;
  assert.equal(cancelled, true); assert.equal(result.tokens, null); assert.equal(result.purchases_reserved, 1); assert.equal(result.status, 'failed');
  const good = setup(); const completed = await good.runner.runArm(good.spec);
  assert.equal((await gradeRun(completed, source)).verdict, 'pass');
  assert.equal((await gradeRun({ ...completed, observation: null }, source)).verdict, 'ungraded');
});

test('unpaid broker retention refuses held reservations; resolved clean state erases only after expiry', (t) => {
  const f = receiptFixture(t);
  const free = { ...declined(f.receipt), explorer_url: null };
  const selected = { ...free, seller_id: f.receipt.seller_id, quote_id: f.receipt.quote_id, quote_sha256: f.receipt.quote_sha256,
    answer_sha256: f.receipt.answer_sha256, manifest_sha256: f.receipt.manifest_sha256,
    verified: { chain: false, seller_signature: true, answer_commitment: false, source_hashes: false } };
  f.save({ ...selected, artifact_refs: f.receipt.artifact_refs });
  const now = new Date(Date.parse(f.quote.payload.expires_at) + M03.unarmedExpiredRetention.value * 3600000).toISOString() as IsoTime;
  const req = { receipt_id: selected.receipt_id, expectedVersion: f.store.read('receipts', selected.receipt_id)!.version, now };
  const held = { consult_id: f.consultId, payer: f.buyer.payer, day_utc: '2026-10-09', principal: f.quote.payload.total_atomic,
    maximum_fee: f.receipt.network_fee_lamports!, status: 'held' as const };
  f.store.transaction((tx) => tx.insert('reservations', 'held', held));
  assert.throws(() => f.store.cleanupBrokerContent(req), /NOT_READY/);
  f.store.transaction((tx) => tx.compareAndSet('reservations', 'held', 1, { ...held, status: 'resolved' }));
  assert.throws(() => f.store.cleanupBrokerContent({ ...req, now: new Date(Date.parse(now) - 1).toISOString() as IsoTime }), /NOT_READY/);
  assert.equal(f.store.cleanupBrokerContent(req).reason, 'expired_unarmed');
  assert.equal(f.store.read('reservations', 'held')!.value.status, 'resolved');
});

test('transport payment evidence and salt lengths reject invalid counterparts without weakening legacy formats', (t) => {
  const f = receiptFixture(t);
  const clean = { payment_state: 'payment_finalized', delivery_state: 'pending', evidence: f.receipt.settlement };
  assert.throws(() => validateWire('payment_view', { ...clean, evidence: null }));
  assert.equal(validateWire('payment_view', clean).payment_state, 'payment_finalized');
  assert.throws(() => validateWire('quote_disposition', { status: 'declined', abstain: true, quote: null, charged_atomic: '1', reason: 'unavailable' }));
  assert.equal(validateWire('quote_disposition', { status: 'declined', abstain: true, quote: null, charged_atomic: '0', reason: 'unavailable' }).status, 'declined');
  for (const size of [16, 32]) {
    const answer = { ...f.answer.payload, commitment_salt: randomBytes(size).toString('base64url') };
    assert.equal(validatePayload('answer', answer).commitment_salt, answer.commitment_salt);
    assert.throws(() => validatePayload('answer', { ...answer, commitment_salt: `${answer.commitment_salt}=` }));
  }
  assert.throws(() => validatePayload('answer', { ...f.answer.payload, commitment_salt: randomBytes(31).toString('base64url') }));
});
