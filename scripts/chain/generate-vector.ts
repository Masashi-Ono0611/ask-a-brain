/** Public chain vector, ephemeral keys never written. Explicit regeneration changes hashes. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Id, SellerPublicKey } from '../../src/wire/contracts.ts';
import { bytesHash, canonicalBytes, parseWire, payloadHash, signEnvelope } from '../../src/wire/index.ts';
import { buildLegacyPayment, attachSignature, generateThrowawayKey, importCliKey, TestSigner, DEVNET_GENESIS, TOKEN_PROGRAM } from '../../src/chain/index.ts';
const golden = parseWire('quote', readFileSync(new URL('../../fixtures/wire/quote.json', import.meta.url)));
const payer = generateThrowawayKey(); const seal = generateThrowawayKey(); const id = 'chain-vector-seal' as Id;
const payload = { ...golden.payload, payer: payer.publicKey, genesis_hash: DEVNET_GENESIS, token_program: TOKEN_PROGRAM };
const quote = signEnvelope('quote', payload, id, importCliKey(seal.keyBytes).key, { kind: 'quote', actor: 'test', approvalId: id, payloadHash: payloadHash(payload) });
const window = { blockhash: golden.payload.mint, lastValidBlockHeight: 100, observedAt: payload.issued_at };
const payment = buildLegacyPayment(quote, { payer: payer.publicKey, tokenAccount: generateThrowawayKey().publicKey }, window);
const armPayload = { v: 1 as const, quote_id: payload.quote_id, buyer_id: payload.buyer_id, quote_sha256: payloadHash(payload), message_sha256: payment.messageHash, recent_blockhash: window.blockhash, last_valid_block_height: window.lastValidBlockHeight, armed_at: payload.issued_at };
const arm = signEnvelope('arm', armPayload, id, importCliKey(seal.keyBytes).key, { kind: 'arm', actor: 'test', approvalId: id, payloadHash: payloadHash(armPayload) });
const signer = new TestSigner({ network: 'devnet', genesis: DEVNET_GENESIS, publicKey: payer.publicKey, keyBytes: () => payer.keyBytes });
const result = await signer.sign({ requestId: payload.request_id, quoteId: payload.quote_id, network: 'devnet', genesis: DEVNET_GENESIS, message: payment.message, messageHash: payment.messageHash, expectedPayer: payer.publicKey, quote, arm,
  manifestHash: payload.manifest_sha256, registryHash: bytesHash(Buffer.from('synthetic-registry')), questionPolicyHash: bytesHash(Buffer.from('synthetic-policy')), reservationId: 'synthetic-reservation' as Id, estimatedFee: '0' as never, maximumFee: '0' as never, blockhash: window,
  offerApproval: { status: 'approved', reviewedHash: payloadHash(payload), actor: 'test', at: payload.issued_at, approvalRef: 'synthetic-approval' as Id } });
const signed = attachSignature(payment, result);
const publicKey: SellerPublicKey = { id, algorithm: 'Ed25519', public_key: seal.publicKey };
const vector = canonicalBytes({ v: 1, evidence: 'SYNTHETIC_PUBLIC_VECTOR_NOT_CHAIN_OBSERVATION', source: 'fixtures/wire/quote.json (metadata only; genesis/program/payer changed and resealed)', sellerKey: publicKey, quote, arm, expected: payment.expected,
  messageBase64: Buffer.from(payment.message).toString('base64'), messageHash: payment.messageHash, transactionBase64: Buffer.from(signed.transaction).toString('base64'), signature: signed.signature });
writeFileSync(new URL('../../fixtures/chain/payment.json', import.meta.url), vector);
writeFileSync(new URL('../../fixtures/chain/SHA256SUMS.json', import.meta.url), canonicalBytes({ 'payment.json': bytesHash(vector) }));
console.log(JSON.stringify({ vectorSha256: bytesHash(vector), messageSha256: payment.messageHash }));
