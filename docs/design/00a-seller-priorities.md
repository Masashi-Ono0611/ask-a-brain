# 00a — Seller-side priorities (founder input, 2026-10-08, binding addendum to 00-brief)

The founder named two seller-side concerns as top priority. They are binding requirements for the design, not optional topics.

## P1. Personal information and injection safety when listing a brain

Requirement: the design must define, for a seller's brain, what may and may not be sold depending on whether it contains personal/sensitive information, and how injection attacks are defended — on the SELLER side first.

Observed facts about the founder's gbrain (use these, do not invent others):
- Page counts by type (approx.): note ~5,000, atom ~2,800, transcript ~2,500, reflection ~470, concept ~320, original ~270, idea ~160, pattern ~80. One single source ("default"); no built-in public/private separation.
- Many pages carry provenance in frontmatter, e.g. `raw_source` (path of the originating conversation transcript), `source_kind`, `ingested_via`, `dream_generated`. Transcript-derived and dream-generated pages are therefore mechanically identifiable.
- Transcripts include work conversations that may contain employer business data, customer data and third-party personal data. These MUST be excluded by default.

Design intent (to be challenged and refined, not assumed correct):
- The unit of sale is a sealed, human-approved **slice**, never "the brain".
- Allowlist-only selection; provenance-based default exclusion of transcript-derived and dream-generated pages; secret/PII/business-marker scanning; human approval of the diff; post-approval changes are excluded until re-approved; sealed manifest with hashes and a signature.
- Three injection directions must each have a defense: (1) slice content attacking the seller's answer engine, (2) buyer questions attacking the seller engine (exfiltration of the slice, jailbreaks), (3) seller answers attacking the buyer agent.
- Safety by data minimization and capability isolation (answer engine has no tools, no network, no access beyond the sealed slice), not by prompt wording.
- Quote-length limits so an answer cannot be a wholesale copy of the slice (also protects the seller's monetization).

## P2. Hosting and uploading (the brain is heavy)

Requirement: the design must decide where and how a seller's slice is hosted, how it is "uploaded", and what the marketplace holds.

Founder concern: uploading a whole brain is heavy.
Observations to build on:
- Only the sealed slice needs to exist outside the seller's machine (likely tens to a few hundred Markdown pages; UNVERIFIED estimate), not the full ~12k-page brain and its ~160k chunks.
- The live brain must never be exposed to the internet.
- Candidate hosting options: H1 self-host on the seller's machine behind a tunnel; H2 seller-owned small cloud container holding the sealed bundle (text + precomputed embeddings); H3 marketplace-hosted custody (adds custody/compliance burden); H4 marketplace holds registry and settlement only, content stays seller-side (combine with H1/H2).
- Founder-side recommendation to evaluate: H4 + H2, fallback H4 + H1 with strict process/permission isolation from the live gbrain.

Both topics must also appear in 03 (threat model, positive controls, tests) and the 4-day plan.

## P3. Slice-readiness: the brain was NOT built to be sliced (founder input, 2026-10-08)

Requirement: the design must include how a brain that was not built for slicing (gbrain in general, and the founder's brain specifically) becomes slice-ready, in addition to how a finished slice is served. This is a first-class part of the design (call it Part D), not an afterthought.

Observed facts (use only these):
- The founder's brain is a single source ("default") holding ~12k pages with no public/private boundary.
- Pages are linked to each other (graph edges, citations). A public page may reference non-public pages; slicing can break links or reveal the existence of excluded pages.
- Transcript-derived and dream-generated pages carry the context of their origin (work conversations, third parties).
- gbrain tool descriptions mention per-source scoping and read grants ("federated read grant", "bound source"). UNVERIFIED whether this is safe/sufficient for serving a public slice to untrusted callers.

Approaches to evaluate (founder-side leaning in parentheses):
- S-A post-hoc extraction by allowlist from the existing brain (cheap; link/context/staleness issues).
- S-B a dedicated public source inside the brain, with approved pages COPIED in (uses native features; weaker isolation if co-located with the live brain).
- S-C clean-room distillation: write NEW public pages from private material (LLM-assisted, human-approved), dropping private context; private brain untouched (lowest leakage risk; costs founder time and some fidelity).
- Founder-side leaning for the 4-day build: S-C as the content strategy, S-B as the container, S-A's procedures (allowlist, scans, approval, sealing).
- Long-term: "publish-by-default authoring": private workshop -> distill -> approve -> promote to a public source.

Questions Part D must answer: minimal metadata schema (visibility, origin, sensitivity, review status, derived-from hashes), the promotion workflow, link/citation handling for edges that cross the boundary, staleness detection when a private origin changes, takedown propagation, how provenance is kept without exposing private content, realistic founder-time budget for a first slice (UNVERIFIED estimate: 30-60 pages), and what a stranger's brain would need (a guide or tool) to become slice-ready.
