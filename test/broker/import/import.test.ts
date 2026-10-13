import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bytesHash, payloadHash } from '../../../src/wire/index.ts';
import type { Eligibility, Id, Revocation } from '../../../src/wire/contracts.ts';
import { createReceiptImporter } from '../../../src/broker/import/index.ts';
import type { IsolatedReceiptTransport, QuotedSafetyEvidence, ReceiptImportDeps } from '../../../src/broker/import/index.ts';
import { fixture, id, planted } from '../receipts/fixture.ts';

function harness(t: { after(fn: () => void): void }, hostile = false) {
  const h = fixture(t, hostile); h.save();
  const records = new Map<string, { page_id: Id; bytes: Uint8Array }>();
  const behavior = { outage: false, readOutage: false, corrupt: false, afterWrite: null as (() => void) | null,
    state: 'eligible' as Eligibility['state'], authorityAvailable: true, stale: false,
    mutate: null as ((value: Eligibility) => Eligibility) | null };
  const counts = { writes: 0, reads: 0, eligibility: 0, signatures: 0, broadcasts: 0, unauthorized: 0, allowedChecks: 0 };
  let tombstones: readonly Revocation[] = [];
  const transport: IsolatedReceiptTransport = {
    async upsert(doc) {
      counts.writes++; if (behavior.outage) throw new Error('fake offline; seller prose must not escape');
      assert.equal(doc.source, 'external_untrusted'); assert.equal(doc.path, `external-evidence/ask-a-brain/${h.consultId}`);
      assert.equal(bytesHash(doc.bytes), doc.content_sha256);
      const page_id = records.get(doc.path)?.page_id ?? id('remote-receipt');
      records.set(doc.path, { page_id, bytes: doc.bytes.slice() }); behavior.afterWrite?.(); return { page_id };
    },
    async read(path) { counts.reads++; if (behavior.readOutage) throw new Error('read unavailable'); const row = records.get(path);
      return row ? { ...row, bytes: behavior.corrupt ? Buffer.from('corrupted') : row.bytes.slice() } : null; },
  };
  const safety: QuotedSafetyEvidence = { evidence_sha256: payloadHash('FAKE harness evidence only'), isolated_source: true,
    excluded_from_general_retrieval: true, mediated_retrieval_only: true, planted_instruction_denied: true,
    allowed_check_passed: true, restart_readback_passed: true, revocation_passed: true };
  function deps(quoted = true): ReceiptImportDeps {
    return { store: h.store, clock: h.clock, buyer: h.buyer, transport, ...(quoted ? { quotedSafety: safety } : {}),
      async eligibility() { counts.eligibility++; const value = { slice_id: h.quote.payload.slice_id, manifest_sha256: h.receipt.manifest_sha256!,
        generation: 1, state: behavior.state, acknowledged_at: behavior.stale ? '2020-01-01T00:00:00.000Z' as Eligibility['acknowledged_at'] : h.clock.now(), checked_at: h.clock.now() }; return behavior.mutate?.(value) ?? value; },
      async authority() { if (!behavior.authorityAvailable) throw new Error('unavailable'); return { rows: tombstones,
        attestation: { generation: tombstones.reduce((max, row) => Math.max(max, row.generation), 0), tombstones_sha256: payloadHash(tombstones), acknowledged_at: h.clock.now() } }; },
    };
  }
  const revocation: Revocation = { slice_id: h.quote.payload.slice_id, manifest_sha256: h.receipt.manifest_sha256!, generation: 1,
    revoked_at: h.clock.now(), reason: 'rights', approval_id: id('operator-revocation') };
  return { h, records, counts, behavior, safety, deps, revocation, tombstones(rows: readonly Revocation[]) { tombstones = rows; } };
}

test('outage keeps authoritative receipt/outbox, restart and duplicate imports produce one exact remote record and no repurchase', async (t) => {
  const f = harness(t), { h } = f; let importer = createReceiptImporter(f.deps());
  f.behavior.outage = true;
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'import_pending');
  assert.equal(h.current().delivery_state, 'delivered'); assert.equal(h.current().import_state, 'import_pending');
  assert.equal(h.store.read('outbox', h.receipt.receipt_id)?.value.attempts, 1);
  h.reopen(); importer = createReceiptImporter(f.deps()); f.behavior.outage = false;
  assert.deepEqual(await importer.retryPending(), { imported: 1, pending: 0 });
  const first = await importer.readback(h.receipt.receipt_id); assert.equal(first?.mode, 'quoted');
  await Promise.all([importer.drain(h.receipt.receipt_id), importer.drain(h.receipt.receipt_id)]);
  assert.equal(f.records.size, 1); assert.deepEqual(await importer.readback(h.receipt.receipt_id), first);
  h.reopen(); importer = createReceiptImporter(f.deps()); assert.deepEqual(await importer.readback(h.receipt.receipt_id), first);
  assert.equal(f.counts.signatures, 0); assert.equal(f.counts.broadcasts, 0);
});

