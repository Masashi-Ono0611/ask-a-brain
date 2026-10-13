/** Knowledge admission stays separate from task/rubric state. No free summaries,
 * newly selected spans, generated advice, or private-brain fallback. */
import { bytesHash, canonicalBytes, renderAnswer, strictJson } from '../../../src/wire/index.ts';
import type { Id } from '../../../src/wire/contracts.ts';
import { checklist, parseCorpus } from '../../../src/eval/index.ts';
import { requireCondition } from './adapter.ts';
export const questionSourceHash = 'fc267d1f9ccbc10a0e55c9584a4cfd9abd36df96469c7a8c2ddfe895d53f6ac7';
export const answerMapSourceHash = '1825a74fa6d2f3f420d2182fbf98d54f784c94901cb91b76220ca7a697a94c49';
export const lessonHashes = Object.freeze({
  L1: 'dce6195597ebff15ae123651af03a7c8ec7546ddf9ad68706d341678de210ff8', L2: 'f0db27f4faa4304bb853c2dc5818b321610d9a53393eaf248176ab29d6d7cece',
  L3: '318cf8ec46d9f2395d27ccccd8e207cc404ee43dca7b7591a9a1ab3e508f9d36', L4: '2296b2cbe5291d7e23148a5d29a73596f23b2575da8609ad8c0729006a783c64',
  L5: '6efc1a09ab011b435adc795fdf0fbe9ab1a0c7ddd800c1fe969d29e2363a1f04',
});
export function approvedPages(lessons: ReadonlyMap<string, Uint8Array>) {
  requireCondition(lessons.size === Object.keys(lessonHashes).length, 'CORPUS_SET_MISMATCH');
  return Object.entries(lessonHashes).map(([page_id, hash]) => {
    const bytes = lessons.get(page_id); requireCondition(bytes && bytesHash(bytes) === hash, 'LESSON_APPROVAL_MISMATCH');
    return { page_id: page_id as Id, text: new TextDecoder('utf8', { fatal: true }).decode(bytes), sha256: bytesHash(bytes) };
  });
}
export function approvedKnowledge(lessons: ReadonlyMap<string, Uint8Array>, questions: Uint8Array | null, map: Uint8Array | null) {
  requireCondition(questions && map, 'APPROVED_QUESTIONS_AND_MAP_REQUIRED');
  requireCondition(bytesHash(questions) === questionSourceHash && bytesHash(map) === answerMapSourceHash, 'QUESTION_MAP_APPROVAL_MISMATCH');
  strictJson(questions); // Pinned exact source; the lead supplies its policy projection separately.
  const corpus = parseCorpus(canonicalBytes({ v: 1, pages: approvedPages(lessons), map: strictJson(map) }));
  return {
    read_checklist: (question: Id) => checklist(corpus, question),
    /** Expected paid payload for comparison only; this is never a fake paid consult. */
    expected_paid_support: (question: Id) => {
      const selected = checklist(corpus, question);
      const excerpts = selected.selection.spans.map((span) => {
        const page = selected.pages.find((p) => p.page_id === span.page_id)!;
        return Buffer.from(page.text).subarray(span.byte_start, span.byte_end).toString('utf8');
      });
      return { selection: selected.selection, excerpts, text: renderAnswer(excerpts.map((text, i) => ({ text, citation_ids: [`c${i}` as Id] }))) };
    },
  };
}
