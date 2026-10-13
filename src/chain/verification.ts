import { isDeepStrictEqual } from 'node:util';
import type { AccountInfo, Address, ExpectedPayment, FinalizedTransaction, Reconciliation, RpcClient, SettlementEvidence, Signature, TokenBalance } from '../wire/contracts.ts';
import { bytesHash, M03 } from '../wire/index.ts';
import { decodeAmount } from '../common/index.ts';
import { buildLegacyPayment, decodeSignedPayment, verifyMessageSignature, requireChain, sameBytes, TOKEN_PROGRAM, validateLegacyMessage } from './legacy.ts';

export function validateMint(account: AccountInfo, mint: Address): void {
  requireChain(account.address === mint && account.owner === TOKEN_PROGRAM && !account.executable && account.data.length === 82);
  requireChain(account.data[44] === M03.tokenDecimals.value && account.data[45] === 1);
}
export function validateTokenAccount(account: AccountInfo, expected: { address: Address; mint: Address; owner: Address }): void {
  requireChain(account.address === expected.address && account.owner === TOKEN_PROGRAM && !account.executable && account.data.length === 165);
  // Kit-independent decoding of the fixed legacy Token account layout.
  const { mint, owner, state, delegate, native, closeAuthority } = tokenAccountFields(account);
  requireChain(mint === expected.mint && owner === expected.owner && state === 1 && delegate === 0 && native === 0 && closeAuthority === 0);
}
import { encodeBase58 } from '../wire/index.ts';
export function tokenAccountFields(account: AccountInfo) {
  const b = Buffer.from(account.data); requireChain(b.length === 165);
  return { mint: encodeBase58(b.subarray(0, 32)), owner: encodeBase58(b.subarray(32, 64)), amount: b.readBigUInt64LE(64), delegate: b.readUInt32LE(72), state: b[108], native: b.readUInt32LE(109), closeAuthority: b.readUInt32LE(129) };
}
/** Before arm/sign. Current balances are admission evidence, never settlement proof. */
export async function validatePaymentAccounts(expected: ExpectedPayment, rpc: RpcClient): Promise<void> {
  const q = expected.quote.payload;
  requireChain(await rpc.genesis() === q.genesis_hash);
  const addresses = [q.mint, expected.payer.tokenAccount, q.seller_token_account, q.marketplace_token_account];
  const snapshot = await rpc.accounts(addresses); requireChain(snapshot.accounts.length === addresses.length);
  const [mint, payer, seller, market] = snapshot.accounts; requireChain(mint && payer && seller && market);
  validateMint(mint, q.mint);
  for (const [account, owner] of [[payer, q.payer], [seller, q.seller_owner], [market, q.marketplace_owner]] as const) validateTokenAccount(account, { address: account.address, mint: q.mint, owner });
  requireChain(snapshot.accounts.every((account, i) => account?.address === addresses[i]));
  requireChain(tokenAccountFields(payer).amount >= M03.totalAtomic.value);
}
function balances(tx: FinalizedTransaction, expected: ExpectedPayment, zero: boolean): void {
  const q = expected.quote.payload;
  const wanted = [expected.payer.tokenAccount, q.seller_token_account, q.marketplace_token_account];
  const owners = [q.payer, q.seller_owner, q.marketplace_owner];
  const deltas = zero ? [0n, 0n, 0n] : [-M03.totalAtomic.value, M03.sellerAtomic.value, M03.marketplaceAtomic.value];
  for (const rows of [tx.meta.preTokenBalances, tx.meta.postTokenBalances]) {
    requireChain(rows.length === wanted.length && new Set(rows.map(b => b.accountIndex)).size === wanted.length);
    requireChain(rows.every(b => Number.isInteger(b.accountIndex) && wanted.includes(tx.accountKeys[b.accountIndex]!)));
  }
  wanted.forEach((key, i) => {
    const index = tx.accountKeys.indexOf(key);
    const pre = tx.meta.preTokenBalances.find(b => b.accountIndex === index);
    const post = tx.meta.postTokenBalances.find(b => b.accountIndex === index);
    requireChain(pre && post);
    for (const b of [pre, post] as TokenBalance[]) requireChain(b.mint === q.mint && b.owner === owners[i] && b.programId === TOKEN_PROGRAM && b.decimals === M03.tokenDecimals.value);
    requireChain(decodeAmount(post.amount) - decodeAmount(pre.amount) === deltas[i]);
  });
}
function envelope(tx: FinalizedTransaction, expected: ExpectedPayment): void {
  requireChain(tx.genesis === expected.quote.payload.genesis_hash && tx.commitment === M03.finality.value && Number.isSafeInteger(tx.slot) && tx.slot >= 0);
  const signed = decodeSignedPayment(tx.transaction);
  requireChain(signed.signature === tx.signature && sameBytes(signed.message, tx.message));
  const decoded = validateLegacyMessage(tx.message, expected);
  requireChain(isDeepStrictEqual(decoded.accountKeys, tx.accountKeys) && isDeepStrictEqual(decoded.instructions, tx.instructions));
  decodeAmount(tx.meta.fee); // Actual fee stays evidence even if above the estimated cap.
}
export function verifyFinalizedPayment(tx: FinalizedTransaction, expected: ExpectedPayment): SettlementEvidence {
  envelope(tx, expected); requireChain(tx.meta.err === null); balances(tx, expected, false);
  return { genesis: tx.genesis, signature: tx.signature, quote_id: expected.quote.payload.quote_id, message_sha256: expected.messageHash,
    slot: tx.slot, observed_at: tx.observedAt, commitment: 'finalized', meta_err: null, actual_fee: tx.meta.fee,
    payer_debit: expected.quote.payload.total_atomic, seller_credit: expected.quote.payload.seller_atomic, marketplace_credit: expected.quote.payload.fee_atomic, transaction_sha256: bytesHash(tx.transaction) };
}
/** Origin is currently missing from T0 RpcClient. Unknown origin cannot release expiry. */
export interface OriginRpcClient extends RpcClient { readonly origin: string }
function origin(rpc: RpcClient): string | null {
  if (!('origin' in rpc) || typeof rpc.origin !== 'string') return null;
  try { const url = new URL(rpc.origin); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null; } catch { return null; }
}
/** Protected composition check; endpoint paths never count as independent origins. */
export function assertRpcOrigins(primary: RpcClient, secondary: RpcClient, allowed: readonly string[] | undefined): void {
  const a = origin(primary), b = origin(secondary);
  requireChain(allowed && allowed.length === 2 && allowed.every(value => {
    try { return new URL(value).origin === value; } catch { return false; }
  }) && a && b && a !== b && allowed.includes(a) && allowed.includes(b));
}
export async function reconcilePayment(expected: ExpectedPayment, signature: Signature, primary: RpcClient, secondary: RpcClient): Promise<Reconciliation> {
  const pending = { status: 'pending', reason: 'PAYMENT_UNCERTAIN' } as const;
  try {
    const firstOrigin = origin(primary), secondOrigin = origin(secondary);
    if (!firstOrigin || !secondOrigin || firstOrigin === secondOrigin) return pending;
    const payment = buildLegacyPayment(expected.quote, expected.payer, expected.blockhash); requireChain(payment.messageHash === expected.messageHash);
    verifyMessageSignature(payment.message, expected.payer.payer, signature);
    const observations = await Promise.all([primary, secondary].map(async rpc => {
      const genesis = await rpc.genesis();
      requireChain(genesis === expected.quote.payload.genesis_hash);
      // Establish the expiry horizon before asking whether the signature is absent.
      const height = await rpc.finalizedHeight();
      const [status, tx] = await Promise.all([rpc.signatureStatus(signature), rpc.finalizedTransaction(signature)]);
      requireChain(status.signature === signature && Number.isSafeInteger(height) && height >= 0);
      requireChain(['absent', 'processed', 'confirmed', 'finalized'].includes(status.status));
      return { rpc, genesis, status, tx, height };
    }));
    const [a, b] = observations as [typeof observations[number], typeof observations[number]];
    if (a.tx || b.tx) {
      // A disagreeing/unavailable provider cannot create a conclusive money transition.
      if (!a.tx || !b.tx || a.status.status !== 'finalized' || b.status.status !== 'finalized') return pending;
      for (const o of [a, b]) {
        requireChain(o.tx && o.tx.signature === signature && o.tx.slot === o.status.slot && isDeepStrictEqual(o.tx.meta.err, o.status.err));
        envelope(o.tx, expected);
      }
      requireChain(sameBytes(a.tx.transaction, b.tx.transaction) && a.tx.slot === b.tx.slot && isDeepStrictEqual(a.tx.meta, b.tx.meta));
      if (a.tx.meta.err !== null) { balances(a.tx, expected, true); balances(b.tx, expected, true); return { status: 'finalized_failure', actualFee: a.tx.meta.fee, transaction: a.tx }; }
      const evidence = verifyFinalizedPayment(a.tx, expected); verifyFinalizedPayment(b.tx, expected);
      return { status: 'finalized_success', evidence };
    }
    if ([a, b].some(o => o.status.status !== 'absent' || o.status.slot !== null || o.status.err !== null || o.height <= expected.blockhash.lastValidBlockHeight)) return pending;
    return { status: 'expired', observations: [
      { origin: firstOrigin, genesis: a.genesis, finalizedHeight: a.height, signature: a.status },
      { origin: secondOrigin, genesis: b.genesis, finalizedHeight: b.height, signature: b.status },
    ] };
  } catch { return pending; }
}
