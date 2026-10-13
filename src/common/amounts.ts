import type { Atomic, Lamports } from '../wire/contracts.ts';
/** SPL u64 / lamport representation bound, not a spending cap or M03 parameter. */
export const U64_MAX = (1n << 64n) - 1n;
export function decodeAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new RangeError('INVALID_AMOUNT');
  const amount = BigInt(value);
  if (amount > U64_MAX) throw new RangeError('AMOUNT_OVERFLOW');
  return amount;
}
function encodeAmount(value: bigint): string {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw new RangeError('INVALID_AMOUNT');
  return value.toString(10);
}
export function atomicFromBigint(value: bigint): Atomic { return encodeAmount(value) as Atomic; }
export function lamportsFromBigint(value: bigint): Lamports { return encodeAmount(value) as Lamports; }
export function parseAtomic(value: unknown): Atomic { return atomicFromBigint(decodeAmount(value)); }
export function parseLamports(value: unknown): Lamports { return lamportsFromBigint(decodeAmount(value)); }
