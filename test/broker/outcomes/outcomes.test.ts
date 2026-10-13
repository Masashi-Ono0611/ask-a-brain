import test from 'node:test';
import assert from 'node:assert/strict';
import { M03, encodeBase58, payloadHash } from '../../../src/wire/index.ts';
import { atomicFromBigint } from '../../../src/common/index.ts';
import type { AgentFeedbackInput, Receipt, Signature, Uuid } from '../../../src/wire/contracts.ts';
import { createOutcomeService, observations } from '../../../src/broker/outcomes/index.ts';
import type { CheckedRun, OperatorContext } from '../../../src/broker/outcomes/index.ts';
import { declined, fixture, id } from '../receipts/fixture.ts';

function harness(t: { after(fn: () => void): void }) {
  const h = fixture(t); h.save();
  const human: OperatorContext = { operator_id: id('founder'), session_id: id('human-session') };
  const runHash = payloadHash('public synthetic checker run');
  let run: CheckedRun = { run_sha256: runHash, verdict: 'pass' };
  const refund = { genesis: h.receipt.settlement!.genesis, signature: encodeBase58(Buffer.alloc(64, 2)) as Signature,
    amount_atomic: atomicFromBigint(M03.sellerAtomic.value), recorded_at: h.clock.now() };
  function service() { return createOutcomeService({ store: h.store, clock: h.clock, buyer: h.buyer,
    authorizeHuman: (context) => context.operator_id === human.operator_id && context.session_id === human.session_id,
    async verifyRun() { return run; }, async verifyRefund() { return refund; } }); }
  const input: AgentFeedbackInput = { consult_id: h.consultId, useful: true, reason_code: 'prevented_missed_check' };
  return { h, human, runHash, refund, input, service, run(value: CheckedRun) { run = value; } };
}

test('agent cannot forge human source, independence, other buyer, or duplicate feedback; clean authenticated signal passes', async (t) => {
  const f = harness(t), api = f.service(), { h } = f;
  for (const field of [{ source: 'human' }, { eligible_for_trust: true }, { classification: 'independent' }, { buyer_id: 'other' }]) {
    await assert.rejects(api.feedback(h.buyer, { ...f.input, ...field } as AgentFeedbackInput), /INVALID_INPUT/);
  }
  await assert.rejects(api.feedback({ ...h.buyer, buyer_id: id('other') }, f.input), /UNAUTHORIZED/);
  await assert.rejects(api.feedback(h.buyer, { ...f.input, consult_id: id('other-consult') }), /UNAUTHORIZED/);
  assert.equal(h.store.scan('outcomes', { limit: 1 }).length, 0);
  const clean = await api.feedback(h.buyer, f.input); assert.equal(clean.source, 'agent'); assert.equal(clean.eligible_for_trust, false);
  await assert.rejects(api.feedback(h.buyer, f.input), /IDEMPOTENCY_CONFLICT/);
  h.reopen(); assert.equal(observations(h.store, h.consultId).length, 1);
  assert.equal(observations(h.store, h.consultId)[0]!.exclusion_reason, 'demo');
});

test('feedback byte parser rejects duplicates/invalid UTF-8 and accepts clean bytes', async (t) => {
  const f = harness(t), api = f.service();
  const bytesInput = (bytes: Buffer): AgentFeedbackInput => bytes as unknown as AgentFeedbackInput;
  await assert.rejects(api.feedback(f.h.buyer, bytesInput(Buffer.from('{"consult_id":"consult-t6","useful":true,"useful":false,"reason_code":"other"}'))), /DUPLICATE_KEY/);
  await assert.rejects(api.feedback(f.h.buyer, bytesInput(Buffer.from([0xff]))));
  await api.feedback(f.h.buyer, bytesInput(Buffer.from(JSON.stringify(f.input))));
  assert.equal(observations(f.h.store, f.h.consultId).length, 1);
});

test('human is protected; append-only corrections retain adverse evidence and disputed coverage', async (t) => {
  const f = harness(t), api = f.service(), { h } = f;
  assert.throws(() => api.human({ ...f.human, session_id: h.buyer.session_id }, f.input), /UNAUTHORIZED/);
  const original = api.human(f.human, { ...f.input, useful: false, reason_code: 'not_actionable' });
  assert.throws(() => api.human(f.human, f.input), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => api.human(f.human, f.input, id('other-observation')), /STATE_CONFLICT/);
  h.clock.advance((M03.feedbackWindow.value + 1) * 86400000);
  const correction = api.human(f.human, f.input, original.feedback_id);
  assert.equal(correction.corrects, original.feedback_id); assert.equal(observations(h.store, h.consultId).length, 2);
  assert.equal(observations(h.store, h.consultId).find((o) => o.feedback_id === original.feedback_id)!.useful, false);
  await assert.rejects(api.feedback(h.buyer, f.input), /POLICY_DENIED/);
  const report = await api.report(h.buyer, { date_utc: '2026-10-09' });
  assert.match(report.markdown, /human \| 0 \| 0 \| 0 \| 1 \| 1 \/ 1/);
  assert.ok(!report.markdown.includes(h.receipt.question));
});

