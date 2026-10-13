/** Devnet-only setup. Separate from the purchase Signer and runtime MCP surface. */
import { isDeepStrictEqual } from 'node:util';
import { address, AccountRole, getProgramDerivedAddress, getAddressEncoder } from '@solana/kit';
import type { Instruction } from '@solana/kit';
import type { AccountInfo, Address, BlockhashWindow, Clock, Sha256, Signature } from '../wire/contracts.ts';
import { decodeBase58, encodeBase58, payloadHash, M03 } from '../wire/index.ts';
import { compileLegacy, decodeLegacy, DEVNET_GENESIS, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, requireChain, sameBytes, verifyMessageSignature } from './legacy.ts';
import { importCliKey, signBytes } from './keys.ts';
import { integer, object, decodeRpcAccount, base64, RpcRateLimitError } from './rpc.ts';
import { validateMint, validateTokenAccount, tokenAccountFields } from './verification.ts';
export interface SetupRpc { genesis(): Promise<Address>; call(method: string, params: readonly unknown[]): Promise<unknown> }
export interface SetupKeys { readonly buyer: Uint8Array; readonly seller: Uint8Array; readonly marketplace: Uint8Array; readonly mint: Uint8Array; readonly seal: Uint8Array }
/** CONTRACT REQUEST: move these E06 setup limits into wire/constants.ts.
 * Required operator inputs until T0 owns them; never borrowed from purchase caps.
 */
