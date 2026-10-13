import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { z } from 'zod';
import { createApprovedTools, gradeApprovedAttempt, parseVisible, parseHeldOut } from '../../fixtures/eval/approved/adapter.ts';
import type { ApprovedAttempt } from '../../fixtures/eval/approved/adapter.ts';
import type { Clock, Id } from '../../src/wire/contracts.ts';
import { bytesHash, canonicalBytes, M03, payloadHash, strictJson } from '../../src/wire/index.ts';
import { admitCall } from './host-surface.ts';
import type { Arm } from './host-surface.ts';
import type { Knowledge } from './host-knowledge.ts';
import { HostLines } from './host-lines.ts';
const callSchema = z.object({ tool: z.string(), input: z.unknown() }).strict();
/** Procedural denial codes a real tool would surface to its caller. Used only when the request sets error_codes (a labelled
 * secondary variant); the default primary study keeps every denial opaque. No rubric text can pass through this list. */
export const PROCEDURAL_DENIAL_CODES = Object.freeze(['PRECONDITION_REQUIRED', 'INSPECTION_REQUIRED', 'EVIDENCE_DENIED', 'TERMINAL_EVIDENCE_REQUIRED',
  'OWNERSHIP_EVIDENCE_REQUIRED', 'STALE_VERIFICATION', 'FIX_DENIED', 'TASK_CLOSED']);
export class CodedDenial extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; this.name = 'CodedDenial'; } }
export function createSupervisor(options: { fixture: Uint8Array; rubric: Uint8Array; arm: Arm; run: Id; clock: Clock; knowledge: Knowledge | null; errorCodes?: boolean;
  journal(event: unknown): void; exhausted(): void }) {
  const fixture = parseVisible(options.fixture), rubric = parseHeldOut(options.rubric, fixture);
  const engine = createApprovedTools(fixture, rubric, options.clock, options.run);
  let calls = 0, consults = 0, closed = false;
  return {
    async call(bytes: Uint8Array) {
      if (closed) throw new Error('ATTEMPT_CLOSED');
      const sequence = ++calls;
      options.journal({ phase: 'request', sequence, at: options.clock.now(), request_sha256: bytesHash(bytes) });
      if (calls > M03.replayCallsMax.value) { closed = true; engine.close(); options.exhausted(); throw new Error('CALL_LIMIT'); }
      try {
        if (bytes.length > M03.ingressBodyMax.value * 1024) throw new Error('INPUT_TOO_LARGE');
        const { tool, input } = callSchema.parse(strictJson(bytes)); admitCall(options.arm, tool, input);
        options.journal({ phase: 'admitted', sequence, tool, input });
        let data: unknown;
        if (tool === 'read_checklist' || tool === 'consult') {
          if (!options.knowledge) throw new Error('KNOWLEDGE_UNAVAILABLE');
          const question = (input as { question_id: Id }).question_id;
          if (tool === 'consult' && ++consults > M03.replayPaidArmPurchasesMax.value) throw new Error('CONSULT_LIMIT');
          data = tool === 'consult' ? options.knowledge.consult(question) : options.knowledge.checklist(question);
        } else data = await engine.call(canonicalBytes({ tool, input }));
        options.journal({ phase: 'response', sequence, ok: true, data, observation: engine.snapshot() });
        return data;
      } catch (error) {
        const code = options.errorCodes === true && error instanceof Error && PROCEDURAL_DENIAL_CODES.includes(error.message) ? error.message : null;
        options.journal({ phase: 'response', sequence, ok: false, ...(code ? { code } : {}) });
        throw code ? new CodedDenial(code) : new Error('REQUEST_DENIED');
      }
    },
    close() { closed = true; engine.close(); }, snapshot: engine.snapshot, calls: () => calls,
  };
}
export async function listenSupervisor(path: string, call: (bytes: Buffer) => Promise<unknown>) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let queue = Promise.resolve();
    const lines = new HostLines(M03.ingressBodyMax.value * 1024, (bytes) => {
      socket.pause(); queue = queue.then(async () => {
        try { const data = await call(bytes); socket.write(Buffer.concat([canonicalBytes({ ok: true, data }), Buffer.from('\n')])); }
        catch (error) { socket.write(error instanceof CodedDenial ? Buffer.concat([canonicalBytes({ ok: false, code: error.code }), Buffer.from('\n')]) : '{"ok":false}\n'); }
        socket.resume();
      });
    });
    socket.on('data', (bytes) => { try { lines.push(bytes); } catch { socket.destroy(); } });
    socket.on('end', () => { try { lines.end(); } catch { socket.destroy(); } });
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(path, ok); });
  return { close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}
/** Same frozen predicates/action replay, amended token policy only. The original
 * usage is never rewritten in evidence; zero here disables T12b token scoring. */
export async function gradeHost(attempt: ApprovedAttempt, fixture: Uint8Array, rubric: Uint8Array) {
  return gradeApprovedAttempt({ ...attempt, tokens: 0 }, fixture, rubric);
}
export async function observationFromJournal(events: readonly unknown[], options: Parameters<typeof createSupervisor>[0]) {
  const replay = createSupervisor({ ...options, journal: () => {} });
  const last = events.findLast((raw) => { const row = raw as { phase?: string; ok?: boolean; observation?: unknown }; return row.phase === 'response' && row.ok === true && row.observation !== undefined; }) as { observation: ReturnType<typeof replay.snapshot> } | undefined;
  const observation = last?.observation ?? replay.snapshot();
  if (payloadHash(observation.initial_sha256) !== payloadHash(replay.snapshot().initial_sha256)) throw new Error('INITIAL_MISMATCH');
  return observation;
}
