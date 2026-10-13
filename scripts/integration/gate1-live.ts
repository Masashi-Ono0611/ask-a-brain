import type { SellerConfig } from '../../src/seller/index.ts';
/** LEAD RUNS ONLY after committing the reviewed SHA. NO MAINNET path.
 * --execute --run ID --primary HTTPS_URL/ --secondary HTTPS_URL/
 * --seller-ports PORT,PORT [--fault after-sign|after-broadcast|after-receipt|after-freeze|before-thaw]
 * Repeat the EXACT run/flags without --fault to recover, never delete state.
 * Raw RPC and verdicts are public; key bytes, tokens and WAL remain private.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemClock, openStore, atomicFromBigint, lamportsFromBigint } from '../../src/common/index.ts';
import { M03, canonicalBytes, bytesHash, payloadHash, strictJson } from '../../src/wire/index.ts';
import { createRpcClient, fetchRpcTransport, RpcRateLimitError, DEVNET_GENESIS, generateThrowawayKey, importCliKey, parseCliKey, TestSigner, StoreSignJournal, validateLegacyMessage, reconcilePayment, decodeSignedPayment, associatedTokenAddress } from '../../src/chain/index.ts';
import type { BrokerDeps, BuyerContext, ConsultInput, ConsultView, Id, IsoTime, RpcClient, Signature } from '../../src/wire/contracts.ts';
import { FileTombstoneJournal, createExtractiveWorker } from '../../src/seller/index.ts';
import { createSellerHttpClient } from '../../src/broker/index.ts';
import { startSeller } from '../seller.ts';
import { composeBroker } from '../broker.ts';
import { privateDirectory, readPrivate, writePrivate, fileSetupJournal } from '../chain/setup-storage.ts';
import { syntheticMarket, wire, id } from './synthetic.ts';
import type { Addresses } from './synthetic.ts';
import { setMarketplaceFrozen } from './freeze.ts';
import { evidenceDirectory, gateReport, revision, verdicts, writeEvidence } from './evidence.ts';

interface RunConfig { v:1; sha:string; createdAt:IsoTime; primary:string; secondary:string; ports:number[]; requests:string[]; tokens:string[] }
function parseConfig(bytes:Uint8Array):RunConfig {
  const x=strictJson(bytes) as unknown as RunConfig;
  if(!x || Object.keys(x).sort().join(',')!=='createdAt,ports,primary,requests,secondary,sha,tokens,v' || x.v!==1 || !/^[a-f0-9]{40}$/.test(x.sha) || !Number.isFinite(Date.parse(x.createdAt)) || typeof x.primary!=='string' || typeof x.secondary!=='string' || !Array.isArray(x.ports) || x.ports.length!==2 || !x.ports.every(p=>Number.isSafeInteger(p)&&p>0&&p<65536) || !Array.isArray(x.requests) || x.requests.length!==2 || !x.requests.every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)) || !Array.isArray(x.tokens) || x.tokens.length!==2 || !x.tokens.every(v=>typeof v==='string'&&v.length>0)) throw new Error('INVALID_RUN_CONFIG'); return x;
}
export async function main(args:readonly string[]) {
  if(args.length===1 && args[0]==='--help') { console.log('LEAD ONLY: node scripts/integration/gate1-live.ts --execute --run ID --primary HTTPS_URL/ --secondary HTTPS_URL/ --seller-ports PORT,PORT [--fault after-sign|after-broadcast|after-receipt|after-freeze|before-thaw]. Repeat same run without fault to recover. Requires completed .local/devnet/t2 setup. TestSigner/synthetic content; Gate1(f) remains UNVERIFIED.'); return; }
  if(args[0]!=='--execute') throw new Error('EXPLICIT_EXECUTE_REQUIRED');
  const flags=new Map<string,string>();
  for(let i=1;i<args.length;i+=2) {const k=args[i]!,v=args[i+1]; if(!['--run','--primary','--secondary','--seller-ports','--fault'].includes(k)||!v||flags.has(k)) throw new Error('INVALID_FLAGS'); flags.set(k,v);}
  const run=flags.get('--run')??'', primaryUrl=flags.get('--primary')??'', secondaryUrl=flags.get('--secondary')??'';
  if(!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('INVALID_RUN');
  const urls=[primaryUrl,secondaryUrl].map(v=>new URL(v));
  if(urls.some(u=>u.protocol!=='https:'||u.href!==(u===urls[0]?primaryUrl:secondaryUrl)||u.username||u.password||u.hash) || urls[0]!.origin===urls[1]!.origin) throw new Error('DISTINCT_CANONICAL_RPC_REQUIRED');
  const ports=(flags.get('--seller-ports')??'').split(',').map(Number);
  if(ports.length!==2||new Set(ports).size!==2||!ports.every(p=>Number.isSafeInteger(p)&&p>0&&p<65536)) throw new Error('TWO_EXPLICIT_PORTS_REQUIRED');
  const fault=flags.get('--fault'); if(fault && !['after-sign','after-broadcast','after-receipt','after-freeze','before-thaw'].includes(fault)) throw new Error('INVALID_FAULT');
  const rev=revision(); if(rev.dirty) throw new Error('COMMIT_REVIEWED_REVISION_FIRST');
  const evidence=evidenceDirectory(run), attempt=`attempt-${Date.now()}-${randomUUID()}`, items=verdicts(), clock=new SystemClock();
  const root=privateDirectory(resolve('.local/devnet/t2/gate1',run)), lock=join(root,'running.lock'); mkdirSync(lock,{mode:0o700});
  let sequence=0; const stores:ReturnType<typeof openStore>[]=[]; const servers:Awaited<ReturnType<typeof startSeller>>[]=[];
  const raw=(provider:string,method:string,bytes:Uint8Array)=>{
    if(!/^[A-Za-z0-9]+$/.test(method))throw new Error('INVALID_RPC_METHOD');
    writeFileSync(join(evidence,`${attempt}-${provider}-${++sequence}-${method}.json`),bytes,{flag:'wx',mode:0o600});
  };
  // M03 sealed payload cap reused only as RPC transport resource budget.
  const responseBytesMax=M03.sealedPayloadMax.value*1024*1024;
  // The free second provider throttles bursts (HTTP 429 / JSON-RPC -32029). Pace calls and retry only on
  // throttling; every attempt's raw response is still recorded by the evidence hook, and success still
  // requires both providers to agree, so pacing cannot weaken a verdict.
  const paced=(inner:ReturnType<typeof fetchRpcTransport>,minGapMs:number):ReturnType<typeof fetchRpcTransport>=>{
    let last=0;
    return async (endpoint,body,signal)=>{
      for(let attempt=0;;attempt++){
        const wait=last+minGapMs-Date.now(); if(wait>0) await new Promise(r=>setTimeout(r,wait));
        last=Date.now();
        try {
          const out=await inner(endpoint,body,signal);
          const throttled=(()=>{try{const j=JSON.parse(Buffer.from(out).toString('utf8')) as {error?:{code?:number}}; return j.error?.code===-32029;}catch{return false;}})();
          if(!throttled || attempt>=8) return out;
        } catch(error) { if(!(error instanceof RpcRateLimitError) || attempt>=8) throw error; }
        await new Promise(r=>setTimeout(r,2000*(attempt+1)));
      }
    };
  };
  const makeRpc=(endpoint:string,provider:string)=>createRpcClient({endpoint,genesis:DEVNET_GENESIS,clock,responseBytesMax,transport:provider==='secondary'?paced(fetchRpcTransport(responseBytesMax),1200):fetchRpcTransport(responseBytesMax),evidence:(method,bytes)=>raw(provider,method,bytes)});
  const primary=makeRpc(primaryUrl,'primary'),secondary=makeRpc(secondaryUrl,'secondary');
  let config:RunConfig | undefined;
  writeEvidence(evidence,`${attempt}-started-verdict.json`,gateReport(rev,items));
  function crash(point:string):void {
    if(fault!==point) return;
    writeEvidence(evidence,`${attempt}-fault.json`,{revision:rev,point,run,pid:process.pid,preserve:'All DB/WAL, signer journal, reservations, freeze journal and tombstones',restart:'Remove running.lock only after confirming this PID exited; rerun identical flags without --fault.'});
    writeEvidence(evidence,`${attempt}-fault-verdict.json`,gateReport(rev,items));
    // Real abrupt process termination: no DB close/checkpoint/rollback cleanup.
    process.kill(process.pid,'SIGKILL');
  }
  try {
    await Promise.all([primary.genesis(),secondary.genesis()]);
    // One durable accounting namespace per setup payer; a new run ID cannot reset caps.
    const activePath=join(privateDirectory(resolve('.local/devnet/t2/gate1')),'active-run.json');
    if(existsSync(activePath)) {
      if(payloadHash(strictJson(readPrivate(activePath)))!==payloadHash({run}))throw new Error('EXISTING_RUN_REQUIRES_OPERATOR_RECONCILIATION');
    } else writePrivate(activePath,canonicalBytes({run}));
    const setup=fileSetupJournal(resolve('.local/devnet/t2')).read();
    if(!setup || setup.genesis!==DEVNET_GENESIS || setup.entries.length===0 || setup.entries.some(e=>e.state!=='finalized')) throw new Error('COMPLETE_T2_SETUP_REQUIRED');
    const setupRoot=resolve('.local/devnet/t2');
    const buyerKey=parseCliKey(readPrivate(join(setupRoot,'buyer.json'))), sealKey=parseCliKey(readPrivate(join(setupRoot,'seal.json')));
    const required=['buyer','seller','marketplace','mint','buyerAta','sellerAta','marketplaceAta'] as const;
    if(required.some(k=>typeof setup.addresses[k]!=='string')) throw new Error('MISSING_SETUP_ADDRESS');
    const a=Object.fromEntries(required.map(k=>[k,setup.addresses[k]])) as unknown as Addresses;
    if(importCliKey(buyerKey).publicKey!==a.buyer || importCliKey(sealKey).publicKey!==setup.addresses.seal) throw new Error('SETUP_KEY_MISMATCH');
    for(const [owner,ata] of [[a.buyer,a.buyerAta],[a.seller,a.sellerAta],[a.marketplace,a.marketplaceAta]] as const) if(await associatedTokenAddress(owner,a.mint)!==ata) throw new Error('ATA_MISMATCH');
    const configPath=join(root,'run.json');
    if(existsSync(configPath)) config=parseConfig(readPrivate(configPath));
    else {
      config={v:1,sha:rev.sha,createdAt:clock.now(),primary:primaryUrl,secondary:secondaryUrl,ports,requests:[randomUUID(),randomUUID()],tokens:[randomUUID(),randomUUID()]};
      writePrivate(join(root,'decline-seal.json'),Buffer.from(JSON.stringify([...generateThrowawayKey().keyBytes])));
      writePrivate(configPath,canonicalBytes(config));
    }
    if(config.sha!==rev.sha||config.primary!==primaryUrl||config.secondary!==secondaryUrl||JSON.stringify(config.ports)!==JSON.stringify(ports)) throw new Error('RUN_REVISION_OR_CONFIG_CHANGED');
    const origins=config.ports.map(p=>`http://127.0.0.1:${p}`) as [string,string];
    const frozenClock={...clock,now:()=>config!.createdAt,monotonicMs:()=>clock.monotonicMs(),sleep:(ms:number,signal?:AbortSignal)=>clock.sleep(ms,signal)};
    const fixture=syntheticMarket(frozenClock,a,origins,[parseCliKey(readPrivate(join(root,'decline-seal.json'))),sealKey]);
    const buyer:BuyerContext={buyer_id:id('gate1-test-buyer'),payer:a.buyer,session_id:id(`gate1-${run}`)};
    const store=(name:string)=>{const s=openStore(join(root,`${name}.db`));stores.push(s);return s;};
    const brokerStore=store('broker'), signingStore=store('signer');
    let negative=false;
    const primaryPort=primary,secondaryPort=secondary;
    const dispatch:RpcClient & {origin:string}={origin:primary.origin,genesis:s=>primary.genesis(s),latestBlockhash:s=>primary.latestBlockhash(s),finalizedHeight:s=>primary.finalizedHeight(s),feeForMessage:(m,s)=>primary.feeForMessage(m,s),accounts:(a,s)=>primary.accounts(a,s),signatureStatus:(v,s)=>primary.signatureStatus(v,s),finalizedTransaction:(v,s)=>primary.finalizedTransaction(v,s),async broadcastIdentical(bytes) {
      const signed=decodeSignedPayment(bytes), row=brokerStore.scan('signed_transactions',{where:{signature:signed.signature as Signature},limit:1})[0]?.value;
      if(!row || row.transaction_base64!==Buffer.from(bytes).toString('base64')) throw new Error('DURABLE_BYTES_REQUIRED');
      let result:Signature;
      if(negative) {
        // Negative-only dispatch is unreachable from MCP. Freeze transaction is
        // separately journaled; purchase still has exactly two transfers + Memo.
        if(await primary.genesis()!==DEVNET_GENESIS) throw new Error('DEVNET_ONLY');
        const sent=await primary.call('sendTransaction',[row.transaction_base64,{encoding:'base64',skipPreflight:true,maxRetries:0}]);
        if(sent!==signed.signature) throw new Error('SIGNATURE_MISMATCH'); result=sent as Signature;
      } else result=await primaryPort.broadcastIdentical(bytes);
      crash('after-broadcast'); return result;
    }};
    const testSigner=new TestSigner({network:'devnet',genesis:DEVNET_GENESIS,publicKey:a.buyer,keyBytes:()=>buyerKey},new StoreSignJournal(signingStore));
    const signer={publicKey:()=>testSigner.publicKey(),recover:(r:Parameters<typeof testSigner.recover>[0],h:Parameters<typeof testSigner.recover>[1])=>testSigner.recover(r,h),async sign(request:Parameters<typeof testSigner.sign>[0]) {
      const result=await testSigner.sign(request); crash('after-sign');
      if(negative) { await setMarketplaceFrozen({root,rpc:primary,clock,addresses:a,buyerKey,frozen:true}); crash('after-freeze'); }
      return result;
    }};
    const sellers=new Map();
    for(const [n,s] of fixture.sellers.entries()) {
      const sellerStore=store(`seller-${n}`), journal=new FileTombstoneJournal(join(root,`tombstones-${n}.jsonl`),wire);
      if(!existsSync(join(root,`tombstones-${n}.jsonl`))) {
        if(sellerStore.scan('quotes',{limit:1}).length) throw new Error('MISSING_EXISTING_TOMBSTONES');
        journal.initializeEmpty();
      }
      const sellerConfig:SellerConfig={rpcOrigins:[primary.origin,secondary.origin],origin:s.listing.endpoint,limits:M03,wire,listing:s.listing,registryVersion:fixture.registry.registry_version,sealActor:'test',invitations:[{origin:s.listing.endpoint,buyer,token_sha256:bytesHash(Buffer.from(config.tokens[n]!))}],
        authority:async()=>{const rows=await journal.readAll();return {generation:rows.reduce((g,r)=>Math.max(g,r.generation),0),tombstones_sha256:payloadHash(rows),acknowledged_at:clock.now()};},clockSkewMs:()=>0,
        payerAccounts:()=>({payer:a.buyer,tokenAccount:a.buyerAta}),validateMessage:validateLegacyMessage,reconcile:reconcilePayment,worker:createExtractiveWorker(s.bundle,{origin:s.listing.endpoint,wire,limits:M03}),scanOutput:async()=>{}};
      const server=await startSeller({bundle:s.bundle,store:sellerStore,clock,signer:s.signer,tombstones:journal,primaryRpc:primaryPort,secondaryRpc:secondaryPort,config:sellerConfig});servers.push(server);
      sellers.set(s.listing.endpoint,createSellerHttpClient({origin:s.listing.endpoint,invitation:config.tokens[n]!,clock,fetch,isolatedLoopback:true}));
    }
    const deps:BrokerDeps={store:brokerStore,clock,signer,primaryRpc:dispatch,secondaryRpc:secondaryPort,registry:fixture.registry,questionPolicy:fixture.questions,sellers,
      policy:{policy_id:id('gate1-test-policy'),buyer,registry_sha256:payloadHash(fixture.registry),question_policy_sha256:payloadHash(fixture.questions),networks:['devnet'],principal_per_call:atomicFromBigint(M03.devnetPrincipalPerCall.value),principal_per_day:atomicFromBigint(M03.devnetPrincipalPerDay.value),fee_per_call:lamportsFromBigint(M03.feePerPurchaseMax.value),fee_per_day:lamportsFromBigint(M03.devnetFeePerDayMax.value),mainnet_enabled:false},
      offerApproval:{async review(offer){return {status:'approved',actor:'test',reviewedHash:offer.quoteHash,at:clock.now(),approvalRef:id('gate1-test-offer')};}},
      receiptImporter:{async importReceipt(){return {status:'import_pending',code:'NOT_READY'};},async readback(){return null;}}};
    const broker=composeBroker(deps,{payer:{payer:a.buyer,tokenAccount:a.buyerAta},rpcOrigins:[primary.origin,secondary.origin],authorizeHuman:()=>false,verifyRun:async()=>{throw new Error('NO_HUMAN_EVIDENCE');},verifyRefund:async()=>{throw new Error('NO_REFUND_SIGNER');}});
    const balances=async()=>{ const snapshot=await primary.accounts([a.buyerAta,a.sellerAta,a.marketplaceAta]);return snapshot.accounts.map(x=>{if(!x)throw new Error('MISSING_ATA');return {address:x.address,amount:Buffer.from(x.data).readBigUInt64LE(64).toString(),state:x.data[108]};});};
    for(let n=0;n<2;n++) {
      negative=n===1;
      const input:ConsultInput={request_id:config.requests[n] as ConsultInput['request_id'],question_id:id(`q${n}`),max_price:{network:'devnet',asset_id:a.mint,amount_atomic:atomicFromBigint(M03.totalAtomic.value)}};
      const beforePath=join(root,`before-${n}.json`); if(!existsSync(beforePath)) writePrivate(beforePath,canonicalBytes(await balances()));
      const existing=brokerStore.scan('consults',{where:{request_id:input.request_id},limit:1})[0]?.value;
      if(existing?.broker?.stage==='signing' && negative) {
        // Lost signer reply: freeze before the broker recovers and dispatches.
        await setMarketplaceFrozen({root,rpc:primary,clock,addresses:a,buyerKey,frozen:true});
      }
      let view:ConsultView;
      if(existing?.view) {view=await broker.market.status(buyer,{consult_id:existing.view.consult_id});}
      else view=await broker.market.consult(buyer,input);
      const started=clock.monotonicMs();
      while(view.payment_state==='payment_pending' && clock.monotonicMs()-started<M03.paymentForegroundWait.value*1000) {
        await clock.sleep(M03.paymentPoll.value[0]*1000);view=await broker.market.status(buyer,{consult_id:view.consult_id});
      }
      const receipt=brokerStore.read('receipts',view.receipt_id)!.value;
      if(!receipt.transaction_signature || (negative ? view.payment_state!=='payment_failed' : view.delivery_state!=='delivered')) throw new Error('PAYMENT_PENDING_OR_FAILED_RETAIN_WAL');
      const tx=await primary.finalizedTransaction(receipt.transaction_signature); if(!tx) throw new Error('FINALIZED_TX_REQUIRED');
      const before=strictJson(readPrivate(beforePath)),after=await balances();
      if(!Array.isArray(before)||before.length!==after.length)throw new Error('INVALID_BALANCE_SNAPSHOT');
      const deltas=negative?[0n,0n,0n]:[-M03.totalAtomic.value,M03.sellerAtomic.value,M03.marketplaceAtomic.value];
      after.forEach((value,i)=>{const old=before[i] as {address?:string;amount?:string};if(old.address!==value.address||typeof old.amount!=='string'||!/^(0|[1-9][0-9]*)$/.test(old.amount)||BigInt(value.amount)-BigInt(old.amount)!==deltas[i])throw new Error('BALANCE_DELTA_MISMATCH');});
      if(negative) {
        const err=tx.meta.err as {InstructionError?:unknown[]}|null;
        if(!err || err.InstructionError?.[0]!==1 || payloadHash(tx.meta.preTokenBalances)!==payloadHash(tx.meta.postTokenBalances) || BigInt(tx.meta.fee)<=0n) throw new Error('LANDED_SECOND_LEG_FAILURE_REQUIRED');
        crash('before-thaw');
        await setMarketplaceFrozen({root,rpc:primary,clock,addresses:a,buyerKey,frozen:false});
      } else {
        if(!receipt.settlement || receipt.settlement.seller_credit!==String(M03.sellerAtomic.value)||receipt.settlement.marketplace_credit!==String(M03.marketplaceAtomic.value))throw new Error('SPLIT_REQUIRED');
        const recoveredPath=join(root,'delivered.json'), digest={answer_sha256:payloadHash(view.answer),receipt_sha256:payloadHash(receipt)};
        if(existsSync(recoveredPath)) {
          if(payloadHash(strictJson(readPrivate(recoveredPath)))!==payloadHash(digest))throw new Error('RECOVERY_BYTES_CHANGED');
          items.e={status:'PASS',evidence:[`${attempt}-clean.json`],reason:'Identical answer and receipt hashes recovered in a subsequent process invocation; no replacement transaction.'};
        } else writePrivate(recoveredPath,canonicalBytes(digest));
        crash('after-receipt');
      }
      const name=`${attempt}-${negative?'failed-second-leg':'clean'}.json`;
      writeEvidence(evidence,name,{revision:rev,evidence:'REAL_DEVNET_TESTSIGNER_SYNTHETIC_CONTENT',signature:tx.signature,explorer:`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`,before,after,fee:tx.meta.fee,meta:tx.meta,memo:Buffer.from(tx.instructions[2]!.data).toString('utf8'),receipt,answer_sha256:payloadHash(view.answer),receipt_sha256:payloadHash(receipt)});
      items[negative?'b':'a']={status:'PASS',evidence:[name],reason:negative?'Finalized instruction-index 1 failure, zero token deltas, positive charged fee; marketplace ATA thawed.':'Finalized exact split, memo and independently verified seller delivery.'};
    }
  } catch(error) {
    writeEvidence(evidence,`${attempt}-stopped.json`,{revision:rev,code:'GATE1_STOPPED_RETAIN_STATE',error_type:error instanceof Error?error.name:'unknown',code_detail:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'EXTERNAL_OR_UNCLASSIFIED_ERROR',pending:'Reconcile the same run; never delete databases, keys, signatures or tombstones.'});
    process.exitCode=1;
  } finally {
    for(const s of servers) await s.close(); for(const s of stores)s.close();
    writeEvidence(evidence,`${attempt}-verdict.json`,gateReport(rev,items));rmdirSync(lock);
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(()=>{console.error('GATE1_LIVE_STOPPED: retain all state; see --help');process.exitCode=1;});
