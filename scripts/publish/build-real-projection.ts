/** T10 inert conversion only. No keys, approval creation, signing, or activation.
 * Usage: node scripts/publish/build-real-projection.ts SOURCE APPROVAL_INDEX NEW_OUTPUT
 * SOURCE must be the lead-supplied approved public copies, never a private corpus.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AnswerMap, ConsultInput, Id, IsoTime, QuestionPolicy } from '../../src/wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, parseWire, payloadHash, renderAnswer, resolveQuestion, strictJson } from '../../src/wire/index.ts';
import { decodeUtf8, encodeUtf8, parseAnswerMap } from '../../src/common/index.ts';
import { buildManifest, createReviewPacket, realDirectory, regularBytes, stageBundle, writeExclusive } from '../../src/publish/index.ts';
import type { ReviewRow } from '../../src/publish/index.ts';

const lessonIds = Array.from({ length: M03.founderSlicePages.value }, (_, i) => `L${i + 1}`);
// These are this approved corpus's identity/count, not additional product caps.
const questionIds = Array.from({ length: 10 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`);
const negativeIds = Array.from({ length: 10 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`);
const sourcePaths = [...lessonIds.map((id) => `lessons/${id}.md`), 'questions/questions.json', 'questions/answer-map.json'];
const day = '2026-10-09T00:00:00.000Z' as IsoTime; // Date-only approval; NOT an observed time of day.
const attestation = 'founder-chat-approval-2026-10-09-lessons' as Id;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const questionSchema = z.object({ id: z.enum(questionIds as [string, ...string[]]), version: z.literal(1), text: z.string(), lesson: z.enum(lessonIds as [string, ...string[]]), sha256_of_utf8_text: hash }).strict();
const spanSchema = z.object({ page: z.enum(lessonIds.map((id) => `lessons/${id}.md`) as [string, ...string[]]), start_byte: z.number().int().safe().nonnegative(), end_byte: z.number().int().safe().positive(), text: z.string() }).strict();
const negativeSchema = z.object({ id: z.enum(negativeIds as [string, ...string[]]), version: z.number().int().safe().nonnegative(), text: z.string(), sha256_of_utf8_text: hash,
  category: z.enum(['unsupported-topic', 'unsafe/business-data-shaped', 'version-mismatch']), reason: z.string().min(1), expected_disposition: z.literal('local_reject'), target_question_id: z.enum(questionIds as [string, ...string[]]).optional() }).strict();
function requireInput(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function exactNames(path: string, names: readonly string[]): void {
  realDirectory(path);
  requireInput(JSON.stringify(readdirSync(path).sort()) === JSON.stringify([...names].sort()), 'SOURCE_INVENTORY');
}
export interface SourcePin { readonly path: string; readonly size_bytes: number; readonly sha256: string }
/** Only the two explicitly scoped approvals may admit this source set. */
export function approvalPins(index: Uint8Array): readonly SourcePin[] {
  const text = decodeUtf8(index); const pins: SourcePin[] = [];
  for (const [heading, names] of [
    ['## Approval 1: five lessons (2026-10-09, founder chat)', lessonIds.map((id) => `${id}.md`)],
    ['## Approval 2: ten questions and answer-map spans (2026-10-09, founder chat)', ['questions/questions.json', 'questions/answer-map.json']],
  ] as const) {
    const parts = text.split(heading); requireInput(parts.length === 2, 'APPROVAL_SECTION');
    const section = parts[1]!.split('\n## ')[0]!;
    const rows = [...section.matchAll(/^\| ([^|]+) \| (\d+) \| ([a-f0-9]{64}) \|$/gm)];
    requireInput(rows.length === names.length && names.every((name) => rows.filter((r) => r[1] === name).length === 1), 'APPROVAL_INVENTORY');
    for (const row of rows) pins.push({ path: row[1]!.startsWith('L') ? `lessons/${row[1]!}` : row[1]!, size_bytes: Number(row[2]), sha256: row[3]! });
  }
  return pins;
}
/** Verify all seven pins before interpreting any source text. Negatives are
 * internal controls only, with no invented content/publication approval. */
