/** Candidate CLI JSON adapter, NOT verified 0.160.0 instrumentation. CLI output
 * never supplies action authority: actions come from the audited MCP relay. */
import { z } from 'zod';
import { createTaskTools, parseFixture, parseCorpus } from '../../src/eval/index.ts';
import type { JournalEvent } from '../../src/eval/index.ts';
import type { ArtifactSource, FrozenRun, IsoTime, Observation } from '../../src/wire/contracts.ts';
import { payloadHash, strictJson } from '../../src/wire/index.ts';
const count = z.number().int().nonnegative();
// Codex 0.160.0 also reports cache_write_input_tokens and reasoning_output_tokens in turn.completed.usage (measured, decision L8).
// They are accepted as non-negative integers and do not change the observed total (input + output; cached input is a subset of input).
const usageSchema = z.object({ input_tokens: count, output_tokens: count, cached_input_tokens: count, cache_write_input_tokens: count.optional(), reasoning_output_tokens: count.optional() }).strict();
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread.started'), thread_id: z.string() }).strict(),
  z.object({ type: z.literal('turn.started') }).strict(),
  z.object({ type: z.literal('turn.completed'), usage: usageSchema }).strict(),
  z.object({ type: z.literal('turn.failed'), error: z.object({ message: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('error'), message: z.string() }).strict(),
  ...(['item.started', 'item.updated', 'item.completed'] as const).map((type) => z.object({ type: z.literal(type), item: z.unknown() }).strict()),
]);
export function usageObserver() {
  let tokens: number | null = null, failed = false;
  return {
    accept(bytes: Uint8Array): void {
      const event = eventSchema.parse(strictJson(bytes));
      if (event.type === 'turn.failed' || event.type === 'error') failed = true;
      if (event.type === 'turn.completed') {
        // Cached input is a subset of input, not an additional token charge.
        if (event.usage.cached_input_tokens > event.usage.input_tokens) throw new Error('USAGE_INVALID');
        const next = (tokens ?? 0) + event.usage.input_tokens + event.usage.output_tokens;
        if (!Number.isSafeInteger(next)) throw new Error('USAGE_INVALID'); tokens = next;
      }
    }, snapshot: () => ({ tokens, failed, schema_status: 'UNVERIFIED' as const }),
  };
}
const responseEvent = z.object({ phase: z.literal('response'), id: z.union([z.string(), z.number()]), tool: z.string(), input: z.unknown(),
  response: z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]), result: z.unknown().optional(), error: z.unknown().optional() }).strict() }).strict();
/** Reconstruct only tool results actually observed on the protected transport.
 * A command recommendation / model-generated JSON cannot create a grade. */
export async function recordedObservation(spec: FrozenRun, source: ArtifactSource, events: readonly JournalEvent[]): Promise<Observation | null> {
  let at = spec.started_at; let observed = false;
  const controller = createTaskTools(parseFixture(source.fixture(spec.fixture_id)), parseCorpus(source.corpus()), spec.arm,
    { now: () => at, monotonicMs: () => 0, sleep: async () => {} }, spec.run_id);
  for (const event of events) {
    if (event.kind !== 'call' || (event.data as { phase?: string }).phase !== 'response') continue;
    if (event.run_id !== spec.run_id) throw new Error('CROSS_RUN_OBSERVATION');
    const record = responseEvent.parse(event.data);
    if (record.response.error) continue;
    const result = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() }).strict()), isError: z.boolean().optional() }).strict().parse(record.response.result);
    if (result.isError) continue;
    if (result.content.length !== 1) throw new Error('OBSERVATION_INVALID');
    const wrapped = z.object({ untrusted_content: z.literal(true), data: z.unknown() }).strict().parse(strictJson(Buffer.from(result.content[0]!.text)));
    const tool = record.tool as keyof typeof controller.tools;
    if (tool === 'read_checklist' || !(tool in controller.tools)) continue;
    // inspect_fixture has no evidence timestamp; it is intentionally not used
    // for action grading. Gateway must export its protected observation for it.
    if (tool === 'inspect_fixture') throw new Error('INSPECT_OBSERVATION_TIMESTAMP_UNAVAILABLE');
    const evidence = z.object({ fixture_id: z.string(), evidence_id: z.string(), operation: z.string(), passed: z.boolean(), artifact_sha256: z.string(), recorded_at: z.string().datetime() }).strict().parse(wrapped.data);
    if (Date.parse(evidence.recorded_at) < Date.parse(at)) throw new Error('OBSERVATION_TIME_INVALID');
    at = evidence.recorded_at as IsoTime;
    const fn = controller.tools[tool] as (input: unknown) => Promise<unknown>;
    const actual = await fn(record.input);
    if (payloadHash(actual) !== payloadHash(wrapped.data)) throw new Error('OBSERVATION_MISMATCH');
    observed = true;
  }
  return observed ? controller.snapshot() : null;
}