test('lost import acknowledgment is pending until exact readback; corruption rejected then clean retry passes', async (t) => {
  const f = harness(t), { h } = f, importer = createReceiptImporter(f.deps());
  f.behavior.readOutage = true; assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'import_pending');
  assert.equal(f.records.size, 1); f.behavior.readOutage = false; f.behavior.corrupt = true;
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'import_pending');
  f.behavior.corrupt = false; assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'quoted');
  assert.equal(f.records.size, 1);
  f.behavior.corrupt = true; assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  assert.equal(h.current().import_state, 'import_pending');
  f.behavior.corrupt = false; await importer.retryPending(); assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'quoted');
});

test('no observed isolation defaults to metadata-only; pending on metadata outage; full receipt stays local', async (t) => {
  const f = harness(t, true), { h } = f; let importer = createReceiptImporter(f.deps(false));
  f.behavior.outage = true; assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'import_pending');
  f.behavior.outage = false; assert.equal((await importer.importReceipt(h.current(), 'quoted')).status, 'metadata_only');
  const readback = await importer.retrieve(h.buyer, h.receipt.receipt_id); assert.equal(readback?.mode, 'metadata_only');
  assert.ok(!readback!.text.includes(h.receipt.question)); assert.ok(!readback!.text.includes('send money'));
  assert.ok(!readback!.text.includes('install package')); assert.ok(!readback!.text.includes('excerpt'));
  assert.ok(h.store.read('artifacts', h.receipt.artifact_refs.answer!));
  h.reopen(); importer = createReceiptImporter(f.deps(false)); assert.equal((await importer.readback(h.receipt.receipt_id))?.mode, 'metadata_only');
});

test('correctly signed planted instructions stay escaped untrusted evidence; fake harness denies requested operations and permits clean check', async (t) => {
  const f = harness(t, true), { h } = f, importer = createReceiptImporter(f.deps());
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'quoted');
  h.reopen(); const restarted = createReceiptImporter(f.deps());
  const result = await restarted.retrieve(h.buyer, h.receipt.receipt_id);
  assert.equal(result?.untrusted_content, true); assert.ok(result!.text.includes('&lt;script&gt;'));
  assert.ok(!result!.text.includes('<script>')); assert.ok(!result!.text.includes(planted));
  assert.match(result!.text, /cannot authorize payments/);
  const task = (operation: string): boolean => { if (operation !== 'check_leftovers') return false; f.counts.allowedChecks++; return true; };
  for (const operation of ['send money', 'install package', 'run outside task', 'mark feedback useful']) assert.equal(task(operation), false);
  assert.equal(task('check_leftovers'), true); assert.equal(f.counts.allowedChecks, 1);
  assert.equal(h.store.scan('outcomes', { limit: 1 }).length, 0); assert.equal(f.counts.unauthorized, 0);
  assert.equal(f.counts.signatures, 0); assert.equal(f.counts.broadcasts, 0);
});

test('post-import revocation suppresses immediately, persists across restart and queues metadata replacement while liabilities survive', async (t) => {
  const f = harness(t), { h } = f; let importer = createReceiptImporter(f.deps());
  await importer.drain(h.receipt.receipt_id); assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'quoted');
  f.tombstones([f.revocation]); importer.learnRevocation(f.revocation); f.behavior.outage = true;
  assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'import_pending');
  h.reopen(); importer = createReceiptImporter(f.deps());
  assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  assert.equal(h.current().payment_state, 'payment_finalized'); assert.equal(h.current().refund_state, 'refund_pending');
  assert.equal(h.current().total_atomic, h.receipt.total_atomic);
  f.behavior.outage = false; assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'metadata_only');
  assert.ok(![...f.records.values()].some((r) => Buffer.from(r.bytes).toString().includes(h.receipt.question)));
  assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'metadata_only');
  h.save(); assert.equal(h.current().content_state, 'revoked'); assert.equal(h.current().refund_state, 'refund_pending');
});

