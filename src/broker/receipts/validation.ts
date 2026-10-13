import { FoundationError } from '../../common/index.ts';
import { canonicalBytes, strictJson, validateWire } from '../../wire/index.ts';
import type { AabErrorCode, Id, ReconciledReceipt } from '../../wire/contracts.ts';

export function requireReceipt(ok: unknown, code: AabErrorCode = 'INVALID_INPUT'): asserts ok {
  if (!ok) throw new FoundationError(code);
}
export function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  // Also reject getters, undefined, invalid scalars and non-JSON objects.
  canonicalBytes(input);
  requireReceipt(input !== null && typeof input === 'object' && !Array.isArray(input));
  requireReceipt(Object.keys(input).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(input, key)));
  return input as Record<string, unknown>;
}
export function opaqueId(input: unknown): Id {
  requireReceipt(typeof input === 'string' && input.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)));
  return input as Id;
}
/** Shared strict schema owns unpaid selection and approval-reference admission. */
export function validateReceipt(input: unknown): ReconciledReceipt {
  const parsed = validateWire('receipt', input);
  return { ...parsed, approval_ref: parsed.approval_ref ?? null };
}
export function parseReceipt(bytes: Uint8Array): ReconciledReceipt {
  return validateReceipt(strictJson(bytes, { integerNumbersOnly: true }));
}
