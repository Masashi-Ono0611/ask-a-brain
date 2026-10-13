/** Founder host-only TTY ceremony with EPHEMERAL keys; no wallets/network.
 * Runtime broker policy/OS isolation/devnet evidence remain separate Gate1 checks.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Arm, Id, Quote, SignRequest, Uuid } from '../../src/wire/contracts.ts';
import { bytesHash, M03, payloadHash, signEnvelope } from '../../src/wire/index.ts';
import { openStore, SystemClock } from '../../src/common/index.ts';
import { attachSignature, buildLegacyPayment, controllingTerminal, createHumanCliSigner, DEVNET_GENESIS, generateThrowawayKey, HumanSigningHelper, importCliKey, serveHumanSigner, StoreSignJournal, TOKEN_PROGRAM } from '../../src/chain/index.ts';
const clock = new SystemClock(); const root = mkdtempSync(join(tmpdir(), 'aab-human-smoke-')); const store = openStore(join(root, 'helper.db'));
const payer = generateThrowawayKey(); const seal = generateThrowawayKey(); const publicKey = () => generateThrowawayKey().publicKey;
const id = 'synthetic-host-smoke' as Id; const hash = bytesHash(Buffer.from('synthetic-host-smoke')); const now = clock.now();
const quotePayload: Quote = { v: 1, quote_id: id, nonce: Buffer.from(randomUUID()).subarray(0, 16).toString('base64url'), request_id: randomUUID() as Uuid,
  buyer_id: id, payer: payer.publicKey, seller_id: id, registry_version: id, question_sha256: hash, slice_id: id, manifest_sha256: hash, answer_sha256: hash,
  issued_at: now, expires_at: new Date(Date.parse(now) + M03.quoteTtl.value * 1000).toISOString() as typeof now, rail: 'solana-split-v1', network: 'devnet', genesis_hash: DEVNET_GENESIS,
  asset: 'TEST', mint: publicKey(), token_program: TOKEN_PROGRAM, decimals: M03.tokenDecimals.value, total_atomic: String(M03.totalAtomic.value) as never, seller_atomic: String(M03.sellerAtomic.value) as never, fee_atomic: String(M03.marketplaceAtomic.value) as never,
  seller_owner: publicKey(), marketplace_owner: publicKey(), seller_token_account: publicKey(), marketplace_token_account: publicKey(), memo: '', delivery: 'immutable-answer-after-finalized', refund_terms: 'aab-prototype-refund-v1' };
const payload = { ...quotePayload, memo: `aab:v1:${id}:${quotePayload.nonce}` };
const quote = signEnvelope('quote', payload, id, importCliKey(seal.keyBytes).key, { kind: 'quote', actor: 'test', approvalId: id, payloadHash: payloadHash(payload) });
const payment = buildLegacyPayment(quote, { payer: payer.publicKey, tokenAccount: publicKey() }, { blockhash: publicKey(), lastValidBlockHeight: 100, observedAt: now });
const armPayload: Arm = { v: 1, quote_id: id, buyer_id: id, quote_sha256: payloadHash(payload), message_sha256: payment.messageHash, recent_blockhash: payment.expected.blockhash.blockhash, last_valid_block_height: payment.expected.blockhash.lastValidBlockHeight, armed_at: now };
const arm = signEnvelope('arm', armPayload, id, importCliKey(seal.keyBytes).key, { kind: 'arm', actor: 'test', approvalId: id, payloadHash: payloadHash(armPayload) });
const request: SignRequest = { requestId: payload.request_id, quoteId: id, network: 'devnet', genesis: DEVNET_GENESIS, quote, arm, message: payment.message, messageHash: payment.messageHash, expectedPayer: payer.publicKey, manifestHash: hash, registryHash: hash, questionPolicyHash: hash, reservationId: id,
  estimatedFee: '0' as never, maximumFee: String(M03.feePerPurchaseMax.value) as never, blockhash: payment.expected.blockhash, offerApproval: { status: 'approved', reviewedHash: payloadHash(payload), actor: 'human', at: now, approvalRef: id } };
let server;
try {
  const helper = new HumanSigningHelper({ publicKey: payer.publicKey, keyBytes: () => payer.keyBytes, clock, journal: new StoreSignJournal(store), terminal: controllingTerminal(), authorize: async input => {
    if (input.messageHash !== request.messageHash || input.genesis !== DEVNET_GENESIS) throw new Error('SMOKE_SUBSTITUTION');
  } });
  const endpoint = join(root, 'helper.sock'); server = await serveHumanSigner(endpoint, helper);
  const client = createHumanCliSigner({ endpoint, expectedPublicKey: payer.publicKey }); const result = await client.sign(request);
  const signed = attachSignature(payment, result); const recovered = await client.recover(request.requestId, request.messageHash);
  if (JSON.stringify(recovered) !== JSON.stringify(result)) throw new Error('RECOVERY_MISMATCH');
  console.log(JSON.stringify({ evidence: 'HOST_TTY_EPHEMERAL_ONLY_NOT_DEVNET', messageHash: signed.messageHash, signature: signed.signature, journaledAndRecovered: true }));
} catch { console.error('HUMAN_SMOKE_FAILED_OR_DENIED'); process.exitCode = 1; }
finally { server?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
