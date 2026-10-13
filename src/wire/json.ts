import canonicalize from 'canonicalize';
import { visit } from 'jsonc-parser';
import { createHash } from 'node:crypto';
import type { JsonValue, Sha256 } from './contracts.ts';

/** Fixed errors never echo untrusted input into logs or protocol responses. */
export class WireError extends Error {
  readonly code = 'INVALID_INPUT';
  constructor(reason: string) { super(reason); this.name = 'WireError'; }
}
export function requireWire(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new WireError(reason);
}
export function scalarString(text: string): void {
  for (const scalar of text) {
    const code = scalar.codePointAt(0)!;
    requireWire(code < 0xd800 || code > 0xdfff, 'INVALID_UNICODE');
  }
}
/** ignoreBOM preserves it; JSON rejects a BOM, public page hashing never strips it. */
export function utf8Text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new WireError('INVALID_UTF8'); }
}
export function strictJson(bytes: Uint8Array, options: { readonly integerNumbersOnly?: boolean } = {}): JsonValue {
  const text = utf8Text(bytes);
  const objects: Set<string>[] = [];
  // visit tokenizes without building an object that could discard a duplicate.
  try {
    visit(text, {
      onObjectBegin() { objects.push(new Set()); },
      onObjectProperty(name) {
        scalarString(name);
        const keys = objects.at(-1)!;
        requireWire(!keys.has(name), 'DUPLICATE_KEY'); keys.add(name);
      },
      onObjectEnd() { objects.pop(); },
      onLiteralValue(value: unknown, offset: number, length: number) {
        if (typeof value === 'string') scalarString(value);
        if (typeof value === 'number') {
          requireWire(Number.isFinite(value), 'INVALID_NUMBER');
          // Wire numeric fields are unsigned safe counters, never JCS floating-point data.
          // Check the lexeme before IEEE-754 rounding could turn a fractional version into 1.
          if (options.integerNumbersOnly) requireWire(/^(0|[1-9][0-9]*)$/.test(text.slice(offset, offset + length)) && Number.isSafeInteger(value), 'INVALID_INTEGER_TOKEN');
        }
      },
      onError() { throw new WireError('INVALID_JSON'); },
    }, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false });
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    if (error instanceof WireError) throw error;
    throw new WireError('INVALID_JSON');
  }
}
/** Also validates in-memory callers: never silently omit undefined or invoke toJSON/getters. */
export function assertJson(value: unknown): asserts value is JsonValue {
  const ancestors = new Set<object>();
  function check(item: unknown): void {
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { scalarString(item); return; }
    if (typeof item === 'number') { requireWire(Number.isFinite(item), 'INVALID_NUMBER'); return; }
    requireWire(typeof item === 'object' && item !== null, 'INVALID_JSON_VALUE');
    requireWire(!ancestors.has(item), 'CYCLIC_JSON');
    requireWire(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'INVALID_JSON_OBJECT');
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    if (Array.isArray(item)) requireWire(keys.length === item.length + 1, 'INVALID_JSON_ARRAY');
    for (const key of keys) {
      requireWire(typeof key === 'string', 'INVALID_JSON_KEY'); scalarString(key);
      if (Array.isArray(item) && key === 'length') continue;
      if (Array.isArray(item)) requireWire(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length, 'INVALID_JSON_ARRAY');
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      requireWire('value' in descriptor && descriptor.enumerable, 'INVALID_JSON_PROPERTY');
      check(descriptor.value);
    }
    ancestors.delete(item);
  }
  try { check(value); } catch (error) {
    if (error instanceof WireError) throw error;
    throw new WireError('INVALID_JSON_VALUE');
  }
}
// unknown deliberately accepts frozen interface records (which lack JsonValue's index signature).
// Runtime validation is stricter than a compile-time cast, and satisfies CanonicalBytes/PayloadHash.
export function canonicalBytes(payload: unknown): Uint8Array {
  assertJson(payload);
  const text = canonicalize(payload);
  requireWire(typeof text === 'string', 'INVALID_JSON_VALUE');
  return Buffer.from(text, 'utf8');
}
export function bytesHash(bytes: Uint8Array): Sha256 {
  return createHash('sha256').update(bytes).digest('hex') as Sha256;
}
export function payloadHash(payload: unknown): Sha256 { return bytesHash(canonicalBytes(payload)); }
