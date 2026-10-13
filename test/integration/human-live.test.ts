import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fixture } from '../chain/support.ts';
import { M03, canonicalBytes, strictJson, payloadHash, bytesHash } from '../../src/wire/index.ts';
import { openStore, FixedClock, FoundationError } from '../../src/common/index.ts';
import { RpcRateLimitError, HumanCliSigner, MemorySignJournal, StoreSignJournal, attachSignature, handleHumanSignerMessage, validatePaymentAccounts, validateSignRequest, generateThrowawayKey, buildLegacyPayment } from '../../src/chain/index.ts';
import type { SignRequest, SignResult, Signature } from '../../src/wire/contracts.ts';
import { createCeremony, recoverCeremony, requestBytes, readRequest } from '../../scripts/chain/human-live-ceremony.ts';
import type { CeremonyEvidence } from '../../scripts/chain/human-live-ceremony.ts';
import { parsePacket, openFrozenSnapshot, assertSetupBinding } from '../../scripts/chain/human-live-helper.ts';
import { reviewHumanOffer, parseFlags, requireClean, claimActive, pacedTransport, verifyHumanSettlement } from '../../scripts/chain/human-live-runtime.ts';
import { brokerLaunch, parseConfig } from '../../scripts/integration/gate1-human-live.ts';
import { writePrivate, readPrivate } from '../../scripts/chain/setup-storage.ts';

const cliArgs=['--execute','--run','human1','--primary','https://primary.example/','--secondary','https://secondary.example/','--seller-ports','18191,18192'];
function dry() {
  const f=fixture(); let tty=true, phrase=true, denied=false, loads=0, prompts=0; const displays:string[]=[];
  const journal=new MemorySignJournal();
  const ceremony=createCeremony(f.request,{publicKey:f.key.publicKey,clock:f.clock,journal,
    keyBytes:()=>{loads++;return f.key.keyBytes;},terminal:{isTTY:()=>tty,async approve(display){prompts++;displays.push(display);return phrase?`approve ${f.request.messageHash}`:'approve';}},
    authorize:async(_,expected)=>{if(denied)throw new FoundationError('POLICY_DENIED');await validatePaymentAccounts(expected,f.primary);},
  });
  return {f,ceremony,journal,displays,get loads(){return loads;},get prompts(){return prompts;},set tty(v:boolean){tty=v;},set phrase(v:boolean){phrase=v;},set denied(v:boolean){denied=v;}};
}
async function purchase(d:ReturnType<typeof dry>) {
  let evidence:CeremonyEvidence|null=null;
  const client=new HumanCliSigner({endpoint:'/unused',expectedPublicKey:d.f.key.publicKey},async bytes=>{
    const frame=strictJson(bytes) as {operation:string;value:unknown};
    assert.equal(frame.operation,'sign');assert.deepEqual(readRequest(canonicalBytes(frame.value)),readRequest(requestBytes(d.f.request)));
    const out=await d.ceremony.sign();evidence=out.evidence;return canonicalBytes({ok:true,result:out.result});
  });
  const result=await client.sign(d.f.request); const signed=attachSignature(d.f.payment,result);
  await d.f.primary.broadcastIdentical(signed.transaction);
  return {result,signed,evidence:evidence as unknown as CeremonyEvidence};
}

