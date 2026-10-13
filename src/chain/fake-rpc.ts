/** Deterministic offline simulator. Never evidence of Solana runtime atomicity. */
import type { AccountInfo, AccountSnapshot, Address, BlockhashWindow, Clock, GenesisHash, ExpectedPayment, FinalizedTransaction, Lamports, Signature, SignatureObservation, TokenBalance } from '../wire/contracts.ts';
import { decodeBase58, M03 } from '../wire/index.ts';
import { atomicFromBigint, lamportsFromBigint } from '../common/index.ts';
import { decodeSignedPayment, requireChain, TOKEN_PROGRAM, validateLegacyMessage } from './legacy.ts';
import type { OriginRpcClient } from './verification.ts';
export interface FakeRpcState { height: number; accounts: Map<Address, AccountInfo>; transactions: Map<Signature, FinalizedTransaction>; status: 'processed' | 'confirmed' | 'finalized'; feesCharged: bigint }
export function fakeMint(mint: Address): AccountInfo {
  const data = Buffer.alloc(82); data[44] = M03.tokenDecimals.value; data[45] = 1;
  return { address: mint, owner: TOKEN_PROGRAM, executable: false, lamports: lamportsFromBigint(1n), data };
}
export function fakeTokenAccount(key: Address, mint: Address, owner: Address, amount: bigint): AccountInfo {
  const data = Buffer.alloc(165); data.set(decodeBase58(mint, 32)); data.set(decodeBase58(owner, 32), 32); data.writeBigUInt64LE(amount, 64); data[108] = 1;
  return { address: key, owner: TOKEN_PROGRAM, executable: false, lamports: lamportsFromBigint(1n), data };
}
export class FakeRpcClient implements OriginRpcClient {
  readonly origin: string; readonly state: FakeRpcState; readonly expected: ExpectedPayment; readonly clock: Clock;
  fee: Lamports; unavailable = false; broadcasts = 0; reads = 0;
  constructor(config: { origin: string; expected: ExpectedPayment; clock: Clock; fee: Lamports; state?: FakeRpcState }) {
    this.origin = config.origin; this.expected = structuredClone(config.expected); this.clock = config.clock; this.fee = config.fee;
    const q = this.expected.quote.payload;
    this.state = config.state ?? { height: 1, status: 'finalized', feesCharged: 0n, transactions: new Map(), accounts: new Map([
      [q.mint, fakeMint(q.mint)], [this.expected.payer.tokenAccount, fakeTokenAccount(this.expected.payer.tokenAccount, q.mint, q.payer, M03.devnetPrincipalPerDay.value)],
      [q.seller_token_account, fakeTokenAccount(q.seller_token_account, q.mint, q.seller_owner, 0n)], [q.marketplace_token_account, fakeTokenAccount(q.marketplace_token_account, q.mint, q.marketplace_owner, 0n)],
    ]) };
  }
  #check(): void { this.reads++; if (this.unavailable) throw new Error('FAKE_RPC_UNAVAILABLE'); }
  async genesis(): Promise<GenesisHash> { this.#check(); return this.expected.quote.payload.genesis_hash; }
  async latestBlockhash(): Promise<BlockhashWindow> { this.#check(); return { ...this.expected.blockhash }; }
  async finalizedHeight(): Promise<number> { this.#check(); return this.state.height; }
  async feeForMessage(): Promise<Lamports> { this.#check(); return this.fee; }
  async accounts(addresses: readonly Address[]): Promise<AccountSnapshot> { this.#check(); return { slot: this.state.height, observedAt: this.clock.now(), accounts: addresses.map(a => structuredClone(this.state.accounts.get(a) ?? null)) }; }
  async signatureStatus(signature: Signature): Promise<SignatureObservation> {
    this.#check(); const tx = this.state.transactions.get(signature);
    return { signature, status: tx ? this.state.status : 'absent', slot: tx?.slot ?? null, err: tx?.meta.err ?? null, observedAt: this.clock.now() };
  }
  async finalizedTransaction(signature: Signature): Promise<FinalizedTransaction | null> { this.#check(); return this.state.status === 'finalized' ? structuredClone(this.state.transactions.get(signature) ?? null) : null; }
  async broadcastIdentical(transaction: Uint8Array): Promise<Signature> {
    this.#check(); this.broadcasts++;
    const signed = decodeSignedPayment(transaction); const signature = signed.signature as Signature;
    if (this.state.transactions.has(signature)) return signature;
    const decoded = validateLegacyMessage(signed.message, this.expected);
    requireChain(this.state.height <= this.expected.blockhash.lastValidBlockHeight);
    const q = this.expected.quote.payload; const keys = [this.expected.payer.tokenAccount, q.seller_token_account, q.marketplace_token_account];
    const owners = [q.payer, q.seller_owner, q.marketplace_owner];
    const pre: TokenBalance[] = keys.map((key, i) => ({ accountIndex: decoded.accountKeys.indexOf(key), mint: q.mint, owner: owners[i]!, programId: TOKEN_PROGRAM, decimals: M03.tokenDecimals.value, amount: atomicFromBigint(Buffer.from(this.state.accounts.get(key)!.data).readBigUInt64LE(64)) }));
    let err: FinalizedTransaction['meta']['err'] = null;
    for (let i = 0; i < 2; i++) if (this.state.accounts.get(keys[i + 1]!)!.data[108] !== 1) { err = { InstructionError: [i, { Custom: 17 }] }; break; }
    if (BigInt(pre[0]!.amount) < M03.totalAtomic.value) err = { InstructionError: [0, { Custom: 1 }] };
    const deltas = [-M03.totalAtomic.value, M03.sellerAtomic.value, M03.marketplaceAtomic.value];
    const post = pre.map((b, i) => ({ ...b, amount: atomicFromBigint(BigInt(b.amount) + (err === null ? deltas[i]! : 0n)) }));
    if (err === null) keys.forEach((key, i) => { const a = this.state.accounts.get(key)!; const data = Buffer.from(a.data); data.writeBigUInt64LE(BigInt(post[i]!.amount), 64); this.state.accounts.set(key, { ...a, data }); });
    this.state.feesCharged += BigInt(this.fee);
    this.state.transactions.set(signature, { genesis: q.genesis_hash, signature, transaction: Uint8Array.from(transaction), message: signed.message, slot: this.state.height, commitment: 'finalized', observedAt: this.clock.now(), accountKeys: decoded.accountKeys, instructions: decoded.instructions, meta: { err, fee: this.fee, preTokenBalances: pre, postTokenBalances: post } });
    return signature;
  }
}
