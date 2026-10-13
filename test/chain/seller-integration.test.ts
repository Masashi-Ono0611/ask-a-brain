import test from 'node:test';
import assert from 'node:assert/strict';
import type { Id, RpcClient, SignRequest } from '../../src/wire/contracts.ts';
import { payloadHash } from '../../src/wire/index.ts';
import { buildLegacyPayment, attachSignature, validateLegacyMessage, reconcilePayment, FakeRpcClient, DEVNET_GENESIS, TOKEN_PROGRAM, TestSigner } from '../../src/chain/index.ts';
import { createSellerService } from '../../src/seller/index.ts';
import { fixture as sellerFixture, settle } from '../seller/support.ts';
import { fixture } from './support.ts';

test('T4 seller ports consume real T2 legacy validation/reconciliation: invalid arm withheld, pending then finalized reveal and replay once', async t => {
  const seller = sellerFixture(t); const chain = fixture(); const buyer = { ...seller.buyer, payer: chain.key.publicKey };
  let primary: FakeRpcClient | undefined; let secondary: FakeRpcClient | undefined;
  const proxy = (origin: string, pick: () => FakeRpcClient | undefined): RpcClient => Object.assign({ origin }, {
    genesis: async () => DEVNET_GENESIS, latestBlockhash: async () => chain.payment.expected.blockhash, finalizedHeight: async () => 1,
    feeForMessage: async () => chain.request.estimatedFee, accounts: async addresses => pick()!.accounts(addresses),
    signatureStatus: async signature => pick()!.signatureStatus(signature), finalizedTransaction: async signature => pick()!.finalizedTransaction(signature), broadcastIdentical: async bytes => pick()!.broadcastIdentical(bytes),
  } satisfies RpcClient);
  const config = { ...seller.config, rpcOrigins: ['https://primary.example', 'https://secondary.example'] as const, listing: { ...seller.config.listing, payment: { ...seller.config.listing.payment, genesis_hash: DEVNET_GENESIS, token_program: TOKEN_PROGRAM, mint: chain.quote.payload.mint,
    seller_owner: chain.quote.payload.seller_owner, seller_token_account: chain.quote.payload.seller_token_account, marketplace_owner: chain.quote.payload.marketplace_owner, marketplace_token_account: chain.quote.payload.marketplace_token_account } },
    invitations: [{ ...seller.config.invitations[0]!, buyer }], payerAccounts: () => chain.payment.expected.payer, validateMessage: validateLegacyMessage, reconcile: reconcilePayment };
  const service = createSellerService({ ...seller.deps, config, primaryRpc: proxy('https://primary.example', () => primary), secondaryRpc: proxy('https://secondary.example', () => secondary) }); await service.start();
  const request = seller.request(0, buyer); const disposition = await settle(seller, service.quote(buyer, request)); assert.equal(disposition.status, 'ready'); if (disposition.status !== 'ready') return;
  const payment = buildLegacyPayment(disposition.quote, chain.payment.expected.payer, chain.payment.expected.blockhash);
  const armInput = { quote_id: disposition.quote.payload.quote_id, message_base64: Buffer.from(payment.message).toString('base64'), message_sha256: payment.messageHash, recent_blockhash: payment.expected.blockhash.blockhash, last_valid_block_height: payment.expected.blockhash.lastValidBlockHeight };
  await assert.rejects(service.arm(buyer, { ...armInput, message_base64: Buffer.from('invalid').toString('base64') }));
  const arm = await service.arm(buyer, armInput);
  const signRequest: SignRequest = { ...chain.request, requestId: request.request_id, quoteId: disposition.quote.payload.quote_id, quote: disposition.quote, arm, message: payment.message, messageHash: payment.messageHash, manifestHash: disposition.quote.payload.manifest_sha256,
    offerApproval: { ...chain.request.offerApproval, at: arm.payload.armed_at, reviewedHash: payloadHash(disposition.quote.payload) } };
  const signer = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: chain.key.publicKey, keyBytes: () => chain.key.keyBytes });
  const signed = attachSignature(payment, await signer.sign(signRequest));
  primary = new FakeRpcClient({ origin: 'https://primary.example', expected: payment.expected, clock: seller.clock, fee: chain.request.estimatedFee });
  secondary = new FakeRpcClient({ origin: 'https://secondary.example', expected: payment.expected, clock: seller.clock, fee: chain.request.estimatedFee, state: primary.state });
  const proof = { v: 1 as const, consult_id: 'chain-consult' as Id, quote_id: disposition.quote.payload.quote_id, quote_sha256: payloadHash(disposition.quote.payload), arm_ticket_sha256: payloadHash(arm.payload), network: 'devnet' as const, genesis_hash: DEVNET_GENESIS, transaction_signature: signed.signature, message_sha256: payment.messageHash };
  assert.equal((await service.payment(buyer, proof)).payment_state, 'payment_pending'); assert.equal((await service.answer(buyer, proof.quote_id)).status, 'pending');
  await primary.broadcastIdentical(signed.transaction); primary.state.status = 'confirmed'; assert.equal((await service.payment(buyer, proof)).payment_state, 'payment_pending');
  primary.state.status = 'finalized'; assert.equal((await service.payment(buyer, proof)).payment_state, 'payment_finalized');
  const answer = await service.answer(buyer, proof.quote_id); assert.equal(answer.status, 'ready');
  assert.equal((await service.payment(buyer, proof)).payment_state, 'payment_finalized'); assert.deepEqual(await service.answer(buyer, proof.quote_id), answer);
  assert.equal(seller.store.scan('settlements', { limit: 100 }).length, 1);
});
