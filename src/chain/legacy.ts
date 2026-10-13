import { createPublicKey, verify } from 'node:crypto';
import { address, blockhash as kitBlockhash, createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransactionMessage, getCompiledTransactionMessageEncoder, getCompiledTransactionMessageDecoder, AccountRole } from '@solana/kit';
import type { Instruction } from '@solana/kit';
import type { Address, BlockhashWindow, CompiledInstruction, DecodedPayment, ExpectedPayment, PayerAccounts, Quote, Signed, SignResult, SignedPayment, UnsignedPayment } from '../wire/contracts.ts';
import { bytesHash, decodeBase58, encodeBase58, validateWire, M03 } from '../wire/index.ts';
import { decodeUtf8, FoundationError } from '../common/index.ts';
// Protocol identifiers, not configurable spending limits. R1 legacy Token only.
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address;
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;
export const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' as Address;
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' as Address;
export function requireChain(ok: unknown): asserts ok { if (!ok) throw new FoundationError('PAYMENT_INVALID'); }
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean { return Buffer.from(a).equals(Buffer.from(b)); }
export function transferChecked(source: Address, mint: Address, destination: Address, owner: Address, amount: bigint): Instruction {
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amount, 1); data[9] = M03.tokenDecimals.value;
  return { programAddress: address(TOKEN_PROGRAM), accounts: [
    { address: address(source), role: AccountRole.WRITABLE }, { address: address(mint), role: AccountRole.READONLY },
    { address: address(destination), role: AccountRole.WRITABLE }, { address: address(owner), role: AccountRole.READONLY_SIGNER },
  ], data };
}
export function compileLegacy(payer: Address, window: BlockhashWindow, instructions: readonly Instruction[]): Uint8Array {
  requireChain(Number.isSafeInteger(window.lastValidBlockHeight) && window.lastValidBlockHeight >= 0);
  const message = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: kitBlockhash(window.blockhash), lastValidBlockHeight: BigInt(window.lastValidBlockHeight) }, setTransactionMessageFeePayer(address(payer), createTransactionMessage({ version: 'legacy' }))));
  return Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message)));
}
function template(quote: Signed<Quote>, payer: PayerAccounts, window: BlockhashWindow): Uint8Array {
  validateWire('quote', quote);
  const q = quote.payload;
  requireChain(q.token_program === TOKEN_PROGRAM && q.payer === payer.payer);
  requireChain(q.genesis_hash === (q.network === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS));
  requireChain(new Set([payer.payer, q.seller_owner, q.marketplace_owner]).size === 3);
  // Aliasing even a program/mint with a writable account is forbidden.
  const keys = [payer.payer, payer.tokenAccount, q.seller_token_account, q.marketplace_token_account, q.mint, TOKEN_PROGRAM, MEMO_PROGRAM];
  requireChain(new Set(keys).size === keys.length);
  requireChain(BigInt(q.total_atomic) === M03.totalAtomic.value && BigInt(q.seller_atomic) === M03.sellerAtomic.value && BigInt(q.fee_atomic) === M03.marketplaceAtomic.value);
  return compileLegacy(payer.payer, window, [
    transferChecked(payer.tokenAccount, q.mint, q.seller_token_account, payer.payer, M03.sellerAtomic.value),
    transferChecked(payer.tokenAccount, q.mint, q.marketplace_token_account, payer.payer, M03.marketplaceAtomic.value),
    { programAddress: address(MEMO_PROGRAM), accounts: [], data: Buffer.from(q.memo, 'utf8') },
  ]);
}
/** Independent decoding, canonical round-trip and semantic checks; no SDK object escapes. */
export function decodeLegacy(message: Uint8Array): { accountKeys: readonly Address[]; instructions: readonly CompiledInstruction[]; recentBlockhash: Address; signers: number; readonlySigned: number; readonlyUnsigned: number } {
  const decoded = getCompiledTransactionMessageDecoder().decode(message);
  requireChain(decoded.version === 'legacy');
  requireChain(sameBytes(message, Uint8Array.from(getCompiledTransactionMessageEncoder().encode(decoded)))); // trailing/noncanonical bytes
  return { accountKeys: decoded.staticAccounts.map(a => a as string as Address), recentBlockhash: decoded.lifetimeToken as string as Address,
    signers: decoded.header.numSignerAccounts, readonlySigned: decoded.header.numReadonlySignerAccounts, readonlyUnsigned: decoded.header.numReadonlyNonSignerAccounts,
    instructions: decoded.instructions.map(i => ({ programIdIndex: i.programAddressIndex, accountIndices: [...(i.accountIndices ?? [])], data: Uint8Array.from(i.data ?? []) })) };
}
export function validateLegacyMessage(message: Uint8Array, expected: ExpectedPayment): DecodedPayment {
  const q = expected.quote.payload;
  requireChain(bytesHash(message) === expected.messageHash);
  const d = decodeLegacy(message);
  requireChain(d.signers === 1 && d.readonlySigned === 0 && d.readonlyUnsigned === 3 && d.accountKeys.length === 7 && d.instructions.length === 3);
  requireChain(d.accountKeys[0] === expected.payer.payer && d.recentBlockhash === expected.blockhash.blockhash);
  const writable = new Set(d.accountKeys.slice(0, 4));
  for (const key of [expected.payer.payer, expected.payer.tokenAccount, q.seller_token_account, q.marketplace_token_account]) requireChain(writable.has(key));
  for (let n = 0; n < 2; n++) {
    const i = d.instructions[n]!; const data = Buffer.from(i.data);
    requireChain(d.accountKeys[i.programIdIndex] === TOKEN_PROGRAM && i.accountIndices.length === 4 && data.length === 10 && data[0] === 12 && data[9] === M03.tokenDecimals.value);
    requireChain(data.readBigUInt64LE(1) === (n === 0 ? M03.sellerAtomic.value : M03.marketplaceAtomic.value));
    const wanted = [expected.payer.tokenAccount, q.mint, n === 0 ? q.seller_token_account : q.marketplace_token_account, expected.payer.payer];
    requireChain(i.accountIndices.every((index, j) => d.accountKeys[index] === wanted[j]));
  }
  const memo = d.instructions[2]!;
  requireChain(d.accountKeys[memo.programIdIndex] === MEMO_PROGRAM && memo.accountIndices.length === 0 && decodeUtf8(memo.data) === q.memo);
  requireChain(sameBytes(message, template(expected.quote, expected.payer, expected.blockhash)));
  return { payer: { ...expected.payer }, accountKeys: d.accountKeys, instructions: d.instructions, recentBlockhash: d.recentBlockhash, memo: q.memo };
}
export function buildLegacyPayment(quote: Signed<Quote>, payer: PayerAccounts, window: BlockhashWindow): UnsignedPayment {
  const stableQuote = structuredClone(quote); const stablePayer = { ...payer }; const stableWindow = { ...window };
  const message = template(stableQuote, stablePayer, stableWindow); const messageHash = bytesHash(message);
  const expected = { quote: stableQuote, payer: stablePayer, blockhash: stableWindow, messageHash };
  return { message, messageHash, expected, decoded: validateLegacyMessage(message, expected) };
}
export function verifyMessageSignature(message: Uint8Array, payer: Address, signature: string): void {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), decodeBase58(payer, 32)]), format: 'der', type: 'spki' });
  requireChain(verify(null, message, key, decodeBase58(signature, 64)));
}
export function attachSignature(payment: UnsignedPayment, signed: SignResult): SignedPayment {
  validateLegacyMessage(payment.message, payment.expected);
  requireChain(payment.messageHash === payment.expected.messageHash && signed.status === 'signed');
  requireChain(signed.messageHash === payment.messageHash && signed.publicKey === payment.expected.payer.payer);
  verifyMessageSignature(payment.message, signed.publicKey, signed.signature);
  const transaction = Uint8Array.from(Buffer.concat([Buffer.from([1]), decodeBase58(signed.signature, 64), payment.message]));
  validateLegacyMessage(transaction.slice(65), payment.expected);
  return { transaction, signature: signed.signature, messageHash: payment.messageHash };
}
export function decodeSignedPayment(transaction: Uint8Array): { message: Uint8Array; signature: string } {
  requireChain(transaction[0] === 1 && transaction.length > 65);
  const message = transaction.slice(65); const signature = encodeBase58(transaction.slice(1, 65));
  const decoded = decodeLegacy(message); requireChain(decoded.signers === 1 && decoded.accountKeys[0]);
  verifyMessageSignature(message, decoded.accountKeys[0], signature);
  return { message, signature };
}
