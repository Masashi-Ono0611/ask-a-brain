/** Lead-only devnet negative fixture. Never imported by buyer/broker runtime.
 * CONTRACT REQUEST T2: expose a reviewed freeze/thaw setup port through index.ts.
 * This local adapter uses Kit + node:crypto until that port is available. */
import { sign } from 'node:crypto';
import { join } from 'node:path';
import { address, blockhash, AccountRole, createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransactionMessage, getCompiledTransactionMessageEncoder } from '@solana/kit';
import { DEVNET_GENESIS, TOKEN_PROGRAM, decodeLegacy, decodeSignedPayment, importCliKey } from '../../src/chain/index.ts';
import type { JsonRpcClient } from '../../src/chain/index.ts';
import type { Clock, Signature } from '../../src/wire/contracts.ts';
import { M03, canonicalBytes, strictJson, encodeBase58 } from '../../src/wire/index.ts';
import { readPrivate, writePrivate } from '../chain/setup-storage.ts';
import type { Addresses } from './synthetic.ts';
interface Entry { signature: Signature; transaction: string; height: number; operation: 'freeze' | 'thaw' }
function parseEntry(bytes:Uint8Array):Entry {
  const x = strictJson(bytes) as unknown as Entry;
  if(!x || Object.keys(x).sort().join(',') !== 'height,operation,signature,transaction' || !Number.isSafeInteger(x.height) || x.height < 0 || !['freeze','thaw'].includes(x.operation) || typeof x.transaction !== 'string' || typeof x.signature !== 'string') throw new Error('BAD_SETUP_JOURNAL');
  const raw=Buffer.from(x.transaction,'base64');
  if(raw.toString('base64')!==x.transaction || raw[0]!==1 || encodeBase58(raw.subarray(1,65))!==x.signature) throw new Error('BAD_SETUP_BYTES'); return x;
}
export async function setMarketplaceFrozen(options:{ root:string; rpc:JsonRpcClient; clock:Clock; addresses:Addresses; buyerKey:Uint8Array; frozen:boolean }):Promise<Signature> {
  const {root,rpc,clock,addresses:a,buyerKey,frozen}=options;
  if(await rpc.genesis()!==DEVNET_GENESIS || importCliKey(buyerKey).publicKey!==a.buyer) throw new Error('DEVNET_ONLY');
  const operation=frozen ? 'freeze' : 'thaw', path=join(root,`${operation}.json`);
  let entry:Entry;
  try {entry=parseEntry(readPrivate(path));} catch(e) {
    if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;
    const window=await rpc.latestBlockhash();
    const instruction={programAddress:address(TOKEN_PROGRAM),accounts:[{address:address(a.marketplaceAta),role:AccountRole.WRITABLE},{address:address(a.mint),role:AccountRole.READONLY},{address:address(a.buyer),role:AccountRole.READONLY_SIGNER}],data:Uint8Array.of(frozen ? 10 : 11)};
    const msg=appendTransactionMessageInstructions([instruction],setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash(window.blockhash),lastValidBlockHeight:BigInt(window.lastValidBlockHeight)},setTransactionMessageFeePayer(address(a.buyer),createTransactionMessage({version:'legacy'}))));
    const message=Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(msg)));
    const decoded=decodeLegacy(message); if(decoded.signers!==1 || decoded.accountKeys[0]!==a.buyer) throw new Error('INVALID_SETUP_MESSAGE');
    const signature=sign(null,message,importCliKey(buyerKey).key);
    entry={signature:encodeBase58(signature) as Signature,transaction:Buffer.concat([Buffer.from([1]),signature,message]).toString('base64'),height:window.lastValidBlockHeight,operation};
    writePrivate(path,canonicalBytes(entry)); // fsync BEFORE dispatch, never replace uncertain bytes.
  }
  if(entry.operation!==operation) throw new Error('SETUP_OPERATION_MISMATCH');
  const signed=decodeSignedPayment(Buffer.from(entry.transaction,'base64')),decoded=decodeLegacy(signed.message),instruction=decoded.instructions[0];
  if(signed.signature!==entry.signature || decoded.accountKeys[0]!==a.buyer || decoded.instructions.length!==1 || !instruction || decoded.accountKeys[instruction.programIdIndex]!==TOKEN_PROGRAM || instruction.data.length!==1 || instruction.data[0] !== (frozen?10:11) || instruction.accountIndices.map(i=>decoded.accountKeys[i]).join(',')!==[a.marketplaceAta,a.mint,a.buyer].join(',')) throw new Error('SETUP_JOURNAL_BINDING_MISMATCH');
  const start=clock.monotonicMs();
  while(clock.monotonicMs()-start < M03.paymentForegroundWait.value*1000) {
    const tx=await rpc.call('getTransaction',[entry.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]) as null | {transaction:[string,string];meta:{err:unknown}};
    if(tx) {
      if(tx.meta.err!==null || tx.transaction[0]!==entry.transaction) throw new Error('SETUP_FAILED');
      const account=(await rpc.accounts([a.marketplaceAta])).accounts[0];
      if(!account || account.data[108] !== (frozen ? 2 : 1)) throw new Error('SETUP_STATE_MISMATCH');
      return entry.signature;
    }
    if(await rpc.finalizedHeight()>entry.height) throw new Error('SETUP_EXPIRED_RECONCILE_WITHOUT_REPLACEMENT');
    const sent=await rpc.call('sendTransaction',[entry.transaction,{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0}]);
    if(sent!==entry.signature) throw new Error('SETUP_SIGNATURE_MISMATCH');
    await clock.sleep(M03.paymentPoll.value[0]*1000);
  }
  throw new Error('SETUP_PENDING_RERUN_SAME_RUN');
}
