import { createHash } from 'node:crypto';
import { FoundationError } from '../common/index.ts';
import type { BrokerDeps, Id, JsonValue, Sha256, Store, StoreTx, Versioned } from '../wire/contracts.ts';
import type { BrokerPorts } from './ports.ts';

export type { BrokerStage as Stage, BrokerJournal as Journal, BrokerConsultRow as BrokerRow, BrokerSignedTransactionRow as BrokerSignedRow } from '../wire/contracts.ts';
import type { BrokerStage as Stage, BrokerConsultRow as BrokerRow } from '../wire/contracts.ts';
export const consultKey = (buyer: string, request: string): Id => `c_${digest(`${buyer}\n${request}`)}` as Id;
export const digest = (bytes: string | Uint8Array): Sha256 => createHash('sha256').update(bytes).digest('hex') as Sha256;
export function json(value: unknown): JsonValue { return value as JsonValue; } // Only validated/role-local JSON records.
export function readJournal(store: Pick<Store, 'read'>, id: Id): Versioned<BrokerRow> {
  const row = store.read('consults', id);
  const value = row?.value as BrokerRow | undefined;
  if (!row || !value?.broker || value.broker.v !== 1 || !value.view) throw new FoundationError('NOT_READY');
  return { version: row.version, value };
}
export function update(deps: BrokerDeps, id: Id, change: (row: BrokerRow) => BrokerRow, expected?: Stage): BrokerRow {
  return deps.store.transaction((tx) => updateTx(tx, deps, id, change, expected));
}
export function updateTx(tx: StoreTx, deps: BrokerDeps, id: Id, change: (row: BrokerRow) => BrokerRow, expected?: Stage): BrokerRow {
  const current = readJournal(tx, id);
  if (expected !== undefined && current.value.broker.stage !== expected) throw new FoundationError('STATE_CONFLICT');
  const next = change(current.value);
  tx.compareAndSet('consults', id, current.version, next);
  tx.append({ event_id: `${id}_${current.version + 1}` as Id, consult_id: id, code: `BROKER_${next.broker.stage.toUpperCase()}`, recorded_at: deps.clock.now(), counters: {} });
  return next;
}
export function artifact(tx: StoreTx, bytes: Uint8Array): Sha256 {
  const hash = digest(bytes);
  if (!tx.read('artifacts', hash)) tx.insert('artifacts', hash, { sha256: hash, bytes_base64: Buffer.from(bytes).toString('base64') });
  return hash;
}
/** Store scan cursors omit keys in T0; broker keys are reconstructible from rows.
 * 1000 is the documented Store adapter page bound, not an M03 business cap.
 */
export function journals(store: Pick<Store, 'scan'>): BrokerRow[] {
  const rows: BrokerRow[] = []; let cursor: string | undefined;
  for (;;) {
    const page = store.scan('consults', { limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
    for (const row of page) {
      const value = row.value as BrokerRow;
      if (!value.broker || !value.view) throw new FoundationError('NOT_READY');
      if (!value.broker.aliasOf) rows.push(value);
    }
    if (page.length < 1000) return rows;
    const last = page.at(-1)!.value; cursor = consultKey(last.buyer_id, last.request_id);
  }
}
export function snapshotArtifacts(tx: StoreTx, deps: BrokerDeps, ports: BrokerPorts): void {
  artifact(tx, ports.canonicalBytes(json(deps.registry))); artifact(tx, ports.canonicalBytes(json(deps.questionPolicy)));
}