test('missing authority, stale eligibility and wrong buyer block quoted readback; restored current eligibility passes', async (t) => {
  const f = harness(t), { h } = f, importer = createReceiptImporter(f.deps());
  await importer.drain(h.receipt.receipt_id);
  await assert.rejects(importer.retrieve({ ...h.buyer, buyer_id: id('other') }, h.receipt.receipt_id), /UNAUTHORIZED/);
  f.behavior.authorityAvailable = false; assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  f.behavior.authorityAvailable = true; await importer.retryPending();
  f.behavior.stale = true; assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  f.behavior.stale = false; await importer.retryPending();
  f.behavior.state = 'unknown'; assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  f.behavior.state = 'eligible'; await importer.retryPending(); assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'quoted');
});

test('revocation racing remote upsert cannot mark stale prose imported or return it; metadata replacement wins', async (t) => {
  const f = harness(t), { h } = f, importer = createReceiptImporter(f.deps());
  f.behavior.afterWrite = () => { f.behavior.afterWrite = null; importer.learnRevocation(f.revocation); };
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'metadata_only');
  assert.equal(h.current().content_state, 'revoked');
  const read = await importer.retrieve(h.buyer, h.receipt.receipt_id); assert.equal(read?.mode, 'metadata_only');
  assert.ok(!read!.text.includes(h.receipt.question));
});

test('caller-mutated receipt never enters importer; durable clean receipt is accepted', async (t) => {
  const f = harness(t), { h } = f, importer = createReceiptImporter(f.deps(false));
  await assert.rejects(importer.importReceipt({ ...h.current(), question: 'injected replacement' }, 'metadata_only'), /STATE_CONFLICT/);
  assert.equal(f.counts.writes, 0);
  assert.equal((await importer.importReceipt(h.current(), 'metadata_only')).status, 'metadata_only'); assert.equal(f.counts.writes, 1);
});

test('restored older content backup cannot override newest independent tombstones; nonrevoked backup readback passes first', async (t) => {
  const f = harness(t), { h } = f; let importer = createReceiptImporter(f.deps());
  await importer.drain(h.receipt.receipt_id);
  const backup = join(h.dir, 'old-content.db'); h.store.backup(backup, payloadHash([]));
  assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'quoted');
  f.tombstones([f.revocation]); importer.learnRevocation(f.revocation);
  h.restore(backup); importer = createReceiptImporter(f.deps());
  assert.equal(h.current().content_state, 'eligible'); // old DB alone is stale
  assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
  assert.equal(h.current().content_state, 'revoked'); assert.equal(h.current().payment_state, 'payment_finalized');
  assert.equal((await importer.drain(h.receipt.receipt_id)).status, 'metadata_only');
});

test('revoked seller flag and failed safety attestation force metadata fallback, while complete observed fake safety permits quoted import', async (t) => {
  const f = harness(t), { h } = f;
  const bad = createReceiptImporter({ ...f.deps(), quotedSafety: { ...f.safety, excluded_from_general_retrieval: false } as unknown as QuotedSafetyEvidence });
  assert.equal((await bad.drain(h.receipt.receipt_id)).status, 'metadata_only');
  const good = createReceiptImporter(f.deps()); assert.equal((await good.drain(h.receipt.receipt_id)).status, 'quoted');
  f.behavior.state = 'revoked';
  assert.equal(await good.retrieve(h.buyer, h.receipt.receipt_id), null); assert.equal(h.current().content_state, 'revoked');
  assert.equal((await good.drain(h.receipt.receipt_id)).status, 'metadata_only');
  const observed = h.store.read('eligibility', bytesHash(Buffer.from(`${h.quote.payload.slice_id}\n${h.receipt.manifest_sha256}`)));
  assert.equal(observed?.value.state, 'revoked');
});

test('online eligibility rejects wrong binding, unknown fields and generation rollback; restored clean observation passes', async (t) => {
  const f = harness(t), { h } = f, importer = createReceiptImporter(f.deps());
  await importer.drain(h.receipt.receipt_id);
  const mutations: ((value: Eligibility) => Eligibility)[] = [
    (value) => ({ ...value, slice_id: id('wrong') }), (value) => ({ ...value, manifest_sha256: payloadHash('wrong') }),
    (value) => ({ ...value, generation: 0 }), (value) => ({ ...value, generation: -1 }),
    (value) => ({ ...value, extra: 'unexpected' }), (value) => ({ ...value, checked_at: 'invalid' as Eligibility['checked_at'] }),
  ];
  for (const mutate of mutations) {
    f.behavior.mutate = mutate; assert.equal(await importer.retrieve(h.buyer, h.receipt.receipt_id), null);
    f.behavior.mutate = null; await importer.retryPending(); assert.equal((await importer.retrieve(h.buyer, h.receipt.receipt_id))?.mode, 'quoted');
  }
});
