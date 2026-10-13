import type { SellerConfig } from '../../src/seller/index.ts';
/** LEAD RUNS ONLY after committing the reviewed SHA. NO MAINNET path.
 * --execute --run ID --primary HTTPS_URL/ --secondary HTTPS_URL/
 * --seller-ports PORT,PORT
 * Repeat the EXACT run/flags with the same flags to recover, never delete state.
 * Raw RPC and verdicts are public; key bytes, tokens and WAL remain private.
 */
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { parseFlags, requireClean, claimActive, pacedTransport, verifyHumanSettlement, reviewHumanOffer, observedRpcTransport, parseHumanRecovery } from '../chain/human-live-runtime.ts';
import type { CeremonyEvidence } from '../chain/human-live-ceremony.ts';
import { parsePacket } from '../chain/human-live-helper.ts';
import { requestBytes, readRequest } from '../chain/human-live-ceremony.ts';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemClock, openStore, atomicFromBigint, lamportsFromBigint } from '../../src/common/index.ts';
import { M03, canonicalBytes, bytesHash, payloadHash, strictJson } from '../../src/wire/index.ts';
import { createRpcClient, fetchRpcTransport, DEVNET_GENESIS, generateThrowawayKey, importCliKey, parseCliKey, HumanCliSigner, controllingTerminal, validateLegacyMessage, reconcilePayment, decodeSignedPayment, associatedTokenAddress } from '../../src/chain/index.ts';
import type { BrokerDeps, BuyerContext, ConsultInput, ConsultView, Id, IsoTime, RpcClient, Signature, Signer, SignRequest } from '../../src/wire/contracts.ts';
import { FileTombstoneJournal, createExtractiveWorker } from '../../src/seller/index.ts';
import { createSellerHttpClient } from '../../src/broker/index.ts';
import { startSeller } from '../seller.ts';
import { composeBroker } from '../broker.ts';
import { renewUnsignedPurchase } from '../../src/broker/service.ts';
import { privateDirectory, readPrivate, writePrivate, fileSetupJournal } from '../chain/setup-storage.ts';
import { syntheticMarket, wire, id } from './synthetic.ts';
import type { Addresses } from './synthetic.ts';
import { evidenceDirectory, gateReport, revision, verdicts, writeEvidence } from './evidence.ts';

