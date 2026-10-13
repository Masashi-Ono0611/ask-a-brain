/** Complete model inventory cannot be derived from tools/list or model prose.
 * No debug flag or privileged trace path is invented. Capture stays incomplete. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesHash } from '../../src/wire/index.ts';
import { decodeUtf8 } from '../../src/common/index.ts';
import { FileJournal } from '../../src/eval/index.ts';
import { loadRequest, readPublicFile } from './request.ts';
import { runAttempt } from './run-attempt.ts';
import type { AttemptOptions, DryRuntime } from './run-attempt.ts';
export function inventorySupport(helpBytes: Uint8Array) {
  const help = decodeUtf8(helpBytes);
  return { complete: false as const, source: 'no_verified_complete_instrumentation' as const,
    status: 'UNVERIFIED' as const, help_sha256: bytesHash(helpBytes),
    // Presence is recorded for lead investigation, never taken as semantics.
    diagnostic_flag_mentions: [...new Set(help.match(/--(?:debug|trace)[a-z-]*/g) ?? [])],
    reason: 'No verified 0.160.0 complete model-visible tool instrumentation adapter. MCP tools/list and model self-report are insufficient.' };
}
export async function captureInventory(options: AttemptOptions, helpBytes: Uint8Array, dry?: DryRuntime) {
  // The prompt is fixed at the driver boundary; no model self-report requested.
  const result = await runAttempt(options, dry, 'inventory');
  return { ...inventorySupport(helpBytes), run_id: options.spec.run_id, attempt_status: result.attempt.status,
    inference_started: result.runtime.exit !== null, runtime: result.runtime, tools: null };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [requestPath, helpPath, outputPath, ...extra] = process.argv.slice(2);
  if (!requestPath || !helpPath || !outputPath || extra.length) throw new Error('REQUEST_HELP_OUTPUT_REQUIRED');
  const request = loadRequest(requestPath), help = readPublicFile(helpPath), journal = new FileJournal(request.journalPath);
  try {
    const result = await captureInventory({ ...request, journal }, help);
    writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result)); process.exitCode = 2;
  } finally { journal.close(); }
}
