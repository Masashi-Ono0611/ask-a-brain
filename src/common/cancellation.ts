import type { Clock, IsoTime, SellerCallOptions } from '../wire/contracts.ts';
import { FoundationError } from './errors.ts';
/** Bounded transport scope. Payment reconciliation outlives this caller scope. */
export async function withDeadline<T>(clock: Clock, ms: number, action: (options: SellerCallOptions & { signal: AbortSignal }) => Promise<T>, parent: SellerCallOptions = {}): Promise<T> {
  const abort = new AbortController(), timer = new AbortController();
  const until = parent.deadline === undefined ? Date.parse(clock.now()) + ms : Math.min(Date.parse(clock.now()) + ms, Date.parse(parent.deadline));
  if (!Number.isFinite(until) || until <= Date.parse(clock.now())) throw new FoundationError('SELLER_UNAVAILABLE');
  parent.signal?.throwIfAborted();
  const cancel = (): void => abort.abort(parent.signal?.reason);
  parent.signal?.addEventListener('abort', cancel, { once: true });
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(abort.signal.reason);
    abort.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timeout = clock.sleep(Math.ceil(until - Date.parse(clock.now())), timer.signal).then(() => { abort.abort(new FoundationError('SELLER_UNAVAILABLE')); });
  try {
    return await Promise.race([action({ signal: abort.signal, deadline: new Date(until).toISOString() as IsoTime }), cancelled, timeout.then((): never => { throw new FoundationError('SELLER_UNAVAILABLE'); })]);
  } finally {
    timer.abort(); parent.signal?.removeEventListener('abort', cancel);
    if (rejectAbort) abort.signal.removeEventListener('abort', rejectAbort);
    abort.abort();
  }
}
