import test from 'node:test';
import assert from 'node:assert/strict';
import type { Answer, ArtifactChain, Id, Manifest, Signed } from '../../src/wire/index.ts';
import { M03, bytesHash, canonicalBytes, payloadHash, renderAnswer, validatePayload, validateWire, verifyAnswerCommitment, verifyArtifactChain, verifyCitations } from '../../src/wire/index.ts';
import { makeGolden } from './golden-fixture.ts';
const fixture = makeGolden();
const original = fixture.chain;
const id = (s: string) => s as Id;
const fakeSignature = original.answer.signature;
function spanFixture(page: Uint8Array, spans: { start: number; end: number }[]) {
  const pageId = original.answer.payload.citations[0]!.page_id;
  const hash = bytesHash(page);
  const manifest: Signed<Manifest> = { ...original.manifest, payload: { ...original.manifest.payload,
    pages: original.manifest.payload.pages.map((p) => p.page_id === pageId ? { ...p, content_sha256: hash, size_bytes: page.length } : p),
    files: original.manifest.payload.files.map((f) => f.path === `pages/${pageId}.md` ? { ...f, sha256: hash, size_bytes: page.length } : f),
  } };
  const citations = spans.map((span, i) => ({ ...original.answer.payload.citations[0]!, id: id(`c${i + 1}`), content_sha256: hash, byte_start: span.start, byte_end: span.end, excerpt: Buffer.from(page.subarray(span.start, span.end)).toString('utf8') }));
  const claims = citations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }));
  const answer: Signed<Answer> = { payload: { ...original.answer.payload, manifest_sha256: payloadHash(manifest.payload), answer: renderAnswer(claims), claims, citations }, signature: fakeSignature };
  return { answer, manifest, pages: new Map<Id, Uint8Array>([[pageId, page]]) };
}
function check(spans: ReturnType<typeof spanFixture>) { verifyCitations(spans.answer, spans.manifest, spans.pages); }
test('Japanese and astral UTF-8 citations pass exact bytes; same-length shifted boundary and excerpt fail', () => {
  verifyCitations(original.answer, original.manifest, original.pages);
  const bad = structuredClone(original.answer);
  const c = bad.payload.citations[0]!;
  const shifted = { ...bad, payload: { ...bad.payload, citations: [{ ...c, byte_start: c.byte_start + 1, byte_end: c.byte_end + 1 }] } };
  assert.throws(() => verifyCitations(shifted, original.manifest, original.pages), /SPAN_UTF8_BOUNDARY/);
  verifyCitations(original.answer, original.manifest, original.pages);
  const changed = { ...c, excerpt: c.excerpt.replace('完', '未') }; const claims = [{ text: changed.excerpt, citation_ids: [c.id] }];
  assert.throws(() => verifyCitations({ ...bad, payload: { ...bad.payload, citations: [changed], claims, answer: renderAnswer(claims) } }, original.manifest, original.pages), /SPAN_EXCERPT_MISMATCH/);
  verifyCitations(original.answer, original.manifest, original.pages);
});
test('hash, manifest binding, missing page and out-of-bounds guards restore clean bytes', () => {
  const firstId = original.answer.payload.citations[0]!.page_id;
  const corrupted = new Map(original.pages); const bytes = Buffer.from(corrupted.get(firstId)!); bytes[0] = bytes[0]! ^ 1; corrupted.set(firstId, bytes);
  assert.throws(() => verifyCitations(original.answer, original.manifest, corrupted), /PAGE_HASH_MISMATCH/);
  assert.throws(() => verifyCitations(original.answer, original.manifest, new Map()), /MISSING_PAGE/);
  assert.throws(() => verifyCitations({ ...original.answer, payload: { ...original.answer.payload, manifest_sha256: bytesHash(Buffer.from('wrong')) } }, original.manifest, original.pages), /MANIFEST_BINDING/);
  const c = original.answer.payload.citations[0]!; const far = { ...c, byte_start: 60000, byte_end: 60000 + Buffer.byteLength(c.excerpt) };
  assert.throws(() => verifyCitations({ ...original.answer, payload: { ...original.answer.payload, citations: [far] } }, original.manifest, original.pages), /SPAN_BOUNDS/);
  verifyCitations(original.answer, original.manifest, original.pages);
});
test('page hash uses exact bytes; no Unicode/newline/BOM normalization and invalid UTF-8 outside span fails', () => {
  const page = Buffer.from('é\ne\u0301\n日本🧠\n'); const valid = spanFixture(page, [{ start: 0, end: 2 }]); check(valid);
  const first = valid.answer.payload.citations[0]!.page_id;
  for (const mutated of [Buffer.from(page.toString().normalize('NFD')), Buffer.from(page.toString().replaceAll('\n', '\r\n')), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), page])]) {
    assert.throws(() => verifyCitations(valid.answer, valid.manifest, new Map([[first, mutated]])), /PAGE_HASH_MISMATCH/); check(valid);
  }
  const malformed = Buffer.concat([page, Buffer.from([0xff])]); const bad = spanFixture(malformed, [{ start: 0, end: 2 }]);
  assert.throws(() => check(bad), /INVALID_UTF8/); check(valid);
  const bom = spanFixture(Buffer.from('\ufeff日本'), [{ start: 3, end: 9 }]); check(bom); // BOM stays part of page hash.
});
test('quoted scalar union cap counts overlaps once and disjoint source positions separately', () => {
  const limit = M03.quotedScalarsMax.value;
  const page = Buffer.from('a'.repeat(limit + 1));
  const good = spanFixture(page, [{ start: 0, end: limit }]); check(good);
  const over = spanFixture(page, [{ start: 0, end: limit + 1 }]); assert.throws(() => check(over), /INVALID_WIRE_RECORD/); check(good);
  const overlap = spanFixture(page, [{ start: 0, end: 600 }, { start: 400, end: limit }]); check(overlap);
  const disjoint = spanFixture(Buffer.from('a'.repeat(limit + 10)), [{ start: 0, end: 500 }, { start: 501, end: limit + 2 }]);
  assert.throws(() => check(disjoint), /INVALID_WIRE_RECORD/); check(overlap);
  // Astral characters count one scalar, not two UTF-16 code units.
  const brain = spanFixture(Buffer.from('🧠'.repeat(100)), [{ start: 0, end: 400 }]); check(brain);
});
test('page and total-fetch caps have exact-limit clean counterparts', () => {
  const maximum = M03.citedPageMax.value * 1024;
  const good = spanFixture(Buffer.from('a'.repeat(maximum)), [{ start: 0, end: 1 }]); check(good);
  const overflowPages = new Map(good.pages); overflowPages.set(id('oversized'), Buffer.alloc(maximum + 1));
  assert.throws(() => verifyCitations(good.answer, good.manifest, overflowPages), /PAGE_LIMIT/); check(good);
  const full = new Map(good.pages); const fetchMax = M03.citationFetchTotalMax.value * 1024;
  for (let n = 1; n < fetchMax / maximum; n++) full.set(id(`extra-${n}`), Buffer.alloc(maximum));
  verifyCitations(good.answer, good.manifest, full);
  const tooMany = new Map(full); tooMany.set(id('extra-over'), Buffer.alloc(1));
  assert.throws(() => verifyCitations(good.answer, good.manifest, tooMany), /FETCH_LIMIT/);
  verifyCitations(good.answer, good.manifest, full);
});
test('answer rendering, section/citation/output/envelope caps reject overage with control', () => {
  const a = original.answer.payload;
  const citation = a.citations[0]!;
  const overCitations = Array.from({ length: M03.citationsMax.value + 1 }, (_, i) => ({ ...citation, id: id(`c${i}`) }));
  const claims = overCitations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }));
  assert.throws(() => validatePayload('answer', { ...a, citations: overCitations, claims, answer: renderAnswer(claims) }));
  assert.doesNotThrow(() => validatePayload('answer', a));
  const tooManyClaims = Array.from({ length: M03.sectionsMax.value + 1 }, () => a.claims[0]!);
  assert.throws(() => validatePayload('answer', { ...a, claims: tooManyClaims, answer: renderAnswer(tooManyClaims) }));
  const maxClaims = tooManyClaims.slice(1); assert.doesNotThrow(() => validatePayload('answer', { ...a, claims: maxClaims, answer: renderAnswer(maxClaims) }));
  // Render label occupies five scalars: space + [c1].
  const forLength = (length: number, char: string) => {
    const excerpt = char.repeat(length - 5); const claims = [{ text: excerpt, citation_ids: [id('c1')] }];
    return { ...a, citations: [{ ...citation, byte_start: 0, byte_end: Buffer.byteLength(excerpt), excerpt }], claims, answer: renderAnswer(claims) };
  };
  const outputLength = (length: number) => {
    const contentLength = length - 17; // three five-scalar labels plus two newlines
    const lengths = [Math.ceil(contentLength / 3), Math.floor(contentLength / 3), contentLength - Math.ceil(contentLength / 3) - Math.floor(contentLength / 3)];
    const citations = lengths.map((n, i) => ({ ...citation, id: id(`c${i + 1}`), byte_start: 0, byte_end: n, excerpt: 'a'.repeat(n) }));
    const claims = citations.map((c) => ({ text: c.excerpt, citation_ids: [c.id] }));
    return { ...a, claims, citations, answer: renderAnswer(claims) };
  };
  assert.doesNotThrow(() => validatePayload('answer', outputLength(M03.answerScalarsMax.value)));
  assert.throws(() => validatePayload('answer', outputLength(M03.answerScalarsMax.value + 1)));
  assert.doesNotThrow(() => validatePayload('answer', outputLength(M03.answerScalarsMax.value)));
  const huge = forLength(1000, '日');
  assert.doesNotThrow(() => validatePayload('answer', huge));
  assert.throws(() => validateWire('answer', { payload: huge, signature: fakeSignature }));
  assert.doesNotThrow(() => validateWire('answer', original.answer));
});
test('salt and content mutations break commitment even with fresh valid signature; correct commitment passes', () => {
  for (const patch of [{ commitment_salt: Buffer.alloc(16, 2).toString('base64url') }, { engine_version: 'new-map' }]) {
    const changed = fixture.seal('answer', { ...original.answer.payload, ...patch });
    assert.throws(() => verifyAnswerCommitment(original.quote, changed), /ANSWER_COMMITMENT/);
    verifyAnswerCommitment(original.quote, original.answer);
  }
});
const chainCases: [string, (c: ArtifactChain) => ArtifactChain, RegExp][] = [
  ['registry pin', (c) => ({ ...c, registryHash: bytesHash(Buffer.from('wrong')) }), /REGISTRY_PIN_MISMATCH/],
  ['registry version', (c) => { const registry = { ...c.registry, registry_version: id('other') }; return { ...c, registry, registryHash: payloadHash(registry) }; }, /REGISTRY_BINDING/],
  ['manifest bytes', (c) => ({ ...c, manifest: fixture.seal('manifest', { ...c.manifest.payload, gate_version: 'changed' }) }), /MANIFEST_BINDING/],
  ['quote payee', (c) => ({ ...c, quote: fixture.seal('quote', { ...c.quote.payload, seller_owner: c.quote.payload.mint }) }), /PAYMENT_BINDING/],
  ['arm message quote hash', (c) => ({ ...c, arm: fixture.seal('arm', { ...c.arm.payload, quote_sha256: bytesHash(Buffer.from('wrong')) }) }), /ARM_BINDING/],
  ['arm too late', (c) => ({ ...c, arm: fixture.seal('arm', { ...c.arm.payload, armed_at: new Date(Date.parse(c.quote.payload.expires_at) - M03.armRemainingMin.value * 1000 + 1).toISOString() }) }), /ARM_TIME/],
  ['answer URL', (c) => { const answer = fixture.seal('answer', { ...c.answer.payload, citations: c.answer.payload.citations.map((x) => ({ ...x, source_url: 'https://attacker.example.invalid/answer' })) }); const quote = fixture.seal('quote', { ...c.quote.payload, answer_sha256: payloadHash(answer.payload) }); const arm = fixture.seal('arm', { ...c.arm.payload, quote_sha256: payloadHash(quote.payload) }); return { ...c, answer, quote, arm }; }, /CITATION_URL_BINDING/],
  ['proof message', (c) => ({ ...c, proof: { ...c.proof, message_sha256: bytesHash(Buffer.from('wrong')) } }), /PROOF_BINDING/],
  ['settlement genesis', (c) => ({ ...c, settlement: { ...c.settlement, genesis: c.quote.payload.mint } }), /SETTLEMENT_BINDING/],
  ['receipt settlement bytes', (c) => ({ ...c, receipt: { ...c.receipt, settlement: { ...c.settlement, observed_at: '2026-10-09T00:01:00Z' as typeof c.settlement.observed_at } } }), /RECEIPT_SETTLEMENT/],
  ['receipt buyer', (c) => ({ ...c, receipt: { ...c.receipt, buyer_id: id('another-buyer') } }), /RECEIPT_BINDING/],
  ['receipt answer hash', (c) => ({ ...c, receipt: { ...c.receipt, answer_sha256: bytesHash(Buffer.from('wrong')) } }), /RECEIPT_HASH/],
  ['receipt question policy', (c) => ({ ...c, receipt: { ...c.receipt, question_policy_sha256: bytesHash(Buffer.from('wrong')) } }), /QUESTION_BINDING/],
  ['receipt selection', (c) => ({ ...c, receipt: { ...c.receipt, dispositions: [c.receipt.dispositions[1]!] } }), /SELECTED_DISPOSITION/],
  ['receipt artifact file hash', (c) => ({ ...c, receipt: { ...c.receipt, artifact_refs: { ...c.receipt.artifact_refs, answer: payloadHash(c.answer.payload) } } }), /ARTIFACT_REFERENCE/],
];
for (const [name, mutate, error] of chainCases) test(`complete chain rejects ${name}; original passes again`, () => {
  assert.throws(() => verifyArtifactChain(mutate(original)), error);
  verifyArtifactChain(original);
});
