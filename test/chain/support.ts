import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Address, Id, IsoTime, Quote, Signed, SignRequest, Uuid } from '../../src/wire/contracts.ts';
import { bytesHash, payloadHash, parseWire } from '../../src/wire/index.ts';
import { FixedClock } from '../../src/common/index.ts';
import { buildLegacyPayment, generateThrowawayKey, DEVNET_GENESIS, TOKEN_PROGRAM, TestSigner, FakeRpcClient } from '../../src/chain/index.ts';
export function fixture() {
  const key = generateThrowawayKey(); const pub = (): Address => generateThrowawayKey().publicKey;
  const clock = new FixedClock('2026-10-09T00:00:00.000Z');
  const golden = parseWire('quote', readFileSync(new URL('../../fixtures/wire/quote.json', import.meta.url)));
  const quote: Signed<Quote> = { ...golden, payload: { ...golden.payload, request_id: randomUUID() as Uuid, payer: key.publicKey, seller_owner: pub(), marketplace_owner: pub(), seller_token_account: pub(), marketplace_token_account: pub(), mint: pub(), genesis_hash: DEVNET_GENESIS, token_program: TOKEN_PROGRAM, issued_at: clock.now(), expires_at: '2026-10-09T00:05:00.000Z' as IsoTime } };
  const payment = buildLegacyPayment(quote, { payer: key.publicKey, tokenAccount: pub() }, { blockhash: pub(), lastValidBlockHeight: 100, observedAt: clock.now() });
  const request: SignRequest = { requestId: quote.payload.request_id, quoteId: quote.payload.quote_id, network: 'devnet', genesis: DEVNET_GENESIS, message: payment.message, messageHash: payment.messageHash, expectedPayer: key.publicKey, quote,
    arm: { signature: quote.signature, payload: { v: 1, quote_id: quote.payload.quote_id, buyer_id: quote.payload.buyer_id, quote_sha256: payloadHash(quote.payload), message_sha256: payment.messageHash, recent_blockhash: payment.expected.blockhash.blockhash, last_valid_block_height: payment.expected.blockhash.lastValidBlockHeight, armed_at: clock.now() } },
    manifestHash: quote.payload.manifest_sha256, registryHash: bytesHash(Buffer.from('registry')), questionPolicyHash: bytesHash(Buffer.from('policy')), reservationId: 'reservation-1' as Id, estimatedFee: '5000' as never, maximumFee: '100000' as never, blockhash: payment.expected.blockhash,
    offerApproval: { status: 'approved', reviewedHash: payloadHash(quote.payload), actor: 'human', at: clock.now(), approvalRef: 'approval-1' as Id } };
  const signer = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: key.publicKey, keyBytes: () => key.keyBytes });
  const primary = new FakeRpcClient({ origin: 'https://primary.example', expected: payment.expected, clock, fee: '5000' as never });
  const secondary = new FakeRpcClient({ origin: 'https://secondary.example', expected: payment.expected, clock, fee: '5000' as never, state: primary.state });
  return { key, clock, quote, payment, request, signer, primary, secondary };
}