export interface SetupLimits { readonly airdropLamports: bigint; readonly airdropBackoffMs: readonly number[]; readonly initialAtomic: bigint; readonly suiteReserveLamports: bigint }
export interface SetupEntry { readonly name: string; readonly signature: Signature; readonly transactionBase64: string; readonly lastValidBlockHeight: number; readonly state: 'pending' | 'finalized'; readonly fee: string | null }
export interface SetupState { readonly v: 1; readonly limitsSha256: Sha256; readonly genesis: Address; readonly addresses: Readonly<Record<string, Address>>; readonly entries: readonly SetupEntry[]; readonly airdropAttempts: number; readonly airdropSignature: Signature | null; readonly airdropPending: boolean; readonly mintAttempted: boolean }
export interface SetupJournal { read(): SetupState | null; write(state: SetupState): void }
export async function associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({ programAddress: address(ATA_PROGRAM), seeds: [getAddressEncoder().encode(address(owner)), getAddressEncoder().encode(address(TOKEN_PROGRAM)), getAddressEncoder().encode(address(mint))] });
  return ata as string as Address;
}
function accountMeta(key: Address, role: AccountRole) { return { address: address(key), role }; }
function mintInstructions(buyer: Address, mint: Address, rent: bigint): Instruction[] {
  const create = Buffer.alloc(52); create.writeUInt32LE(0, 0); create.writeBigUInt64LE(rent, 4); create.writeBigUInt64LE(82n, 12); create.set(decodeBase58(TOKEN_PROGRAM, 32), 20);
  // InitializeMint2 = 20; u8 decimals; authority; one-byte COption<Pubkey>.
  const initialize = Buffer.concat([Buffer.from([20, M03.tokenDecimals.value]), decodeBase58(buyer, 32), Buffer.from([1]), decodeBase58(buyer, 32)]);
  return [
    { programAddress: address(SYSTEM_PROGRAM), accounts: [accountMeta(buyer, AccountRole.WRITABLE_SIGNER), accountMeta(mint, AccountRole.WRITABLE_SIGNER)], data: create },
    { programAddress: address(TOKEN_PROGRAM), accounts: [accountMeta(mint, AccountRole.WRITABLE)], data: initialize },
  ];
}
function ataInstruction(payer: Address, owner: Address, mint: Address, ata: Address): Instruction {
  return { programAddress: address(ATA_PROGRAM), accounts: [accountMeta(payer, AccountRole.WRITABLE_SIGNER), accountMeta(ata, AccountRole.WRITABLE), accountMeta(owner, AccountRole.READONLY), accountMeta(mint, AccountRole.READONLY), accountMeta(SYSTEM_PROGRAM, AccountRole.READONLY), accountMeta(TOKEN_PROGRAM, AccountRole.READONLY)], data: Uint8Array.of(1) };
}
function mintTo(buyer: Address, mint: Address, ata: Address, amount: bigint): Instruction {
  const data = Buffer.alloc(10); data[0] = 14; data.writeBigUInt64LE(amount, 1); data[9] = M03.tokenDecimals.value;
  return { programAddress: address(TOKEN_PROGRAM), accounts: [accountMeta(mint, AccountRole.WRITABLE), accountMeta(ata, AccountRole.WRITABLE), accountMeta(buyer, AccountRole.READONLY_SIGNER)], data };
}
export async function runDevnetSetup(config: { rpc: SetupRpc; clock: Clock; keys: SetupKeys; journal: SetupJournal; limits: SetupLimits }): Promise<SetupState> {
  const { rpc, clock, keys, journal, limits } = config;
  requireChain(await rpc.genesis() === DEVNET_GENESIS); // BEFORE key use/faucet/signing
  requireChain(limits.airdropLamports <= BigInt(Number.MAX_SAFE_INTEGER) && limits.airdropLamports > 0n && limits.initialAtomic > 0n && limits.suiteReserveLamports >= 0n && limits.airdropBackoffMs.length > 0 && limits.airdropBackoffMs.every(n => Number.isSafeInteger(n) && n > 0));
  const buyer = importCliKey(keys.buyer).publicKey; const seller = importCliKey(keys.seller).publicKey; const marketplace = importCliKey(keys.marketplace).publicKey; const mint = importCliKey(keys.mint).publicKey; const seal = importCliKey(keys.seal).publicKey;
  requireChain(new Set([buyer, seller, marketplace, mint, seal]).size === 5);
  const buyerAta = await associatedTokenAddress(buyer, mint); const sellerAta = await associatedTokenAddress(seller, mint); const marketplaceAta = await associatedTokenAddress(marketplace, mint);
  const addresses = { buyer, seller, marketplace, mint, seal, buyerAta, sellerAta, marketplaceAta };
  const limitsSha256 = payloadHash({ airdropLamports: limits.airdropLamports.toString(), airdropBackoffMs: limits.airdropBackoffMs, initialAtomic: limits.initialAtomic.toString(), suiteReserveLamports: limits.suiteReserveLamports.toString() });
  let state: SetupState = journal.read() ?? { v: 1, limitsSha256, genesis: DEVNET_GENESIS, addresses, entries: [], airdropAttempts: 0, airdropSignature: null, airdropPending: false, mintAttempted: false };
  requireChain(state.v === 1 && state.limitsSha256 === limitsSha256 && state.genesis === DEVNET_GENESIS && isDeepStrictEqual(state.addresses, addresses));
  const save = (patch: Partial<SetupState>): void => { state = { ...state, ...patch }; journal.write(state); };
  save({});
  const getAccount = async (key: Address): Promise<AccountInfo | null> => {
    const row = object(await rpc.call('getAccountInfo', [key, { commitment: 'finalized', encoding: 'base64' }]), ['context', 'value']); return decodeRpcAccount(row.value, key);
  };
  const finalized = async (sig: Signature): Promise<{ fee: string } | null> => {
    const raw = await rpc.call('getTransaction', [sig, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if (raw === null) return null;
    const tx = object(raw, ['slot', 'transaction', 'meta'], ['blockTime', 'version', 'transactionIndex']);
    if (tx.meta === null) return null;
    const meta = object(tx.meta, ['err', 'fee'], ['preBalances', 'postBalances', 'preTokenBalances', 'postTokenBalances', 'innerInstructions', 'logMessages', 'rewards', 'loadedAddresses', 'returnData', 'computeUnitsConsumed', 'costUnits', 'status']);
    requireChain(meta.err === null);
    const entry = state.entries.find(e => e.signature === sig); requireChain(entry);
    requireChain(sameBytes(base64(tx.transaction), Buffer.from(entry.transactionBase64, 'base64')));
    return { fee: String(integer(meta.fee)) };
  };
  // A signed setup transaction is journaled BEFORE dispatch. Never replace uncertain bytes.
  const submit = async (name: string, instructions: readonly Instruction[]): Promise<void> => {
    requireChain(await rpc.genesis() === DEVNET_GENESIS);
    let entry = state.entries.find(e => e.name === name);
    if (entry?.state === 'finalized') return;
    if (!entry) {
      const row = object(await rpc.call('getLatestBlockhash', [{ commitment: 'finalized' }]), ['context', 'value']);
      const value = object(row.value, ['blockhash', 'lastValidBlockHeight']);
      const window: BlockhashWindow = { blockhash: String(value.blockhash) as Address, lastValidBlockHeight: integer(value.lastValidBlockHeight), observedAt: clock.now() };
      const message = compileLegacy(buyer, window, instructions); const decoded = decodeLegacy(message);
      const signatures = decoded.accountKeys.slice(0, decoded.signers).map(key => signBytes(message, key === buyer ? keys.buyer : keys.mint, key));
      requireChain(signatures.length < 128);
      const bytes = Buffer.concat([Buffer.from([signatures.length]), ...signatures.map(s => decodeBase58(s, 64)), message]);
      entry = { name, signature: signatures[0]!, transactionBase64: bytes.toString('base64'), lastValidBlockHeight: window.lastValidBlockHeight, state: 'pending', fee: null };
      save({ entries: [...state.entries, entry], mintAttempted: state.mintAttempted || name === 'initial-mint' });
    }
    const frozen = Buffer.from(entry.transactionBase64, 'base64'); requireChain(frozen.toString('base64') === entry.transactionBase64);
    const count = frozen[0]!; requireChain(count > 0 && count < 128); const message = frozen.subarray(1 + count * 64); const decoded = decodeLegacy(message); requireChain(decoded.signers === count && decoded.accountKeys[0] === buyer);
    for (let i = 0; i < count; i++) verifyMessageSignature(message, decoded.accountKeys[i]!, encodeBase58(frozen.subarray(1 + i * 64, 1 + (i + 1) * 64)));
    requireChain(encodeBase58(frozen.subarray(1, 65)) === entry.signature);
    let observation = await finalized(entry.signature);
    if (!observation) {
      const height = integer(await rpc.call('getBlockHeight', [{ commitment: 'finalized' }]));
      if (height > entry.lastValidBlockHeight) throw new Error('SETUP_EXPIRED_RECONCILE_REQUIRED');
      const sent = await rpc.call('sendTransaction', [entry.transactionBase64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 }]);
      requireChain(sent === entry.signature); observation = await finalized(entry.signature);
    }
    if (!observation) throw new Error('SETUP_PENDING_RERUN_SAME_KEYS');
    save({ entries: state.entries.map(e => e.name === name ? { ...e, state: 'finalized', fee: observation.fee } : e) });
  };
  // Recover prior pending work before making new provisioning decisions.
  for (const entry of state.entries) if (entry.state === 'pending') await submit(entry.name, []);
  const mintAccount = await getAccount(mint);
  if (mintAccount) {
    validateMint(mintAccount, mint); const data = Buffer.from(mintAccount.data);
    requireChain(data.readUInt32LE(0) === 1 && encodeBase58(data.subarray(4, 36)) === buyer && data.readUInt32LE(46) === 1 && encodeBase58(data.subarray(50, 82)) === buyer);
  }
  const atas = [[buyer, buyerAta], [seller, sellerAta], [marketplace, marketplaceAta]] as const;
  const missing: [Address, Address][] = [];
  for (const [owner, ata] of atas) { const account = await getAccount(ata); if (account) validateTokenAccount(account, { address: ata, mint, owner }); else missing.push([owner, ata]); }
  const mintRent = BigInt(integer(await rpc.call('getMinimumBalanceForRentExemption', [82])));
  const ataRent = BigInt(integer(await rpc.call('getMinimumBalanceForRentExemption', [165])));
  // Reserve supplied explicitly includes all setup transaction fees and suite fees.
  const threshold = (mintAccount ? 0n : mintRent) + BigInt(missing.length) * ataRent + limits.suiteReserveLamports;
  const balance = async (): Promise<bigint> => { const row = object(await rpc.call('getBalance', [buyer, { commitment: 'finalized' }]), ['context', 'value']); return BigInt(integer(row.value)); };
  if (state.airdropPending) {
    if (await balance() < threshold) throw new Error('AIRDROP_UNCERTAIN_MANUAL_RECONCILIATION');
    save({ airdropPending: false });
  }
  while (await balance() < threshold) {
    if (state.airdropAttempts >= limits.airdropBackoffMs.length) throw new Error('AIRDROP_LIMIT_FUND_SAME_BUYER');
    save({ airdropAttempts: state.airdropAttempts + 1, airdropPending: true });
    try {
      requireChain(await rpc.genesis() === DEVNET_GENESIS);
      const sig = await rpc.call('requestAirdrop', [buyer, Number(limits.airdropLamports), { commitment: 'finalized' }]);
      requireChain(typeof sig === 'string'); decodeBase58(sig, 64); save({ airdropSignature: sig as Signature });
    } catch (error) {
      if (error instanceof RpcRateLimitError) { save({ airdropPending: false }); await clock.sleep(Math.max(limits.airdropBackoffMs[state.airdropAttempts - 1]!, error.retryAfterMs)); continue; }
      // Timeout may have reached the faucet: never automatically request again.
      throw new Error('AIRDROP_UNCERTAIN_MANUAL_RECONCILIATION');
    }
    await clock.sleep(limits.airdropBackoffMs[state.airdropAttempts - 1]!);
    if (await balance() < threshold) throw new Error('AIRDROP_PENDING_RERUN_SAME_KEYS');
    save({ airdropPending: false });
  }
  if (!mintAccount) await submit('create-mint', mintInstructions(buyer, mint, mintRent));
  for (const [owner, ata] of missing) await submit(`ata-${owner}`, [ataInstruction(buyer, owner, mint, ata)]);
  const currentMint = await getAccount(mint); requireChain(currentMint); validateMint(currentMint, mint);
  const supply = Buffer.from(currentMint.data).readBigUInt64LE(36);
  if (supply === 0n && !state.mintAttempted) await submit('initial-mint', [mintTo(buyer, mint, buyerAta, limits.initialAtomic)]);
  else requireChain(supply === limits.initialAtomic); // Never silently top up/reset counters.
  for (const [owner, ata] of atas) { const account = await getAccount(ata); requireChain(account); validateTokenAccount(account, { address: ata, mint, owner }); tokenAccountFields(account); }
  const finalMint = await getAccount(mint); requireChain(finalMint && Buffer.from(finalMint.data).readBigUInt64LE(36) === limits.initialAtomic);
  return state;
}
