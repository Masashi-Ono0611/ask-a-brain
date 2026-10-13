import { createConnection, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { chmodSync, lstatSync, openSync, constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { ReadStream, WriteStream } from 'node:tty';
import { createInterface } from 'node:readline/promises';
import type { Address, Clock, ExpectedPayment, HumanSignerIpcConfig, Sha256, Signer, SignRequest, SignResult, Uuid } from '../wire/contracts.ts';
import { canonicalBytes, strictJson, M03 } from '../wire/index.ts';
import { FoundationError } from '../common/index.ts';
import { attachSignature, requireChain, validateLegacyMessage } from './legacy.ts';
import { exactObject, validateSignRequest } from './signer.ts';
import type { SignJournal } from './signer.ts';
import { signBytes } from './keys.ts';
// Only failures proven to precede signing can cross IPC as a refusal.
class PreSigningRefusal extends FoundationError {}
/** Local IPC extension pending the shared error-code contract update. This is
 * emitted only before signBytes; arbitrary helper failures remain ambiguous. */
export class ExpiredBeforeApproval extends Error {
  readonly code = 'EXPIRED_BEFORE_APPROVAL';
  constructor() { super('EXPIRED_BEFORE_APPROVAL'); this.name = 'ExpiredBeforeApproval'; }
}
function replyResult(bytes: Uint8Array): unknown {
  requireChain(bytes.length <= M03.ingressBodyMax.value * 1024);
  const row = exactObject(strictJson(bytes), ['ok', 'result']);
  if (row.ok === false && row.result === 'EXPIRED_BEFORE_APPROVAL') throw new ExpiredBeforeApproval();
  requireChain(row.ok === true); return row.result;
}
export interface HumanTerminal { isTTY(): boolean; approve(display: string): Promise<string> }
export interface HumanHelperConfig {
  readonly publicKey: Address; readonly keyBytes: () => Uint8Array | Promise<Uint8Array>;
  readonly journal: SignJournal; readonly clock: Clock; readonly terminal: HumanTerminal;
  /** Protected, independent policy/envelope/arm/reservation/eligibility verification.
   * Must also check pinned RPC genesis, current height <= expiry and account readiness.
   * No default grants authority; called before display AND again after approval.
   */
  readonly authorize: (request: SignRequest, expected: ExpectedPayment) => Promise<void>;
  /** Trusted genesis-checked height port for a countdown and explicit expiry. */
  readonly finalizedHeight?: () => Promise<number>;
}
export function renderFrozenMessage(request: SignRequest): string {
  const expected = validateSignRequest(request); const q = request.quote.payload;
  // JSON escapes control characters; no seller-controlled terminal escapes.
  return JSON.stringify({ network: request.network, genesis: request.genesis, mint: q.mint, program: q.token_program, decimals: q.decimals,
    payer: q.payer, payerTokenAccount: expected.payer.tokenAccount, sellerOwner: q.seller_owner, sellerTokenAccount: q.seller_token_account,
    marketplaceOwner: q.marketplace_owner, marketplaceTokenAccount: q.marketplace_token_account, total: q.total_atomic, seller: q.seller_atomic, marketplace: q.fee_atomic,
    memo: q.memo, blockhash: request.blockhash, quoteHash: request.arm.payload.quote_sha256, manifestHash: request.manifestHash,
    registryHash: request.registryHash, questionPolicyHash: request.questionPolicyHash, estimatedFee: request.estimatedFee, maximumFee: request.maximumFee,
    reservationId: request.reservationId, messageHash: request.messageHash, messageBase64: Buffer.from(request.message).toString('base64') }, null, 2) + `\nType approve ${request.messageHash}\n`;
}
/** Helper side only. Key loader injection is the sole source of private bytes. Never broadcasts. */
export class HumanSigningHelper implements Signer {
  #config: HumanHelperConfig; #tail: Promise<unknown> = Promise.resolve();
  constructor(config: HumanHelperConfig) { this.#config = { ...config }; }
  async publicKey(): Promise<Address> { return this.#config.publicKey; }
  async recover(id: Uuid, hash: Sha256): Promise<SignResult | null> { return this.#config.journal.read(id, hash); }
  sign(input: SignRequest): Promise<SignResult> {
    const request = structuredClone(input);
    const run = this.#tail.then(async (): Promise<SignResult> => {
      const c = this.#config; const expected = validateSignRequest(request);
      requireChain(request.expectedPayer === c.publicKey);
      const previous = c.journal.read(request.requestId, request.messageHash); if (previous) return previous;
      if (!c.terminal.isTTY() || request.offerApproval.actor !== 'human') return { status: 'denied', reason: 'APPROVAL_REQUIRED' };
      let remaining: number | undefined;
      const validity = async (): Promise<void> => {
        if (!c.finalizedHeight) return; // Legacy adapters enforce height inside authorize.
        const height = await c.finalizedHeight();
        requireChain(Number.isSafeInteger(height) && height >= 0);
        remaining = request.blockhash.lastValidBlockHeight - height;
        if (remaining < 0) throw new ExpiredBeforeApproval();
      };
      const check = async (): Promise<void> => {
        try {
          if (Date.parse(c.clock.now()) >= Date.parse(request.quote.payload.expires_at)) throw new FoundationError('QUOTE_EXPIRED');
          await validity();
          try { await c.authorize(structuredClone(request), structuredClone(expected)); }
          catch (error) { await validity(); throw error; }
          await validity();
          if (Date.parse(c.clock.now()) >= Date.parse(request.quote.payload.expires_at)) throw new FoundationError('QUOTE_EXPIRED');
          validateLegacyMessage(request.message, expected);
        } catch (error) {
          if (error instanceof FoundationError) throw new PreSigningRefusal(error.code);
          throw error;
        }
      };
      await check();
      const display = renderFrozenMessage(request);
      const countdown = remaining === undefined ? '' : `Validity countdown: ${remaining} finalized blocks remaining; expires after height ${request.blockhash.lastValidBlockHeight}. Approve within about 30 s; block production varies.\n`;
      const approval = await c.terminal.approve(display.replace('Type approve', `${countdown}Type approve`));
      if (approval !== `approve ${request.messageHash}`) return { status: 'denied', reason: 'APPROVAL_REQUIRED' };
      await check();
      const bytes = Uint8Array.from(await c.keyBytes());
      try {
        await check(); // loader may have waited; never refresh blockhash under approval
        const result = { status: 'signed', messageHash: request.messageHash, publicKey: c.publicKey,
          signature: signBytes(request.message, bytes, c.publicKey), approvalRef: request.offerApproval.approvalRef } as const;
        c.journal.write(request, result); return result;
      } finally { bytes.fill(0); }
    });
    this.#tail = run.catch(() => undefined); return run;
  }
}
/** Controlling terminal, never inherited stdin or an environment approval flag. */
export function controllingTerminal(): HumanTerminal {
  return { isTTY: () => {
    try { const fd = openSync('/dev/tty', fsConstants.O_RDWR); const stream = new ReadStream(fd); const ok = stream.isTTY; stream.destroy(); return ok; } catch { return false; }
  }, async approve(display) {
    const fd = openSync('/dev/tty', fsConstants.O_RDWR); const input = new ReadStream(fd); const outputFd = openSync('/dev/tty', fsConstants.O_WRONLY); const output = new WriteStream(outputFd);
    const rl = createInterface({ input, output, terminal: true });
    try { requireChain(input.isTTY && output.isTTY); output.write(display); return await rl.question('> '); }
    finally { rl.close(); input.destroy(); output.destroy(); }
  } };
}
function socketPath(endpoint: string): string {
  requireChain(isAbsolute(endpoint) && !endpoint.includes('\0'));
  const parent = lstatSync(dirname(endpoint));
  requireChain(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0 && parent.uid === process.getuid?.());
  return endpoint;
}
function frame(socket: Socket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    socket.setTimeout(M03.paymentForegroundWait.value * 1000, () => socket.destroy(new Error('IPC_TIMEOUT')));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > M03.ingressBodyMax.value * 1024) { socket.destroy(new Error('IPC_LIMIT')); return; }
      if (buffer.at(-1) === 10) { socket.pause(); resolve(buffer.subarray(0, -1)); }
    });
    socket.once('error', reject); socket.once('end', () => reject(new Error('IPC_INCOMPLETE')));
  });
}
function wireRequest(request: SignRequest): unknown { return { ...request, message: Buffer.from(request.message).toString('base64') }; }
function unwireRequest(value: unknown): SignRequest {
  requireChain(value && typeof value === 'object');
  const record = value as Record<string, unknown>; requireChain(typeof record.message === 'string');
  const message = Buffer.from(record.message, 'base64'); requireChain(message.toString('base64') === record.message);
  const request = { ...record, message } as unknown as SignRequest; validateSignRequest(request); return request;
}
export async function handleHumanSignerMessage(bytes: Uint8Array, helper: Signer): Promise<Uint8Array> {
  try {
    requireChain(bytes.length <= M03.ingressBodyMax.value * 1024);
    const row = exactObject(strictJson(bytes), ['operation', 'value']);
    let result: unknown;
    if (row.operation === 'sign') result = await helper.sign(unwireRequest(row.value));
    else if (row.operation === 'recover') {
      const r = exactObject(row.value, ['requestId', 'messageHash']);
      requireChain(typeof r.requestId === 'string' && /^[0-9a-f-]{36}$/.test(r.requestId) && typeof r.messageHash === 'string' && /^[0-9a-f]{64}$/.test(r.messageHash));
      result = await helper.recover(r.requestId as Uuid, r.messageHash as Sha256);
    } else if (row.operation === 'publicKey') { requireChain(row.value === null); result = await helper.publicKey(); }
    else throw new Error('IPC_OPERATION');
    return canonicalBytes({ ok: true, result });
  } catch (error) {
    if (error instanceof ExpiredBeforeApproval) return canonicalBytes({ ok: false, result: error.code });
    if (error instanceof PreSigningRefusal) return canonicalBytes({ ok: true, result: { status: 'denied', reason: error.code } });
    return canonicalBytes({ ok: false, result: null });
  }
}
export async function serveHumanSigner(endpoint: string, helper: Signer): Promise<Server> {
  const path = socketPath(endpoint);
  const server = createServer(socket => {
    void (async () => {
      try { socket.end(Buffer.concat([await handleHumanSignerMessage(await frame(socket), helper), Buffer.from('\n')])); }
      catch { socket.destroy(); }
    })();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { chmodSync(path, 0o600); resolve(); }); });
  return server;
}
export type HumanSignerExchange = (request: Uint8Array) => Promise<Uint8Array>;
export class HumanCliSigner implements Signer {
  #config: HumanSignerIpcConfig; #exchange: HumanSignerExchange | undefined;
  constructor(config: HumanSignerIpcConfig, exchange?: HumanSignerExchange) { this.#config = { ...config }; this.#exchange = exchange; }
  async #call(operation: string, value: unknown): Promise<unknown> {
    if (this.#exchange) return replyResult(await this.#exchange(canonicalBytes({ operation, value })));
    const path = socketPath(this.#config.endpoint); const stat = lstatSync(path);
    requireChain(stat.isSocket() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.());
    const socket = createConnection(path);
    try {
      const response = frame(socket); socket.write(Buffer.concat([canonicalBytes({ operation, value }), Buffer.from('\n')]));
      return replyResult(await response);
    } finally { socket.destroy(); }
  }
  async publicKey(): Promise<Address> { const key = await this.#call('publicKey', null); requireChain(key === this.#config.expectedPublicKey); return key as Address; }
  async sign(input: SignRequest): Promise<SignResult> {
    const request = structuredClone(input); const expected = validateSignRequest(request); requireChain(expected.payer.payer === this.#config.expectedPublicKey);
    const result = await this.#call('sign', wireRequest(request)) as SignResult;
    if (result?.status === 'signed') { exactObject(result, ['status', 'messageHash', 'publicKey', 'signature', 'approvalRef']); attachSignature({ message: request.message, messageHash: request.messageHash, expected, decoded: validateLegacyMessage(request.message, expected) }, result); }
    else { exactObject(result, ['status', 'reason']); requireChain(result.status === 'denied' && ['APPROVAL_REQUIRED', 'QUOTE_EXPIRED', 'POLICY_DENIED', 'CONTENT_REVOKED', 'NOT_READY', 'PAYMENT_INVALID', 'NETWORK_MISMATCH', 'VERIFICATION_FAILED'].includes(result.reason)); }
    return result;
  }
  async recover(requestId: Uuid, messageHash: Sha256): Promise<SignResult | null> {
    const result = await this.#call('recover', { requestId, messageHash }) as SignResult | null;
    if (result !== null) { exactObject(result, ['status', 'messageHash', 'publicKey', 'signature', 'approvalRef']); requireChain(result.status === 'signed' && result.messageHash === messageHash && result.publicKey === this.#config.expectedPublicKey); }
    // Broker must attachSignature with its persisted message before any broadcast.
    return result;
  }
}
export function createHumanCliSigner(config: HumanSignerIpcConfig): Signer { return new HumanCliSigner(config); }
