import type { Eligibility, Revocation, RevokeSlice, Store, StoreTx, TombstoneJournal } from '../wire/contracts.ts';
import { FoundationError, verifyTombstoneAttestation, validateTombstones } from '../common/index.ts';
import { jsonValue } from './ports.ts';
import type { SellerDependencies } from './ports.ts';

class SerialLock {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(body: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(body); this.#tail = result.catch(() => undefined); return result;
  }
}
const locks = new WeakMap<Store, SerialLock>();
export function sellerLock(store: Store): SerialLock {
  let lock = locks.get(store); if (!lock) { lock = new SerialLock(); locks.set(store, lock); } return lock;
}
export function eligibilityKey(row: Pick<Revocation, 'slice_id' | 'manifest_sha256'>): string { return `${row.slice_id}:${row.manifest_sha256}`; }
function validateRevocation(row: Revocation): void { validateTombstones([row]); }
function apply(tx: StoreTx, row: Revocation): void {
  validateRevocation(row); const key = eligibilityKey(row); const old = tx.read('tombstones', key);
  if (old && Object.keys(row).some((key) => old.value[key as keyof Revocation] !== row[key as keyof Revocation])) throw new FoundationError('STATE_CONFLICT');
  if (!old) tx.insert('tombstones', key, row);
  const eligibility = tx.read('eligibility', key);
  if (eligibility) tx.compareAndSet('eligibility', key, eligibility.version, { ...eligibility.value, state: 'revoked', generation: Math.max(row.generation, eligibility.value.generation) });
}
/** Same Store instance/single process owner is required (T0 Store contract).
 * Local flag commits FIRST. A journal failure never rolls that flag back.
 */
export const revokeSlice: RevokeSlice = async (store, revocation, journal) => sellerLock(store).run(async () => {
  store.transaction((tx) => apply(tx, revocation));
  await journal.append(revocation);
});
export class EligibilityGate {
  readonly #deps: SellerDependencies;
  #online = false;
  constructor(deps: SellerDependencies) { this.#deps = deps; }
  async start(): Promise<void> {
    this.#online = false;
    const { store, tombstones, config, bundle, clock } = this.#deps;
    const snapshot = await (tombstones.newestState ? tombstones.newestState() : config.authority());
    const rows = await tombstones.readAll();
    verifyTombstoneAttestation(rows, snapshot, clock.now());
    const sorted = validateTombstones(rows);
    // Compare every local tombstone: a stale external copy cannot erase a local flag.
    let cursor: string | undefined;
    for (;;) {
      const page = store.scan('tombstones', { limit: 1, ...(cursor ? { cursor } : {}) });
      const row = page[0]?.value; if (!row) break;
      const matching = rows.find((r) => eligibilityKey(r) === eligibilityKey(row));
      if (!matching || config.wire.hash(jsonValue(matching)) !== config.wire.hash(jsonValue(row))) throw new FoundationError('NOT_READY');
      cursor = eligibilityKey(row);
    }
    const key = eligibilityKey({ slice_id: bundle.manifest.payload.slice_id, manifest_sha256: config.listing.slice.manifest_sha256 });
    const previous = store.read('eligibility', key);
    if (previous && previous.value.generation > snapshot.generation) throw new FoundationError('NOT_READY');
    this.#fresh(snapshot.acknowledged_at);
    store.transaction((tx) => {
      for (const row of sorted) apply(tx, row);
      const current = tx.read('eligibility', key);
      const eligibility: Eligibility = { slice_id: bundle.manifest.payload.slice_id, manifest_sha256: config.listing.slice.manifest_sha256,
        state: tx.read('tombstones', key) ? 'revoked' : current?.value.state === 'superseded' ? 'superseded' : 'eligible',
        generation: snapshot.generation, acknowledged_at: snapshot.acknowledged_at, checked_at: clock.now() };
      if (current) tx.compareAndSet('eligibility', key, current.version, eligibility); else tx.insert('eligibility', key, eligibility);
    });
    this.#online = true;
  }
  #fresh(at: string): void {
    const age = Date.parse(this.#deps.clock.now()) - Date.parse(at); const L = this.#deps.config.limits;
    if (!Number.isFinite(age) || age < -L.clockSkewMax.value * 1000 || age > L.lineageAcknowledgementMaxAge.value * 3600 * 1000) throw new FoundationError('NOT_READY');
  }
  check(newPurchase = false): Eligibility {
    const { store, config, bundle, clock } = this.#deps;
    if (!this.#online) throw new FoundationError('NOT_READY');
    if (newPurchase) {
      const skew = config.clockSkewMs();
      if (!Number.isFinite(skew) || Math.abs(skew) > config.limits.clockSkewMax.value * 1000) throw new FoundationError('NOT_READY');
    }
    const key = eligibilityKey({ slice_id: bundle.manifest.payload.slice_id, manifest_sha256: config.listing.slice.manifest_sha256 });
    if (store.read('tombstones', key)) throw new FoundationError('CONTENT_REVOKED');
    const row = store.read('eligibility', key)?.value;
    if (!row) throw new FoundationError('NOT_READY');
    this.#fresh(row.acknowledged_at);
    if (row.state === 'revoked') throw new FoundationError('CONTENT_REVOKED');
    if (row.state !== 'eligible' && !(row.state === 'superseded' && !newPurchase)) throw new FoundationError('NOT_READY');
    if (newPurchase && config.listing.status !== 'active') throw new FoundationError('NOT_READY');
    return { ...row, checked_at: clock.now() };
  }
}
export type { TombstoneJournal };
