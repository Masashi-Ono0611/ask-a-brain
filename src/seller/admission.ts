import type { BuyerContext, Clock, Id, Store } from '../wire/contracts.ts';
import { FoundationError } from '../common/index.ts';
import type { SellerLimits } from './ports.ts';

/** In-memory concurrency, durable counters. Restart never refunds a counted check. */
export class Admission {
  readonly #store: Store; readonly #clock: Clock; readonly #limits: SellerLimits; readonly #seller: Id;
  #active = 0; #buyers = new Set<Id>(); #queue: { buyer: Id; resolve: () => void; reject: (e: unknown) => void; abort: AbortController }[] = [];
  constructor(store: Store, clock: Clock, limits: SellerLimits, seller: Id) { this.#store = store; this.#clock = clock; this.#limits = limits; this.#seller = seller; }
  reserve(context: BuyerContext, ip: string): void {
    const now = Date.parse(this.#clock.now()); const minute = Math.floor(now / 60000); const day = this.#clock.now().slice(0, 10); const L = this.#limits;
    const buckets = [
      [`buyer:${context.buyer_id}:minute:${minute}`, context.buyer_id, L.buyerSellerChecksPerMinute.value],
      [`buyer:${context.buyer_id}:day:${day}`, context.buyer_id, L.buyerSellerChecksPerDay.value],
      [`ip:${ip}:minute:${minute}`, 'ip' as Id, L.ipChecksPerMinute.value],
      [`seller:day:${day}`, 'seller' as Id, L.sellerChecksPerDay.value],
    ] as const;
    this.#store.transaction((tx) => {
      for (const [window, buyer, maximum] of buckets) {
        const key = `${this.#seller}:${window}`; const row = tx.read('free_checks', key);
        if ((row?.value.count ?? 0) >= maximum) throw new FoundationError('RATE_LIMITED');
        const value = { buyer_id: buyer, seller_id: this.#seller, window, count: (row?.value.count ?? 0) + 1 };
        if (row) tx.compareAndSet('free_checks', key, row.version, value); else tx.insert('free_checks', key, value);
      }
    });
  }
  async enter(buyer: Id): Promise<() => void> {
    const L = this.#limits;
    if (this.#buyers.has(buyer)) throw new FoundationError('RATE_LIMITED');
    this.#buyers.add(buyer);
    try {
      if (this.#active >= L.sellerActiveJobsMax.value) {
        if (this.#queue.length >= L.queueMax.value) throw new FoundationError('RATE_LIMITED');
        await new Promise<void>((resolve, reject) => {
          const abort = new AbortController(); const queued = { buyer, resolve, reject, abort }; this.#queue.push(queued);
          void this.#clock.sleep(L.queueWaitMax.value * 1000, abort.signal).then(() => {
            const index = this.#queue.indexOf(queued);
            if (index !== -1) { this.#queue.splice(index, 1); reject(new FoundationError('SELLER_UNAVAILABLE')); }
          }).catch(() => undefined);
        });
      } else this.#active++;
    } catch (error) { this.#buyers.delete(buyer); throw error; }
    let released = false;
    return () => {
      if (released) return; released = true; this.#buyers.delete(buyer);
      const next = this.#queue.shift();
      if (next) { next.abort.abort(); next.resolve(); } else this.#active--;
    };
  }
}
