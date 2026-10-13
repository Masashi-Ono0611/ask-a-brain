/** Separate founder helper; the ONLY live purchase process that reads buyer.json. */
import { existsSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, SystemClock } from '../../src/common/index.ts';
import { M03, bytesHash, canonicalBytes, strictJson } from '../../src/wire/index.ts';
import { controllingTerminal, createHumanAuthorizer, createRpcClient, fetchRpcTransport, DEVNET_GENESIS, parseCliKey, StoreSignJournal, validateSignRequest } from '../../src/chain/index.ts';
import type { SellerPublicKey, Store, SignRequest } from '../../src/wire/contracts.ts';
import { readPrivate, writePrivate, fileSetupJournal } from './setup-storage.ts';
import type { CeremonyEvidence } from './human-live-ceremony.ts';
import { ExpiredBeforeApproval } from '../../src/chain/human-cli.ts';
import { observedRpcTransport } from './human-live-runtime.ts';
import { createCeremony, readRequest, recoverCeremony } from './human-live-ceremony.ts';

export function parsePacket(bytes: Uint8Array) {
  if(bytes.length>M03.ingressBodyMax.value*1024)throw new Error('PACKET_TOO_LARGE');
  const packet = strictJson(bytes) as unknown as { request: string; primary: string; snapshot: string; snapshotHash: string; sellerKey: SellerPublicKey; evidence: string };
  if (!packet || Object.keys(packet).sort().join(',') !== 'evidence,primary,request,sellerKey,snapshot,snapshotHash' ||
      !['request','primary','snapshot','snapshotHash','evidence'].every(k => typeof packet[k as 'request'] === 'string') ||
      Object.keys(packet.sellerKey).sort().join(',') !== 'algorithm,id,public_key') throw new Error('INVALID_PACKET');
  return packet;
}
export function snapshotView(snapshot: Store, request: SignRequest): Store {
  // T3 keys arms by consult/reservation ID; T2 authorizer expects quote ID.
  // Adapt only the read port, leaving the frozen public contract untouched.
  return new Proxy(snapshot, { get(target, property) {
    if (property === 'read') return (table: Parameters<Store['read']>[0], key: string) => target.read(table, table === 'arms' && key === request.quoteId ? request.reservationId : key);
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/** Opening SQLite changes journal metadata. Keep the hashed source immutable. */
export function openFrozenSnapshot(path: string, hash: string) {
  const bytes=readPrivate(path);if(bytesHash(bytes)!==hash)throw new Error('SNAPSHOT_CHANGED');
  const temporary=realpathSync(mkdtempSync(join(tmpdir(),'aab-human-snapshot-')));
  try {
    const copy=join(temporary,'snapshot.db');writePrivate(copy,bytes);const store=openStore(copy);
    return {store,close(){try{store.close();}finally{rmSync(temporary,{recursive:true,force:true});}}};
  }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
}

export function assertSetupBinding(request: SignRequest, setup: ReturnType<ReturnType<typeof fileSetupJournal>['read']>, sellerKey: SellerPublicKey): void {
  const expected=validateSignRequest(request);
  const q = request.quote.payload;
  if (!setup || setup.genesis !== DEVNET_GENESIS || !setup.entries.length || setup.entries.some(e => e.state !== 'finalized') ||
      request.network !== 'devnet' || request.genesis !== DEVNET_GENESIS || q.payer !== setup.addresses.buyer ||
      expected.payer.tokenAccount !== setup.addresses.buyerAta || q.mint !== setup.addresses.mint ||
      q.seller_owner !== setup.addresses.seller || q.seller_token_account !== setup.addresses.sellerAta ||
      q.marketplace_owner !== setup.addresses.marketplace || q.marketplace_token_account !== setup.addresses.marketplaceAta ||
      sellerKey.public_key !== setup.addresses.seal) throw new Error('SETUP_BINDING_MISMATCH');
}

export async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 3 || args[0] !== '--packet' || !process.send || !controllingTerminal().isTTY()) throw new Error('FOUNDER_TTY_REQUIRED');
  const packetPath = resolve(args[1]!); const root = dirname(packetPath);
  const packet = parsePacket(readPrivate(packetPath));
  const request = readRequest(Buffer.from(packet.request, 'base64')); const expected = validateSignRequest(request);
  const setupRoot = resolve('.local/devnet/t2'); const setup = fileSetupJournal(setupRoot).read();
  assertSetupBinding(request,setup,packet.sellerKey);
  const frozenSnapshot=openFrozenSnapshot(packet.snapshot,packet.snapshotHash);
  const snapshot = frozenSnapshot.store, journal = openStore(join(root, 'human-signer.db')), clock = new SystemClock();
  const view = snapshotView(snapshot, request);
  let sequence = 0;
  const rpc = createRpcClient({ endpoint: packet.primary, genesis: DEVNET_GENESIS, clock, responseBytesMax: M03.sealedPayloadMax.value * 1024 * 1024,
    transport: observedRpcTransport(fetchRpcTransport(M03.sealedPayloadMax.value * 1024 * 1024), (method, bytes) => {
      writeFileSync(join(packet.evidence, `human-helper-${process.pid}-${Date.now()}-${++sequence}-${method}.json`), bytes, { flag: 'wx', mode: 0o600 });
    }) });
  const evidencePath = join(root, 'human-ceremony.json');
  const frame = strictJson(Buffer.from(args[2]!, 'base64')) as {operation: string; value: unknown};
  if (!frame || Object.keys(frame).sort().join(',') !== 'operation,value') throw new Error('INVALID_FRAME');
  try {
    if (frame.operation === 'recover') {
      const v = frame.value as {requestId:string;messageHash:string};
      if (!v || Object.keys(v).sort().join(',') !== 'messageHash,requestId' || v.requestId !== request.requestId || v.messageHash !== request.messageHash) throw new Error('RECOVERY_REQUEST_CHANGED');
      const result = recoverCeremony(request,new StoreSignJournal(journal),existsSync(evidencePath)?strictJson(readPrivate(evidencePath)) as unknown as CeremonyEvidence:null);
      process.send!(Buffer.from(canonicalBytes({ok:true,result})).toString('base64')); return;
    }
    if (frame.operation !== 'sign' || bytesHash(canonicalBytes(frame.value)) !== bytesHash(Buffer.from(packet.request,'base64'))) throw new Error('REQUEST_CHANGED');
    const row = snapshot.read('consults',request.reservationId)?.value;
    if (!row?.broker || row.broker.stage !== 'signing' || row.request_id !== request.requestId || row.broker.messageHash !== request.messageHash ||
        row.broker.registryHash !== request.registryHash || row.broker.policyHash !== request.questionPolicyHash || row.broker.listing?.slice.manifest_sha256 !== request.manifestHash) throw new Error('BROKER_SNAPSHOT_BINDING_MISMATCH');
    const ceremony = createCeremony(request, { publicKey: expected.payer.payer, clock, journal: new StoreSignJournal(journal), terminal: controllingTerminal(), finalizedHeight: () => rpc.finalizedHeight(),
      keyBytes: () => parseCliKey(readPrivate(join(setupRoot, 'buyer.json'))),
      authorize: createHumanAuthorizer({ genesis: DEVNET_GENESIS, payer: expected.payer, sellerKey: packet.sellerKey, reservationId: request.reservationId,
        quoteHash: request.arm.payload.quote_sha256, registryHash: request.registryHash, manifestHash: request.manifestHash, questionPolicyHash: request.questionPolicyHash,
        allowMainnet: false, rpc, store: view, clock, eligible: async () => {
          // Synthetic fixture only; read the current independent tombstone journal each time.
          // No real content is admitted by this ceremony; current tombstones remain authoritative.
          const path = join(root, 'tombstones-1.jsonl');
          return existsSync(path) && readPrivate(path).length === 0;
        } }),
    });
    const { result, evidence } = await ceremony.sign();
    if (result.status === 'signed') {
      if (evidence?.tty && evidence.exactPhrase) writePrivate(evidencePath, canonicalBytes(evidence));
      else if (!existsSync(evidencePath)) throw new Error('MISSING_ORIGINAL_TTY_EVIDENCE');
    }
    process.send!(Buffer.from(canonicalBytes({ ok: true, result })).toString('base64'));
  } catch (error) {
    if (!(error instanceof ExpiredBeforeApproval)) throw error;
    console.error('EXPIRED_BEFORE_APPROVAL: no signature created. Retain this run and its reservation; a fresh message requires a new exact approval.');
    process.send!(Buffer.from(canonicalBytes({ ok: false, result: error.code })).toString('base64'));
  } finally { frozenSnapshot.close(); journal.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error('HUMAN_HELPER_STOPPED_RETAIN_STATE'); process.exitCode = 1; });
