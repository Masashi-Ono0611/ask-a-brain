import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Arm, ExpectedPayment, SellerPublicKey, Signature, Signed } from '../../src/wire/contracts.ts';
import { bytesHash, strictJson, verifyEnvelope } from '../../src/wire/index.ts';
import { buildLegacyPayment, decodeSignedPayment, validateLegacyMessage } from '../../src/chain/index.ts';
test('public chain vector verifies T1 quote/arm signatures and independent legacy bytes; mutation fails and original restores', () => {
  const bytes = readFileSync(new URL('../../fixtures/chain/payment.json', import.meta.url));
  const hashes = strictJson(readFileSync(new URL('../../fixtures/chain/SHA256SUMS.json', import.meta.url))) as Record<string, string>;
  assert.equal(bytesHash(bytes), hashes['payment.json']);
  const v = strictJson(bytes) as unknown as { sellerKey: SellerPublicKey; expected: ExpectedPayment; arm: Signed<Arm>; messageBase64: string; transactionBase64: string; signature: Signature };
  verifyEnvelope('quote', v.expected.quote, v.sellerKey); verifyEnvelope('arm', v.arm, v.sellerKey);
  const payment = buildLegacyPayment(v.expected.quote, v.expected.payer, v.expected.blockhash); assert.equal(Buffer.from(payment.message).toString('base64'), v.messageBase64);
  const signed = decodeSignedPayment(Buffer.from(v.transactionBase64, 'base64')); assert.equal(signed.signature, v.signature); validateLegacyMessage(signed.message, v.expected);
  const bad = Uint8Array.from(signed.message); bad[20] = bad[20]! ^ 1; assert.throws(() => validateLegacyMessage(bad, v.expected)); validateLegacyMessage(signed.message, v.expected);
});
