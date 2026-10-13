import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness,settle } from './harness.ts';
import { canonicalBytes,payloadHash } from '../../src/wire/index.ts';
import { revokeSlice } from '../../src/seller/index.ts';
import { id } from '../../scripts/integration/synthetic.ts';

test('SIGKILL after signer WAL commit: new process recovers without key/re-sign and preserves reservation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'aab-t11-crash-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const locator=join(dir,'locator');const child=spawnSync(process.execPath,['test/integration/crash-child.ts',locator],{encoding:'utf8',timeout:30000});
 assert.equal(child.signal,'SIGKILL');assert.equal(child.status,null);
 const h=await harness(readFileSync(locator,'utf8'));t.after(()=>h.cleanup());
 const row=h.store.scan('consults',{limit:1})[0]!.value;assert.equal(row.broker?.stage,'signing');
 assert.equal(h.store.scan('reservations',{limit:1})[0]!.value.status,'held');
 await settle(h,h.broker.resume());assert.equal(h.counts.sign,0);assert.equal(h.counts.broadcast,1);
 const delivered=await settle(h,h.broker.market.status(h.buyer,{consult_id:row.view!.consult_id}));assert.equal(delivered.delivery_state,'delivered');
 const receipt=canonicalBytes(h.store.read('receipts',delivered.receipt_id)!.value);await h.reopen();
 const again=await h.broker.market.status(h.buyer,{consult_id:delivered.consult_id});assert.deepEqual(again.answer,delivered.answer);assert.deepEqual(canonicalBytes(h.store.read('receipts',again.receipt_id)!.value),receipt);
 assert.equal(h.counts.sign,0);assert.equal(h.counts.broadcast,1);
});

test('restored seller content backup obeys newest independent tombstone; broker WAL/obligation retained',async t=>{
 const h=await harness();t.after(()=>h.cleanup());const pending=await settle(h,h.broker.market.consult(h.buyer,h.request()));
 const good=await settle(h,h.broker.market.status(h.buyer,{consult_id:pending.consult_id}));assert.equal(good.delivery_state,'delivered');
 const seller=h.sellerRows[1]!,backup=join(h.directory,'old-seller.db');seller.store.backup(backup,payloadHash([]));
 const wal=canonicalBytes(h.store.scan('signed_transactions',{limit:100})[0]!.value);
 await revokeSlice(seller.store,{slice_id:seller.listing.slice.id,manifest_sha256:seller.listing.slice.manifest_sha256,generation:1,revoked_at:h.clock.now(),reason:'safety',approval_id:id('synthetic-withdrawal')},seller.journal);
 await seller.reopen(backup);
 assert.notEqual((await seller.controller.answer(h.buyer,h.proof().quote_id)).status,'ready');
 const bad=await h.broker.market.status(h.buyer,{consult_id:good.consult_id});assert.equal(bad.answer,null);assert.equal(bad.content_state,'revoked');assert.equal(bad.refund_state,'refund_pending');assert.equal(bad.payment_state,'payment_finalized');
 assert.deepEqual(canonicalBytes(h.store.scan('signed_transactions',{limit:100})[0]!.value),wal);assert.equal(h.store.scan('settlements',{limit:100}).length,1);
 await h.reopen();assert.equal((await h.broker.market.status(h.buyer,{consult_id:good.consult_id})).answer,null);
});