interface RunConfig { v:1; sha:string; createdAt:IsoTime; primary:string; secondary:string; ports:number[]; requests:string[]; tokens:string[] }
export function parseConfig(bytes:Uint8Array):RunConfig {
  const x=strictJson(bytes) as unknown as RunConfig;
  if(!x || Object.keys(x).sort().join(',')!=='createdAt,ports,primary,requests,secondary,sha,tokens,v' || x.v!==1 || !/^[a-f0-9]{40}$/.test(x.sha) || !Number.isFinite(Date.parse(x.createdAt)) || typeof x.primary!=='string' || typeof x.secondary!=='string' || !Array.isArray(x.ports) || x.ports.length!==2 || !x.ports.every(p=>Number.isSafeInteger(p)&&p>0&&p<65536) || !Array.isArray(x.requests) || x.requests.length!==2 || !x.requests.every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)) || !Array.isArray(x.tokens) || x.tokens.length!==2 || !x.tokens.every(v=>typeof v==='string'&&v.length>0)) throw new Error('INVALID_RUN_CONFIG'); return x;
}
export async function main(args:readonly string[]) {
  if(args.length===1 && args[0]==='--help') { console.log('LEAD ONLY: node scripts/integration/gate1-human-live.ts --execute --run ID --primary HTTPS_URL/ --secondary HTTPS_URL/ --seller-ports PORT,PORT. Repeat same run with the same flags to recover. Requires completed .local/devnet/t2 setup. Founder real TTY; human-signed devnet only. Host isolation remains UNVERIFIED.'); return; }
  if (!controllingTerminal().isTTY()) throw new Error('FOUNDER_TTY_REQUIRED');
  const {run,primaryUrl,secondaryUrl,ports}=parseFlags(args);
  const rev=revision(); requireClean(rev.dirty);
  const evidence=evidenceDirectory(run), attempt=`attempt-${Date.now()}-${randomUUID()}`, items=verdicts(), clock=new SystemClock();
  const root=privateDirectory(resolve('.local/devnet/t2/gate1',run)), lock=join(root,'running.lock'); mkdirSync(lock,{mode:0o700});
  let sequence=0; const stores:ReturnType<typeof openStore>[]=[]; const servers:Awaited<ReturnType<typeof startSeller>>[]=[];
  const raw=(provider:string,method:string,bytes:Uint8Array)=>{
    if(!/^[A-Za-z0-9]+$/.test(method))throw new Error('INVALID_RPC_METHOD');
    writeFileSync(join(evidence,`${attempt}-${provider}-${++sequence}-${method}.json`),bytes,{flag:'wx',mode:0o600});
  };
  // M03 sealed payload cap reused only as RPC transport resource budget.
  const responseBytesMax=M03.sealedPayloadMax.value*1024*1024;
  const makeRpc=(endpoint:string,provider:string)=>createRpcClient({endpoint,genesis:DEVNET_GENESIS,clock,responseBytesMax,transport:provider==='secondary'?pacedTransport(observedRpcTransport(fetchRpcTransport(responseBytesMax),(method,bytes)=>raw(provider,method,bytes)),clock):observedRpcTransport(fetchRpcTransport(responseBytesMax),(method,bytes)=>raw(provider,method,bytes)),evidence:(method,bytes)=>raw(provider,method,bytes)});
  const primary=makeRpc(primaryUrl,'primary'),secondary=makeRpc(secondaryUrl,'secondary');
  let config:RunConfig | undefined;
  writeEvidence(evidence,`${attempt}-started-verdict.json`,gateReport(rev,items));
  try {
    await Promise.all([primary.genesis(),secondary.genesis()]);
    // One durable accounting namespace per setup payer; a new run ID cannot reset caps.
    const activePath=join(privateDirectory(resolve('.local/devnet/t2/gate1')),'active-run.json');
    claimActive(activePath,run);
    const setup=fileSetupJournal(resolve('.local/devnet/t2')).read();
    if(!setup || setup.genesis!==DEVNET_GENESIS || setup.entries.length===0 || setup.entries.some(e=>e.state!=='finalized')) throw new Error('COMPLETE_T2_SETUP_REQUIRED');
    const setupRoot=resolve('.local/devnet/t2');
    const sealKey=parseCliKey(readPrivate(join(setupRoot,'seal.json')));
    const required=['buyer','seller','marketplace','mint','buyerAta','sellerAta','marketplaceAta'] as const;
    if(required.some(k=>typeof setup.addresses[k]!=='string')) throw new Error('MISSING_SETUP_ADDRESS');
    const a=Object.fromEntries(required.map(k=>[k,setup.addresses[k]])) as unknown as Addresses;
    if(importCliKey(sealKey).publicKey!==setup.addresses.seal) throw new Error('SETUP_KEY_MISMATCH');
    for(const [owner,ata] of [[a.buyer,a.buyerAta],[a.seller,a.sellerAta],[a.marketplace,a.marketplaceAta]] as const) if(await associatedTokenAddress(owner,a.mint)!==ata) throw new Error('ATA_MISMATCH');
    const configPath=join(root,'human-run.json');
    if(existsSync(join(root,'run.json'))) throw new Error('TESTSIGNER_RUN_CANNOT_BECOME_HUMAN_RUN');
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
    const brokerStore=store('broker');
    const primaryPort=primary,secondaryPort=secondary;
    const dispatch:RpcClient & {origin:string}={origin:primary.origin,genesis:s=>primary.genesis(s),latestBlockhash:s=>primary.latestBlockhash(s),finalizedHeight:s=>primary.finalizedHeight(s),feeForMessage:(m,s)=>primary.feeForMessage(m,s),accounts:(a,s)=>primary.accounts(a,s),signatureStatus:(v,s)=>primary.signatureStatus(v,s),finalizedTransaction:(v,s)=>primary.finalizedTransaction(v,s),async broadcastIdentical(bytes) {
      const signed=decodeSignedPayment(bytes), row=brokerStore.scan('signed_transactions',{where:{signature:signed.signature as Signature},limit:1})[0]?.value;
      if(!row || row.transaction_base64!==Buffer.from(bytes).toString('base64')) throw new Error('DURABLE_BYTES_REQUIRED');
      return primaryPort.broadcastIdentical(bytes);
    }};
    const packetPath=join(root,'human-packet.json');
    const exchange=async (frame:Uint8Array):Promise<Uint8Array> => {
      // Public request/config only; never inherit wallet variables, NODE_OPTIONS or preloads.
      const child=fork(fileURLToPath(new URL('../chain/human-live-helper.ts',import.meta.url)),['--packet',packetPath,Buffer.from(frame).toString('base64')],{env:{},execArgv:[],stdio:['inherit','inherit','inherit','ipc']});
      let reply:Uint8Array|undefined;
      child.on('message',value=>{if(typeof value==='string')reply=Buffer.from(value,'base64');});
      const [code]=await once(child,'exit');
      if(code!==0||!reply)throw new Error('HUMAN_HELPER_NO_REPLY_RETAIN_STATE');
      return reply;
    };
    const client=new HumanCliSigner({endpoint:join(root,'unused.sock'),expectedPublicKey:a.buyer},exchange);
    const signer:Signer={publicKey:async()=>a.buyer,async recover(requestId,messageHash){
      if(!existsSync(packetPath))return null;
      const packet=strictJson(readPrivate(packetPath)) as unknown as {request:string};
      const request=readRequest(Buffer.from(packet.request,'base64'));
      if(request.requestId!==requestId||request.messageHash!==messageHash)throw new Error('RECOVERY_REQUEST_CHANGED');
      // Same request and durable helper journal; never constructs a fresh message.
      return parseHumanRecovery(await exchange(canonicalBytes({operation:'recover',value:{requestId,messageHash}})),request);
    },async sign(request:SignRequest){
      if(existsSync(packetPath)) {
        const oldBytes=readPrivate(packetPath), oldPacket=parsePacket(oldBytes);
        const previous=readRequest(Buffer.from(oldPacket.request,'base64'));
        const row=brokerStore.read('consults',request.reservationId)?.value.broker;
        if(previous.messageHash===request.messageHash || previous.requestId!==request.requestId || previous.quoteId!==request.quoteId || previous.reservationId!==request.reservationId || row?.renewal?.unsigned_message_sha256!==previous.messageHash) throw new Error('ONE_HUMAN_REQUEST_ONLY');
        const archive=join(root,`human-packet-${previous.messageHash}.json`);
        if(!existsSync(archive))writePrivate(archive,oldBytes);
      }
      const snapshot=join(root,`human-broker-snapshot-${request.messageHash}.db`);
      const backup=brokerStore.backup(snapshot,payloadHash([]));
      writePrivate(packetPath,canonicalBytes({request:Buffer.from(requestBytes(request)).toString('base64'),primary:primaryUrl,snapshot,snapshotHash:backup.sha256,sellerKey:fixture.sellers[1]!.listing.signing_key,evidence}),existsSync(packetPath));
      return client.sign(request);
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
      offerApproval:{review:offer=>reviewHumanOffer(offer,clock,controllingTerminal())},
      receiptImporter:{async importReceipt(){return {status:'import_pending',code:'NOT_READY'};},async readback(){return null;}}};
    const broker=composeBroker(deps,{payer:{payer:a.buyer,tokenAccount:a.buyerAta},rpcOrigins:[primary.origin,secondary.origin],authorizeHuman:()=>false,verifyRun:async()=>{throw new Error('NO_HUMAN_EVIDENCE');},verifyRefund:async()=>{throw new Error('NO_REFUND_SIGNER');}});
    const balances=async()=>{ const snapshot=await primary.accounts([a.buyerAta,a.sellerAta,a.marketplaceAta]);return snapshot.accounts.map(x=>{if(!x)throw new Error('MISSING_ATA');return {address:x.address,amount:Buffer.from(x.data).readBigUInt64LE(64).toString(),state:x.data[108]};});};
    for(let n=0;n<1;n++) {
      const input:ConsultInput={request_id:config.requests[n] as ConsultInput['request_id'],question_id:id(`q${n}`),max_price:{network:'devnet',asset_id:a.mint,amount_atomic:atomicFromBigint(M03.totalAtomic.value)}};
      const beforePath=join(root,`before-${n}.json`); if(!existsSync(beforePath)) writePrivate(beforePath,canonicalBytes(await balances()));
      const existing=brokerStore.scan('consults',{where:{request_id:input.request_id},limit:1})[0]?.value;
      let view:ConsultView;
      if(existing?.view) {view=await broker.market.status(buyer,{consult_id:existing.view.consult_id});}
      else view=await broker.market.consult(buyer,input);
      while(view.message.startsWith('EXPIRED_BEFORE_APPROVAL:') || brokerStore.read('consults',view.consult_id)?.value.broker?.stage==='arming') {
        const state=brokerStore.read('consults',view.consult_id)!.value.broker!;
        const previous=state.stage==='arming' ? state.renewal?.previous_arm_sha256 : payloadHash(brokerStore.read('arms',view.consult_id)!.value.arm.payload);
        if(!previous)throw new Error('ORIGINAL_MESSAGE_RECOVERY_REQUIRED');
        console.error('Previous message expired without a signature. Preparing the same quote with a fresh hash; a new exact approval is required.');
        view=await renewUnsignedPurchase(deps,broker.ports,view.consult_id,previous);
      }
      const started=clock.monotonicMs();
      while(view.payment_state==='payment_pending' && clock.monotonicMs()-started<M03.paymentForegroundWait.value*1000) {
        await clock.sleep(M03.paymentPoll.value[0]*1000);view=await broker.market.status(buyer,{consult_id:view.consult_id});
      }
      const receipt=brokerStore.read('receipts',view.receipt_id)!.value;
      if(!receipt.transaction_signature || view.delivery_state!=='delivered') throw new Error('PAYMENT_PENDING_OR_FAILED_RETAIN_WAL');
      const tx=await primary.finalizedTransaction(receipt.transaction_signature); if(!tx) throw new Error('FINALIZED_TX_REQUIRED');
      const before=strictJson(readPrivate(beforePath)),after=await balances();
      if(!Array.isArray(before)||before.length!==after.length)throw new Error('INVALID_BALANCE_SNAPSHOT');
      const deltas=[-M03.totalAtomic.value,M03.sellerAtomic.value,M03.marketplaceAtomic.value];
      after.forEach((value,i)=>{const old=before[i] as {address?:string;amount?:string};if(old.address!==value.address||typeof old.amount!=='string'||!/^(0|[1-9][0-9]*)$/.test(old.amount)||BigInt(value.amount)-BigInt(old.amount)!==deltas[i])throw new Error('BALANCE_DELTA_MISMATCH');});
      const packet=strictJson(readPrivate(packetPath)) as unknown as {request:string};
      const approved=readRequest(Buffer.from(packet.request,'base64'));
      const human=strictJson(readPrivate(join(root,'human-ceremony.json'))) as unknown as CeremonyEvidence;
      const finality=await verifyHumanSettlement(approved,human,receipt.transaction_signature,primary,secondary);
      const name=`${attempt}-human-clean.json`;
      writeEvidence(evidence,name,{revision:rev,evidence:'REAL_DEVNET_HUMAN_SIGNED_SYNTHETIC_CONTENT',human,finality,host_isolation:'UNVERIFIED',signature:tx.signature,explorer:`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`,before,after,fee:tx.meta.fee,meta:tx.meta,memo:Buffer.from(tx.instructions[2]!.data).toString('utf8'),receipt,answer_sha256:payloadHash(view.answer),receipt_sha256:payloadHash(receipt)});
      items.a={status:'PASS',evidence:[name],reason:'One finalized human-signed split; exact message and token deltas verified by both providers.'};
      items.f={status:'PASS',evidence:[name],reason:'Real TTY exact-phrase approval; exact-message signature verified; substituted bytes refused with zero signature; live finalized split. Host isolation/OS canaries are NOT part of f in T11b and remain UNVERIFIED.'};
      console.log('Gate1(a)=PASS Gate1(f)=PASS host_isolation=UNVERIFIED paid_mode=false mainnet_enabled=false');

    }
  } catch(error) {
    writeEvidence(evidence,`${attempt}-stopped.json`,{revision:rev,code:'GATE1_STOPPED_RETAIN_STATE',error_type:error instanceof Error?error.name:'unknown',code_detail:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'EXTERNAL_OR_UNCLASSIFIED_ERROR',pending:'Reconcile the same run; never delete databases, keys, signatures or tombstones.'});
    process.exitCode=1;
  } finally {
    for(const s of servers) await s.close(); for(const s of stores)s.close();
    writeEvidence(evidence,`${attempt}-verdict.json`,{...gateReport(rev,items),host_isolation:'UNVERIFIED'});rmdirSync(lock);
  }
}
/** Launch the broker with a minimal, key-free process environment and arguments. */
export function brokerLaunch(args:readonly string[]) {
  parseFlags(args);
  return {args:['--broker',...args],env:{} as NodeJS.ProcessEnv};
}
async function cli(args:readonly string[]) {
  if(args[0]==='--broker') {if(!process.send)throw new Error('BROKER_LAUNCH_REQUIRED'); try {await main(args.slice(1));} finally {process.disconnect();} return;}
  if(args.length===1&&args[0]==='--help') {await main(args);return;}
  if(!controllingTerminal().isTTY())throw new Error('FOUNDER_TTY_REQUIRED');
  const launch=brokerLaunch(args),child=fork(fileURLToPath(import.meta.url),launch.args,{env:launch.env,execArgv:[],stdio:['inherit','inherit','inherit','ipc']});
  const [code]=await once(child,'exit');process.exitCode=typeof code==='number'?code:1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).catch((error:unknown)=>{console.error(`GATE1_HUMAN_LIVE_STOPPED: ${error instanceof Error ? error.message : 'UNKNOWN'}; retain all state; see --help`);process.exitCode=1;});
