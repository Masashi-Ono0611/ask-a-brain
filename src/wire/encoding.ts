import { requireWire } from './json.ts';
// Representation codecs only; all signatures/hashes are delegated to node:crypto.
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(text: string, size: number): Uint8Array {
  requireWire(typeof text === 'string' && text.length > 0 && text.length <= Math.ceil(size * 8 / Math.log2(58)), 'INVALID_BASE58');
  let value = 0n;
  for (const char of text) {
    const digit = alphabet.indexOf(char); requireWire(digit >= 0, 'INVALID_BASE58');
    value = value * 58n + BigInt(digit);
  }
  const tail: number[] = [];
  while (value > 0n) { tail.push(Number(value & 255n)); value >>= 8n; }
  let zeroes = 0; while (text[zeroes] === '1') zeroes++;
  const bytes = Uint8Array.from([...new Array<number>(zeroes).fill(0), ...tail.reverse()]);
  requireWire(bytes.length === size, 'INVALID_BASE58_LENGTH'); return bytes;
}
export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n; for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = ''; while (value > 0n) { text = alphabet[Number(value % 58n)]! + text; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = '1' + text; }
  return text;
}
export function decodeBase64url(text: string, size: number): Uint8Array {
  requireWire(typeof text === 'string' && /^[A-Za-z0-9_-]+$/.test(text), 'INVALID_BASE64URL');
  const bytes = Buffer.from(text, 'base64url');
  requireWire(bytes.length === size && bytes.toString('base64url') === text, 'INVALID_BASE64URL'); return bytes;
}
