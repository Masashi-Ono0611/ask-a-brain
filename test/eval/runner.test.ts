import test from 'node:test';
import assert from 'node:assert/strict';
import { M03, canonicalBytes } from '../../src/wire/index.ts';
import type { Id, TaskEvidence } from '../../src/wire/contracts.ts';
import { collectAttempts, createReplayRunner, gradeAttempt, replayLimits } from '../../src/eval/index.ts';
import type { BuyerSession, Metrics } from '../../src/eval/index.ts';
import { call, consultInput, measured, source, syntheticDriver, syntheticMarket } from '../../scripts/eval/synthetic.ts';
import { driver, setup } from './helpers.ts';
async function clean(arm: 'A' | 'B' | 'C' = 'A') { const c = setup(arm); const result = await c.runner.runArm(c.spec); assert.equal(result.status, 'completed'); return result; }
test('frozen fixture/corpus/rubric changes abort before driver or market; restored sources complete', async () => {
  for (const part of ['fixture', 'corpus', 'rubric'] as const) {
    let driverCalls = 0;
    const corrupted = { ...source, [part]: (key: Id) => Buffer.concat([Buffer.from(source[part](key)), Buffer.from(' ')]) };
    const c = setup('A', { source: corrupted, driver: driver(async () => { driverCalls++; throw new Error(); }) });
    const r = await c.runner.runArm(c.spec); assert.equal(r.reason_code, 'FROZEN_ARTIFACT_CHANGED'); assert.equal(driverCalls, 0);
    assert.equal(c.journal.read().filter((e) => e.kind === 'start').length, 1); await clean();
  }
});
test('changed frozen spec fails and correct counterpart runs; duplicate attempt never overwrites', async () => {
  const c = setup(); await assert.rejects(c.runner.runArm({ ...c.spec, model: 'other' }), /FROZEN_SPEC_CHANGED/);
  assert.equal((await c.runner.runArm(c.spec)).status, 'completed');
  await assert.rejects(c.runner.runArm(c.spec), /ATTEMPT_EXISTS/);
  assert.equal(c.journal.read().filter((e) => e.kind === 'result').length, 1);
});
test('raw tool messages reject duplicates, unknown fields, invalid UTF8 and disabled tools; clean repair follows', async () => {
  const c = setup(); const good = syntheticDriver(c.deps.study);
  const badBytes = [Buffer.from('{"tool":"inspect_fixture","tool":"verify_fixture","input":{}}'), Uint8Array.from([0xff]),
    canonicalBytes({ tool: 'inspect_fixture', input: { fixture_id: 's1' }, hidden: true }), canonicalBytes({ tool: 'shell', input: {} }),
    canonicalBytes({ tool: 'consult', input: consultInput('q1' as Id) })];
  const d = driver(async (s, signal) => { for (const bytes of badBytes) await assert.rejects(s.call(bytes)); return good.execute(s, signal); });
  const r = await createReplayRunner({ ...c.deps, driver: d }).runArm(c.spec);
  assert.equal(r.status, 'completed'); assert.equal(r.rejected_calls, badBytes.length); assert.equal(r.purchases_reserved, 0);
});
test('call 31 is rejected before dispatch and budget failure retained; allowed cap counterpart passes', async () => {
  const c = setup(); const good = syntheticDriver(c.deps.study);
  const fill = (over: boolean) => driver(async (s, signal) => {
    for (let i = 0; i < replayLimits.calls - 5 + (over ? 1 : 0); i++) await call(s, 'inspect_fixture', { fixture_id: s.fixture_id });
    return good.execute(s, signal);
  });
  const r = await createReplayRunner({ ...c.deps, driver: fill(true) }).runArm(c.spec);
  assert.equal(r.reason_code, 'CALL_BUDGET'); assert.equal(r.calls, M03.replayCallsMax.value); assert.equal(r.rejected_calls, 1);
  const ok = setup('A', { driver: fill(false) }); assert.equal((await ok.runner.runArm(ok.spec)).status, 'completed');
});
test('wall deadline cancels a never-returning driver and closes late task capability; clean counterpart passes', async () => {
  const c = setup(); let captured: BuyerSession | undefined;
  const runner = createReplayRunner({ ...c.deps, driver: driver(async (session) => { captured = session; c.clock.advance(replayLimits.wall_ms); return new Promise<Metrics>(() => {}); }) });
  const result = await runner.runArm(c.spec); assert.equal(result.reason_code, 'WALL_BUDGET');
  await assert.rejects(call(captured!, 'apply_fixture_fix', { fixture_id: 's1', fix_id: 'repair' }), /RUN_CLOSED/);
  assert.equal(result.observation!.files.work, 'pending'); await clean();
});
test('wallet/consult waiting consumes wall budget; pending purchase reservation survives timeout', async () => {
  const c = setup('C'); const market = syntheticMarket();
  const r = await createReplayRunner({ ...c.deps, market: { ...market, async consult() { c.clock.advance(replayLimits.wall_ms); return new Promise(() => {}); } } }).runArm(c.spec);
  assert.equal(r.reason_code, 'WALL_BUDGET'); assert.equal(r.purchases_reserved, 1); assert.equal(r.consult_ids.length, 0);
  assert.equal(r.accounting.length, 0); await clean('C');
});
test('second purchase blocked even after an unknown first response; one permitted consult completes', async () => {
  const c = setup('C'); let dispatch = 0;
  const r = await createReplayRunner({ ...c.deps, market: { ...syntheticMarket(), async consult() { dispatch++; throw new Error('unknown'); } },
    driver: driver(async (s) => { await assert.rejects(call(s, 'consult', consultInput(s.question_id))); await call(s, 'consult', consultInput(s.question_id)); return measured(c.deps.study); }) }).runArm(c.spec);
  assert.equal(r.reason_code, 'PURCHASE_BUDGET'); assert.equal(dispatch, 1); assert.equal(r.purchases_reserved, 1); await clean('C');
});
test('C rejects altered support or uncited prose while keeping payment expense; exact source counterpart passes', async () => {
  for (const change of ['text', 'citation']) {
    const c = setup('C'), market = syntheticMarket();
    const r = await createReplayRunner({ ...c.deps, market: { ...market, async consult(context, input) {
      const view = structuredClone(await market.consult(context, input));
      return { ...view, answer: { ...view.answer!, ...(change === 'text' ? { text: 'hidden solution' } : { citations: [] }) } };
    } } }).runArm(c.spec);
    assert.equal(r.reason_code, 'COMPARATOR_MISMATCH'); assert.equal(r.accounting[0]!.principal_atomic, M03.totalAtomic.value.toString());
    await clean('C');
  }
});
test('reported token overflow and unknown usage never pass; exact token-cap clean counterpart passes', async () => {
  for (const tokens of [replayLimits.tokens + 1, null, replayLimits.tokens]) {
    const c = setup(), good = syntheticDriver(c.deps.study);
    const r = await createReplayRunner({ ...c.deps, driver: driver(async (s, sig) => ({ ...await good.execute(s, sig), tokens })) }).runArm(c.spec);
    assert.equal(r.reason_code, tokens === null ? 'USAGE_UNKNOWN' : tokens > replayLimits.tokens ? 'TOKEN_BUDGET' : 'COMPLETED');
    assert.equal(r.usage?.tokens, tokens); assert.equal(r.compliant_primary, false);
    assert.equal((await gradeAttempt(r, source)).verdict, tokens === null ? 'ungraded' : tokens > replayLimits.tokens ? 'fail' : 'pass');
  }
});
test('model/config drift fails despite completed repair; frozen identity passes', async () => {
  for (const field of ['effective_model', 'config_sha256'] as const) {
    const c = setup(), good = syntheticDriver(c.deps.study);
    const r = await createReplayRunner({ ...c.deps, driver: driver(async (s, sig) => ({ ...await good.execute(s, sig), [field]: 'drift' })) }).runArm(c.spec);
    assert.equal(r.reason_code, 'MODEL_CONFIG_DRIFT'); assert.equal(r.status, 'failed'); await clean();
  }
});
test('no-op or recommendation is failure, not successful grading; permitted repair evidence passes', async () => {
  const c = setup(); const r = await createReplayRunner({ ...c.deps, driver: driver(async () => measured(c.deps.study)) }).runArm(c.spec);
  assert.equal(r.reason_code, 'NO_COMPLETION'); assert.equal((await gradeAttempt(r, source)).verdict, 'fail');
  assert.equal((await gradeAttempt(await clean(), source)).verdict, 'pass');
});
test('rubric/cross-arm canaries and labels never enter session; C report cannot reach global outcomes', async () => {
  const c = setup('C'); let reportCalls = 0; const good = syntheticDriver(c.deps.study);
  const r = await createReplayRunner({ ...c.deps, market: { ...syntheticMarket(), async report() { reportCalls++; return { markdown: 'CROSS_ARM_CANARY', receipt_ids: [], gbrain_pending_count: 0 }; } },
    driver: driver(async (s, sig) => {
      const visible = JSON.stringify(s); assert.equal(visible.includes('RUBRIC_ONLY'), false); assert.equal(visible.includes('rubric'), false);
      await assert.rejects(call(s, 'inspect_fixture', { fixture_id: 's1', path: 'rubric' }));
      const report = await call(s, 'report', { date_utc: '2026-10-09' }); assert.equal(JSON.stringify(report).includes('CROSS_ARM_CANARY'), false);
      return good.execute(s, sig);
    }) }).runArm(c.spec);
  assert.equal(r.status, 'completed'); assert.equal(reportCalls, 0);
});
test('interrupted attempt keeps last state, calls, pending purchase and expenses; rerun denied', async () => {
  const c = setup('C'); await c.runner.runArm(c.spec);
  const beforeFinish = c.journal.read().filter((e) => e.kind !== 'result');
  const copy = setup('C'); for (const e of beforeFinish) copy.journal.append(e);
  const restored = collectAttempts(copy.plan, copy.journal).find((a) => a.run_id === c.spec.run_id)!;
  assert.equal(restored.reason_code, 'INTERRUPTED_UNKNOWN'); assert.equal(restored.purchases_reserved, 1);
  assert.equal(restored.accounting[0]!.principal_atomic, M03.totalAtomic.value.toString()); assert.ok(restored.calls > 0);
  assert.equal(restored.usage, null); await assert.rejects(copy.runner.runArm(copy.spec), /ATTEMPT_EXISTS/); await clean('C');
});

