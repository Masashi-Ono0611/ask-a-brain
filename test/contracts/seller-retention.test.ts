import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, purchase } from '../seller/support.ts';
import { M03, payloadHash } from '../../src/wire/index.ts';
import { parseAnswerMap } from '../../src/common/index.ts';
import type { BrokerPorts, CreateSellerService, JsonValue, SellerConfig } from '../../src/wire/contracts.ts';
import type { BrokerPorts as LocalBrokerPorts } from '../../src/broker/ports.ts';
import { createSellerService } from '../../src/seller/index.ts';
// Compile-only assignments catch drift between frozen ports and existing adapters.
const create: CreateSellerService = createSellerService;
const promote = (ports: LocalBrokerPorts): BrokerPorts => ports;
void create; void promote;

test('shared answer-map/config matches current seller fixture and manifest.files scan commitment', (t) => {
  const f = fixture(t); const config: SellerConfig = f.config; void config;
  assert.deepEqual(parseAnswerMap(f.bundle.files.get('answer-map.json')!), f.answerMap);
  assert.equal(f.bundle.scans.bundle_sha256, payloadHash(f.bundle.manifest.payload.files as unknown as JsonValue));
  assert.notEqual(f.bundle.scans.bundle_sha256, payloadHash(f.bundle.manifest.payload as unknown as JsonValue));
});
test('real seller denies redacted revoked answer after restart; nonrevoked paid answer passes first', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized');
  await f.service.payment(f.buyer, p.proof);
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'ready');
  const revocation = f.revocation(); await f.service.revoke(revocation);
  const saved = f.store.read('quotes', p.quote.payload.quote_id)!;
  assert.equal(f.store.cleanupContent({ quote_id: p.quote.payload.quote_id, expectedVersion: saved.version, now: f.clock.now() }).reason, 'revoked');
  await f.restart();
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'withheld');
  const retained = f.store.read('quotes', p.quote.payload.quote_id)!.value;
  assert.equal(retained.answer, null); assert.equal(retained.payment_state, 'payment_finalized');
  assert.equal(retained.requested_recovery_atomic, M03.totalAtomic.value.toString());
  assert.equal(retained.refund_state, 'refund_pending');
});
test('safe paid retention leaves existing seller verification fail-closed on absent cached bytes', async (t) => {
  const f = fixture(t); await f.service.start(); const p = await purchase(f); f.setMode('finalized');
  await f.service.payment(f.buyer, p.proof);
  assert.equal((await f.service.answer(f.buyer, p.quote.payload.quote_id)).status, 'ready');
  f.clock.advance(M03.safePaidRetention.value * 86400000); f.setAcknowledged(f.clock.now()); await f.restart();
  const saved = f.store.read('quotes', p.quote.payload.quote_id)!;
  assert.equal(f.store.cleanupContent({ quote_id: p.quote.payload.quote_id, expectedVersion: saved.version, now: f.clock.now() }).reason, 'paid_retention');
  assert.deepEqual(await f.service.answer(f.buyer, p.quote.payload.quote_id), { status: 'withheld', code: 'VERIFICATION_FAILED' });
  assert.equal(f.store.read('quotes', p.quote.payload.quote_id)!.value.answer, null);
});
