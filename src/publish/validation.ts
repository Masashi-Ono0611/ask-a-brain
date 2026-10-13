import type { BundleInput, Id, Manifest, PublicApproval, ScanAttestation, ValidatedBundle } from '../wire/contracts.ts';
import { M03, bytesHash, canonicalBytes, parseWire, payloadHash, renderAnswer, validatePayload } from '../wire/index.ts';
import { decodeUtf8, parseAnswerMap } from '../common/index.ts';

export function requirePublish(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
export function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  canonicalBytes(value);
  requirePublish(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_RECORD');
  const row = value as Record<string, unknown>;
  requirePublish(Object.keys(row).length === fields.length && fields.every((k) => Object.hasOwn(row, k)), 'INVALID_FIELDS'); return row;
}
export function hash(value: unknown): void { requirePublish(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_HASH'); }
export function id(value: unknown): void { requirePublish(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'INVALID_ID'); }
export function time(value: unknown): void { requirePublish(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'INVALID_TIME'); }
export function publicPath(path: string): void { requirePublish(/^(pages\/[A-Za-z0-9_-]+\.md|answer-map\.json|question-policy\.json)$/.test(path), 'INVALID_PUBLIC_PATH'); }
/** Deliberately conservative plain Markdown subset. This is NOT a PII classifier. */
export function guardText(bytes: Uint8Array, page = false): void {
  const text = decodeUtf8(bytes);
  requirePublish(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text), 'UNSAFE_CONTROL');
  requirePublish(!/AAB_(?:BUSINESS|PRIVATE|SCAN)_CANARY|confidential|internal.only|customer[ _-]?(?:name|list|data)|employee[ _-]?data|顧客|社外秘|機密|個人情報|取引先|従業員/i.test(text), 'BUSINESS_MARKER');
  requirePublish(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+\d[\d ()-]{7,}\d|\b0\d{1,3}[- ()]\d{2,4}[- ]\d{3,4}\b)/i.test(text.replace(/[a-f0-9]{64}/g, '')), 'PII_MARKER');
  requirePublish(!/derived_from|backlinks?|parent[_ -]?(?:hash|count|slug)|source[_ -]?(?:path|file)|private[_ -]?(?:hash|path)|(?:\/Users\/|\/home\/|[A-Z]:\\|~\/)|gbrain:\/\//i.test(text), 'PROVENANCE_LEAK');
  if (page) {
    // No inline/reference/wiki links, images, HTML, front matter, transclusion,
    // URLs, Markdown escapes/entities that could hide any of those constructs.
    requirePublish(!/[<>\[\]\\]|&(?:#\w+|\w+);|(?:https?|file|data|javascript):|www\.|!\{|\{\{|^---\s*$/im.test(text), 'ACTIVE_OR_LINKED_CONTENT');
    requirePublish(text.trim().length > 0, 'EMPTY_PAGE');
  }
}
export function cloneInput(input: BundleInput): BundleInput {
  return { manifest: structuredClone(input.manifest), files: new Map([...input.files].map(([p, b]) => [p, Uint8Array.from(b)])) };
}
export function validateInput(input: BundleInput): BundleInput {
  const manifest = validatePayload('manifest', input.manifest);
  [manifest.seller_id, manifest.slice_id, manifest.gate_version, manifest.approval_id].forEach(id);
  requirePublish(input.files instanceof Map && input.files.size === manifest.files.length, 'INVENTORY_MISMATCH');
  requirePublish(manifest.files.length <= M03.chunksMax.value, 'CHUNK_LIMIT');
  const pageIds = new Set(manifest.pages.map((p) => p.page_id));
  requirePublish(manifest.files.length === manifest.pages.length + 2, 'INVENTORY_MISMATCH');
  for (const file of manifest.files) {
    publicPath(file.path); const bytes = input.files.get(file.path);
    requirePublish(bytes && bytes.length === file.size_bytes && bytesHash(bytes) === file.sha256, 'FILE_CHANGED');
    guardText(bytes, file.path.startsWith('pages/'));
  }
  for (const page of manifest.pages) {
    id(page.page_id); const bytes = input.files.get(`pages/${page.page_id}.md`);
    requirePublish(bytes && bytes.length === page.size_bytes && bytesHash(bytes) === page.content_sha256, 'PAGE_MISMATCH');
  }
  const policyBytes = input.files.get('question-policy.json'); const mapBytes = input.files.get('answer-map.json');
  requirePublish(policyBytes && mapBytes, 'MISSING_POLICY_MAP');
  const policy = parseWire('question_policy', policyBytes);
  for (const question of policy.questions) {
    guardText(Buffer.from(question.text), true); guardText(Buffer.from(question.topic), true);
    Object.values(question.template_values).forEach((value) => guardText(Buffer.from(value), true));
  }
  requirePublish(bytesHash(policyBytes) === payloadHash(policy) && manifest.policy_sha256 === payloadHash(policy), 'POLICY_NOT_CANONICAL');
  const map = parseAnswerMap(mapBytes); const questions = new Set(policy.questions.map((q) => `${q.question_id}:${q.question_sha256}`));
  requirePublish(questions.size === map.entries.length && map.entries.every((e) => questions.has(`${e.question_id}:${e.question_sha256}`)), 'MAP_POLICY_MISMATCH');
  const indexed = new Set<string>(); const chunks = new Set<string>();
  for (const entry of map.entries) {
    if (entry.support !== 'supported') continue;
    requirePublish(entry.spans.length >= M03.citationsMin.value && entry.spans.length <= M03.citationsMax.value, 'CITATION_LIMIT');
    let evidence = 0; const covered = new Set<string>(); const excerpts: string[] = [];
    for (const span of entry.spans) {
      const bytes = input.files.get(`pages/${span.page_id}.md`);
      requirePublish(pageIds.has(span.page_id) && bytes && span.byte_end <= bytes.length, 'SPAN_OUTSIDE_PAGE');
      decodeUtf8(bytes.subarray(0, span.byte_start)); decodeUtf8(bytes.subarray(span.byte_end));
      const excerpt = decodeUtf8(bytes.subarray(span.byte_start, span.byte_end)); excerpts.push(excerpt);
      let offset = span.byte_start;
      for (const scalar of excerpt) { covered.add(`${span.page_id}:${offset}`); offset += Buffer.byteLength(scalar); }
      evidence += span.byte_end - span.byte_start; indexed.add(span.page_id); chunks.add(`${span.page_id}:${span.byte_start}:${span.byte_end}`);
    }
    const rendered = renderAnswer(excerpts.map((text, index) => ({ text, citation_ids: [`c${index + 1}` as Id] })));
    requirePublish(evidence <= M03.evidenceMax.value * 1024 && covered.size <= M03.quotedScalarsMax.value && [...rendered].length <= M03.answerScalarsMax.value, 'EXTRACT_LIMIT');
  }
  requirePublish(indexed.size === pageIds.size && chunks.size <= M03.chunksMax.value, 'UNINDEXED_PAGE');
  return cloneInput({ manifest, files: input.files });
}
/** Structural/hash admission only. Human authority is supplied by createPublisher,
 * never inferred from this record or a green scanner result. */
export function validateBundle(input: BundleInput, approval: PublicApproval, scans: ScanAttestation): ValidatedBundle {
  const snapshot = validateInput(input);
  record(approval, ['approval_id', 'payload_sha256', 'approved_at', 'actor']); id(approval.approval_id); hash(approval.payload_sha256); time(approval.approved_at);
  record(scans, ['bundle_sha256', 'scanner_version', 'scanner_sha256', 'scanned_at', 'passed']); hash(scans.bundle_sha256); hash(scans.scanner_sha256); time(scans.scanned_at);
  requirePublish(approval.actor === 'human' && approval.approval_id === snapshot.manifest.approval_id && approval.payload_sha256 === payloadHash(snapshot.manifest), 'APPROVAL_MISMATCH');
  requirePublish(scans.passed === true && typeof scans.scanner_version === 'string' && scans.scanner_version.length > 0 && scans.bundle_sha256 === payloadHash(snapshot.manifest.files), 'SCAN_MISMATCH');
  return { ...snapshot, approval: structuredClone(approval), scans: structuredClone(scans) };
}
export type ManifestMetadata = Omit<Manifest, 'v' | 'pages' | 'files' | 'policy_sha256'>;
export function buildManifest(metadata: ManifestMetadata, files: ReadonlyMap<string, Uint8Array>): BundleInput {
  const inventory = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, size_bytes: bytes.length, sha256: bytesHash(bytes) }));
  const policy = files.get('question-policy.json'); requirePublish(policy, 'MISSING_POLICY_MAP');
  return validateInput({ manifest: { ...metadata, v: 1, policy_sha256: bytesHash(policy), files: inventory,
    pages: inventory.filter((f) => f.path.startsWith('pages/')).map((f) => ({ page_id: f.path.slice(6, -3) as Manifest['pages'][number]['page_id'], content_sha256: f.sha256, size_bytes: f.size_bytes })) }, files });
}
