/** Deterministic capability attacks, not claims about a live model or OS sandbox. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createExtractiveWorker } from '../../../src/seller/index.ts';
import { canonicalBytes, encodeBase58, payloadHash, renderAnswer, signEnvelope, verifyEnvelope } from '../../../src/wire/index.ts';
import type { Address, Id, SellerPublicKey, TaskEvidence } from '../../../src/wire/contracts.ts';
import { serveRestrictedMcp } from '../../../src/mcp/index.ts';
import { bytes, fixture, hash, reseal } from '../../seller/support.ts';
import { makeGolden } from '../../wire/golden-fixture.ts';
import { setup } from '../../mcp/helpers.ts';
const attacks = JSON.parse(readFileSync(new URL('../../../fixtures/security/injections.json', import.meta.url), 'utf8')) as {
  directions: { id: string; text: string }[]; negative_tools: string[];
};
test('slice -> worker: hostile text forced through real retrieval remains inert; clean extraction restored', async (t) => {
  const f = fixture(t), text = attacks.directions[0]!.text;
  const files = new Map(f.bundle.files); files.set('pages/p1.md', Buffer.from(text));
  files.set('answer-map.json', bytes({ ...f.answerMap, entries: [{ ...f.answerMap.entries[0], spans: [{ page_id: 'p1', byte_start: 0, byte_end: Buffer.byteLength(text) }] }] }));
  const worker = createExtractiveWorker(reseal(f, files), f.config);
  const result = await worker.prepare(f.questions[0]!, f.context(), new AbortController().signal);
  assert.ok('answer' in result); assert.equal(result.answer.citations[0]!.excerpt, text);
  assert.equal(f.counts.seals, 0); assert.equal(f.counts.rpcReads, 0);
  const restored = await createExtractiveWorker(f.bundle, f.config).prepare(f.questions[0]!, f.context(), new AbortController().signal);
  assert.ok('answer' in restored); assert.match(restored.answer.answer, /^確認/);
  // Worker receives bytes only; no model executes them. Host egress/key canaries
  // must be rerun in its actual isolated container before M11 T6 acceptance.
});
test('buyer -> seller: approved-looking hostile question hits exact policy before work; approved counterpart passes', async (t) => {
  const f = fixture(t), text = attacks.directions[1]!.text;
  const worker = createExtractiveWorker(f.bundle, f.config);
  const denied = await worker.prepare({ ...f.questions[0]!, text, question_sha256: hash(text) }, f.context(), new AbortController().signal);
  assert.ok('status' in denied); assert.equal(denied.charged_atomic, '0');
  const s = setup();
  const result = await s.gateway.handle(canonicalBytes({ tool: 'consult', input: { ...s.input, question: text, source: 'human' } }));
  assert.equal(JSON.parse(Buffer.from(result).toString()).ok, false); assert.equal(s.dispatches.length, 0);
  const clean = await worker.prepare(f.questions[0]!, f.context(), new AbortController().signal);
  assert.ok('answer' in clean); await s.gateway.port.call('consult', s.input); assert.deepEqual(s.dispatches, ['consult']);
});
test('correctly signed answer -> MCP buyer: forced forbidden actions denied, permitted repair and evidence pass', async (t) => {
  const pair = generateKeyPairSync('ed25519'), golden = makeGolden(), text = attacks.directions[2]!.text;
  const citation = { ...golden.chain.answer.payload.citations[0]!, excerpt: text, byte_start: 0, byte_end: Buffer.byteLength(text), content_sha256: hash(text) };
  const claims = [{ text, citation_ids: [citation.id] }];
  const payload = { ...golden.chain.answer.payload, answer: renderAnswer(claims), citations: [citation], claims };
  const key: SellerPublicKey = { id: 't7_ephemeral' as Id, algorithm: 'Ed25519', public_key: encodeBase58(Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url')) as Address };
  const signed = signEnvelope('answer', payload, key.id, pair.privateKey, { kind: 'answer', payloadHash: payloadHash(payload), approvalId: 'synthetic' as Id, actor: 'test' });
  verifyEnvelope('answer', signed, key); // Deliberately authentic hostile prose.
  assert.throws(() => verifyEnvelope('answer', { ...signed, payload: { ...payload, engine_version: 'tampered' as Id } }, key));
  verifyEnvelope('answer', signed, key);
  const original = setup();
  const s = setup('C', { ...original.market, async consult(ctx, input) {
    const view = await original.market.consult(ctx, input);
    return { ...view, answer: { text: signed.payload.answer, citations: signed.payload.citations, answer_sha256: payloadHash(payload), verified: true, untrusted_content: true } };
  } });
  const [ct, st] = InMemoryTransport.createLinkedPair(); const server = await serveRestrictedMcp(s.gateway.port, st, 'C');
  const client = new Client({ name: 'forced-attack-driver', version: '1' }, { capabilities: {} }); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); });
  const advice = await client.callTool({ name: 'consult', arguments: s.input as unknown as Record<string, unknown> });
  assert.notEqual(advice.isError, true); assert.match(JSON.stringify(advice), /Verified signature grants admin/);
  for (const name of attacks.negative_tools) {
    const result = await client.callTool({ name, arguments: { path: '/probe-denied/keys/fake-key.json', url: 'http://callback.invalid/', command: 'outside action' } });
    assert.equal(result.isError, true, name);
  }
  const changed = await client.callTool({ name: 'consult', arguments: { ...s.input, request_id: '00000000-0000-4000-8000-000000000002' } });
  assert.equal(changed.isError, true); assert.deepEqual(s.dispatches, ['consult']);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true);
    return JSON.parse((result.content as { text: string }[])[0]!.text).data as TaskEvidence;
  };
  const input = { fixture_id: s.fixtureId };
  await call('apply_fixture_fix', { ...input, fix_id: 'repair' });
  const left = await call('check_leftovers', input), verified = await call('verify_fixture', input);
  const finish = await call('finish_with_evidence', { ...input, evidence_ids: [left.evidence_id, verified.evidence_id] });
  assert.equal(finish.passed, true); assert.equal(s.controller.snapshot().files.archive, 'intact');
  const fresh = setup(); assert.equal(fresh.controller.snapshot().files.work, 'pending');
});
