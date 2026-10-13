import { INVENTORY_CALL_ID } from '../../scripts/replay/capture-inventory-mock.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import type { Id, IsoTime } from '../../src/wire/contracts.ts';
import { canonicalBytes, bytesHash } from '../../src/wire/index.ts';
import { hostTools, residualTop, residualNested } from '../../scripts/replay/host-surface.ts';
import type { Arm } from '../../scripts/replay/host-surface.ts';
export const root = resolve(import.meta.dirname, '../..');
export const clock = { now: () => '2026-10-09T00:00:00.000Z' as IsoTime, monotonicMs: () => 0, sleep: async () => {} };
export function temp(t: TestContext) { const dir = mkdtempSync(join(tmpdir(), 'aab-t12c-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
export function fixture() {
  const visible = { v: 1, fixture_id: 'I2', label: 'historical-derived-toy', family_id: 'test', prompt: 'Synthetic test only: complete the task.', files: { state: 'before', harm: 'no' }, fixes: [{ fix_id: 'fix', description: 'perform repair' }] };
  const hidden = { v: 1, fixture_id: 'I2', canary: 'HIDDEN_RESOLUTION_NEVER_KNOWLEDGE', source_sha256: bytesHash(Buffer.from('synthetic')),
    initial: visible.files, visible_fields: ['state', 'harm'], leftover_fields: ['state'], inspect_changes: {},
    fixes: [{ fix_id: 'fix', changes: { state: 'after' }, requires: ['inspect_fixture'], when: [] }], verify_rules: [], checks: [{ file_id: 'state', equals: 'after' }], ownership_fixes: [],
    pass_predicates: [{ file_id: 'state', equals: 'after' }], fail_predicates: [{ file_id: 'state', equals: 'before' }], critical_regression: [{ file_id: 'harm', equals: 'yes' }] };
  return { fixture: canonicalBytes(visible), rubric: canonicalBytes(hidden), run: 'I2_A' as Id };
}
export function requestInventory(arm: Arm, extra?: string) {
  const top = residualTop.map((name) => ({ type: 'function', name: name.split('.').at(-1), description: name === 'functions.exec' ? [...residualNested, ...hostTools(arm).map((t) => `mcp__replay__${t.name}`), ...(extra ? [extra] : [])].map((n) => `### \`${n}\``).join('\n') : '' }));
  return Buffer.from(canonicalBytes({ input: [{ type: 'additional_tools', id: 'at_test', role: 'developer', tools: [
    { type: 'namespace', name: 'functions', tools: top.slice(0, 4) }, { type: 'namespace', name: 'collaboration', tools: top.slice(4) },
  ] }], tools: [] }));
}
/** Second captured request: the exec orchestrator's runtime ALL_TOOLS output, shaped as measured on Codex 0.160.0. */
export function runtimeRequest(arm: Arm, options: { extra?: string; omit?: string } = {}) {
  const names = [...residualNested, ...hostTools(arm).map((t) => `mcp__replay__${t.name}`)].filter((n) => n !== options.omit);
  if (options.extra) names.push(options.extra);
  return Buffer.from(canonicalBytes({ input: [{ type: 'custom_tool_call_output', id: 'ctco_test', call_id: INVENTORY_CALL_ID,
    output: [{ type: 'input_text', text: 'Script completed\nWall time 0.0 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify(names) }] }] }));
}
export function stub(t: TestContext, body: string) { const directory = temp(t), path = join(directory, 'codex-stub.cjs'); writeFileSync(path, body); return { executable: process.execPath, prefix: [path] }; }
