# Content approval index

Inert record. Hashes only; the approved bytes stay in the founder-controlled candidate area until sealing.

## Approval 1: five lessons (2026-10-09, founder chat)

Founder was asked to read lessons L1-L5 (facts match their own operating notes, no private content, CC BY 4.0 acceptable) and replied that all are OK.
Scope: lesson page bytes below ONLY. NOT approved yet: the ten questions, the answer map spans, the six incident fixtures, listing metadata, and the signed manifest.

| page | bytes | sha256 |
|---|---|---|
| L1.md | 1389 | dce6195597ebff15ae123651af03a7c8ec7546ddf9ad68706d341678de210ff8 |
| L2.md | 1508 | f0db27f4faa4304bb853c2dc5818b321610d9a53393eaf248176ab29d6d7cece |
| L3.md | 1703 | 318cf8ec46d9f2395d27ccccd8e207cc404ee43dca7b7591a9a1ab3e508f9d36 |
| L4.md | 1539 | 2296b2cbe5291d7e23148a5d29a73596f23b2575da8609ad8c0729006a783c64 |
| L5.md | 1407 | 6efc1a09ab011b435adc795fdf0fbe9ab1a0c7ddd800c1fe969d29e2363a1f04 |

Licence for the approved lesson text: CC BY 4.0 (D12). Any later edit of these bytes invalidates this approval and returns to review.

## Approval 2: ten questions and answer-map spans (2026-10-09, founder chat)

Founder reply: 質問 OK. Scope: the two files below only (the finite list of ten approved questions and the exact answer spans). NOT covered: negatives.json (internal control list), listing metadata, signed manifest.

| file | bytes | sha256 |
|---|---|---|
| questions/questions.json | 2618 | fc267d1f9ccbc10a0e55c9584a4cfd9abd36df96469c7a8c2ddfe895d53f6ac7 |
| questions/answer-map.json | 9308 | 1825a74fa6d2f3f420d2182fbf98d54f784c94901cb91b76220ca7a697a94c49 |

## Approval 3: incident fixture facts (2026-10-09, founder chat)

Founder reply: the incident descriptions match the real events (実際の事例と合っている). Scope: factual correspondence of the six candidate incident files below (I3 and I7 were excluded by the drafting worker and are not covered). NOT yet decided: which incidents are primary, the frozen held-out rubrics and primary IDs (a separate step that must happen before any result is seen), and rights/lineage records for them. No historical matched-replay count (n) is claimed from this approval.

| file | bytes | sha256 |
|---|---|---|
| incidents/I1.md | 6276 | f1f46251a86b40c01be98e1a7922a24b85d4c689e113f41da7a0567988b95572 |
| incidents/I2.md | 6216 | 9387ede63b02eb5d0d6dd7da1878aa30522b1313bbb9e19f0324f66f5e69d576 |
| incidents/I4.md | 6211 | bfb5bc8c39868aca30fe719bf52ea5d90561144b2a948dd9a93cf9fe4c6e9122 |
| incidents/I5.md | 5840 | 569df16e2165eb515d65f073c06b9d4f0be3bd868b9782d883c3a7df8939e6ae |
| incidents/I6.md | 5864 | 75d503d0610eff4c99d5b2e97801f265fd3da489efdac66a6fe74e00046f12b5 |
| incidents/I8.md | 6256 | 59a7130abc5298a6db02557ab52ba384766f11c58ecb300a4bdb8305974b4d95 |

## Decision 4: primary incident set frozen (2026-10-09, founder chat)

Founder reply: all six approved incidents (I1, I2, I4, I5, I6, I8) are primary ("全てHai"). Recorded BEFORE any replay result exists.
Rules from this point: no incident is swapped in or out, re-ordered or edited to improve a result; every attempt counts; unrun or incomplete
cases are reported as unrun in their original order. I3 and I7 remain excluded (near miss; solution overlap with a lesson page).
Not yet frozen: the held-out rubrics (predicates on final state) and the A/B/C protocol constants, which the lead freezes next from the
rubric descriptions inside the approved incident files, still before the first run.

## Record 5: seal of the real slice (2026-10-09, founder-run steps)

The founder personally ran the protected steps (key creation, six typed acknowledgments, manifest signature) in a real terminal; the lead then
ran `seal` and `list` with the pinned scanner (gitleaks 8.30.1, pins hash e3ea707b…). Result: `SEALED_INACTIVE`, and a proposal that is
`suspended` / `requires_human_repin`. Manifest JCS sha256 `67e5238aa1517e106849bbf42bacc5ac9230b21ede219c57c3deb6533f21b892`; seller signing
public key `B93qUaEmhBru69b5knc28TX9UGJ9Fsyz4SekjzTW1hMc`; approval file sha256 `3a585c6bb226cc96639eb2b740dd24a4160b7c140f40f3fc52df69a5c06cbb53`.
Endpoint is the reserved non-deployment name `seller.example.invalid`, devnet only. NOT done: activation / registry repin, any public hosting.

## Record 6: pre-registered stratification (2026-10-09, lead, before any replay result; provisional, founder may overrule)

The executable-fixture build (T12b) assessed overlap between lesson pages and the case-specific resolution of each approved incident.
Substantive overlap flagged: I1 (L4), I4 (L3), I5 (L2), I6 (L1), I8 (L3). No flagged resolution overlap: I2. The six-incident primary set stays frozen
(nothing is dropped or swapped). Reporting rule fixed now: results are always reported in two strata, "no resolution overlap" (I2) and
"lesson-overlapped" (I1, I4, I5, I6, I8), alongside the pooled counts, with the overlap stated next to every figure. For overlapped incidents, B/C
success cannot be separated from simply reading the lesson text, so no prevention claim, no paid-consult advantage claim and no demand claim is made from any
stratum; the study is exploratory. Fixture manifest sha256 09bb7d38a0e6ef2782e73b41bc311e2ea8c4f182b5615167892e4a5c2a72db5c, protocol sha256
999bf14efe3f7c84bcfbab7d81e32c2e5d3012dcaa48d3842069b52d8cc6175e.