test('mainnet, unapproved question, foreign status and forged human feedback are rejected before dispatch', async () => {
  const c = setup('C'); let consults = 0, statuses = 0, feedbacks = 0; const market = syntheticMarket(), good = syntheticDriver(c.deps.study);
  const r = await createReplayRunner({ ...c.deps, market: { ...market,
    async consult(ctx, input) { consults++; return market.consult(ctx, input); },
    async status(ctx, input) { statuses++; return market.status(ctx, input); },
    async feedback(ctx, input) { feedbacks++; return market.feedback(ctx, input); },
  }, driver: driver(async (s, sig) => {
    const input = consultInput(s.question_id);
    await assert.rejects(call(s, 'consult', { ...input, max_price: { ...input.max_price, network: 'mainnet-beta' } }), /QUESTION_DENIED/);
    await assert.rejects(call(s, 'consult', { ...input, question_id: 'unknown_question' }), /QUESTION_DENIED/);
    await assert.rejects(call(s, 'status', { consult_id: 'other_arm' }), /CONSULT_DENIED/);
    await assert.rejects(call(s, 'feedback', { consult_id: 'other_arm', useful: true, reason_code: 'other', source: 'human' }));
    return good.execute(s, sig);
  }) }).runArm(c.spec);
  assert.equal(r.status, 'completed'); assert.equal(consults, 1); assert.equal(statuses, 0); assert.equal(feedbacks, 0);
});
test('concurrent calls are denied without double dispatch and fresh run succeeds', async () => {
  const c = setup('C'); const market = syntheticMarket(); let release: (() => void) | undefined, started: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const d = driver(async (s) => {
    const pending = call(s, 'consult', consultInput(s.question_id)); await entered;
    await assert.rejects(call(s, 'inspect_fixture', { fixture_id: s.fixture_id }), /CONCURRENT_CALL_DENIED/);
    release!(); await pending;
    // Pure task completion after the one successful consult.
    const input = { fixture_id: s.fixture_id }; await call(s, 'apply_fixture_fix', { ...input, fix_id: 'repair' });
    const a = await call(s, 'check_leftovers', input) as TaskEvidence, b = await call(s, 'verify_fixture', input) as TaskEvidence;
    await call(s, 'finish_with_evidence', { ...input, evidence_ids: [a.evidence_id, b.evidence_id] }); return measured(c.deps.study);
  });
  const r = await createReplayRunner({ ...c.deps, driver: d, market: { ...market, async consult(ctx, input) { started!(); await new Promise<void>((resolve) => { release = resolve; }); return market.consult(ctx, input); } } }).runArm(c.spec);
  assert.equal(r.status, 'completed'); assert.equal(r.purchases_reserved, 1); assert.equal(r.rejected_calls, 1); await clean('C');
});
test('late settlement after timeout is journaled and recovered without reopening task writes', async () => {
  const c = setup('C'), market = syntheticMarket(); let resolvePayment: (() => void) | undefined;
  const delayed = { ...market, async consult(ctx: Parameters<typeof market.consult>[0], input: Parameters<typeof market.consult>[1]) {
    const wait = new Promise<void>((resolve) => { resolvePayment = resolve; }); c.clock.advance(replayLimits.wall_ms); await wait; return market.consult(ctx, input);
  } };
  const r = await createReplayRunner({ ...c.deps, market: delayed }).runArm(c.spec);
  assert.equal(r.reason_code, 'WALL_BUDGET'); assert.equal(r.accounting.length, 0);
  resolvePayment!(); await new Promise<void>((resolve) => setImmediate(resolve));
  const restored = collectAttempts(c.plan, c.journal).find((a) => a.run_id === c.spec.run_id)!;
  assert.equal(restored.reason_code, 'WALL_BUDGET'); assert.equal(restored.accounting[0]!.payment_state, 'payment_finalized');
  assert.equal(restored.observation!.files.work, 'pending'); await clean('C');
});
test('oversized request is rejected before parsing; clean bounded repair follows', async () => {
  const c = setup(), good = syntheticDriver(c.deps.study);
  const r = await createReplayRunner({ ...c.deps, driver: driver(async (s, sig) => {
    await assert.rejects(s.call(Buffer.alloc(M03.ingressBodyMax.value * 1024 + 1, 32)), /INPUT_TOO_LARGE/);
    return good.execute(s, sig);
  }) }).runArm(c.spec);
  assert.equal(r.status, 'completed'); assert.equal(r.rejected_calls, 1);
});
