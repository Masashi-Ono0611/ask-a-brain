/** Protected composition root. Only approved pages/map enter the knowledge port. */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Id, IsoTime, SealedBundle, SellerPublicKey } from '../../src/wire/contracts.ts';
import { bytesHash, canonicalBytes, M03, parseWire, payloadHash, strictJson, verifyCitations, verifyEnvelope } from '../../src/wire/index.ts';
import { prepareAnswer, validatePublicBundle } from '../../src/seller/index.ts';
import { approvedPages, questionSourceHash, answerMapSourceHash, lessonHashes } from '../../fixtures/eval/approved/knowledge.ts';
import { checklist, parseCorpus } from '../../src/eval/index.ts';
export interface Knowledge { checklist(question: Id): unknown; consult(question: Id): unknown }
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sealSchema = z.object({ manifest: z.unknown(), approval: z.object({ approval_id: z.string(), payload_sha256: hash, approved_at: z.string().datetime(), actor: z.literal('human') }).strict(),
  scans: z.object({ bundle_sha256: hash, scanner_version: z.string(), scanner_sha256: hash, scanned_at: z.string().datetime(), passed: z.literal(true) }).strict() }).strict();
export function loadSeal(bytes: Uint8Array, files: ReadonlyMap<string, Uint8Array>, key: SellerPublicKey): SealedBundle {
  const seal = sealSchema.parse(strictJson(bytes)); const manifest = parseWire('manifest', canonicalBytes(seal.manifest));
  verifyEnvelope('manifest', manifest, key);
  return { manifest, files, approval: seal.approval as SealedBundle['approval'], scans: seal.scans as SealedBundle['scans'] };
}
export function createKnowledge(bundle: SealedBundle, sourceQuestions: Uint8Array, sourceMap: Uint8Array, origin: string): Knowledge {
  const config = { origin, limits: M03, wire: { parse: parseWire, canonical: canonicalBytes, hash: payloadHash, verify: verifyEnvelope, citations: verifyCitations, json: strictJson } };
  validatePublicBundle(bundle, config);
  const lessons = new Map<string, Uint8Array>();
  for (const [lesson, hash] of Object.entries(lessonHashes)) {
    const page = bundle.manifest.payload.pages.find((p) => p.content_sha256 === hash);
    if (!page) throw new Error('LESSON_APPROVAL_MISMATCH');
    lessons.set(lesson, bundle.files.get(`pages/${page.page_id}.md`)!);
  }
  if (bytesHash(sourceQuestions) !== questionSourceHash || bytesHash(sourceMap) !== answerMapSourceHash) throw new Error('SOURCE_APPROVAL_MISMATCH');
  // T12b knowledge.ts expects an internal map, while its pinned source is the
  // original Qxx -> spans object. Normalize locally without editing the freeze.
  const sourceRows = z.array(z.object({ id: z.string(), version: z.literal(1), text: z.string(), lesson: z.string(), sha256_of_utf8_text: hash }).strict()).parse(strictJson(sourceQuestions));
  const spanSchema = z.object({ page: z.string(), start_byte: z.number().int().nonnegative(), end_byte: z.number().int().positive(), text: z.string() }).strict();
  const rawMap = z.object(Object.fromEntries(sourceRows.map((q) => [q.id, z.array(spanSchema)]))).strict().parse(strictJson(sourceMap));
  const pages = approvedPages(lessons);
  const corpus = parseCorpus(canonicalBytes({ v: 1, pages, map: { v: 1, engine_version: 'approved-source-v1', entries: sourceRows.map((q) => ({
    question_id: q.id, question_sha256: q.sha256_of_utf8_text, support: 'supported', spans: rawMap[q.id]!.map((span) => {
      const page = pages.find((p) => span.page === `lessons/${p.page_id}.md`);
      if (!page || page.page_id !== q.lesson || bytesHash(Buffer.from(q.text)) !== q.sha256_of_utf8_text || Buffer.from(page.text).subarray(span.start_byte, span.end_byte).toString('utf8') !== span.text) throw new Error('SOURCE_SPAN_MISMATCH');
      return { page_id: page.page_id, byte_start: span.start_byte, byte_end: span.end_byte };
    }) })) } }));
  const approved = { read_checklist: (q: Id) => checklist(corpus, q), expected_paid_support: (q: Id) => ({ excerpts: rawMap[q]!.map((s) => s.text) }) };
  const policy = parseWire('question_policy', bundle.files.get('question-policy.json')!);
  // Prove projected spans match the exact approved source map, before any run.
  const answers = new Map<Id, ReturnType<typeof prepareAnswer>>();
  for (const question of policy.questions) {
    const selected = approved.read_checklist(question.question_id);
    if (question.question_sha256 !== selected.selection.question_sha256) throw new Error('QUESTION_PROJECTION_MISMATCH');
    const result = prepareAnswer(bundle, question, { quote_id: 'simulated', buyer_id: 'replay', created_at: new Date().toISOString() as IsoTime, commitment_salt: randomBytes(32).toString('base64url') } as Parameters<typeof prepareAnswer>[2], config);
    if (!('answer' in result)) throw new Error('EXTRACTION_DECLINED');
    const expected = approved.expected_paid_support(question.question_id);
    if (payloadHash(result.answer.claims.map((c) => c.text)) !== payloadHash(expected.excerpts)) throw new Error('SPAN_PROJECTION_MISMATCH');
    result.answer.citations.forEach((citation, i) => {
      const span = selected.selection.spans[i]!; const page = selected.pages.find((p) => p.page_id === span.page_id)!;
      if (citation.content_sha256 !== page.sha256 || citation.byte_start !== span.byte_start || citation.byte_end !== span.byte_end) throw new Error('SPAN_PROJECTION_MISMATCH');
    });
    answers.set(question.question_id, result);
  }
  if (answers.size !== sourceRows.length) throw new Error('QUESTION_SET_MISMATCH');
  return { checklist: (question) => { if (!answers.has(question)) throw new Error('QUESTION_DENIED'); return approved.read_checklist(question); },
    consult: (question) => {
      const approvedQuestion = policy.questions.find((q) => q.question_id === question);
      if (!answers.has(question) || !approvedQuestion) throw new Error('QUESTION_DENIED');
      const result = prepareAnswer(bundle, approvedQuestion, { quote_id: 'simulated' as Id, buyer_id: 'replay' as Id, created_at: new Date().toISOString() as IsoTime, commitment_salt: randomBytes(32).toString('base64url') }, config);
      if (!('answer' in result)) throw new Error('EXTRACTION_DECLINED');
      // Return source evidence only: no simulated signature, receipt or settlement.
      return structuredClone({ payment_mode: 'SIMULATED', live_paid: false, charged_atomic: '0', answer: result.answer.answer,
        claims: result.answer.claims, citations: result.answer.citations, engine_version: result.answer.engine_version,
        manifest_sha256: result.answer.manifest_sha256, source_map_sha256: bytesHash(sourceMap) });
    } };
}
