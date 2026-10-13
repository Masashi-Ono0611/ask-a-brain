/** Compare a trusted complete Codex capability capture, never model prose.
 * Passing this comparison proves exact inventory equality only, NOT provenance,
 * host isolation, auth mode, hard tokens, model identity or live gate approval. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalBytes, payloadHash, strictJson } from '../../src/wire/index.ts';
import { inventory } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
export function verifyInventory(arm: Arm, bytes: Uint8Array) {
  const capture = strictJson(bytes) as Record<string, unknown>;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture) || Object.keys(capture).sort().join(',') !== 'complete,source,tools' || capture.complete !== true || capture.source !== 'trusted_runtime_instrumentation' || !Array.isArray(capture.tools)) throw new Error('COMPLETE_TRUSTED_CAPTURE_REQUIRED');
  const expected = inventory(arm).map(({ name, inputSchema }) => ({ name: `mcp__aab__${name}`, inputSchema }));
  const sort = (rows: unknown[]) => [...rows].sort((a, b) => String((a as { name: string }).name).localeCompare(String((b as { name: string }).name)));
  if (!Buffer.from(canonicalBytes(sort(capture.tools))).equals(Buffer.from(canonicalBytes(sort(expected))))) throw new Error('CAPABILITY_INVENTORY_MISMATCH');
  return { result: 'INVENTORY_MATCH_ONLY', arm, tool_count: expected.length, capture_sha256: payloadHash(capture), live_replay: 'BLOCKED_PENDING_OTHER_PROBES' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arm = process.argv[2], path = process.argv[3];
  if (!['A', 'B', 'C'].includes(arm ?? '') || !path) throw new Error('ARM_AND_CAPTURE_REQUIRED');
  console.log(JSON.stringify(verifyInventory(arm as Arm, readFileSync(path))));
}