export function loadApprovedSources(source: string, index: Uint8Array) {
  const root = realDirectory(source); exactNames(root, ['lessons', 'questions']);
  exactNames(join(root, 'lessons'), lessonIds.map((id) => `${id}.md`));
  exactNames(join(root, 'questions'), ['questions.json', 'answer-map.json', 'negatives.json']);
  const pins = approvalPins(index); const files = new Map<string, Uint8Array>();
  for (const pin of pins) {
    const bytes = regularBytes(join(root, pin.path), pin.path.startsWith('lessons/') ? M03.pageMax.value * 1024 : M03.sealedPayloadMax.value * 1024 * 1024);
    requireInput(bytes.length === pin.size_bytes && bytesHash(bytes) === pin.sha256, 'SOURCE_APPROVAL_MISMATCH'); files.set(pin.path, bytes);
  }
  requireInput(sourcePaths.every((path) => files.has(path)), 'SOURCE_INVENTORY');
  const negatives = regularBytes(join(root, 'questions/negatives.json'), M03.sealedPayloadMax.value * 1024 * 1024);
  return { files, pins, negatives };
}
/** The source version is a finite, preexpanded policy value, never a free slot. */
export function admissionInput(id: string, version: number): ConsultInput {
  return parseWire('consult_input', canonicalBytes({ request_id: '00000000-0000-4000-8000-000000000001', question_id: id,
    template_values: { version: String(version) }, max_price: { network: 'devnet', asset_id: '11111111111111111111111111111111', amount_atomic: M03.totalAtomic.value.toString() } }));
}
export function createProjection(source: ReturnType<typeof loadApprovedSources>) {
  const json = (bytes: Uint8Array): unknown => strictJson(bytes, { integerNumbersOnly: true });
  const questions = z.array(questionSchema).length(questionIds.length).parse(json(source.files.get('questions/questions.json')!));
  requireInput(new Set(questions.map((q) => q.id)).size === questionIds.length, 'QUESTION_SET');
  const mapValue = json(source.files.get('questions/answer-map.json')!);
  const sourceMap = z.object(Object.fromEntries(questionIds.map((id) => [id, z.array(spanSchema).min(M03.citationsMin.value).max(M03.citationsMax.value)]))).strict().parse(mapValue);
  const negatives = z.array(negativeSchema).length(negativeIds.length).parse(json(source.negatives));
  requireInput(new Set(negatives.map((n) => n.id)).size === negativeIds.length, 'NEGATIVE_SET');
  const files = new Map<string, Uint8Array>();
  const mapping = lessonIds.map((lesson, i) => {
    const path = `pages/p${i + 1}.md`; const bytes = source.files.get(`lessons/${lesson}.md`)!; decodeUtf8(bytes);
    files.set(path, Uint8Array.from(bytes)); return { approved_page: lesson, page_id: `p${i + 1}`, sha256: bytesHash(bytes) };
  });
  const policy: QuestionPolicy = parseWire('question_policy', canonicalBytes({ v: 1, policy_id: 'founder-lessons-policy-v1', approved_at: day,
    approval_sha256: bytesHash(source.files.get('questions/questions.json')!), questions: questions.map((q) => {
      requireInput(bytesHash(encodeUtf8(q.text)) === q.sha256_of_utf8_text, 'QUESTION_HASH');
      return { question_id: q.id, text: q.text, question_sha256: q.sha256_of_utf8_text, template_values: { version: String(q.version) }, topic: 'harness-operations',
        allowed_origins: ['https://seller.example.invalid'], allowed_networks: ['devnet'], approval_sha256: bytesHash(source.files.get('questions/questions.json')!) };
    }) }));
  const proof = questions.map((q) => {
    const approved = resolveQuestion(policy, admissionInput(q.id, q.version));
    requireInput(approved.text === q.text, 'QUESTION_ADMISSION');
    const covered = new Set<string>(); let evidenceBytes = 0;
    const spans = sourceMap[q.id]!.map((span) => {
      requireInput(span.page === `lessons/${q.lesson}.md`, 'LESSON_MISMATCH');
      const page = mapping.find((p) => span.page === `lessons/${p.approved_page}.md`)!;
      const bytes = files.get(`pages/${page.page_id}.md`)!;
      requireInput(span.end_byte > span.start_byte && span.end_byte <= bytes.length, 'SPAN_RANGE');
      decodeUtf8(bytes.subarray(0, span.start_byte)); decodeUtf8(bytes.subarray(span.end_byte));
      const excerpt = bytes.subarray(span.start_byte, span.end_byte);
      requireInput(Buffer.from(excerpt).equals(Buffer.from(encodeUtf8(span.text))), 'SPAN_TEXT_MISMATCH');
      let offset = span.start_byte;
      for (const scalar of decodeUtf8(excerpt)) { covered.add(`${page.page_id}:${offset}`); offset += Buffer.byteLength(scalar); }
      evidenceBytes += excerpt.length;
      return { page_id: page.page_id as Id, byte_start: span.start_byte, byte_end: span.end_byte, text: span.text, text_sha256: bytesHash(excerpt), equal: true as const };
    });
    const concatenatedScalars = [...spans.map((s) => s.text).join('')].length;
    const renderedScalars = [...renderAnswer(spans.map((s, i) => ({ text: s.text, citation_ids: [`c${i + 1}` as Id] })))].length;
    requireInput(spans.length <= M03.sectionsMax.value && evidenceBytes <= M03.evidenceMax.value * 1024 && concatenatedScalars <= M03.answerScalarsMax.value && renderedScalars <= M03.answerScalarsMax.value && covered.size <= M03.quotedScalarsMax.value, 'EXTRACT_LIMIT');
    return { question_id: q.id, question_sha256: approved.question_sha256, spans, concatenated_scalars: concatenatedScalars, rendered_scalars: renderedScalars, quoted_scalars: covered.size };
  });
  const map: AnswerMap = parseAnswerMap(canonicalBytes({ v: 1, engine_version: 'founder-extractive-v1', entries: proof.map((p) => ({ question_id: p.question_id,
    question_sha256: p.question_sha256, support: 'supported', spans: p.spans.map(({ page_id, byte_start, byte_end }) => ({ page_id, byte_start, byte_end })) })) }));
  const negativeProof = negatives.map((n) => {
    requireInput(bytesHash(encodeUtf8(n.text)) === n.sha256_of_utf8_text, 'NEGATIVE_HASH');
    requireInput(n.category === 'version-mismatch' ? n.target_question_id !== undefined : n.target_question_id === undefined, 'NEGATIVE_TARGET');
    if (n.category === 'version-mismatch') {
      const target = questions.find((q) => q.id === n.target_question_id)!;
      requireInput(target.text === n.text && target.version !== n.version, 'NEGATIVE_VERSION');
    } else requireInput(!questions.some((q) => q.text === n.text), 'NEGATIVE_SUPPORTED_TEXT');
    let rejected = false;
    try { resolveQuestion(policy, admissionInput(n.target_question_id ?? n.id, n.version)); } catch { rejected = true; }
    requireInput(rejected && !map.entries.some((e) => e.question_id === n.id), 'NEGATIVE_ADMITTED');
    // Do not reproduce unapproved negative text/hash in the output packet.
    return { control_id: n.id, disposition: 'local_reject' as const, mapped_spans: 0, signer_calls: 0, network_calls: 0 };
  });
  files.set('answer-map.json', canonicalBytes(map)); files.set('question-policy.json', canonicalBytes(policy));
  const bundle = buildManifest({ seller_id: 'founder' as Id, slice_id: 'founder-lessons-v1' as Id, version: 1, previous_manifest_hash: null, created_at: day,
    gate_version: 'gate2' as Id, approval_id: 'pending-founder-projection-v1' as Id }, files);
  const worksheet: ReviewRow[] = mapping.map((p) => ({ page_id: p.page_id as Id, visibility: 'public', origin: 'personal-public', sensitivity: 'none', review_status: 'approved',
    derived_from: 'founder-private-map', reviewer: 'founder' as Id, last_reviewed: day, license: 'CC BY 4.0', right_to_sell: attestation }));
  createReviewPacket(bundle, worksheet);
  // Companion worksheet, outside the publisher inventory: frozen ReviewRow and
  // Manifest have no source-ID field. Never add source names to public pages/map.
  const worksheetMapping = { worksheet_sha256: payloadHash(worksheet), pages: mapping };
  return { bundle, worksheet, worksheetMapping, proof: { state: 'inert-not-approved-for-publication', sources: source.pins, questions: proof, negatives: negativeProof,
    negative_source_approved: false, supported: proof.length, local_rejected: negativeProof.length } };
}
export function buildRealProjection(sourceRoot: string, approvalIndex: string, outputRoot: string) {
  const index = regularBytes(resolve(approvalIndex), M03.sealedPayloadMax.value * 1024 * 1024);
  const result = createProjection(loadApprovedSources(resolve(sourceRoot), index));
  const output = resolve(outputRoot); realDirectory(resolve(output, '..'));
  // No overwrite/resume into a partially written packet. All checks precede writes.
  mkdirSync(output, { mode: 0o700 }); mkdirSync(join(output, 'real'), { mode: 0o700 });
  stageBundle(result.bundle, join(output, 'real'));
  writeExclusive(join(output, 'manifest.json'), canonicalBytes(result.bundle.manifest));
  writeExclusive(join(output, 'worksheet.json'), canonicalBytes(result.worksheet));
  writeExclusive(join(output, 'worksheet-mapping.json'), canonicalBytes(result.worksheetMapping));
  writeExclusive(join(output, 'span-proof.json'), canonicalBytes(result.proof));
  return { output, manifest_sha256: payloadHash(result.bundle.manifest), inventory_sha256: payloadHash(result.bundle.manifest.files), supported: result.proof.supported, local_rejected: result.proof.local_rejected };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); requireInput(args.length === 3, 'USAGE_SOURCE_INDEX_NEW_OUTPUT');
    console.log(JSON.stringify(buildRealProjection(args[0]!, args[1]!, args[2]!)));
  } catch (error) { console.error(error instanceof Error ? error.message : 'PROJECTION_FAILED_CLOSED'); process.exitCode = 1; }
}
