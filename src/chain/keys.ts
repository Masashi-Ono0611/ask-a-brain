import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Address, Signature } from '../wire/contracts.ts';
import { encodeBase58, strictJson } from '../wire/index.ts';
import { requireChain, sameBytes } from './legacy.ts';
export function importCliKey(bytes: Uint8Array, expected?: Address): { key: KeyObject; publicKey: Address } {
  requireChain(bytes.length === 64);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes.slice(0, 32)]), format: 'der', type: 'pkcs8' });
  const raw = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  const publicKey = encodeBase58(raw) as Address;
  requireChain(sameBytes(raw, bytes.slice(32)) && (expected === undefined || expected === publicKey));
  return { key, publicKey };
}
export function parseCliKey(bytes: Uint8Array): Uint8Array {
  const value = strictJson(bytes, { integerNumbersOnly: true });
  requireChain(Array.isArray(value) && value.length === 64 && value.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255));
  const key = Uint8Array.from(value as number[]); importCliKey(key); return key;
}
/** Throwaway generation only; caller owns private storage and never logs the result. */
export function generateThrowawayKey(): { publicKey: Address; keyBytes: Uint8Array } {
  const pair = generateKeyPairSync('ed25519');
  const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const publicBytes = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { publicKey: encodeBase58(publicBytes) as Address, keyBytes: Uint8Array.from(Buffer.concat([seed, publicBytes])) };
}
export function signBytes(message: Uint8Array, bytes: Uint8Array, expected: Address): Signature {
  return encodeBase58(sign(null, message, importCliKey(bytes, expected).key)) as Signature;
}
