import { setTimeout } from 'node:timers/promises';
import type { Clock, IsoTime } from '../wire/contracts.ts';
function duration(ms: number): void { if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError('INVALID_DURATION'); }
export class SystemClock implements Clock {
  now(): IsoTime { return new Date().toISOString() as IsoTime; }
  monotonicMs(): number { return performance.now(); }
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    duration(ms);
    await setTimeout(ms, undefined, signal === undefined ? {} : { signal });
  }
}
/** Fixed until explicitly advanced; sleep waits on virtual monotonic time. */
export class FixedClock implements Clock {
  #epoch: number; #elapsed = 0;
  #waiters = new Set<{ deadline: number; resolve: () => void; reject: (reason: unknown) => void; cleanup: () => void }>();
  constructor(now: IsoTime | string) {
    this.#epoch = Date.parse(now);
    if (!Number.isFinite(this.#epoch)) throw new RangeError('INVALID_TIME');
    new Date(this.#epoch).toISOString();
  }
  now(): IsoTime { return new Date(this.#epoch + this.#elapsed).toISOString() as IsoTime; }
  monotonicMs(): number { return this.#elapsed; }
  advance(ms: number): void {
    duration(ms);
    const next = this.#elapsed + ms;
    if (!Number.isSafeInteger(next)) throw new RangeError('INVALID_DURATION');
    new Date(this.#epoch + next).toISOString();
    this.#elapsed = next;
    for (const waiter of this.#waiters) if (waiter.deadline <= next) {
      this.#waiters.delete(waiter); waiter.cleanup(); waiter.resolve();
    }
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    duration(ms);
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (ms === 0) return Promise.resolve();
    if (!Number.isSafeInteger(this.#elapsed + ms)) throw new RangeError('INVALID_DURATION');
    return new Promise((resolve, reject) => {
      const abort = (): void => { this.#waiters.delete(waiter); waiter.cleanup(); reject(signal?.reason); };
      const waiter = { deadline: this.#elapsed + ms, resolve, reject, cleanup: (): void => signal?.removeEventListener('abort', abort) };
      this.#waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
