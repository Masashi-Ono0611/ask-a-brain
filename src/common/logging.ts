import type { AabErrorCode, Clock, Id } from '../wire/contracts.ts';
export interface LogRecord { readonly code: AabErrorCode | 'STARTED' | 'STOPPED' | 'CHECK_PASSED'; readonly ids?: { readonly consult_id?: Id; readonly request_id?: Id }; readonly counters?: { readonly attempts?: number; readonly failures?: number; readonly pending?: number } }
const codes = new Set(['INVALID_INPUT', 'UNAUTHORIZED', 'UNKNOWN_SELLER', 'POLICY_DENIED', 'BUDGET_EXCEEDED', 'APPROVAL_REQUIRED', 'RATE_LIMITED', 'QUOTE_EXPIRED', 'IDEMPOTENCY_CONFLICT', 'NETWORK_MISMATCH', 'PAYMENT_UNCERTAIN', 'PAYMENT_INVALID', 'SELLER_UNAVAILABLE', 'VERIFICATION_FAILED', 'RECEIPT_STORE_UNAVAILABLE', 'INTERNAL_ERROR', 'CONTENT_REVOKED', 'NOT_READY', 'STATE_CONFLICT', 'BUDGET_EXHAUSTED', 'EXPIRED_BEFORE_APPROVAL', 'STARTED', 'STOPPED', 'CHECK_PASSED']);
function keys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError('INVALID_LOG_FIELD');
}
/** Only explicitly allowlisted fields are serialized. Sink defaults to stderr. */
export function createLogger(clock: Clock, sink: (line: string) => void = (line) => { process.stderr.write(line); }): (record: LogRecord) => void {
  return (record) => {
    keys(record, ['code', 'ids', 'counters']);
    if (!codes.has(record.code)) throw new TypeError('INVALID_LOG_CODE');
    const ids: Record<string, string> = {}; const counters: Record<string, number> = {};
    if (record.ids !== undefined) {
      keys(record.ids, ['consult_id', 'request_id']);
      for (const [key, value] of Object.entries(record.ids)) {
        if (typeof value !== 'string' || !/^[A-Za-z0-9_.\/-]{1,128}$/.test(value)) throw new TypeError('INVALID_LOG_ID');
        ids[key] = value;
      }
    }
    if (record.counters !== undefined) {
      keys(record.counters, ['attempts', 'failures', 'pending']);
      for (const [key, value] of Object.entries(record.counters)) {
        if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('INVALID_LOG_COUNTER');
        counters[key] = value;
      }
    }
    sink(`${JSON.stringify({ at: clock.now(), code: record.code, ids, counters })}\n`);
  };
}
