/** Explicit offline self-test of the lead-provisioned scanner on public fixture
 * bytes. It does not download, choose a version, or confer human approval. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOperator } from '../publish/operator.ts';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runOperator(['scan', ...process.argv.slice(2)]); }
  catch { console.error('SCANNER_FAILED_CLOSED'); process.exitCode = 1; }
}