test('test-only dry purchase: frozen display, human IPC signer, exact signature, split, substitution and dual finality',async()=>{
  const d=dry(),p=await purchase(d);
  assert.equal(d.loads,1);assert.equal(d.prompts,1);assert.equal(d.f.primary.broadcasts,1);
  const display=d.displays[0]!;
  for(const value of [d.f.request.expectedPayer,d.f.quote.payload.mint,d.f.quote.payload.seller_token_account,d.f.quote.payload.marketplace_token_account,
    String(M03.sellerAtomic.value),String(M03.marketplaceAtomic.value),d.f.quote.payload.memo,d.f.request.messageHash,'lastValidBlockHeight','Fee payer:'])assert.ok(display.includes(value),value);
  const finality=await verifyHumanSettlement(d.f.request,p.evidence,p.signed.signature,d.f.primary,d.f.secondary);
  assert.equal(finality.evidence.payer_debit,String(M03.totalAtomic.value));assert.equal(finality.evidence.seller_credit,String(M03.sellerAtomic.value));assert.equal(finality.evidence.marketplace_credit,String(M03.marketplaceAtomic.value));
  assert.equal(p.evidence.substitution_signatures,0);assert.equal(p.evidence.substitution_refused,true);
  assert.deepEqual(await d.ceremony.helper.recover(d.f.request.requestId,d.f.request.messageHash),p.result);
  assert.equal(d.loads,1);d.f.key.keyBytes.fill(0);
});
for(const guard of ['tty','phrase','policy'] as const)test(`approval ${guard}: refused with zero key loads/broadcast; restored clean counterpart signs`,async()=>{
  const d=dry();if(guard==='tty')d.tty=false;if(guard==='phrase')d.phrase=false;if(guard==='policy')d.denied=true;
  if(guard==='policy')await assert.rejects(d.ceremony.sign());else assert.equal((await d.ceremony.sign()).result.status,'denied');
  assert.equal(d.loads,0);assert.equal(d.f.primary.broadcasts,0);
  d.tty=true;d.phrase=true;d.denied=false;await purchase(d);assert.equal(d.loads,1);assert.equal(d.f.primary.broadcasts,1);
});
for(const guard of ['unknown','duplicate','utf8','base64','changedMessage','changedHash','mainnet'] as const)test(`strict request ${guard}: rejected then clean request restored`,()=>{
  const f=fixture();let raw=requestBytes(f.request);
  if(guard==='unknown')raw=Buffer.from(Buffer.from(raw).toString().replace('{','{"unknown":true,'));
  if(guard==='duplicate')raw=Buffer.from(Buffer.from(raw).toString().replace('{','{"network":"devnet",'));
  if(guard==='utf8')raw=Uint8Array.from([0xff]);
  if(guard==='base64')raw=canonicalBytes({...f.request,message:'?'});
  if(guard==='changedMessage'){const changed=Uint8Array.from(f.request.message);changed[changed.length-1]!^=1;raw=requestBytes({...f.request,message:changed});}
  if(guard==='changedHash')raw=requestBytes({...f.request,messageHash:payloadHash('wrong')});
  if(guard==='mainnet')raw=requestBytes({...f.request,network:'mainnet-beta'});
  assert.throws(()=>readRequest(raw));assert.equal(readRequest(requestBytes(f.request)).messageHash,f.request.messageHash);
});
test('substitution reaches helper, yields no signature, then original signs; coherently changed message also denied',async()=>{
  const d=dry(),bad=Uint8Array.from(d.f.request.message);bad[bad.length-1]!^=1;
  const response=strictJson(await handleHumanSignerMessage(canonicalBytes({operation:'sign',value:{...d.f.request,message:Buffer.from(bad).toString('base64')}}),d.ceremony.helper));
  assert.deepEqual(response,{ok:false,result:null});assert.equal(d.loads,0);
  const alternate=buildLegacyPayment(d.f.request.quote,d.f.payment.expected.payer,{...d.f.request.blockhash,blockhash:generateThrowawayKey().publicKey});
  const changed:SignRequest={...d.f.request,message:alternate.message,messageHash:alternate.messageHash,blockhash:alternate.expected.blockhash,arm:{...d.f.request.arm,payload:{...d.f.request.arm.payload,message_sha256:alternate.messageHash,recent_blockhash:alternate.expected.blockhash.blockhash}}};
  await assert.rejects(d.ceremony.helper.sign(changed),/PAYMENT_INVALID/);assert.equal(d.loads,0);
  await purchase(d);assert.equal(d.loads,1);
});
for(const guard of ['tty','phrase','substitution','count','hash','signature','unknown','sameMutation','confirmed','unavailable','sameProvider','wrongDelta','failedTx'] as const)test(`PASS gate ${guard}: rejected; clean two-provider evidence passes`,async()=>{
  const d=dry(),p=await purchase(d),human={...p.evidence};
  if(guard==='tty')human.tty=false;if(guard==='phrase')human.exactPhrase=false;if(guard==='substitution')human.substitution_refused=false;if(guard==='count')human.substitution_signatures=1;
  if(guard==='hash')human.messageHash=payloadHash('wrong');if(guard==='signature')human.signature='bad';if(guard==='unknown')Object.assign(human,{extra:true});if(guard==='sameMutation')human.substituted_message_sha256=human.messageHash;
  if(guard==='confirmed')d.f.primary.state.status='confirmed';if(guard==='unavailable')d.f.secondary.unavailable=true;
  const original=d.f.primary.state.transactions.get(p.signed.signature)!;
  if(guard==='wrongDelta'){const changed={...original,meta:{...original.meta,postTokenBalances:original.meta.postTokenBalances.map((v,i)=>i===0?{...v,amount:'0' as never}:v)}};d.f.primary.state.transactions.set(p.signed.signature,changed);}
  if(guard==='failedTx')d.f.primary.state.transactions.set(p.signed.signature,{...original,meta:{...original.meta,err:{InstructionError:[1,{Custom:17}]}}});
  await assert.rejects(verifyHumanSettlement(d.f.request,human,p.signed.signature,d.f.primary,guard==='sameProvider'?d.f.primary:d.f.secondary));
  d.f.primary.state.status='finalized';d.f.secondary.unavailable=false;d.f.primary.state.transactions.set(p.signed.signature,original);
  assert.equal((await verifyHumanSettlement(d.f.request,p.evidence,p.signed.signature,d.f.primary,d.f.secondary)).status,'finalized_success');
});
test('durable helper restart recovers identical signed bytes without loading a key or asking again',async t=>{
  const root=mkdtempSync(join(tmpdir(),'aab-human-live-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const f=fixture();let store=openStore(join(root,'helper.db')),loads=0;
  const ceremony=createCeremony(f.request,{publicKey:f.key.publicKey,clock:f.clock,journal:new StoreSignJournal(store),terminal:{isTTY:()=>true,approve:async()=>`approve ${f.request.messageHash}`},authorize:async()=>{},keyBytes:()=>{loads++;return f.key.keyBytes;}});
  const out=await ceremony.sign();store.close();store=openStore(join(root,'helper.db'));t.after(()=>store.close());
  const journal=new StoreSignJournal(store);assert.throws(()=>journal.read(f.request.requestId,payloadHash('wrong')));
  assert.deepEqual(journal.read(f.request.requestId,f.request.messageHash),out.result);assert.equal(loads,1);
});
for(const guard of ['execute','dryRun','duplicate','unknown','run','scheme','origin','credentials','canonical','port'] as const)test(`CLI ${guard}: rejected; clean flags accepted`,()=>{
  const bad=[...cliArgs];if(guard==='execute')bad[0]='--dry-run';if(guard==='dryRun')bad.push('--dry-run','true');if(guard==='duplicate')bad.push('--run','human2');if(guard==='unknown')bad.push('--key','/tmp/forbidden-wallet.json');
  if(guard==='run')bad[2]='../outside';if(guard==='scheme')bad[4]='http://primary.example/';if(guard==='origin')bad[6]='https://primary.example/other';if(guard==='credentials')bad[4]='https://secret@primary.example/';if(guard==='canonical')bad[4]='https://primary.example';if(guard==='port')bad[8]='18191,18191';
  assert.throws(()=>parseFlags(bad));assert.equal(parseFlags(cliArgs).run,'human1');
});
test('revision and active-run guards reject dirty/replacement; clean same-run retains the same bytes',t=>{
  assert.throws(()=>requireClean(true),/COMMIT_REVIEWED/);requireClean(false);
  const root=realpathSync(mkdtempSync(join(tmpdir(),'aab-human-active-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'active.json');
  claimActive(path,'one');const original=readPrivate(path);assert.throws(()=>claimActive(path,'two'),/RECONCILIATION/);claimActive(path,'one');assert.deepEqual(readPrivate(path),original);
});
test('persisted run strict parsing rejects tampering and restores clean configuration',()=>{
  const f=fixture(),config={v:1,sha:'a'.repeat(40),createdAt:f.clock.now(),primary:'https://primary.example/',secondary:'https://secondary.example/',ports:[18191,18192],requests:[f.request.requestId,f.request.requestId],tokens:['one','two']};
  for(const bad of [{...config,v:2},{...config,sha:'bad'},{...config,ports:[0,1]},{...config,requests:[]},{...config,extra:true}])assert.throws(()=>parseConfig(canonicalBytes(bad)));
  assert.equal(parseConfig(canonicalBytes(config)).sha,config.sha);
});
test('actual broker launch environment/args contain no injected key path or ephemeral bytes',()=>{
  const f=fixture(),keyPath=join(tmpdir(),'ephemeral-buyer.json'),secret=Buffer.from(f.key.keyBytes).toString('base64');
  const old=process.env.AAB_WALLET;process.env.AAB_WALLET=`${keyPath}:${secret}`;
  try {
    assert.throws(()=>brokerLaunch([...cliArgs,'--key',keyPath]));
    const launch=brokerLaunch(cliArgs);
    const result=spawnSync(process.execPath,['--input-type=module','-e','process.stdout.write(JSON.stringify({args:process.argv.slice(1),env:process.env}))','--',...launch.args],{env:launch.env,encoding:'utf8'});
    assert.equal(result.status,0);assert.ok(!result.stdout.includes(keyPath));assert.ok(!result.stdout.includes(secret));
    const actual=JSON.parse(result.stdout);assert.deepEqual(actual.args,launch.args);assert.ok(Object.keys(actual.env).every(k=>k==='__CF_USER_TEXT_ENCODING'));
    // The launcher always strips inherited runtime injection too.
    assert.ok(!Object.hasOwn(launch.env,'NODE_OPTIONS'));
  }finally{if(old===undefined)delete process.env.AAB_WALLET;else process.env.AAB_WALLET=old;}
});
test('CLI has no test approval mode: detached non-TTY execute/helper refuse, --help succeeds',async()=>{
  async function detached(path:string,args:readonly string[]){return await new Promise<{status:number|null;stderr:string;stdout:string}>((done,reject)=>{const child=spawn(process.execPath,[path,...args],{detached:true,env:{},stdio:['ignore','pipe','pipe']});let stderr='',stdout='';child.stderr.on('data',b=>{stderr+=b;});child.stdout.on('data',b=>{stdout+=b;});child.on('error',reject);child.on('exit',status=>done({status,stderr,stdout}));});}
  for(const [path,args] of [['scripts/integration/gate1-human-live.ts',cliArgs],['scripts/chain/human-live-helper.ts',['--packet','/tmp/nonexistent','e30=']]] as const){
    const out=await detached(path,args);assert.notEqual(out.status,0);assert.match(out.stderr,/TTY|STOPPED/);
  }
  const help=await detached('scripts/integration/gate1-human-live.ts',['--help']);assert.equal(help.status,0);assert.match(help.stdout,/real TTY/);
});
test('secondary transport serializes parallel calls and retries only throttling; clean response survives',async()=>{
  const clock=new FixedClock('2026-10-09T00:00:00Z'),times:number[]=[];let calls=0;
  const pacingClock={now:()=>clock.now(),monotonicMs:()=>clock.monotonicMs(),sleep:async(ms:number)=>{clock.advance(ms);}};
  const rpc=pacedTransport(async()=>{times.push(clock.monotonicMs());return canonicalBytes(++calls===1?{error:{code:-32029}}:{result:'clean'});},pacingClock);
  const results=await Promise.all([rpc('https://secondary.example/',new Uint8Array(),new AbortController().signal),rpc('https://secondary.example/',new Uint8Array(),new AbortController().signal)]);
  assert.equal(calls,3);assert.ok(times.slice(1).every((v,i)=>v-times[i]!>=M03.paymentPoll.value[0]*1000));for(const r of results)assert.deepEqual(strictJson(r),{result:'clean'});
  let bad=0;const errors=pacedTransport(async()=>{bad++;throw new Error('OFFLINE');},pacingClock);await assert.rejects(errors('x',new Uint8Array(),new AbortController().signal),/OFFLINE/);assert.equal(bad,1);
  const malformed=pacedTransport(async()=>Buffer.from('{"result":1,"result":2}'),pacingClock);await assert.rejects(malformed('x',new Uint8Array(),new AbortController().signal));
});

test('helper snapshot hash refusal and clean repeated opens preserve the frozen original',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'aab-human-frozen-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=openStore(join(root,'source.db'));t.after(()=>source.close());
  const path=join(root,'frozen.db'),backup=source.backup(path,payloadHash([]));
  assert.throws(()=>openFrozenSnapshot(path,payloadHash('tampered')),/SNAPSHOT_CHANGED/);
  for(let i=0;i<2;i++){const copy=openFrozenSnapshot(path,backup.sha256);assert.equal(copy.store.scan('reservations',{limit:1}).length,0);copy.close();assert.equal(bytesHash(readFileSync(path)),backup.sha256);}
});
test('helper packet strict parser rejects duplicate/unknown/UTF8/overlimit fields; clean packet restores',()=>{
  const f=fixture(),key={id:'seal',algorithm:'Ed25519',public_key:generateThrowawayKey().publicKey};
  const packet={request:Buffer.from(requestBytes(f.request)).toString('base64'),primary:'https://primary.example/',snapshot:'/tmp/snapshot',snapshotHash:payloadHash('snapshot'),sellerKey:key,evidence:'/tmp/evidence'};
  const clean=canonicalBytes(packet);
  for(const bad of [canonicalBytes({...packet,unknown:1}),Buffer.from(Buffer.from(clean).toString().replace('{','{"primary":"https://other.example/",')),Uint8Array.from([0xff]),new Uint8Array(M03.ingressBodyMax.value*1024+1)])assert.throws(()=>parsePacket(bad));
  assert.equal(parsePacket(clean).request,packet.request);
});
for(const field of ['genesis','pending','empty','buyer','buyerAta','mint','seller','sellerAta','marketplace','marketplaceAta','seal'] as const)test(`helper setup binding ${field}: refuses then exact setup passes`,()=>{
  const f=fixture(),q=f.request.quote.payload,seal=generateThrowawayKey().publicKey;
  const setup={genesis:f.request.genesis,entries:[{state:'finalized'}],addresses:{buyer:q.payer,buyerAta:f.payment.expected.payer.tokenAccount,mint:q.mint,seller:q.seller_owner,sellerAta:q.seller_token_account,marketplace:q.marketplace_owner,marketplaceAta:q.marketplace_token_account,seal}};
  const key={id:'seal' as never,algorithm:'Ed25519' as const,public_key:seal};const bad=structuredClone(setup);
  if(field==='genesis')bad.genesis=generateThrowawayKey().publicKey;if(field==='pending')bad.entries[0]!.state='pending';if(field==='empty')bad.entries=[];
  if(field!=='genesis'&&field!=='pending'&&field!=='empty')bad.addresses[field]=generateThrowawayKey().publicKey;
  assert.throws(()=>assertSetupBinding(f.request,bad as never,key),/SETUP_BINDING/);assertSetupBinding(f.request,setup as never,key);
});
test('offer review requires real-terminal predicate and exact quote phrase; clean review passes',async()=>{
  const f=fixture(),offer={quote:f.request.quote,quoteHash:payloadHash(f.request.quote.payload),terms:'synthetic'};let prompts=0;
  assert.equal((await reviewHumanOffer(offer,f.clock,{isTTY:()=>false,approve:async()=>{prompts++;return `review ${offer.quoteHash}`;}})).status,'denied');assert.equal(prompts,0);
  assert.equal((await reviewHumanOffer(offer,f.clock,{isTTY:()=>true,approve:async()=>`review wrong`})).status,'denied');
  assert.equal((await reviewHumanOffer(offer,f.clock,{isTTY:()=>true,approve:async display=>{assert.ok(display.includes(offer.quoteHash));return `review ${offer.quoteHash}`;}})).status,'approved');
});

test('lost-reply recovery refuses missing/tampered human evidence, never signs; restored original recovers',async()=>{
  const d=dry();assert.equal(recoverCeremony(d.f.request,d.journal,null),null);assert.equal(d.loads,0);
  const p=await purchase(d);assert.throws(()=>recoverCeremony(d.f.request,d.journal,null),/MISSING_ORIGINAL/);
  assert.throws(()=>recoverCeremony(d.f.request,d.journal,{...p.evidence,tty:false}),/EVIDENCE_REQUIRED/);
  assert.deepEqual(recoverCeremony(d.f.request,d.journal,p.evidence),p.result);assert.equal(d.loads,1);assert.equal(d.prompts,1);
});
test('secondary transport HTTP throttling is bounded, abort blocks I/O, clean queue recovers and raw attempts are retained',async()=>{
  let now=0,calls=0,fail=true,observations=0;
  const clock={now:()=>new FixedClock('2026-10-09').now(),monotonicMs:()=>now,sleep:async(ms:number)=>{now+=ms;}};
  const rpc=pacedTransport(async()=>{calls++;if(fail)throw new RpcRateLimitError(0);return canonicalBytes({result:'ok'});},clock,()=>{observations++;});
  await assert.rejects(rpc('x',new Uint8Array(),new AbortController().signal),/RPC_RATE_LIMIT/);assert.equal(calls,M03.paymentPoll.value.length+1);
  const before=calls;await assert.rejects(rpc('x',new Uint8Array(),AbortSignal.abort()));assert.equal(calls,before);
  fail=false;assert.deepEqual(strictJson(await rpc('x',new Uint8Array(),new AbortController().signal)),{result:'ok'});assert.equal(observations,1);
});
