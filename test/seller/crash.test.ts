import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, bytes, settle } from './support.ts';

for (const phase of ['before', 'after']) test(`SIGKILL ${phase} quote+answer transaction: restart exposes only committed bytes`, async (t) => {
  const f = fixture(t); await f.service.start(); const request = f.request(); const original = await settle(f, f.service.quote(f.buyer, request));
  assert.equal(original.status, 'ready'); if (original.status !== 'ready') return;
  const row = f.store.read('quotes', original.quote.payload.quote_id)!.value;
  const requestRow = f.store.read('consults', row.seller_request_key)!.value;
  const packetPath = join(f.directory, 'public-packet.json'); writeFileSync(packetPath, bytes({ quote: row, request: requestRow }));
  const target = join(f.directory, `crash-${phase}.db`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./crash-child.ts', import.meta.url)), target, packetPath, phase], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.signal, 'SIGKILL'); assert.equal(result.status, null);
  await f.restart(target);
  assert.equal(f.store.scan('quotes', { limit: 1 }).length, phase === 'after' ? 1 : 0);
  assert.equal(f.store.scan('consults', { limit: 1 }).length, phase === 'after' ? 1 : 0);
  const recovered = await settle(f, f.service.quote(f.buyer, request)); assert.equal(recovered.status, 'ready');
  if (phase === 'after') { assert.deepEqual(recovered, original); assert.equal(f.counts.preparations, 1); }
  else assert.equal(f.counts.preparations, 2);
});
