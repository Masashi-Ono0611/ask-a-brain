import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { Id, SellerPublicKey, SignedKind } from '../../src/wire/index.ts';
import { canonicalBytes, encodeBase58, payloadHash, signEnvelope, signingBytes, verifyEnvelope } from '../../src/wire/index.ts';
import { makeGolden } from './golden-fixture.ts';
const fixture = makeGolden();
const kinds = ['manifest', 'quote', 'arm', 'answer'] as const;
for (const kind of kinds) test(`${kind}: valid signature plus changed payload/signature/key/domain controls`, () => {
  const original = fixture.chain[kind]; const key = fixture.chain.registry.listings[0]!.signing_key;
  verifyEnvelope(kind, original, key);
  const changes = { manifest: { gate_version: 'mutated-gate' }, quote: { request_id: '00000000-0000-4000-8000-000000000002' }, arm: { last_valid_block_height: 101 }, answer: { engine_version: 'mutated-engine' } };
  const tampered = { ...original, payload: { ...original.payload, ...changes[kind] } };
  assert.throws(() => verifyEnvelope(kind, tampered as typeof original, key), /INVALID_SIGNATURE/);
  verifyEnvelope(kind, original, key);
  const payload = { ...original.payload, v: 2 };
  assert.throws(() => verifyEnvelope(kind, { ...original, payload } as typeof original, key));
  const signature = Buffer.from(original.signature.value, 'base64url'); signature[0] = signature[0]! ^ 1;
  assert.throws(() => verifyEnvelope(kind, { ...original, signature: { ...original.signature, value: signature.toString('base64url') } }, key), /INVALID_SIGNATURE/);
  assert.throws(() => verifyEnvelope(kind, { ...original, signature: { ...original.signature, key_id: 'unknown' as Id } }, key), /UNKNOWN_KEY_ID/);
  const another = generateKeyPairSync('ed25519');
  const otherKey: SellerPublicKey = { ...key, public_key: encodeBase58(Buffer.from(another.publicKey.export({ format: 'jwk' }).x!, 'base64url')) as SellerPublicKey['public_key'] };
  assert.throws(() => verifyEnvelope(kind, original, otherKey), /INVALID_SIGNATURE/);
  for (const wrongDomain of kinds.filter((k) => k !== kind).concat('wrong-v2' as SignedKind)) {
    const wrong = sign(null, Buffer.concat([Buffer.from(`ask-a-brain/v1/${wrongDomain}\n`), canonicalBytes(original.payload)]), another.privateKey);
    assert.throws(() => verifyEnvelope(kind, { ...original, signature: { ...original.signature, value: wrong.toString('base64url') } }, otherKey), /INVALID_SIGNATURE/);
    const good = signEnvelope(kind, original.payload, key.id, another.privateKey, { kind, payloadHash: payloadHash(original.payload), approvalId: kind === 'manifest' ? fixture.chain.manifest.payload.approval_id : 'test' as Id, actor: 'test' });
    verifyEnvelope(kind, good, otherKey);
  }
  verifyEnvelope(kind, original, key);
});
test('typed seal signing requires exact approval payload, kind, manifest approval id and Ed25519 private key', () => {
  const pair = generateKeyPairSync('ed25519'); const payload = fixture.chain.manifest.payload; const keyId = 'test-key' as Id;
  const approval = { kind: 'manifest' as const, payloadHash: payloadHash(payload), approvalId: payload.approval_id, actor: 'test' as const };
  for (const bad of [{ ...approval, payloadHash: payloadHash({ wrong: true }) }, { ...approval, kind: 'answer' }, { ...approval, approvalId: 'wrong' }, { ...approval, actor: 'agent' }]) {
    assert.throws(() => signEnvelope('manifest', payload, keyId, pair.privateKey, bad as typeof approval));
    assert.doesNotThrow(() => signEnvelope('manifest', payload, keyId, pair.privateKey, approval));
  }
  assert.throws(() => signEnvelope('manifest', payload, keyId, pair.publicKey, approval), /INVALID_SIGNING_KEY/);
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  assert.throws(() => signEnvelope('manifest', payload, keyId, ec.privateKey, approval), /INVALID_SIGNING_KEY/);
  assert.doesNotThrow(() => signEnvelope('manifest', payload, keyId, pair.privateKey, approval));
  assert.deepEqual(signingBytes('manifest', payload), Buffer.concat([Buffer.from('ask-a-brain/v1/manifest\n'), canonicalBytes(payload)]));
});
test('RFC 8032 test 1: public Ed25519 empty-message signature, no private vector seed', () => {
  // RFC 8032 §7.1 public data only. This verifies Node's primitive independently of fixture creation.
  const publicBytes = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
  const signature = Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b', 'hex');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: publicBytes.toString('base64url') } });
  assert.equal(verify(null, Buffer.alloc(0), key, signature), true);
  assert.equal(verify(null, Buffer.from('x'), key, signature), false);
  assert.equal(verify(null, Buffer.alloc(0), key, signature), true);
});
