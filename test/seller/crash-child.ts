/** Test child only. Inputs are synthetic public signed records, never private keys. */
import { readFileSync } from 'node:fs';
import { openStore } from '../../src/common/index.ts';
import type { ConsultRow, QuoteRow } from '../../src/wire/contracts.ts';
const [path, packetPath, phase] = process.argv.slice(2);
if (!path || !packetPath || !['before', 'after'].includes(phase ?? '')) throw new Error('INVALID_FIXTURE');
const packet = JSON.parse(readFileSync(packetPath, 'utf8')) as { quote: QuoteRow; request: ConsultRow };
const store = openStore(path);
store.transaction((tx) => {
  tx.insert('quotes', packet.quote.quote.payload.quote_id, packet.quote);
  tx.insert('consults', packet.quote.seller_request_key, packet.request);
  if (phase === 'before') process.kill(process.pid, 'SIGKILL');
});
process.kill(process.pid, 'SIGKILL');
