/** PROTECTED composition root. Mount neither this module nor its dependencies in buyer.
 * One gateway instance and private socket per frozen run. Never resume an aborted
 * run with fresh budgets; reconciliation continues independently in the broker. */
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { chmodSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { M03, canonicalBytes, payloadHash } from '../../src/wire/index.ts';
import type { BuyerContext, Clock, ConsultInput, Id, MarketApi, ReportInput, ReportOutput, TaskTools } from '../../src/wire/contracts.ts';
import { namesForArm, parseRequest, validateInput } from '../../src/mcp/index.ts';
import type { Arm, RuntimePort } from '../../src/mcp/index.ts';
export interface GatewayOptions {
  readonly arm: Arm; readonly buyer: BuyerContext; readonly fixtureId: Id; readonly questionId: Id;
  readonly tools: TaskTools; readonly market: MarketApi; readonly clock: Clock;
  /** Required to expose report data: must exclude other runs, hidden grader and history. */
  readonly runReport?: (input: ReportInput) => Promise<ReportOutput>;
}
export function createRunGateway(options: GatewayOptions) {
  const { arm, tools, market, clock, fixtureId, questionId } = options;
  const buyer = Object.freeze({ ...options.buyer }), names = namesForArm(arm);
  const start = clock.monotonicMs(); let calls = 0, closed = false, pending = false;
  let consultHash: string | null = null; const consultIds = new Set<Id>();
  const alive = (): void => {
    const elapsed = clock.monotonicMs() - start;
    if (closed || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= M03.replayWallTimeMax.value * 60_000) throw new Error('RUN_CLOSED');
  };
  const port: RuntimePort = { async call(tool, raw) {
    alive();
    // Attempts, including denied calls, consume budget. Single flight prevents
    // concurrent mutation, competing purchases and finish/check races.
    if (++calls > M03.replayCallsMax.value) { closed = true; throw new Error('BUDGET_EXHAUSTED'); }
    if (pending || !names.includes(tool as typeof names[number])) throw new Error('TOOL_DENIED');
    const input = validateInput(tool, raw) as Record<string, unknown>;
    if ('fixture_id' in input && input.fixture_id !== fixtureId) throw new Error('FIXTURE_DENIED');
    if ('question_id' in input && input.question_id !== questionId) throw new Error('QUESTION_DENIED');
    if ('consult_id' in input && !consultIds.has(input.consult_id as Id)) throw new Error('CONSULT_DENIED');
    pending = true;
    try {
      let result: unknown;
      switch (tool) {
        case 'find': result = await market.find(buyer, input as unknown as Parameters<MarketApi['find']>[1]); break;
        case 'consult': {
          const consult = input as unknown as ConsultInput;
          if (consult.max_price.network !== 'devnet') throw new Error('NETWORK_DENIED');
          const hash = payloadHash(consult);
          if (consultHash !== null && hash !== consultHash) throw new Error('PURCHASE_LIMIT');
          consultHash = hash; // Reserve before dispatch; even ambiguous errors retain it.
          const view = await market.consult(buyer, consult); consultIds.add(view.consult_id); result = view; break;
        }
        case 'status': result = await market.status(buyer, input as unknown as Parameters<MarketApi['status']>[1]); break;
        case 'feedback': result = await market.feedback(buyer, input as unknown as Parameters<MarketApi['feedback']>[1]); break;
        case 'report': {
          if (!options.runReport) throw new Error('RUN_REPORT_UNAVAILABLE');
          result = await options.runReport(input as unknown as ReportInput); break;
        }
        case 'inspect_fixture': result = await tools.inspect_fixture(input as unknown as Parameters<TaskTools['inspect_fixture']>[0]); break;
        case 'check_leftovers': result = await tools.check_leftovers(input as unknown as Parameters<TaskTools['check_leftovers']>[0]); break;
        case 'apply_fixture_fix': result = await tools.apply_fixture_fix(input as unknown as Parameters<TaskTools['apply_fixture_fix']>[0]); break;
        case 'verify_fixture': result = await tools.verify_fixture(input as unknown as Parameters<TaskTools['verify_fixture']>[0]); break;
        case 'finish_with_evidence': result = await tools.finish_with_evidence(input as unknown as Parameters<TaskTools['finish_with_evidence']>[0]); alive(); closed = true; return result;
        case 'read_checklist': result = await tools.read_checklist(input as unknown as Parameters<TaskTools['read_checklist']>[0]); break;
        default: throw new Error('TOOL_DENIED');
      }
      alive(); return result;
    } finally { pending = false; }
  } };
  return {
    port, close() { closed = true; }, snapshot() { return { calls, closed, consult_reserved: consultHash !== null }; },
    async handle(bytes: Uint8Array): Promise<Uint8Array> {
      try {
        const request = parseRequest(bytes), result = await port.call(request.tool, request.input);
        const response = canonicalBytes({ ok: true, result });
        if (response.length > M03.citationFetchTotalMax.value * 1024) throw new Error('OUTPUT_LIMIT'); return response;
      } catch { return canonicalBytes({ ok: false, result: 'REQUEST_DENIED' }); }
    },
  };
}
/** Socket parent must be an operator-created empty per-run directory (0700).
 * No TCP listener, bearer auth in logs, generic admin route or path resolver.
 * OS UID/mount isolation is required; local unit tests do not prove it. */
export async function listenGateway(path: string, gateway: ReturnType<typeof createRunGateway>): Promise<Server> {
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid?.()) throw new Error('PRIVATE_SOCKET_DIRECTORY_REQUIRED');
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let bytes = Buffer.alloc(0); let denied = false;
    socket.on('error', () => { /* Fixed denial; no raw peer error logging. */ });
    socket.setTimeout(M03.replayWallTimeMax.value * 60_000, () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      if (denied) return;
      if (bytes.length + chunk.length > M03.ingressBodyMax.value * 1024) { denied = true; socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
    });
    socket.once('end', () => { if (!denied) void gateway.handle(bytes).then((response) => socket.end(response)); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve(); }); });
  chmodSync(path, 0o600); return server;
}
