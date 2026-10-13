/** Offline setup emulator; labelled synthetic and never a devnet acceptance claim. */
import type { Address } from '../../src/wire/contracts.ts';
import { decodeBase58, encodeBase58, M03 } from '../../src/wire/index.ts';
import { DEVNET_GENESIS, SYSTEM_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, decodeLegacy, RpcRateLimitError } from '../../src/chain/index.ts';
import type { SetupRpc } from '../../src/chain/index.ts';
import { requireChain, verifyMessageSignature } from '../../src/chain/legacy.ts';
export class FakeSetupRpc implements SetupRpc {
  readonly accounts = new Map<string, { owner: Address; data: Buffer; executable: boolean; lamports: number }>();
  readonly transactions = new Map<string, unknown>(); calls: string[] = []; balance = 0; height = 1; genesisHash = DEVNET_GENESIS;
  airdrops = 0; sends = 0; rateLimits = 0; lostResponse = false; hideTransaction = false; airdropTimeout = false;
  async genesis(): Promise<Address> { this.calls.push('genesis'); return this.genesisHash; }
  async call(method: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push(method);
    switch (method) {
      case 'getAccountInfo': { const a = this.accounts.get(String(params[0])); return { context: { slot: this.height }, value: a ? { ...a, data: [a.data.toString('base64'), 'base64'] } : null }; }
      case 'getMinimumBalanceForRentExemption': return Number(params[0]) * 10;
      case 'getBalance': return { context: { slot: this.height }, value: this.balance };
      case 'requestAirdrop': this.airdrops++; if (this.rateLimits-- > 0) throw new RpcRateLimitError(0); if (this.airdropTimeout) throw new Error('TIMEOUT'); this.balance += Number(params[1]); return encodeBase58(new Uint8Array(64));
      case 'getLatestBlockhash': return { context: { slot: this.height }, value: { blockhash: SYSTEM_PROGRAM, lastValidBlockHeight: this.height + 100 } };
      case 'getBlockHeight': return this.height;
      case 'getTransaction': return this.hideTransaction ? null : this.transactions.get(String(params[0])) ?? null;
      case 'sendTransaction': {
        this.sends++; const bytes = Buffer.from(String(params[0]), 'base64'); const count = bytes[0]!; const message = bytes.subarray(1 + count * 64); const decoded = decodeLegacy(message); requireChain(decoded.signers === count);
        for (let i = 0; i < count; i++) verifyMessageSignature(message, decoded.accountKeys[i]!, encodeBase58(bytes.subarray(1 + i * 64, 1 + (i + 1) * 64)));
        const signature = encodeBase58(bytes.subarray(1, 65)); if (this.transactions.has(signature)) return signature;
        for (const instruction of decoded.instructions) {
          const program = decoded.accountKeys[instruction.programIdIndex]; const accounts = instruction.accountIndices.map(i => decoded.accountKeys[i]!); const data = Buffer.from(instruction.data);
          if (program === SYSTEM_PROGRAM) { requireChain(data.length === 52 && data.readUInt32LE(0) === 0); this.accounts.set(accounts[1]!, { owner: TOKEN_PROGRAM, data: Buffer.alloc(82), executable: false, lamports: Number(data.readBigUInt64LE(4)) }); }
          else if (program === TOKEN_PROGRAM && data[0] === 20) {
            requireChain(data.length === 67 && data[1] === M03.tokenDecimals.value && data[34] === 1); const mint = this.accounts.get(accounts[0]!)!; mint.data.writeUInt32LE(1, 0); mint.data.set(data.subarray(2, 34), 4); mint.data[44] = data[1]!; mint.data[45] = 1; mint.data.writeUInt32LE(1, 46); mint.data.set(data.subarray(35, 67), 50);
          } else if (program === ATA_PROGRAM) {
            requireChain(data[0] === 1 && accounts.length === 6); if (!this.accounts.has(accounts[1]!)) { const token = Buffer.alloc(165); token.set(decodeBase58(accounts[3]!, 32)); token.set(decodeBase58(accounts[2]!, 32), 32); token[108] = 1; this.accounts.set(accounts[1]!, { owner: TOKEN_PROGRAM, data: token, executable: false, lamports: 1650 }); }
          } else if (program === TOKEN_PROGRAM && data[0] === 14) {
            requireChain(data.length === 10 && data[9] === M03.tokenDecimals.value); const mint = this.accounts.get(accounts[0]!)!; const target = this.accounts.get(accounts[1]!)!; const amount = data.readBigUInt64LE(1); mint.data.writeBigUInt64LE(mint.data.readBigUInt64LE(36) + amount, 36); target.data.writeBigUInt64LE(target.data.readBigUInt64LE(64) + amount, 64);
          } else throw new Error('UNKNOWN_SETUP_INSTRUCTION');
        }
        this.transactions.set(signature, { slot: this.height, version: 'legacy', transaction: [params[0], 'base64'], meta: { err: null, fee: 5000 } });
        if (this.lostResponse) { this.lostResponse = false; throw new Error('LOST_SEND_RESPONSE'); }
        return signature;
      }
      default: throw new Error('UNSUPPORTED_FAKE_METHOD');
    }
  }
}
