import { atomicFromBigint, decodeAmount, lamportsFromBigint } from '../common/index.ts';
import type { Atomic, BrokerReservationRow as BrokerReservation, BrokerDeps, Id, IsoTime, Lamports, ReservationRow, Store, StoreTx } from '../wire/contracts.ts';
import type { BrokerPorts } from './ports.ts';
import { journals, readJournal, updateTx } from './journal.ts';
import { requireThat } from './policy.ts';

export type { BrokerReservationRow as BrokerReservation } from '../wire/contracts.ts';
/** Original-day charges survive refunds and unresolved exposure crosses midnight. */
export function reservations(store: Pick<Store, 'scan'>, payer: ReservationRow['payer']): BrokerReservation[] {
  const result: BrokerReservation[] = []; let cursor: string | undefined;
  for (;;) {
    const page = store.scan('reservations', { where: { payer }, limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
    for (const row of page) {
      const r = row.value as BrokerReservation;
      requireThat(r.network && Object.hasOwn(r, 'actualPrincipal') && Object.hasOwn(r, 'actualFee'), 'NOT_READY'); result.push(r);
    }
    if (page.length < 1000) return result;
    cursor = page.at(-1)!.value.consult_id;
  }
}
export function reserve(deps: BrokerDeps, ports: BrokerPorts, id: Id): void {
  deps.store.transaction((tx) => {
    const row = readJournal(tx, id).value; const q = row.broker.quote!.payload;
    requireThat(row.broker.stage === 'approved', 'STATE_CONFLICT');
    requireThat(!tx.read('events', 'broker_budget_fault'), 'NOT_READY');
    const day = deps.clock.now().slice(0, 10); const principal = decodeAmount(q.total_atomic); const maximumFee = decodeAmount(deps.policy.fee_per_call);
    const l = ports.limits;
    requireThat(principal <= decodeAmount(deps.policy.principal_per_call) && principal <= l.devnetPrincipalPerCall.value && maximumFee <= l.feePerPurchaseMax.value, 'BUDGET_EXCEEDED');
    let principalExposure = 0n, feeExposure = 0n;
    for (const r of reservations(tx, q.payer)) {
      // Fee exposure spans networks too: same payer SOL and policy ceiling.
      if (r.status === 'held') { principalExposure += decodeAmount(r.principal); feeExposure += decodeAmount(r.maximum_fee); }
      else if (r.day_utc === day) { requireThat(r.actualPrincipal !== null && r.actualFee !== null, 'NOT_READY'); principalExposure += decodeAmount(r.actualPrincipal); feeExposure += decodeAmount(r.actualFee); }
    }
    requireThat(principalExposure + principal <= decodeAmount(deps.policy.principal_per_day) && feeExposure + maximumFee <= decodeAmount(deps.policy.fee_per_day), 'BUDGET_EXCEEDED');
    // Unresolved delivered-value liabilities suspend further purchases (M06).
    requireThat(!journals(tx).some((r) => r.view.refund_state === 'refund_pending' || r.view.refund_state === 'partial_refund'), 'NOT_READY');
    if (q.network === 'mainnet-beta') {
      requireThat(deps.policy.mainnet_enabled && row.broker.listing!.listing_kind === 'founder' && principal === l.mainnetPrincipal.value && maximumFee <= l.mainnetAttemptFeeMax.value);
      // Entire demonstration, not per buyer/day. Inserted atomically with reserve.
      requireThat(!tx.read('events', 'broker_mainnet_attempt'), 'BUDGET_EXCEEDED');
      tx.append({ event_id: 'broker_mainnet_attempt' as Id, consult_id: id, code: 'MAINNET_ATTEMPT_LATCH', recorded_at: deps.clock.now(), counters: {} });
    }
    const reservation: BrokerReservation = { consult_id: id, payer: q.payer, day_utc: day, principal: q.total_atomic, maximum_fee: lamportsFromBigint(maximumFee), status: 'held', network: q.network, actualPrincipal: null, actualFee: null };
    tx.insert('reservations', id, reservation);
    updateTx(tx, deps, id, (r) => ({ ...r, broker: { ...r.broker, stage: 'reserved' }, view: { ...r.view, payment_state: 'payment_pending', delivery_state: 'pending', purchase_amount_atomic: null, network_fee_lamports: null, message: 'payment status unknown—do not pay again' } }), 'approved');
  });
}
export function resolveReservation(tx: StoreTx, id: Id, principal: Atomic, fee: Lamports, at: IsoTime): void {
  const current = tx.read('reservations', id); requireThat(current, 'STATE_CONFLICT');
  const r = current.value as BrokerReservation;
  requireThat(r.status === 'held', 'STATE_CONFLICT');
  requireThat(decodeAmount(principal) <= decodeAmount(r.principal), 'PAYMENT_INVALID');
  // Preserve authoritative charged fee even after an unexpected cap breach.
  // Freeze all new reservations until protected operator ledger repair (E18).
  if (decodeAmount(fee) > decodeAmount(r.maximum_fee) && !tx.read('events', 'broker_budget_fault')) tx.append({ event_id: 'broker_budget_fault' as Id, consult_id: id, code: 'FEE_RESERVATION_BREACH', recorded_at: at, counters: {} });
  tx.compareAndSet('reservations', id, current.version, { ...r, status: 'resolved', actualPrincipal: atomicFromBigint(decodeAmount(principal)), actualFee: lamportsFromBigint(decodeAmount(fee)) } as BrokerReservation);
}
