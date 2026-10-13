/** Offline-only protected composition. No model, wallet, network, or host-home IO. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedClock, atomicFromBigint, lamportsFromBigint } from '../../src/common/index.ts';
import { M03, canonicalBytes, payloadHash, renderAnswer } from '../../src/wire/index.ts';
import type { Address, BuyerContext, ConsultInput, ConsultView, Id, MarketApi, TaskEvidence, Uuid } from '../../src/wire/contracts.ts';
import { checklist, runFrozenStudy, FileJournal, gradeAttempt, MemoryJournal, parseCorpus, parseStudy, planRuns, renderDetailedReplayReport } from '../../src/eval/index.ts';
import type { ArtifactSource, BuyerSession, Driver, Journal, Metrics, Study } from '../../src/eval/index.ts';
const root = new URL('../../', import.meta.url);
export const source: ArtifactSource = {
  fixture(key) { if (!/^s[123]$/.test(key)) throw new Error('FIXTURE_DENIED'); return readFileSync(new URL(`fixtures/eval/synthetic/${key}.json`, root)); },
  rubric(key) { if (!/^s[123]$/.test(key)) throw new Error('FIXTURE_DENIED'); return readFileSync(new URL(`fixtures/eval/synthetic/${key}.rubric.json`, root)); },
  corpus() { return readFileSync(new URL('fixtures/eval/synthetic/corpus.json', root)); },
};
export function loadStudy(): Study { return parseStudy(readFileSync(new URL('config/eval/synthetic.json', root))); }
export const buyer: BuyerContext = { buyer_id: 'synthetic_buyer' as Id, session_id: 'synthetic_session' as Id, payer: '11111111111111111111111111111111' as Address };
export function consultInput(question: Id): ConsultInput {
  return { request_id: '00000000-0000-4000-8000-000000000001' as Uuid, question_id: question,
    max_price: { network: 'devnet', asset_id: '11111111111111111111111111111111' as Address, amount_atomic: atomicFromBigint(M03.totalAtomic.value) } };
}
export function syntheticMarket(): MarketApi {
  const corpus = parseCorpus(source.corpus()); const views = new Map<Id, ConsultView>();
  return {
    async find() { return { listings: [] }; },
    async consult(_context, input) {
      const selected = checklist(corpus, input.question_id); const key = `sim_${input.question_id}` as Id;
      const citations = selected.selection.spans.map((span, index) => {
        const page = corpus.pages.find((p) => p.page_id === span.page_id)!;
        return { ...span, id: `cite_${index}` as Id, content_sha256: page.sha256,
          excerpt: Buffer.from(page.text).subarray(span.byte_start, span.byte_end).toString('utf8'), source_url: `https://synthetic.invalid/${span.page_id}` };
      });
      const view: ConsultView = { consult_id: key, receipt_id: `receipt_${key}` as Id, consult_state: 'quote_issued', dispositions: [],
        purchase_amount_atomic: atomicFromBigint(M03.totalAtomic.value), network_fee_lamports: lamportsFromBigint(0n),
        payment_state: 'payment_finalized', content_state: 'eligible', delivery_state: 'delivered', refund_state: 'none', import_state: 'not_applicable', feedback_state: 'none',
        message: 'SIMULATED: no signature, transfer or chain observation', answer: { text: renderAnswer(citations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }))),
          citations, answer_sha256: payloadHash(citations), verified: true, untrusted_content: true } };
      views.set(key, view); return view;
    },
    async status(_context, input) { const view = views.get(input.consult_id); if (!view) throw new Error('CONSULT_DENIED'); return view; },
    async feedback() { return { feedback_id: 'sim_feedback' as Id, source: 'agent', eligible_for_trust: false }; },
    async report() { throw new Error('CROSS_ARM_REPORT_MUST_NOT_BE_CALLED'); },
  };
}
export async function call(session: BuyerSession, tool: string, input: unknown): Promise<unknown> { return session.call(canonicalBytes({ tool, input })); }
export function measured(study: Study): Metrics { return { effective_model: study.effective_model, config_sha256: study.config_sha256, tokens: 0,
  model_ms: 0, human_active_ms: null, chain_ms: 0, model_expense_usd: '0', rpc_expense_usd: '0', hosting_expense_usd: '0' }; }
/** Same scripted policy in every arm; it deliberately yields an A/B/C null delta. */
export function syntheticDriver(study: Study): Driver {
  return { async execute(session) {
    const input = { fixture_id: session.fixture_id };
    await call(session, 'inspect_fixture', input);
    if (session.tools.includes('read_checklist')) await call(session, 'read_checklist', { question_id: session.question_id });
    if (session.tools.includes('consult')) await call(session, 'consult', consultInput(session.question_id));
    await call(session, 'apply_fixture_fix', { ...input, fix_id: 'repair' });
    const left = await call(session, 'check_leftovers', input) as TaskEvidence;
    const verified = await call(session, 'verify_fixture', input) as TaskEvidence;
    await call(session, 'finish_with_evidence', { ...input, evidence_ids: [left.evidence_id, verified.evidence_id] });
    return measured(study);
  } };
}
export async function rehearse(journal: Journal = new MemoryJournal()) {
  const study = loadStudy(), clock = new FixedClock('2026-10-09T00:00:00.000Z'), plan = planRuns(study, clock.now());
  // Fresh driver and market instances for every arm. Existing attempts are never rerun.
  const attempts = await runFrozenStudy(plan, journal, (spec) => ({ study, source, clock, buyer: { ...buyer, session_id: spec.run_id }, driver: syntheticDriver(study), market: syntheticMarket() }));
  const grades = await Promise.all(attempts.map((a) => gradeAttempt(a, source)));
  return { plan, attempts, grades, report: renderDetailedReplayReport(plan, attempts, grades) };
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Default leaves no files; optional path is a trusted operator argument, never tool input.
  const path = process.argv[2]; const journal = path ? new FileJournal(path) : new MemoryJournal();
  try { console.log((await rehearse(journal)).report); } finally { if (journal instanceof FileJournal) journal.close(); }
}
