import { canonicalBytes, M03, strictJson } from '../wire/index.ts';
import type { Id, Sha256 } from '../wire/contracts.ts';
export class EvalError extends Error { constructor(code: string) { super(code); this.name = 'EvalError'; } }
export function requireEval(ok: unknown, code = 'INVALID_INPUT'): asserts ok { if (!ok) throw new EvalError(code); }
export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  canonicalBytes(input); // Reject accessors, prototypes, undefined and invalid Unicode.
  requireEval(input !== null && typeof input === 'object' && !Array.isArray(input));
  const value = input as Record<string, unknown>;
  requireEval(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
  return value;
}
export function id(value: unknown): Id { requireEval(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)); return value as Id; }
export function hash(value: unknown): Sha256 { requireEval(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value as Sha256; }
export function text(value: unknown): string { requireEval(typeof value === 'string'); canonicalBytes(value); return value; }
export function integer(value: unknown): number { requireEval(Number.isSafeInteger(value) && Number(value) >= 0); return Number(value); }
export function array(value: unknown): readonly unknown[] { requireEval(Array.isArray(value)); return value; }
export function parse(bytes: Uint8Array): unknown {
  requireEval(bytes.byteLength <= M03.sealedPayloadMax.value * 1024 * 1024, 'INPUT_TOO_LARGE');
  return strictJson(bytes, { integerNumbersOnly: true });
}
export function clone<T>(value: T): T { return structuredClone(value); }
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
