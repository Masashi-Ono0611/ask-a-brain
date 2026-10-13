import type { AabError, AabErrorCode, Id } from '../wire/contracts.ts';
export class FoundationError extends Error {
  readonly code: AabErrorCode;
  constructor(code: AabErrorCode) { super(code); this.name = 'FoundationError'; this.code = code; }
}
/** Never forwards exception.message, seller prose, stack traces or causes. */
export function transportError(error: unknown, consultId: Id | null = null): AabError {
  const code = error instanceof FoundationError ? error.code : 'INTERNAL_ERROR';
  return { code, retryable: false, consult_id: consultId, message: code };
}