test('checker/replay bind verified run hashes; explicit unknown remains unknown; mismatch rejects and clean pass/fail work', async (t) => {
  const f = harness(t), api = f.service(), { h } = f;
  f.run({ run_sha256: payloadHash('wrong run'), verdict: 'pass' });
  await assert.rejects(api.taskCheck(h.consultId, f.runHash), /VERIFICATION_FAILED/);
  f.run({ run_sha256: f.runHash, verdict: 'fail' });
  const checked = await api.taskCheck(h.consultId, f.runHash); assert.equal(checked?.source, 'task_check'); assert.equal(checked?.useful, false);
  assert.ok(h.current().artifact_refs[`outcome:${checked!.feedback_id}`]);
  f.run({ run_sha256: f.runHash, verdict: 'unknown' });
  assert.equal(await api.replay(h.consultId, f.runHash), null); assert.ok(h.current().artifact_refs['unknown:replay']);
  await assert.rejects(api.replay(h.consultId, f.runHash), /IDEMPOTENCY_CONFLICT/);
  f.run({ run_sha256: f.runHash, verdict: 'pass' });
  await assert.rejects(api.replay(h.consultId, f.runHash), /IDEMPOTENCY_CONFLICT/);
  assert.equal(observations(h.store, h.consultId).filter((o) => o.source === 'replay').length, 0);
  const report = await api.report(h.buyer, { date_utc: '2026-10-09' }); assert.match(report.markdown, /replay \| 0 \| 0 \| 1 \| 0 \| 0 \/ 1/);
  assert.match(report.markdown, new RegExp(f.runHash));
});

test('delivery recovery never removes historical failure from reliability; normal clean consult remains delivered', async (t) => {
  const f = harness(t), { h } = f;
  let report = await f.service().report(h.buyer, { date_utc: '2026-10-09' });
  assert.match(report.markdown, /technical_verification \/ devnet \| 1 \| 1 \| 0/);
  h.save({ ...h.receipt, delivery_state: 'verification_failed', refund_state: 'refund_pending', refund: { ...h.receipt.refund, status: 'refund_pending' } });
  h.save(); h.reopen();
  assert.equal(h.current().delivery_state, 'delivered');
  report = await f.service().report(h.buyer, { date_utc: '2026-10-09' });
  assert.match(report.markdown, /technical_verification \/ devnet \| 1 \| 1 \| 1/);
});

test('replay and service failure sources are derived and never independent endorsements', async (t) => {
  const f = harness(t), api = f.service(), { h } = f;
  assert.throws(() => api.serviceFailure(h.consultId), /STATE_CONFLICT/);
  const replay = await api.replay(h.consultId, f.runHash); assert.equal(replay?.classification, 'replay'); assert.equal(replay?.exclusion_reason, 'replay');
  h.save({ ...h.receipt, delivery_state: 'delivery_failed', refund_state: 'refund_pending', refund: { ...h.receipt.refund, status: 'refund_pending' } });
  const failure = api.serviceFailure(h.consultId); assert.equal(failure.source, 'service_failure'); assert.equal(failure.useful, false);
  assert.equal(failure.eligible_for_trust, false);
});

