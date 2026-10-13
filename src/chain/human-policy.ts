import type { Address, Id, Clock, ExpectedPayment, PayerAccounts, RpcClient, SellerPublicKey, Sha256, SignRequest, Store } from '../wire/contracts.ts';
import { canonicalBytes, payloadHash, verifyEnvelope, M03 } from '../wire/index.ts';
import { decodeAmount, FoundationError } from '../common/index.ts';
import { DEVNET_GENESIS, MAINNET_GENESIS, requireChain, sameBytes } from './legacy.ts';
import { validatePaymentAccounts } from './verification.ts';
export interface HumanPolicyConfig {
  readonly genesis: Address; readonly payer: PayerAccounts; readonly sellerKey: SellerPublicKey;
  readonly reservationId: Id; readonly quoteHash: Sha256; readonly registryHash: Sha256; readonly manifestHash: Sha256; readonly questionPolicyHash: Sha256;
  readonly allowMainnet: boolean; readonly rpc: RpcClient; readonly store: Store; readonly clock: Clock;
  /** Protected controller eligibility check, never caller-supplied boolean. */
  readonly eligible: (request: SignRequest) => Promise<boolean>;
}
/** Protected helper policy for one reviewed offer. Recreate only after new human offer approval.
 * The helper process must have protected read access to the broker's durable arm/reservation
 * snapshot via a Store implementation (not a second SQLite owner for a live broker DB).
 */
export function createHumanAuthorizer(config: HumanPolicyConfig): (request: SignRequest, expected: ExpectedPayment) => Promise<void> {
  const { rpc, store, clock, eligible } = config;
  const pin = structuredClone({ genesis: config.genesis, payer: config.payer, sellerKey: config.sellerKey, reservationId: config.reservationId, quoteHash: config.quoteHash,
    registryHash: config.registryHash, manifestHash: config.manifestHash, questionPolicyHash: config.questionPolicyHash, allowMainnet: config.allowMainnet });
  return async (request, expected) => {
    if ((request.network === 'mainnet-beta' && (!pin.allowMainnet || pin.genesis !== MAINNET_GENESIS)) || (request.network === 'devnet' && pin.genesis !== DEVNET_GENESIS) || request.genesis !== pin.genesis) throw new FoundationError('NETWORK_MISMATCH');
    requireChain(request.reservationId === pin.reservationId);
    requireChain(payloadHash(request.quote.payload) === pin.quoteHash && request.registryHash === pin.registryHash && request.manifestHash === pin.manifestHash && request.questionPolicyHash === pin.questionPolicyHash);
    requireChain(expected.payer.payer === pin.payer.payer && expected.payer.tokenAccount === pin.payer.tokenAccount);
    verifyEnvelope('quote', request.quote, pin.sellerKey); verifyEnvelope('arm', request.arm, pin.sellerKey);
    const now = Date.parse(clock.now());
    requireChain(Number.isFinite(now) && now < Date.parse(request.quote.payload.expires_at) && Date.parse(request.arm.payload.armed_at) <= now + M03.clockSkewMax.value * 1000);
    const reservation = store.read('reservations', request.reservationId)?.value;
    const arm = store.read('arms', request.quoteId)?.value;
    requireChain(reservation?.status === 'held' && reservation.payer === pin.payer.payer && decodeAmount(reservation.principal) === M03.totalAtomic.value && decodeAmount(reservation.maximum_fee) >= decodeAmount(request.maximumFee));
    requireChain(arm && arm.message_sha256 === request.messageHash && sameBytes(canonicalBytes(arm.arm), canonicalBytes(request.arm)));
    requireChain(await rpc.genesis() === pin.genesis && await rpc.finalizedHeight() <= request.blockhash.lastValidBlockHeight);
    const estimated = await rpc.feeForMessage(request.message);
    requireChain(estimated !== null && decodeAmount(estimated) <= decodeAmount(request.maximumFee));
    await validatePaymentAccounts(expected, rpc);
    if (!await eligible(structuredClone(request))) throw new FoundationError('CONTENT_REVOKED');
  };
}
