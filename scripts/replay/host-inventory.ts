import { z } from 'zod';
import { strictJson, payloadHash } from '../../src/wire/index.ts';
import { hostTools, residualNested, residualTop } from './host-surface.ts';
import type { Arm } from './host-surface.ts';
const item = z.object({ type: z.string(), name: z.string().optional(), description: z.string().optional(), tools: z.array(z.unknown()).optional(),
  parameters: z.unknown().optional(), strict: z.boolean().optional(), format: z.unknown().optional(), defer_loading: z.boolean().optional() }).strict();
export interface Inventory { top: string[]; nested: string[] }
/** Provider envelope remains opaque; every tool definition is admitted strictly.
 * additional_tools is mandatory: provider-native tools alone are incomplete. */
export function extractInventory(bytes: Uint8Array): Inventory {
  const body = strictJson(bytes) as Record<string, unknown>;
  if (!body || !Array.isArray(body.input)) throw new Error('INCOMPLETE_INVENTORY');
  const additional = body.input.filter((v) => v && typeof v === 'object' && (v as { type?: unknown }).type === 'additional_tools');
  if (additional.length !== 1) throw new Error('INCOMPLETE_INVENTORY');
  const list = z.object({ type: z.literal('additional_tools'), tools: z.array(z.unknown()), id: z.string().optional(), role: z.string().optional() }).strict().parse(additional[0]);
  const top = new Set<string>(), nested = new Set<string>();
  function walk(raw: unknown, prefix = ''): void {
    const tool = item.parse(raw);
    if (!tool.name) throw new Error('UNNAMED_TOOL');
    if (tool.type === 'namespace') {
      if (!tool.tools || tool.tools.length === 0) throw new Error('EMPTY_NAMESPACE');
      for (const child of tool.tools) walk(child, `${prefix}${tool.name}.`);
    } else {
      if (!['function', 'custom'].includes(tool.type) || tool.tools) throw new Error('UNKNOWN_TOOL_TYPE');
      top.add(prefix + tool.name);
      // Nested tools are the headed declarations inside the exec orchestrator description ('### `name`'); prose examples such as `tools.x(` are not declarations.
      for (const m of (tool.description ?? '').matchAll(/^### `([^`]+)`/gm)) nested.add(m[1]!);
    }
  }
  list.tools.forEach((t) => walk(t));
  if (body.tools !== undefined) z.array(z.unknown()).parse(body.tools).forEach((t) => walk(t));
  if (!top.has('functions.exec') || nested.size === 0) throw new Error('INCOMPLETE_INVENTORY');
  return { top: [...top].sort(), nested: [...nested].sort() };
}
/** The model-visible MCP tools of Codex 0.160.0 are DEFERRED: they are not in the request's declarations but only in the exec
 * runtime's ALL_TOOLS (measured, decision L6/L8). The static request check therefore skips arm-tool presence (staticOnly);
 * extractRuntimeTools + verifyRuntimeTools prove the complete enabled nested set from the runtime's own enumeration. */
export function extractRuntimeTools(bytes: Uint8Array, callId: string): string[] {
  const body = strictJson(bytes) as { input?: unknown };
  if (!body || !Array.isArray(body.input)) throw new Error('INCOMPLETE_RUNTIME_INVENTORY');
  const outputs = body.input.filter((v) => v && typeof v === 'object' && (v as { type?: unknown }).type === 'custom_tool_call_output' && (v as { call_id?: unknown }).call_id === callId);
  if (outputs.length !== 1) throw new Error('INCOMPLETE_RUNTIME_INVENTORY');
  const parts = z.object({ output: z.array(z.object({ type: z.string(), text: z.string() }).passthrough()) }).passthrough().parse(outputs[0]).output;
  const last = parts.at(-1)?.text; if (!last) throw new Error('INCOMPLETE_RUNTIME_INVENTORY');
  const names = z.array(z.string()).parse(JSON.parse(last));
  if (new Set(names).size !== names.length) throw new Error('DUPLICATE_RUNTIME_TOOL');
  return names.sort();
}
export function verifyRuntimeTools(names: readonly string[], arm: Arm): void {
  const expected = [...residualNested, ...hostTools(arm).map((t) => `mcp__replay__${t.name}`)].sort();
  const actual = [...names].sort();
  if (actual.length !== expected.length || actual.some((n, i) => n !== expected[i])) throw new Error(actual.some((n) => !expected.includes(n)) ? 'EXTRA_TOOL' : 'MISSING_TOOL');
}
export function verifyInventory(value: Inventory, arm: Arm, options: { staticOnly?: boolean } = {}): void {
  const allowedMcp = hostTools(arm).map((t) => `mcp__replay__${t.name}`);
  // Codex MCP names are declared inside the JS orchestrator in L6. Accept the
  // same names as direct tools too, but never silently omit an arm tool.
  const topAllowed = new Set([...residualTop, ...allowedMcp, ...allowedMcp.map((n) => `functions.${n}`)]);
  const nestedAllowed = new Set([...residualNested, ...allowedMcp]);
  if (value.top.some((n) => !topAllowed.has(n)) || value.nested.some((n) => !nestedAllowed.has(n))) throw new Error('EXTRA_TOOL');
  if (residualTop.some((n) => !value.top.includes(n)) || residualNested.some((n) => !value.nested.includes(n)) ||
    (!options.staticOnly && allowedMcp.some((n) => !value.nested.includes(n) && !value.top.includes(n) && !value.top.includes(`functions.${n}`)))) throw new Error('MISSING_TOOL');
}
export function residualHash(value: Inventory) {
  return payloadHash({ top: value.top.filter((n) => !n.includes('mcp__')), nested: value.nested.filter((n) => !n.startsWith('mcp__')) });
}
