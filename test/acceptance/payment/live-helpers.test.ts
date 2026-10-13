import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setMarketplaceFrozen } from '../../../scripts/integration/freeze.ts';
import { generateThrowawayKey,DEVNET_GENESIS,MAINNET_GENESIS,decodeSignedPayment,decodeLegacy,TOKEN_PROGRAM } from '../../../src/chain/index.ts';
import type { JsonRpcClient } from '../../../src/chain/index.ts';
import { FixedClock } from '../../../src/common/index.ts';
import { gateReport,verdicts } from '../../../scripts/integration/evidence.ts';
import { main as live } from '../../../scripts/integration/gate1-live.ts';
import { main as human } from '../../../scripts/integration/gate1-human.ts';

test('devnet-only freeze/thaw helper journals before broadcast and reuses identical bytes; bad cluster signs nothing',async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'aab-t11-freeze-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const key=generateThrowawayKey(),pub=()=>generateThrowawayKey().publicKey;
 const a={buyer:key.publicKey,seller:pub(),marketplace:pub(),mint:pub(),buyerAta:pub(),sellerAta:pub(),marketplaceAta:pub()};
 const clock=new FixedClock('2026-10-09T00:00:00.000Z'),transactions=new Map<string,string>();let state=1,sends=0,genesis=MAINNET_GENESIS;
 const rpc={async genesis(){return genesis;},async latestBlockhash(){return {blockhash:pub(),lastValidBlockHeight:100,observedAt:clock.now()};},async finalizedHeight(){return 1;},async accounts(){return {accounts:[{data:Object.assign(Buffer.alloc(165),{108:state})}]};},async call(method:string,params:unknown[]){
  if(method==='getTransaction'){const value=transactions.get(String(params[0]));return value?{transaction:[value,'base64'],meta:{err:null}}:null;}
  assert.equal(method,'sendTransaction');const bytes=Buffer.from(String(params[0]),'base64'),signed=decodeSignedPayment(bytes),message=decodeLegacy(signed.message);assert.equal(message.instructions.length,1);
  const instruction=message.instructions[0]!;assert.equal(message.accountKeys[instruction.programIdIndex],TOKEN_PROGRAM);assert.deepEqual(instruction.accountIndices.map(i=>message.accountKeys[i]),[a.marketplaceAta,a.mint,a.buyer]);
  const operation=instruction.data[0]===10?'freeze':'thaw';assert.equal(JSON.parse(readFileSync(join(root,`${operation}.json`),'utf8')).transaction,params[0]);
  state=operation==='freeze'?2:1;sends++;transactions.set(signed.signature,String(params[0]));return signed.signature;
 }} as unknown as JsonRpcClient;
 const options={root,rpc,clock:{now:()=>clock.now(),monotonicMs:()=>clock.monotonicMs(),sleep:async(ms:number)=>clock.advance(ms)},addresses:a,buyerKey:key.keyBytes,frozen:true};
 await assert.rejects(setMarketplaceFrozen(options),/DEVNET_ONLY/);assert.equal(sends,0);
 genesis=DEVNET_GENESIS;const first=await setMarketplaceFrozen(options);assert.equal(sends,1);assert.equal(state,2);
 assert.equal(await setMarketplaceFrozen(options),first);assert.equal(sends,1);
 await setMarketplaceFrozen({...options,frozen:false});assert.equal(state,1);assert.equal(sends,2);
 assert.equal(await setMarketplaceFrozen({...options,frozen:false}),[...transactions.keys()][1]);assert.equal(sends,2);
});

test('unobserved/failed or dirty revision cannot pass gate; even full evidence does not activate paid/mainnet',()=>{
 const rev={sha:'a'.repeat(40),dirty:false,source_sha256:'b'.repeat(64),node:process.version},items=verdicts();
 assert.equal(gateReport(rev,items).gate1,'UNVERIFIED_OR_FAILED');
 for(const k of Object.keys(items) as (keyof typeof items)[])items[k]={status:'PASS',evidence:['lead-observed'],reason:'synthetic gate reducer control only'};
 assert.equal(gateReport(rev,items).gate1,'PASS');assert.equal(gateReport(rev,items).paid_mode,false);assert.equal(gateReport(rev,items).mainnet_enabled,false);
 assert.equal(gateReport({...rev,dirty:true},items).gate1,'UNVERIFIED_OR_FAILED');items.b.status='FAIL';assert.equal(gateReport(rev,items).gate1,'UNVERIFIED_OR_FAILED');
});

test('live entrypoint help is inert; malformed execution and non-TTY ceremony fail closed',async()=>{
 await assert.rejects(live([]),/EXPLICIT_EXECUTE_REQUIRED/);await assert.rejects(live(['--execute','--run','../outside']),/INVALID_RUN/);
 await live(['--help']);assert.throws(()=>human(['--run','test']),/FOUNDER_TTY_REQUIRED/);
});
