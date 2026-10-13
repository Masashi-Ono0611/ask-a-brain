import { existsSync } from 'node:fs';
import type { Clock, SignRequest, Signature } from '../../src/wire/contracts.ts';
import type { RpcTransport, OriginRpcClient } from '../../src/chain/index.ts';
import { RpcRateLimitError, buildLegacyPayment, attachSignature, reconcilePayment, validateSignRequest } from '../../src/chain/index.ts';
import { M03, canonicalBytes, strictJson, payloadHash } from '../../src/wire/index.ts';
import { readPrivate, writePrivate } from './setup-storage.ts';
import { validateCeremonyEvidence } from './human-live-ceremony.ts';
import type { CeremonyEvidence } from './human-live-ceremony.ts';

export function parseFlags(args: readonly string[]) {
  if(args[0]!=='--execute') throw new Error('EXPLICIT_EXECUTE_REQUIRED');
  const flags=new Map<string,string>();
  for(let i=1;i<args.length;i+=2) {const k=args[i]!,v=args[i+1]; if(!['--run','--primary','--secondary','--seller-ports'].includes(k)||!v||flags.has(k)) throw new Error('INVALID_FLAGS'); flags.set(k,v);}
  const run=flags.get('--run')??'', primaryUrl=flags.get('--primary')??'', secondaryUrl=flags.get('--secondary')??'';
  if(!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('INVALID_RUN');
  const urls=[primaryUrl,secondaryUrl].map(v=>new URL(v));
  if(urls.some((u,i)=>u.protocol!=='https:'||u.href!==[primaryUrl,secondaryUrl][i]||u.username||u.password||u.hash) || urls[0]!.origin===urls[1]!.origin) throw new Error('DISTINCT_CANONICAL_RPC_REQUIRED');
  const ports=(flags.get('--seller-ports')??'').split(',').map(Number);
  if(ports.length!==2||new Set(ports).size!==2||!ports.every(p=>Number.isSafeInteger(p)&&p>0&&p<65536)) throw new Error('TWO_EXPLICIT_PORTS_REQUIRED');
  return {run,primaryUrl,secondaryUrl,ports};
}
export function requireClean(dirty: boolean): void { if(dirty)throw new Error('COMMIT_REVIEWED_REVISION_FIRST'); }
export function claimActive(path: string, run: string): void {
  if(existsSync(path)) {
    if(payloadHash(strictJson(readPrivate(path)))!==payloadHash({run}))throw new Error('EXISTING_RUN_REQUIRES_OPERATOR_RECONCILIATION');
  } else writePrivate(path,canonicalBytes({run}));
}
/** Serialize concurrent secondary reads; pacing cannot turn disagreement into finality. */
export function pacedTransport(inner: RpcTransport, clock: Clock, observe?: (bytes: Uint8Array) => void): RpcTransport {
  let last = -Infinity, tail: Promise<unknown> = Promise.resolve();
  return (endpoint,body,signal) => {
    const pending = tail.then(async () => {
      for(let attempt=0;;attempt++) {
        signal?.throwIfAborted();
        const wait=last+M03.paymentPoll.value[0]*1000-clock.monotonicMs();
        if(wait>0)await clock.sleep(Math.ceil(wait),signal);
        last=clock.monotonicMs();
        try {
          const out=await inner(endpoint,body,signal);observe?.(out);
          const row=strictJson(out) as {error?:{code?:number}};
          if(row?.error?.code!==-32029||attempt>=M03.paymentPoll.value.length)return out;
        } catch(error) { if(!(error instanceof RpcRateLimitError)||attempt>=M03.paymentPoll.value.length)throw error; }
        await clock.sleep(M03.paymentPoll.value[Math.min(attempt,M03.paymentPoll.value.length-1)]!*1000,signal);
      }
    });
    tail=pending.catch(()=>undefined); return pending;
  };
}
export async function verifyHumanSettlement(request: SignRequest, human: CeremonyEvidence, signature: Signature, primary: OriginRpcClient, secondary: OriginRpcClient) {
  validateCeremonyEvidence(request,human,signature);
  const expected = validateSignRequest(request);
  const payment=buildLegacyPayment(request.quote,expected.payer,request.blockhash);
  attachSignature(payment,{status:'signed',messageHash:request.messageHash,publicKey:request.expectedPayer,signature,approvalRef:request.offerApproval.approvalRef});
  const finality=await reconcilePayment(payment.expected,signature,primary,secondary);
  if(finality.status!=='finalized_success')throw new Error('DUAL_FINALIZED_SUCCESS_REQUIRED');
  return finality;
}

/** M05 offer review precedes reservation/arm and the helper's exact-message approval. */
export async function reviewHumanOffer(offer: import('../../src/wire/contracts.ts').OfferReview, clock: Clock, terminal: import('../../src/chain/index.ts').HumanTerminal): Promise<import('../../src/wire/contracts.ts').ApprovalDecision> {
  const approved=terminal.isTTY() && await terminal.approve(`${JSON.stringify({quote:offer.quote.payload,quoteHash:offer.quoteHash,terms:offer.terms},null,2)}\nType review ${offer.quoteHash}\n`)===`review ${offer.quoteHash}`;
  return {status:approved?'approved':'denied',actor:'human',reviewedHash:offer.quoteHash,at:clock.now(),approvalRef:'gate1-human-offer' as import('../../src/wire/contracts.ts').Id};
}

/** Record requests BEFORE dispatch and raw replies BEFORE RPC parsing. The SDK
 * evidence hook only sees successful results and cannot prove a send was absent.
 * No endpoint, headers, exception text or process environment enters evidence.
 */
export function observedRpcTransport(inner: RpcTransport, record: (method: string, bytes: Uint8Array) => void): RpcTransport {
  return async (endpoint, body, signal) => {
    const request = strictJson(body) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (!request || Object.keys(request).sort().join(',') !== 'id,jsonrpc,method,params' || request.jsonrpc !== '2.0' ||
        typeof request.id !== 'number' || !Number.isSafeInteger(request.id) || request.id < 1 || !Array.isArray(request.params) ||
        typeof request.method !== 'string' || !/^[A-Za-z0-9]+$/.test(request.method)) throw new Error('INVALID_RPC_METHOD');
    record(`${request.method}Request`, Uint8Array.from(body));
    let response: Uint8Array;
    try { response = await inner(endpoint, body, signal); }
    catch (error) {
      record(`${request.method}TransportError`, canonicalBytes({ code: error instanceof RpcRateLimitError ? 'RPC_RATE_LIMIT' : 'RPC_TRANSPORT_FAILED' }));
      throw error;
    }
    record(`${request.method}Response`, Uint8Array.from(response));
    return response;
  };
}

/** Strict message-bound recovery adapter while the generic IPC adapter accepts
 * signed results only. A missing/invalid reply never proves non-signing. */
export function parseHumanRecovery(bytes: Uint8Array, request: SignRequest): import('../../src/wire/contracts.ts').SignResult | null {
  if (bytes.length > M03.ingressBodyMax.value * 1024) throw new Error('INVALID_RECOVERY');
  const frame = strictJson(bytes) as { ok: boolean; result: import('../../src/wire/contracts.ts').SignResult | null };
  if (!frame || Object.keys(frame).sort().join(',') !== 'ok,result' || frame.ok !== true) throw new Error('INVALID_RECOVERY');
  const result = frame.result;
  if (result === null) return null;
  if (result.status === 'denied') {
    if (Object.keys(result).sort().join(',') !== 'messageHash,reason,status' || result.reason !== 'EXPIRED_BEFORE_APPROVAL' || result.messageHash !== request.messageHash) throw new Error('INVALID_RECOVERY');
    return result;
  }
  if (Object.keys(result).sort().join(',') !== 'approvalRef,messageHash,publicKey,signature,status' || result.status !== 'signed') throw new Error('INVALID_RECOVERY');
  const expected = validateSignRequest(request);
  attachSignature(buildLegacyPayment(request.quote, expected.payer, request.blockhash), result);
  return result;
}
