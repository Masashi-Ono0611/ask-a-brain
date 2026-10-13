/** Pure approved-byte extraction. No storage, key, network, environment or inference capability. */
import { createHash } from 'node:crypto';
import type { Answer, ApprovedQuestion, AnswerContext, Decline, Id, PreparedAnswer, SealedBundle, Sha256 } from '../wire/contracts.ts';
import type { AnswerMap, PreparationConfig } from './ports.ts';
import { jsonValue } from './ports.ts';
import { renderAnswer } from '../wire/index.ts';

export function digest(bytes: Uint8Array | string): Sha256 { return createHash('sha256').update(bytes).digest('hex') as Sha256; }
export function utf8(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) throw new Error('INVALID_INPUT');
  return text;
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error('INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function opaque(value: unknown): Id {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_INPUT');
  return value as Id;
}
export function decline(): Decline { return { status: 'declined', abstain: true, quote: null, charged_atomic: '0' as Decline['charged_atomic'], reason: 'unavailable' }; }
export function pagePath(pageId: Id): string { return `pages/${opaque(pageId)}.md`; }
export function pageUrl(origin: string, slice: Id, page: Id): string { return `${origin}/v1/slices/${opaque(slice)}/pages/${opaque(page)}`; }
export function loadMap(bundle: SealedBundle, config: PreparationConfig): AnswerMap {
  const bytes = bundle.files.get('answer-map.json');
  if (!bytes) throw new Error('NOT_READY');
  const map = object(config.wire.json(bytes), ['v', 'engine_version', 'entries']);
  if (map.v !== 1 || !Array.isArray(map.entries)) throw new Error('INVALID_INPUT');
  opaque(map.engine_version);
  const seen = new Set<string>();
  for (const candidate of map.entries) {
    const row = object(candidate, ['question_id', 'question_sha256', 'support', 'spans']);
    opaque(row.question_id);
    if (typeof row.question_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.question_sha256) || !['supported', 'declined', 'stale', 'contradictory'].includes(String(row.support)) || !Array.isArray(row.spans)) throw new Error('INVALID_INPUT');
    const key = `${row.question_id}:${row.question_sha256}`;
    if (seen.has(key)) throw new Error('INVALID_INPUT'); seen.add(key);
    if (row.spans.length > config.limits.sectionsMax.value || (row.support !== 'supported' && row.spans.length !== 0)) throw new Error('INVALID_INPUT');
    for (const candidateSpan of row.spans) {
      const span = object(candidateSpan, ['page_id', 'byte_start', 'byte_end']); opaque(span.page_id);
      if (!Number.isSafeInteger(span.byte_start) || !Number.isSafeInteger(span.byte_end) || Number(span.byte_start) < 0 || Number(span.byte_end) <= Number(span.byte_start)) throw new Error('INVALID_INPUT');
    }
  }
  return map as unknown as AnswerMap;
}
export function validatePublicBundle(bundle: SealedBundle, config: PreparationConfig): void {
  const { payload: manifest } = bundle.manifest; const L = config.limits;
  if (manifest.pages.length < L.slicePagesMin.value || manifest.pages.length > L.slicePagesMax.value || bundle.files.size !== manifest.files.length || manifest.files.length > L.chunksMax.value) throw new Error('NOT_READY');
  if (config.wire.hash(jsonValue(manifest.files)) !== bundle.scans.bundle_sha256 || config.wire.hash(jsonValue(manifest)) !== bundle.approval.payload_sha256 || manifest.approval_id !== bundle.approval.approval_id || bundle.approval.actor !== 'human' || bundle.scans.passed !== true) throw new Error('NOT_READY');
  if (manifest.files.map((f) => f.path).join('\n') !== manifest.files.map((f) => f.path).sort().join('\n')) throw new Error('NOT_READY');
  const paths = new Set<string>(); let total = 0;
  for (const file of manifest.files) {
    if (!/^(pages\/[A-Za-z0-9_-]+\.md|answer-map\.json|question-policy\.json)$/.test(file.path) || paths.has(file.path)) throw new Error('NOT_READY');
    paths.add(file.path); const bytes = bundle.files.get(file.path);
    if (!bytes || bytes.length !== file.size_bytes || digest(bytes) !== file.sha256) throw new Error('NOT_READY');
    utf8(bytes); total += bytes.length;
  }
  if (total > L.sealedPayloadMax.value * 1024 * 1024) throw new Error('NOT_READY');
  const ids = new Set<string>();
  for (const page of manifest.pages) {
    const path = pagePath(page.page_id); const bytes = bundle.files.get(path);
    if (ids.has(page.page_id) || !paths.has(path) || !bytes || bytes.length !== page.size_bytes || bytes.length > L.pageMax.value * 1024 || digest(bytes) !== page.content_sha256) throw new Error('NOT_READY');
    ids.add(page.page_id);
  }
  if ([...paths].filter((p) => p.startsWith('pages/')).length !== ids.size) throw new Error('NOT_READY');
  const policyBytes = bundle.files.get('question-policy.json');
  if (!policyBytes) throw new Error('NOT_READY');
  const policy = config.wire.parse('question_policy', policyBytes);
  if (config.wire.hash(jsonValue(policy)) !== manifest.policy_sha256) throw new Error('NOT_READY');
  const map = loadMap(bundle, config); const chunks = new Set<string>();
  for (const entry of map.entries) for (const span of entry.spans) {
    const bytes = bundle.files.get(pagePath(span.page_id));
    if (!ids.has(span.page_id) || !bytes || span.byte_end > bytes.length) throw new Error('NOT_READY');
    utf8(bytes.subarray(0, span.byte_start)); utf8(bytes.subarray(span.byte_end));
    chunks.add(`${span.page_id}:${span.byte_start}:${span.byte_end}`);
  }
  if (chunks.size > L.chunksMax.value) throw new Error('NOT_READY');
}
export function prepareAnswer(bundle: SealedBundle, question: ApprovedQuestion, context: AnswerContext, config: PreparationConfig): PreparedAnswer | Decline {
  validatePublicBundle(bundle, config);
  const map = loadMap(bundle, config); const L = config.limits; const manifest = bundle.manifest.payload;
  const questionBytes = new TextEncoder().encode(question.text);
  const policy = config.wire.parse('question_policy', bundle.files.get('question-policy.json')!);
  if (questionBytes.length > L.questionBytesMax.value * 1024 || [...question.text].length > L.questionScalarsMax.value || digest(questionBytes) !== question.question_sha256 || !question.allowed_origins.includes(config.origin) || !policy.questions.some((q) => config.wire.hash(jsonValue(q)) === config.wire.hash(jsonValue(question)))) return decline();
  const entry = map.entries.find((row) => row.question_id === question.question_id && row.question_sha256 === question.question_sha256);
  if (!entry || entry.support !== 'supported') return decline();
  if (entry.spans.length < L.citationsMin.value || entry.spans.length > L.citationsMax.value) return decline();
  const covered = new Map<Id, Set<number>>(); let evidence = 0;
  const citations = entry.spans.map((span, index) => {
    const page = manifest.pages.find((p) => p.page_id === span.page_id); const bytes = bundle.files.get(pagePath(span.page_id));
    if (!page || !bytes || span.byte_end > bytes.length) throw new Error('INVALID_INPUT');
    // Prefix and suffix decoding proves both exclusive offsets are scalar boundaries.
    utf8(bytes.subarray(0, span.byte_start)); utf8(bytes.subarray(span.byte_end));
    const excerpt = utf8(bytes.subarray(span.byte_start, span.byte_end)); evidence += span.byte_end - span.byte_start;
    const positions = covered.get(span.page_id) ?? new Set<number>(); covered.set(span.page_id, positions);
    let offset = span.byte_start;
    for (const scalar of excerpt) { positions.add(offset); offset += new TextEncoder().encode(scalar).length; }
    return { id: `c${index + 1}` as Id, ...span, content_sha256: page.content_sha256, excerpt, source_url: pageUrl(config.origin, manifest.slice_id, span.page_id) };
  });
  const claims = citations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }));
  const answer: Answer = { v: 1, ...context, seller_id: manifest.seller_id, question_sha256: question.question_sha256, slice_id: manifest.slice_id,
    manifest_sha256: config.wire.hash(jsonValue(manifest)), answer: renderAnswer(claims),
    claims, citations, abstain: false, engine_version: map.engine_version };
  if (evidence > L.evidenceMax.value * 1024 || [...answer.answer].length > L.answerScalarsMax.value || [...covered.values()].reduce((n, s) => n + s.size, 0) > L.quotedScalarsMax.value) return decline();
  return { answer, answer_sha256: config.wire.hash(jsonValue(answer)) };
}
