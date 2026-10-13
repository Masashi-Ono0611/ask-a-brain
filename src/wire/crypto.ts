import { createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Id, SealAuthorization, SellerPublicKey, Signed, SignedKind, SignedTypes } from './contracts.ts';
import { decodeBase58, decodeBase64url } from './encoding.ts';
import { canonicalBytes, payloadHash, requireWire } from './json.ts';
import { sellerPublicKeySchema, validatePayload, validateWire } from './schemas.ts';

export function signingBytes<K extends SignedKind>(kind: K, payload: SignedTypes[K]): Uint8Array {
  const validated = validatePayload(kind, payload);
  return Buffer.concat([Buffer.from(`ask-a-brain/v1/${kind}\n`, 'utf8'), canonicalBytes(validated)]);
}
/** Stateless typed signing primitive; protected key provisioning/approval authentication is the caller's job. */
export function signEnvelope<K extends SignedKind>(kind: K, payload: SignedTypes[K], keyId: Id, privateKey: KeyObject, authorization: SealAuthorization<K>): Signed<SignedTypes[K]> {
  const validated = validatePayload(kind, payload);
  requireWire(authorization.kind === kind && authorization.payloadHash === payloadHash(validated) && ['human', 'test'].includes(authorization.actor), 'SEAL_AUTHORIZATION');
  if (kind === 'manifest') requireWire(authorization.approvalId === (validated as SignedTypes['manifest']).approval_id, 'MANIFEST_APPROVAL');
  requireWire(privateKey.type === 'private' && privateKey.asymmetricKeyType === 'ed25519', 'INVALID_SIGNING_KEY');
  // Enforce envelope size and key-id syntax BEFORE invoking the private-key operation.
  validateWire(kind, { payload: validated, signature: { key_id: keyId, algorithm: 'Ed25519', value: Buffer.alloc(64).toString('base64url') } });
  const value = sign(null, signingBytes(kind, validated), privateKey).toString('base64url');
  return { payload: validated, signature: { key_id: keyId, algorithm: 'Ed25519', value } };
}
export function verifyEnvelope<K extends SignedKind>(kind: K, value: Signed<SignedTypes[K]>, key: SellerPublicKey): void {
  // These functions also defend typed callers crossing JS/IPC boundaries.
  const envelope = validateWire(kind, value) as Signed<SignedTypes[K]>;
  const publicKey = sellerPublicKeySchema.parse(key);
  requireWire(envelope.signature.key_id === publicKey.id, 'UNKNOWN_KEY_ID');
  const raw = decodeBase58(publicKey.public_key, 32);
  const verifier = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' });
  requireWire(verify(null, signingBytes(kind, envelope.payload), verifier, decodeBase64url(envelope.signature.value, 64)), 'INVALID_SIGNATURE');
}
