import type { AccountInfo, AccountSnapshot, Address, BlockhashWindow, Clock, FinalizedTransaction, JsonValue, Lamports, Signature, SignatureObservation, TokenBalance } from '../wire/contracts.ts';
import { decodeBase58, strictJson, M03 } from '../wire/index.ts';
import { parseAtomic, parseLamports } from '../common/index.ts';
import { decodeLegacy, decodeSignedPayment, requireChain } from './legacy.ts';
import type { OriginRpcClient } from './verification.ts';
export class RpcRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super('RPC_RATE_LIMIT'); this.retryAfterMs = retryAfterMs; }
}
export type RpcTransport = (endpoint: string, body: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;
export interface RpcConfig {
  readonly endpoint: string; readonly genesis: Address; readonly clock: Clock; readonly transport: RpcTransport;
  /** Explicit transport resource budget, not a payment cap. */
  readonly responseBytesMax: number;
  readonly evidence?: (method: string, raw: Uint8Array) => void;
}
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireChain(value !== null && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  requireChain(required.every(k => Object.hasOwn(row, k)) && Object.keys(row).every(k => required.includes(k) || optional.includes(k))); return row;
}
export function integer(value: unknown): number { requireChain(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); return value; }
export function rpcAddress(value: unknown): Address { requireChain(typeof value === 'string'); decodeBase58(value, 32); return value as Address; }
function context(value: unknown): number { const row = object(value, ['slot'], ['apiVersion']); if (row.apiVersion !== undefined) requireChain(typeof row.apiVersion === 'string'); return integer(row.slot); }
function signature(value: unknown): Signature { requireChain(typeof value === 'string'); decodeBase58(value, 64); return value as Signature; }
function lamports(value: unknown): Lamports { return parseLamports(String(integer(value))); }
export function base64(value: unknown): Uint8Array {
  requireChain(Array.isArray(value) && value.length === 2 && value[1] === 'base64' && typeof value[0] === 'string');
  const bytes = Buffer.from(value[0], 'base64'); requireChain(bytes.toString('base64') === value[0]); return Uint8Array.from(bytes);
}
export function decodeRpcAccount(value: unknown, address: Address): AccountInfo | null {
  if (value === null) return null;
  const row = object(value, ['data', 'executable', 'lamports', 'owner'], ['rentEpoch', 'space']);
  requireChain(typeof row.executable === 'boolean');
  const data = base64(row.data); if (row.space !== undefined) requireChain(integer(row.space) === data.length);
  return { address, owner: rpcAddress(row.owner), lamports: lamports(row.lamports), executable: row.executable, data };
}
function tokenBalances(value: unknown): TokenBalance[] {
  requireChain(Array.isArray(value));
  return value.map(v => {
    const row = object(v, ['accountIndex', 'mint', 'owner', 'programId', 'uiTokenAmount']);
    const amount = object(row.uiTokenAmount, ['amount', 'decimals', 'uiAmount', 'uiAmountString']);
    return { accountIndex: integer(row.accountIndex), mint: rpcAddress(row.mint), owner: rpcAddress(row.owner), programId: rpcAddress(row.programId), decimals: integer(amount.decimals), amount: parseAtomic(amount.amount) };
  });
}
/** Explicitly injected HTTP implementation; creating an adapter never contacts the network. */
export function fetchRpcTransport(responseBytesMax: number): RpcTransport {
  requireChain(Number.isSafeInteger(responseBytesMax) && responseBytesMax > 0);
  return async (endpoint, body, signal) => {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: Buffer.from(body), signal });
    if (response.status === 429) { const value = response.headers.get('retry-after'); const seconds = value === null ? 0 : Number(value); const retry = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value!) - Date.now()); throw new RpcRateLimitError(Number.isFinite(retry) ? retry : 0); }
    requireChain(response.ok && response.body);
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > responseBytesMax) throw new Error('RPC_BODY_LIMIT'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  };
}
export class JsonRpcClient implements OriginRpcClient {
  readonly origin: string; #config: RpcConfig; #nextId = 0;
  constructor(config: RpcConfig) {
    const url = new URL(config.endpoint);
    requireChain(url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === config.endpoint);
    requireChain(Number.isSafeInteger(config.responseBytesMax) && config.responseBytesMax > 0);
    this.origin = url.origin; this.#config = { ...config };
  }
  async call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    const id = ++this.#nextId; const timeout = AbortSignal.timeout(M03.paymentForegroundWait.value * 1000);
    const raw = await this.#config.transport(this.#config.endpoint, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params })), signal ? AbortSignal.any([signal, timeout]) : timeout);
    requireChain(raw.length <= this.#config.responseBytesMax);
    const response = object(strictJson(raw), ['jsonrpc', 'id'], ['result', 'error']);
    requireChain(response.jsonrpc === '2.0' && response.id === id && Object.hasOwn(response, 'result') !== Object.hasOwn(response, 'error'));
    if (response.error !== undefined) throw new Error('RPC_ERROR');
    this.#config.evidence?.(method, Uint8Array.from(raw)); return response.result;
  }
  async genesis(signal?: AbortSignal): Promise<Address> { const genesis = await this.call('getGenesisHash', [], signal); requireChain(genesis === this.#config.genesis); return this.#config.genesis; }
  async latestBlockhash(signal?: AbortSignal): Promise<BlockhashWindow> {
    await this.genesis(signal); const row = object(await this.call('getLatestBlockhash', [{ commitment: 'finalized' }], signal), ['context', 'value']);
    context(row.context); const value = object(row.value, ['blockhash', 'lastValidBlockHeight']);
    return { blockhash: rpcAddress(value.blockhash), lastValidBlockHeight: integer(value.lastValidBlockHeight), observedAt: this.#config.clock.now() };
  }
  async finalizedHeight(signal?: AbortSignal): Promise<number> { await this.genesis(signal); return integer(await this.call('getBlockHeight', [{ commitment: 'finalized' }], signal)); }
  async feeForMessage(message: Uint8Array, signal?: AbortSignal): Promise<Lamports | null> {
    await this.genesis(signal); const row = object(await this.call('getFeeForMessage', [Buffer.from(message).toString('base64'), { commitment: 'finalized' }], signal), ['context', 'value']);
    context(row.context); return row.value === null ? null : lamports(row.value);
  }
  async accounts(addresses: readonly Address[], signal?: AbortSignal): Promise<AccountSnapshot> {
    addresses.forEach(rpcAddress); await this.genesis(signal);
    const row = object(await this.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }], signal), ['context', 'value']);
    const context = object(row.context, ['slot'], ['apiVersion']); requireChain(Array.isArray(row.value) && row.value.length === addresses.length);
    return { slot: integer(context.slot), observedAt: this.#config.clock.now(), accounts: row.value.map((a, i) => decodeRpcAccount(a, addresses[i]!)) };
  }
  async signatureStatus(sig: Signature, signal?: AbortSignal): Promise<SignatureObservation> {
    signature(sig); await this.genesis(signal);
    const row = object(await this.call('getSignatureStatuses', [[sig], { searchTransactionHistory: true }], signal), ['context', 'value']);
    context(row.context); requireChain(Array.isArray(row.value) && row.value.length === 1);
    if (row.value[0] === null) return { signature: sig, status: 'absent', slot: null, err: null, observedAt: this.#config.clock.now() };
    const value = object(row.value[0], ['slot', 'confirmations', 'err', 'confirmationStatus'], ['status']);
    requireChain(['processed', 'confirmed', 'finalized'].includes(String(value.confirmationStatus)));
    return { signature: sig, status: value.confirmationStatus as 'processed' | 'confirmed' | 'finalized', slot: integer(value.slot), err: value.err as JsonValue, observedAt: this.#config.clock.now() };
  }
  async finalizedTransaction(sig: Signature, signal?: AbortSignal): Promise<FinalizedTransaction | null> {
    signature(sig); const genesis = await this.genesis(signal);
    const result = await this.call('getTransaction', [sig, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }], signal);
    if (result === null) return null;
    const row = object(result, ['slot', 'transaction', 'meta'], ['blockTime', 'version', 'transactionIndex']);
    requireChain(row.version === undefined || row.version === 'legacy'); if (row.meta === null) return null;
    const transaction = base64(row.transaction); const signed = decodeSignedPayment(transaction); requireChain(signed.signature === sig);
    const decoded = decodeLegacy(signed.message);
    const meta = object(row.meta, ['err', 'fee', 'preTokenBalances', 'postTokenBalances'], ['preBalances', 'postBalances', 'innerInstructions', 'logMessages', 'rewards', 'loadedAddresses', 'returnData', 'computeUnitsConsumed', 'costUnits', 'status']);
    requireChain(meta.innerInstructions === undefined || meta.innerInstructions === null || (Array.isArray(meta.innerInstructions) && meta.innerInstructions.length === 0));
    if (meta.loadedAddresses !== undefined) { const loaded = object(meta.loadedAddresses, ['writable', 'readonly']); requireChain(Array.isArray(loaded.writable) && loaded.writable.length === 0 && Array.isArray(loaded.readonly) && loaded.readonly.length === 0); }
    return { genesis, signature: sig, transaction, message: signed.message, slot: integer(row.slot), commitment: 'finalized', observedAt: this.#config.clock.now(), accountKeys: decoded.accountKeys, instructions: decoded.instructions,
      meta: { err: meta.err as JsonValue, fee: lamports(meta.fee), preTokenBalances: tokenBalances(meta.preTokenBalances), postTokenBalances: tokenBalances(meta.postTokenBalances) } };
  }
  async broadcastIdentical(signedTransaction: Uint8Array, signal?: AbortSignal): Promise<Signature> {
    const bytes = Uint8Array.from(signedTransaction); const decoded = decodeSignedPayment(bytes); await this.genesis(signal);
    const sig = signature(await this.call('sendTransaction', [Buffer.from(bytes).toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 }], signal));
    requireChain(sig === decoded.signature); return sig;
  }
}
export function createRpcClient(config: RpcConfig): JsonRpcClient { return new JsonRpcClient(config); }
