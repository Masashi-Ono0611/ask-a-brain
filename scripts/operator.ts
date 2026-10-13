/** Offline operator entrypoint. Never exposes a runtime admin route. */
import { runOperator } from './publish/operator.ts';
try { await runOperator(process.argv.slice(2)); }
catch { console.error('PUBLISH_FAILED_CLOSED'); process.exitCode = 1; }
