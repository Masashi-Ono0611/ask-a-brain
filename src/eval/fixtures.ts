import { bytesHash, M03, payloadHash } from '../wire/index.ts';
import { parseAnswerMap } from '../common/index.ts';
import type { Id } from '../wire/contracts.ts';
import type { Corpus, Files, Fixture, MatchedChecklist, Predicate, Rubric } from './types.ts';
import { array, hash, id, immutable, object, parse, requireEval, text } from './validation.ts';
function files(input: unknown): Files {
  requireEval(input !== null && typeof input === 'object' && !Array.isArray(input));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) { id(key); result[key] = text(value); }
  requireEval(Object.keys(result).length > 0); return result;
}
function predicates(input: unknown): readonly Predicate[] {
  return array(input).map((item) => { const row = object(item, ['file_id', 'equals']); return { file_id: id(row.file_id), equals: text(row.equals) }; });
}
export function parseFixture(bytes: Uint8Array): Fixture {
  const f = object(parse(bytes), ['v', 'fixture_id', 'label', 'family_id', 'prompt', 'files', 'fixes', 'checks', 'leftovers']);
  requireEval(f.v === 1 && f.label === 'synthetic'); const initial = files(f.files);
  const fixes = array(f.fixes).map((item) => { const row = object(item, ['fix_id', 'description', 'changes']);
    const changes = files(row.changes); requireEval(Object.keys(changes).every((key) => Object.hasOwn(initial, key)));
    return { fix_id: id(row.fix_id), description: text(row.description), changes }; });
  requireEval(new Set(fixes.map((fix) => fix.fix_id)).size === fixes.length);
  const checks = predicates(f.checks), leftovers = predicates(f.leftovers);
  requireEval(checks.length > 0 && [...checks, ...leftovers].every((p) => Object.hasOwn(initial, p.file_id)));
  return immutable({ v: 1, fixture_id: id(f.fixture_id), label: 'synthetic', family_id: id(f.family_id), prompt: text(f.prompt), files: initial, fixes, checks, leftovers });
}
export function parseRubric(bytes: Uint8Array, fixture: Fixture): Rubric {
  const r = object(parse(bytes), ['v', 'fixture_id', 'label', 'canary', 'pass', 'fail', 'critical_regression']);
  requireEval(r.v === 1 && r.label === 'synthetic' && r.fixture_id === fixture.fixture_id);
  const pass = predicates(r.pass), fail = predicates(r.fail), critical_regression = predicates(r.critical_regression);
  requireEval(pass.length > 0 && [...pass, ...fail, ...critical_regression].every((p) => Object.hasOwn(fixture.files, p.file_id)));
  return immutable({ v: 1, fixture_id: fixture.fixture_id, label: 'synthetic', canary: text(r.canary), pass, fail, critical_regression });
}
export function parseCorpus(bytes: Uint8Array): Corpus {
  const c = object(parse(bytes), ['v', 'pages', 'map']); requireEval(c.v === 1);
  const pages = array(c.pages).map((item) => { const p = object(item, ['page_id', 'text', 'sha256']); const content = text(p.text);
    requireEval(Buffer.byteLength(content) <= M03.pageMax.value * 1024 && bytesHash(Buffer.from(content)) === hash(p.sha256), 'CORPUS_MISMATCH');
    return { page_id: id(p.page_id), text: content, sha256: hash(p.sha256) }; });
  requireEval(pages.length > 0 && new Set(pages.map((p) => p.page_id)).size === pages.length);
  const map = parseAnswerMap(Buffer.from(JSON.stringify(c.map)));
  requireEval(new Set(map.entries.map((entry) => entry.question_id)).size === map.entries.length);
  for (const entry of map.entries) {
    let size = 0;
    for (const span of entry.spans) {
      const page = pages.find((p) => p.page_id === span.page_id); requireEval(page, 'CORPUS_MISMATCH');
      const content = Buffer.from(page.text); requireEval(span.byte_end <= content.length, 'CORPUS_MISMATCH');
      const decoder = new TextDecoder('utf8', { fatal: true });
      decoder.decode(content.subarray(0, span.byte_start)); decoder.decode(content.subarray(span.byte_start, span.byte_end));
      size += span.byte_end - span.byte_start;
    }
    requireEval(size <= M03.evidenceMax.value * 1024, 'CORPUS_MISMATCH');
  }
  return immutable({ v: 1, pages, map });
}
export function checklist(corpus: Corpus, question: Id): MatchedChecklist {
  const selection = corpus.map.entries.find((entry) => entry.question_id === question); requireEval(selection, 'QUESTION_DENIED');
  return immutable({ question_id: question, pages: corpus.pages, selection, corpus_sha256: payloadHash(corpus), map_sha256: payloadHash(corpus.map) });
}
export function matches(files: Files, predicate: Predicate): boolean { return files[predicate.file_id] === predicate.equals; }
