import type { BrokerDeps, FreeCheckLease as Lease, Id, Listing, StoreTx } from '../wire/contracts.ts';
import type { BrokerPorts } from './ports.ts';
import { requireThat } from './policy.ts';
import { digest } from './journal.ts';
function key(buyer: Id, seller: Id, window: string): string { return digest(`${buyer}\n${seller}\n${window}`); }
function write(tx: StoreTx, buyer: Id, seller: Id, window: string, maximum: number, consultId: Id | null = null, expiresAt: string | null = null, now = ''): void {
  const id = key(buyer, seller, window); const row = tx.read('free_checks', id); const prior = row?.value as Lease | undefined;
  let count = prior?.count ?? 0;
  if (window === 'ready' && prior?.expiresAt !== null && prior?.expiresAt !== undefined && prior.expiresAt <= now) count = 0;
  requireThat(count < maximum, 'RATE_LIMITED');
  const next: Lease = { buyer_id: buyer, seller_id: seller, window, count: count + 1, consultId, expiresAt };
  if (row) tx.compareAndSet('free_checks', id, row.version, next); else tx.insert('free_checks', id, next);
}
/** Reserve the entire free fan-out before any seller I/O; rollback all on a cap.
 * Global IP/jobs/queue limits belong to the authenticated seller controller.
 */
export function takeChecks(tx: StoreTx, deps: BrokerDeps, ports: BrokerPorts, consultId: Id, listings: readonly Listing[]): void {
  const now = deps.clock.now(); const buyer = deps.policy.buyer.buyer_id;
  for (const listing of listings) {
    const seller = listing.seller_id;
    const ready = tx.read('free_checks', key(buyer, seller, 'ready'))?.value as Lease | undefined;
    requireThat(!ready || ready.count < ports.limits.buyerSellerUnarmedReadyMax.value || (ready.expiresAt !== null && ready.expiresAt <= now), 'RATE_LIMITED');
    write(tx, buyer, seller, `minute:${Math.floor(Date.parse(now) / 60000)}`, ports.limits.buyerSellerChecksPerMinute.value);
    write(tx, buyer, seller, `day:${now.slice(0, 10)}`, ports.limits.buyerSellerChecksPerDay.value);
    write(tx, buyer, seller, 'active', ports.limits.buyerSellerActiveMax.value, consultId);
  }
}
export function finishCheck(tx: StoreTx, deps: BrokerDeps, ports: BrokerPorts, consultId: Id, seller: Id, readyUntil: string | null): void {
  const buyer = deps.policy.buyer.buyer_id; const id = key(buyer, seller, 'active'); const row = tx.read('free_checks', id); const lease = row?.value as Lease | undefined;
  if (row && lease?.consultId === consultId) tx.compareAndSet('free_checks', id, row.version, { ...lease, count: 0, consultId: null } as Lease);
  if (readyUntil) write(tx, buyer, seller, 'ready', ports.limits.buyerSellerUnarmedReadyMax.value, consultId, readyUntil, deps.clock.now());
}
export function armedCheck(tx: StoreTx, deps: BrokerDeps, consultId: Id, seller: Id): void {
  const id = key(deps.policy.buyer.buyer_id, seller, 'ready'); const row = tx.read('free_checks', id); const lease = row?.value as Lease | undefined;
  if (row && lease?.consultId === consultId) tx.compareAndSet('free_checks', id, row.version, { ...lease, count: 0, consultId: null } as Lease);
}