test('refund verification, amount and replay guards fire; partial/full returns preserve failure and principal denominator', async (t) => {
  const f = harness(t), { h } = f, api = f.service(), hash = payloadHash('synthetic refund evidence');
  h.save({ ...h.receipt, delivery_state: 'delivery_failed', refund_state: 'refund_pending', refund: { ...h.receipt.refund, status: 'refund_pending' } });
  api.serviceFailure(h.consultId);
  await assert.rejects(api.refund({ ...f.human, session_id: id('bad') }, h.consultId, hash), /UNAUTHORIZED/);
  const originalTime = f.refund.recorded_at, originalGenesis = f.refund.genesis;
  f.refund.recorded_at = 'invalid' as typeof originalTime;
  await assert.rejects(api.refund(f.human, h.consultId, hash), /VERIFICATION_FAILED/);
  f.refund.recorded_at = originalTime;
  f.refund.genesis = '11111111111111111111111111111111' as typeof originalGenesis;
  await assert.rejects(api.refund(f.human, h.consultId, hash), /VERIFICATION_FAILED/);
  f.refund.genesis = originalGenesis;
  f.refund.amount_atomic = atomicFromBigint(M03.totalAtomic.value + 1n);
  await assert.rejects(api.refund(f.human, h.consultId, hash), /VERIFICATION_FAILED/);
  f.refund.amount_atomic = atomicFromBigint(M03.sellerAtomic.value);
  await api.refund(f.human, h.consultId, hash); assert.equal(h.current().refund_state, 'partial_refund');
  // Duplicate signature with an amount that otherwise fits must still reject.
  f.refund.amount_atomic = atomicFromBigint(M03.marketplaceAtomic.value);
  await assert.rejects(api.refund(f.human, h.consultId, hash), /IDEMPOTENCY_CONFLICT/);
  f.refund.signature = encodeBase58(Buffer.alloc(64, 3)) as Signature;
  await api.refund(f.human, h.consultId, hash); assert.equal(h.current().refund_state, 'refunded');
  assert.equal(h.current().delivery_state, 'delivery_failed'); assert.equal(h.current().total_atomic, h.receipt.total_atomic);
  h.reopen(); h.save({ ...h.receipt, delivery_state: 'delivery_failed' }); // stale broker cannot erase returns
  assert.equal(h.current().refund.returned_atomic, h.receipt.total_atomic);
  const report = await f.service().report(h.buyer, { date_utc: '2026-10-09' });
  assert.match(report.markdown, /technical_verification \/ devnet \| 1 \| 0 \| 1 \| 0 \| 1 \| 0/);
  assert.equal(h.store.scan('refunds', { limit: 1000 }).length, 2); assert.equal(observations(h.store, h.consultId)[0]!.source, 'service_failure');
});

test('report retains every paid failure/refund/unknown by evidence class, no prose or score and separate source denominators', async (t) => {
  const f = harness(t), { h } = f, api = f.service();
  await api.feedback(h.buyer, f.input);
  const add = (n: number, change: Partial<Receipt>): void => {
    const receiptId = id(`cohort-${n}`), consultId = id(`cohort-consult-${n}`), requestId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as Uuid;
    const receipt = { ...h.receipt, ...change, request_id: requestId, receipt_id: receiptId };
    h.store.transaction((tx) => {
      tx.insert('consults', consultId, { ...h.row, request_id: requestId, view: { ...h.row.view, consult_id: consultId, receipt_id: receiptId } });
      tx.insert('receipts', receiptId, receipt);
    });
  };
  add(2, { delivery_state: 'delivery_failed', refund_state: 'refunded', refund: { status: 'refunded', returned_atomic: h.receipt.total_atomic!, transactions: [encodeBase58(Buffer.alloc(64, 4)) as Signature] } });
  add(3, { ...declined(h.receipt), payment_state: 'payment_pending', delivery_state: 'pending', total_atomic: null, seller_atomic: null, fee_atomic: null, network_fee_lamports: null });
  add(4, { classification: 'replay' });
  add(5, declined(h.receipt));
  const report = await api.report(h.buyer, { date_utc: '2026-10-09' });
  assert.equal(report.receipt_ids.length, 5); assert.equal(report.gbrain_pending_count, 5);
  assert.match(report.markdown, /technical_verification \/ devnet \| 2 \| 1 \| 1 \| 0 \| 1 \| 0/);
  assert.match(report.markdown, /replay \/ devnet \| 1 \| 1/); assert.match(report.markdown, /independent \/ devnet \| 0/);
  assert.match(report.markdown, /agent \| 1 \| 0 \| 4 \| 0 \| 1 \/ 5/);
  assert.match(report.markdown, /human \| 0 \| 0 \| 5 \| 0 \| 0 \/ 5/);
  assert.match(report.markdown, /unrated until 3 independent buyers/); assert.ok(!report.markdown.includes(h.receipt.question));
  await assert.rejects(api.report({ ...h.buyer, buyer_id: id('other') }, { date_utc: '2026-10-09' }), /UNAUTHORIZED/);
  await assert.rejects(api.report(h.buyer, { date_utc: '2026-10-09', source: 'human' } as { date_utc: string }), /INVALID_INPUT/);
  assert.equal((await api.report(h.buyer, { date_utc: '2026-10-10' })).receipt_ids.length, 0);
});
