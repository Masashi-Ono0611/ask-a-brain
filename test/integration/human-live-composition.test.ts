/** Test-only complete broker/seller ceremony; no CLI route to injected approval. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from '../chain/support.ts';
import { settle } from './harness.ts';
import { M03, payloadHash, bytesHash, canonicalBytes } from '../../src/wire/index.ts';
import { openStore, atomicFromBigint, lamportsFromBigint } from '../../src/common/index.ts';
import { DEVNET_GENESIS, FakeRpcClient, generateThrowawayKey, HumanCliSigner, StoreSignJournal, createHumanAuthorizer, validateLegacyMessage, validateSignRequest, reconcilePayment } from '../../src/chain/index.ts';
import type { SellerConfig } from '../../src/seller/index.ts';
import { createExtractiveWorker } from '../../src/seller/index.ts';
import { composeSeller } from '../../scripts/seller.ts';
import { composeBroker } from '../../scripts/broker.ts';
import { syntheticMarket, wire, id } from '../../scripts/integration/synthetic.ts';
import { createCeremony } from '../../scripts/chain/human-live-ceremony.ts';
import type { CeremonyEvidence } from '../../scripts/chain/human-live-ceremony.ts';
import { snapshotView, openFrozenSnapshot } from '../../scripts/chain/human-live-helper.ts';
import { verifyHumanSettlement, reviewHumanOffer } from '../../scripts/chain/human-live-runtime.ts';
import type { BrokerDeps, BuyerContext, SellerClient, SignRequest, Signer, Uuid } from '../../src/wire/contracts.ts';

for (const slowSecondary of [false, true]) test(`human ceremony: denied offer signs zero; durable broadcast precedes ${slowSecondary ? 'slow' : 'clean'} secondary reconciliation`, async t=>{
  const f=fixture(),clock=f.clock,key=f.key;
  const root=realpathSync(mkdtempSync(join(tmpdir(),'aab-human-composition-'))),stores:ReturnType<typeof openStore>[]=[];
  t.after(()=>{for(const s of stores)s.close();key.keyBytes.fill(0);rmSync(root,{recursive:true,force:true});});
  const store=(name:string)=>{const s=openStore(join(root,`${name}.db`));stores.push(s);return s;};
  const brokerStore=store('broker'),signStore=store('helper');
  const q=f.quote.payload,a={buyer:q.payer,buyerAta:f.payment.expected.payer.tokenAccount,seller:q.seller_owner,sellerAta:q.seller_token_account,marketplace:q.marketplace_owner,marketplaceAta:q.marketplace_token_account,mint:q.mint};
  const market=syntheticMarket(clock,a,['https://decline.example','https://ready.example'],[generateThrowawayKey().keyBytes,generateThrowawayKey().keyBytes]);
  let primary=f.primary,secondary=f.secondary;
  let signedReturned=false, broadcastsAtFirstReconcile:number|undefined, blockhashFetchedAt:number|undefined, reviewCompletedAt:number|undefined;
  const proxy=(which:'primary'|'secondary')=>new Proxy(f[which],{get(_,name){if(name==='latestBlockhash')return async()=>{blockhashFetchedAt=clock.monotonicMs();return {...f.request.blockhash,observedAt:clock.now()};};if(which==='secondary' && name==='genesis' && signedReturned) return async()=>{
    if(broadcastsAtFirstReconcile===undefined) {
      broadcastsAtFirstReconcile=primary.broadcasts;
      if(slowSecondary) {clock.advance(40000);primary.state.height=f.request.blockhash.lastValidBlockHeight+1;}
    }
    return secondary.genesis();
  };const target=which==='primary'?primary:secondary;const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
  const primaryRpc=proxy('primary'),secondaryRpc=proxy('secondary'),buyer:BuyerContext={buyer_id:id('human-dry'),session_id:id('session'),payer:a.buyer};
  let signerError:unknown;
  let prompts=0,loads=0,request:SignRequest|undefined,evidence:CeremonyEvidence|undefined;
  const signer:Signer={publicKey:async()=>a.buyer,recover:async(r,h)=>new StoreSignJournal(signStore).read(r,h),async sign(input){
    request=input;const expected=validateSignRequest(input);
    primary=new FakeRpcClient({origin:f.primary.origin,expected,clock,fee:input.estimatedFee});secondary=new FakeRpcClient({origin:f.secondary.origin,expected,clock,fee:input.estimatedFee,state:primary.state});
    const path=join(root,'snapshot.db'),backup=brokerStore.backup(path,payloadHash([]));assert.equal(bytesHash(readFileSync(path)),backup.sha256);
    const frozen=openFrozenSnapshot(path,backup.sha256),snapshot=frozen.store;try{
      const view=snapshotView(snapshot,input);
      assert.equal(snapshot.read('arms',input.quoteId),null);assert.equal(view.read('arms',input.quoteId)?.value.message_sha256,input.messageHash);
      const authorize=createHumanAuthorizer({genesis:DEVNET_GENESIS,payer:expected.payer,sellerKey:market.sellers[1]!.listing.signing_key,reservationId:input.reservationId,quoteHash:input.arm.payload.quote_sha256,
        registryHash:input.registryHash,manifestHash:input.manifestHash,questionPolicyHash:input.questionPolicyHash,allowMainnet:false,rpc:primaryRpc,store:view,clock,eligible:async()=>true});
      const ceremony=createCeremony(input,{publicKey:a.buyer,clock,journal:new StoreSignJournal(signStore),authorize,keyBytes:()=>{loads++;return key.keyBytes;},terminal:{isTTY:()=>true,approve:async()=>{prompts++;return `approve ${input.messageHash}`;}}});
      const client=new HumanCliSigner({endpoint:'/unused',expectedPublicKey:a.buyer},async()=>{const out=await ceremony.sign();if(out.evidence)evidence=out.evidence;return canonicalBytes({ok:true,result:out.result});});
      const result=await client.sign(input);signedReturned=true;return result;
    }catch(error){signerError=error;throw error;}finally{frozen.close();if(bytesHash(readFileSync(path))!==backup.sha256)signerError=new Error('SNAPSHOT_OPEN_CHANGED_HASH');}
  }};
  const sellers=new Map<string,SellerClient>();
  for(const [n,s] of market.sellers.entries()){
    const built=await composeSeller({bundle:s.bundle,store:store(`seller-${n}`),clock,signer:s.signer,primaryRpc,secondaryRpc,tombstones:{readAll:async()=>[],append:async()=>{}},config:{rpcOrigins:[primaryRpc.origin,secondaryRpc.origin],origin:s.listing.endpoint,limits:M03,wire,listing:s.listing,registryVersion:market.registry.registry_version,sealActor:'test',invitations:[{origin:s.listing.endpoint,buyer,token_sha256:payloadHash('ephemeral-invitation')}],
      authority:async()=>({generation:0,tombstones_sha256:payloadHash([]),acknowledged_at:clock.now()}),clockSkewMs:()=>0,payerAccounts:()=>({payer:a.buyer,tokenAccount:a.buyerAta}),validateMessage:validateLegacyMessage,reconcile:reconcilePayment,worker:createExtractiveWorker(s.bundle,{origin:s.listing.endpoint,limits:M03,wire}),scanOutput:async()=>{}} as SellerConfig});
    sellers.set(s.listing.endpoint,built.controller);
  }
  let allowOffer=false;
  const deps:BrokerDeps={clock,store:brokerStore,signer,primaryRpc,secondaryRpc,sellers,registry:market.registry,questionPolicy:market.questions,
    policy:{policy_id:id('human-policy'),buyer,registry_sha256:payloadHash(market.registry),question_policy_sha256:payloadHash(market.questions),networks:['devnet'],principal_per_call:atomicFromBigint(M03.devnetPrincipalPerCall.value),principal_per_day:atomicFromBigint(M03.devnetPrincipalPerDay.value),fee_per_call:lamportsFromBigint(M03.feePerPurchaseMax.value),fee_per_day:lamportsFromBigint(M03.devnetFeePerDayMax.value),mainnet_enabled:false},
    offerApproval:{review:offer=>reviewHumanOffer(offer,clock,{isTTY:()=>true,approve:async()=>{if(!allowOffer)return 'no';clock.advance(M03.paymentForegroundWait.value*1000);reviewCompletedAt=clock.monotonicMs();return `review ${offer.quoteHash}`;}})},receiptImporter:{importReceipt:async()=>({status:'import_pending',code:'NOT_READY'}),readback:async()=>null}};
  const broker=composeBroker(deps,{payer:{payer:a.buyer,tokenAccount:a.buyerAta},rpcOrigins:[primaryRpc.origin,secondaryRpc.origin],authorizeHuman:()=>false,verifyRun:async()=>{throw new Error('UNVERIFIED');},verifyRefund:async()=>{throw new Error('UNVERIFIED');}});
  const input=()=>({request_id:randomUUID() as Uuid,question_id:id('q0'),max_price:{network:'devnet' as const,asset_id:a.mint,amount_atomic:atomicFromBigint(M03.totalAtomic.value)}});
  const denied=await settle({clock},broker.market.consult(buyer,input()));assert.equal(denied.consult_state,'cancelled');assert.equal(loads,0);assert.equal(primary.broadcasts,0);
  // Independent declined offer remains unarmed until TTL; wait before the clean counterpart.
  clock.advance(M03.dedupWindow.value*60*1000);allowOffer=true;
  const clean=await settle({clock},broker.market.consult(buyer,input()));
  assert.equal(signerError,undefined);
  assert.ok(reviewCompletedAt!==undefined && blockhashFetchedAt!==undefined && blockhashFetchedAt>=reviewCompletedAt,'blockhash is obtained after the long human offer review');
  const result=await settle({clock},broker.market.status(buyer,{consult_id:clean.consult_id}));
  assert.equal(broadcastsAtFirstReconcile,1,'must broadcast durable exact bytes before waiting for either provider to reconcile');
  assert.equal(result.delivery_state,'delivered',JSON.stringify({result,events:brokerStore.scan('events',{limit:100})}));assert.equal(loads,1);assert.equal(prompts,1);assert.equal(primary.broadcasts,1);
  assert.ok(request&&evidence);const receipt=brokerStore.read('receipts',result.receipt_id)!.value;
  assert.equal((await verifyHumanSettlement(request,evidence,receipt.transaction_signature!,primary,secondary)).status,'finalized_success');
  const before=canonicalBytes(receipt);await broker.market.status(buyer,{consult_id:clean.consult_id});assert.deepEqual(canonicalBytes(brokerStore.read('receipts',result.receipt_id)!.value),before);assert.equal(loads,1);assert.equal(primary.broadcasts,1);
});
