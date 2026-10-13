/** Public synthetic packet only, OS temp. Explicit process exit bypasses close. */
import { readFileSync } from 'node:fs';
import { FixedClock, openStore } from '../../../src/common/index.ts';
import { strictJson } from '../../../src/wire/index.ts';
import type { Receipt, Sha256 } from '../../../src/wire/contracts.ts';
import { createReceiptPersistence } from '../../../src/broker/receipts/index.ts';
const [path, packet, mode] = process.argv.slice(2);
if (!path || !packet || !['before-commit', 'after-commit'].includes(mode ?? '')) throw new Error('INVALID_CRASH_FIXTURE');
const input = strictJson(readFileSync(packet)) as unknown as { receipt: Receipt; blobs: [Sha256, string][] };
const store = openStore(path), persist = createReceiptPersistence({ clock: new FixedClock('2026-10-09T00:00:01.000Z') });
store.transaction((tx) => {
  persist(tx, input.receipt, { blobs: new Map(input.blobs.map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')])) });
  if (mode === 'before-commit') process.exit(23);
});
process.exit(24);
