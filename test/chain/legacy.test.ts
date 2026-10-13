import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, address, blockhash } from '@solana/kit';
import type { ExpectedPayment, SignResult } from '../../src/wire/contracts.ts';
import { bytesHash, M03 } from '../../src/wire/index.ts';
import { attachSignature, buildLegacyPayment, decodeLegacy, validateLegacyMessage, MAINNET_GENESIS } from '../../src/chain/index.ts';
import { fixture } from './support.ts';

test('legacy round-trip: exactly seller, fee, memo; independent Kit and account-role decode before/after signing', async () => {
  const f = fixture(); const d = decodeLegacy(f.payment.message);
  assert.equal(d.signers, 1); assert.equal(d.accountKeys.length, 7); assert.equal(d.instructions.length, 3);
  assert.equal(Buffer.from(d.instructions[0]!.data).readBigUInt64LE(1), M03.sellerAtomic.value);
  assert.equal(Buffer.from(d.instructions[1]!.data).readBigUInt64LE(1), M03.marketplaceAtomic.value);
  assert.equal(Buffer.from(d.instructions[2]!.data).toString(), f.quote.payload.memo);
  const signed = attachSignature(f.payment, await f.signer.sign(f.request));
  assert.deepEqual(signed.transaction.slice(65), f.payment.message);
  assert.deepEqual(validateLegacyMessage(signed.transaction.slice(65), f.payment.expected), f.payment.decoded);
  assert.equal(getCompiledTransactionMessageDecoder().decode(signed.transaction.slice(65)).version, 'legacy');
});
const mutations = ['extra-instruction', 'extra-account', 'extra-memo-account', 'reordered', 'wrong-mint', 'wrong-recipient', 'wrong-amount', 'wrong-decimals', 'wrong-program', 'wrong-opcode', 'wrong-blockhash', 'wrong-signer-role', 'wrong-write-role', 'invalid-utf8-memo', 'wrong-memo', 'trailing-byte', 'versioned'] as const;
for (const mutation of mutations) test(`message guard ${mutation}: reject even with matching mutated hash, then clean succeeds`, () => {
  const f = fixture(); const original = getCompiledTransactionMessageDecoder().decode(f.payment.message); assert.equal(original.version, 'legacy');
  if (original.version !== 'legacy') throw new Error('fixture');
  const d = structuredClone(original); const first = d.instructions[0]!; let bytes: Uint8Array;
  switch (mutation) {
    case 'extra-instruction': d.instructions.push(d.instructions[2]!); break;
    case 'extra-account': d.staticAccounts.push(address(f.quote.payload.seller_owner)); break;
    case 'extra-memo-account': d.instructions[2] = { ...d.instructions[2]!, accountIndices: [0] }; break;
    case 'reordered': [d.instructions[0], d.instructions[1]] = [d.instructions[1]!, first]; break;
    case 'wrong-mint': d.staticAccounts[d.staticAccounts.indexOf(address(f.quote.payload.mint))] = address(f.quote.payload.seller_owner); break;
    case 'wrong-recipient': d.instructions[0] = { ...first, accountIndices: [first.accountIndices![0]!, first.accountIndices![1]!, d.instructions[1]!.accountIndices![2]!, 0] }; break;
    case 'wrong-amount': case 'wrong-decimals': case 'wrong-opcode': {
      const data = Uint8Array.from(first.data!); const at = mutation === 'wrong-amount' ? 1 : mutation === 'wrong-decimals' ? 9 : 0; data[at] = data[at]! ^ 1;
      d.instructions[0] = { ...first, data }; break;
    }
    case 'wrong-program': d.instructions[0] = { ...first, programAddressIndex: d.instructions[2]!.programAddressIndex }; break;
    case 'wrong-blockhash': Object.assign(d, { lifetimeToken: blockhash(f.quote.payload.mint) }); break;
    case 'wrong-signer-role': Object.assign(d, { header: { ...d.header, numReadonlySignerAccounts: 1 } }); break;
    case 'wrong-write-role': Object.assign(d, { header: { ...d.header, numReadonlyNonSignerAccounts: 4 } }); break;
    case 'invalid-utf8-memo': d.instructions[2] = { ...d.instructions[2]!, data: Uint8Array.of(0xff) }; break;
    case 'wrong-memo': d.instructions[2] = { ...d.instructions[2]!, data: Buffer.from('aab:v1:other:nonce') }; break;
  }
  bytes = Uint8Array.from(getCompiledTransactionMessageEncoder().encode(d));
  if (mutation === 'trailing-byte') bytes = Uint8Array.from([...bytes, 0]);
  if (mutation === 'versioned') bytes = Uint8Array.from([0x80, ...bytes, 0]);
  assert.throws(() => validateLegacyMessage(bytes, { ...f.payment.expected, messageHash: bytesHash(bytes) }));
  assert.deepEqual(validateLegacyMessage(f.payment.message, f.payment.expected), f.payment.decoded);
});
test('expected payer/quote/genesis/aliases and hash cannot be rewritten; clean restored', () => {
  const f = fixture();
  for (const patch of [{ genesis_hash: MAINNET_GENESIS }, { payer: f.quote.payload.seller_owner }, { token_program: f.quote.payload.mint }, { seller_owner: f.quote.payload.marketplace_owner }]) {
    assert.throws(() => buildLegacyPayment({ ...f.quote, payload: { ...f.quote.payload, ...patch } }, f.payment.expected.payer, f.payment.expected.blockhash));
    assert.deepEqual(buildLegacyPayment(f.quote, f.payment.expected.payer, f.payment.expected.blockhash).message, f.payment.message);
  }
  assert.throws(() => validateLegacyMessage(f.payment.message, { ...f.payment.expected, messageHash: bytesHash(Buffer.from('bad')) }));
  assert.throws(() => buildLegacyPayment(f.quote, { ...f.payment.expected.payer, tokenAccount: f.quote.payload.mint }, f.payment.expected.blockhash));
  assert.doesNotThrow(() => validateLegacyMessage(f.payment.message, f.payment.expected));
});
test('wallet signature/message substitution and caller byte mutation fail; genuine signature passes', async () => {
  const f = fixture(); const result = await f.signer.sign(f.request); assert.equal(result.status, 'signed');
  for (const bad of [{ ...result, messageHash: bytesHash(Buffer.from('wrong')) }, { ...result, publicKey: f.quote.payload.seller_owner }, { ...result, signature: '1'.repeat(64) }]) assert.throws(() => attachSignature(f.payment, bad as SignResult));
  const changed = structuredClone(f.payment); changed.message[10] = changed.message[10]! ^ 1;
  assert.throws(() => attachSignature(changed, result));
  assert.ok(attachSignature(f.payment, result).transaction.length > f.payment.message.length);
  const wrong: ExpectedPayment = { ...f.payment.expected, blockhash: { ...f.payment.expected.blockhash, blockhash: f.quote.payload.mint } };
  assert.throws(() => validateLegacyMessage(f.payment.message, wrong));
});
