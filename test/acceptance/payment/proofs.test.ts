import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, settle } from '../../integration/harness.ts';
import { id } from '../../../scripts/integration/synthetic.ts';
import { bytesHash, payloadHash } from '../../../src/wire/index.ts';
import { MAINNET_GENESIS, generateThrowawayKey, verifyFinalizedPayment } from '../../../src/chain/index.ts';

test('malicious proof bindings reject; exact same proof is idempotent and a different consult replay rejects', async t => {
  const h = await harness(); t.after(() => h.cleanup()); await settle(h,h.broker.market.consult(h.buyer,h.request()));
  const proof = h.proof(), seller = h.sellerRows[1]!.controller;
  for (const mutation of [{ quote_id: id('other') }, { quote_sha256: bytesHash(Buffer.from('wrong')) }, { arm_ticket_sha256: bytesHash(Buffer.from('wrong')) }, { message_sha256: bytesHash(Buffer.from('wrong')) }, { network: 'mainnet-beta' as const }, { genesis_hash: MAINNET_GENESIS }]) {
    await assert.rejects(seller.payment(h.buyer, { ...proof, ...mutation }));
    assert.equal((await seller.payment(h.buyer,proof)).payment_state, 'payment_finalized');
  }
  await assert.rejects(seller.payment({ ...h.buyer, buyer_id: id('attacker') },proof));
  await assert.rejects(seller.payment(h.buyer,{ ...proof, consult_id: id('other-consult') }));
  assert.equal((await seller.answer(h.buyer,proof.quote_id)).status,'ready'); assert.equal(h.sellerRows[1]!.store.scan('settlements',{limit:100}).length,1);
});

test('wrong network, payee, mint, amount, memo and evidence deltas fail real chain verifier with clean pair', async t => {
  const h = await harness(); t.after(() => h.cleanup()); await settle(h,h.broker.market.consult(h.buyer,h.request()));
  const transaction = [...h.primary.state.transactions.values()][0]!, expected = h.primary.expected;
  const other = generateThrowawayKey().publicKey;
  for (const mutation of [{ genesis_hash: MAINNET_GENESIS }, { payer: other }, { seller_owner: other }, { seller_token_account: other }, { mint: other }, { total_atomic: '1' }, { memo: 'aab:v1:wrong:wrong' }]) {
    const q = { ...expected.quote.payload, ...mutation };
    assert.throws(() => verifyFinalizedPayment(transaction, { ...expected, quote: { ...expected.quote, payload: q } } as typeof expected));
    assert.equal(verifyFinalizedPayment(transaction,expected).quote_id,expected.quote.payload.quote_id);
  }
  const bad = { ...transaction, meta: { ...transaction.meta, postTokenBalances: transaction.meta.postTokenBalances.map((b,i) => i === 0 ? { ...b, amount: '0' as never } : b) } };
  assert.throws(() => verifyFinalizedPayment(bad,expected)); assert.equal(verifyFinalizedPayment(transaction,expected).transaction_sha256,bytesHash(transaction.transaction));
  assert.ok(payloadHash(expected.quote.payload));
});
