import type { Address, Sha256, Signer, SignRequest, SignResult, TestSignerConfig, Uuid } from '../wire/contracts.ts';
/** Foundation stub only. Accepts a caller-owned key source but NEVER invokes it.
 * T2 owns real signing and recovery; no key generation, files or SDK here.
 */
export class TestSigner implements Signer {
  readonly #config: TestSignerConfig;
  constructor(config: TestSignerConfig) {
    if (config.network !== 'devnet' && config.network !== 'local-simulation') throw new TypeError('NETWORK_MISMATCH');
    if (typeof config.keyBytes !== 'function' || !config.publicKey ||
        (config.network === 'devnet' ? !config.genesis : !config.namespace)) throw new TypeError('INVALID_INPUT');
    this.#config = Object.freeze({ ...config });
  }
  async publicKey(): Promise<Address> { return this.#config.publicKey; }
  async sign(request: SignRequest): Promise<SignResult> {
    if (request.network !== 'devnet' || (this.#config.network === 'devnet' && request.genesis !== this.#config.genesis)) return { status: 'denied', reason: 'NETWORK_MISMATCH' };
    return { status: 'denied', reason: 'NOT_READY' };
  }
  async recover(_requestId: Uuid, _messageHash: Sha256): Promise<SignResult | null> { return null; }
}
export function createTestSigner(config: TestSignerConfig): Signer { return new TestSigner(config); }
