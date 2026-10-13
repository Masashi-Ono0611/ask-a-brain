import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { StrictStdioTransport } from '../../src/mcp/index.ts';

// Exact initialize message measured from Codex 0.160.0 (decision L8): two inert client capability declarations.
const codexInitialize = (capabilities: unknown) => Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities, clientInfo: { name: 'codex-mcp-client', title: 'Codex', version: '0.160.0' } } }) + '\n');

async function feed(bytes: Buffer): Promise<{ seen: number; errors: number }> {
  const input = new PassThrough(), output = new PassThrough(), transport = new StrictStdioTransport(input, output);
  let seen = 0, errors = 0; transport.onmessage = () => { seen++; }; transport.onerror = () => { errors++; };
  await transport.start(); input.write(bytes); await transport.close(); input.destroy(); output.destroy();
  return { seen, errors };
}

test('the measured Codex initialize is accepted; every other or non-empty capability is refused', async () => {
  const clean = await feed(codexInitialize({ experimental: { 'codex/auth-change': {} }, elicitation: { form: {}, url: {} } }));
  assert.deepEqual(clean, { seen: 1, errors: 0 });
  assert.deepEqual(await feed(codexInitialize({})), { seen: 1, errors: 0 });
  for (const bad of [
    { sampling: {} }, { roots: { listChanged: true } }, { experimental: { 'other/capability': {} } },
    { experimental: { 'codex/auth-change': { enabled: true } } }, { elicitation: { form: { schema: 1 } } }, { elicitation: { form: {}, extra: {} } },
  ]) {
    const result = await feed(codexInitialize(bad));
    assert.deepEqual(result, { seen: 0, errors: 1 }, JSON.stringify(bad));
  }
  // restored: the clean message still passes after the refusals
  assert.deepEqual(await feed(codexInitialize({ elicitation: { form: {} } })), { seen: 1, errors: 0 });
});

const listWith = (params: unknown) => Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params }) + '\n');
test('tools/list accepts only an integer progressToken in _meta (measured Codex shape); other params stay refused', async () => {
  assert.deepEqual(await feed(listWith({ _meta: { progressToken: 0 } })), { seen: 1, errors: 0 });
  assert.deepEqual(await feed(listWith({})), { seen: 1, errors: 0 });
  for (const bad of [{ cursor: 'x' }, { _meta: { progressToken: 'a' } }, { _meta: { progressToken: -1 } }, { _meta: { progressToken: 1.5 } }, { _meta: { other: 1 } }, { _meta: {}, extra: 1 }]) {
    assert.deepEqual(await feed(listWith(bad)), { seen: 0, errors: 1 }, JSON.stringify(bad));
  }
  assert.deepEqual(await feed(listWith({ _meta: { progressToken: 7 } })), { seen: 1, errors: 0 });
});

const callWith = (meta: unknown, args: unknown = { fixture_id: 'I2' }) => Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: meta, name: 'inspect_fixture', arguments: args } }) + '\n');
// Shape measured from Codex 0.160.0 (decision L8): ids, progress token and a flat turn-metadata record.
const measuredMeta = () => ({ callId: 'exec-ff0fc7b7', itemId: 'item_1', progressToken: 1, sessionId: '01a1243b', threadId: '01a1243b', windowId: 'w1',
  'x-codex-turn-metadata': { session_id: 's', thread_id: 't', reasoning_effort: 'medium', turn_id: 'u', model: 'gpt-6.1-sol', thread_source: 'user', turn_trigger: 'exec',
    sandbox: 'seatbelt', sandbox_mode: 'read-only', auto_review_enabled: false, node_repl_auto_review_required: true, node_repl_disabled: false, turn_started_at_unix_ms: 1791609213054, codex_version: '0.160.0' } });
test('tools/call accepts the measured Codex _meta; unknown keys, nesting and oversize values are refused', async () => {
  assert.deepEqual(await feed(callWith(measuredMeta())), { seen: 1, errors: 0 });
  assert.deepEqual(await feed(callWith(undefined)), { seen: 1, errors: 0 });
  const bad: unknown[] = [
    { ...measuredMeta(), extra: 'x' }, { ...measuredMeta(), callId: 5 }, { ...measuredMeta(), callId: 'x'.repeat(201) }, { ...measuredMeta(), progressToken: 'a' },
    { ...measuredMeta(), 'x-codex-turn-metadata': { nested: { a: 1 } } }, { ...measuredMeta(), 'x-codex-turn-metadata': { k: 'x'.repeat(201) } },
    { ...measuredMeta(), 'x-codex-turn-metadata': { list: [1] } }, { ...measuredMeta(), 'x-codex-turn-metadata': [] },
    { ...measuredMeta(), 'x-codex-turn-metadata': Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 1])) },
  ];
  for (const meta of bad) assert.deepEqual(await feed(callWith(meta)), { seen: 0, errors: 1 }, JSON.stringify(meta).slice(0, 80));
  assert.deepEqual(await feed(callWith(measuredMeta())), { seen: 1, errors: 0 }); // restored
});
