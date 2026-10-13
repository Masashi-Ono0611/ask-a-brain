# Independent review by a Claude (Opus) subagent — condensed record (2026-10-08)

Verdict: ship-with-fixes after a large scope cut. Biggest risk: scope collapse (~3-5x what one founder can build/verify in ~2.5 working days). 03 did not exist at review time.

Findings (severity — topic — fix):
- F1 CRITICAL scope: union of specs needs 3 services, custom quote/arm/reveal protocol with write-ahead log, 17-state machine, JCS+Ed25519 plus Minisign/delegated keys/signed status feed, OS-user isolation, controller/worker/broker split, Gitleaks+Presidio, lineage ledger, replay harness, two reputation formulas, refund reserve, 15 pages. Fix: record a scope-cut decision; freeze one minimal contract.
- F2 HIGH: D3/D4 "Market Harness" absent from all docs; reframe thesis and storyboard around the harness (budget, payee allowlist, out-of-process policy, receipts, outcome ledger); first 30 s show a blocked drain/injection then a bounded purchase.
- F3 HIGH: brief's "ask any brain, those who don't know decline free" was designed out (buyer must pick a seller). Fix: bounded free fan-out pre-check over 2-3 listings.
- F4 HIGH (hard-constraint risk): candidate selection/inventory run gbrain search over a single source that contains work transcripts; if run via an AI session, employer/customer text goes to a hosted model. Fix: private-brain search, inventory and distillation inputs are founder-run, locally, outside any AI session; the AI sees only founder-approved bytes or counts.
- F5 HIGH: real incidents are mostly inside work sessions (excluded). Fix: name an admissible pool now (public founder-owned work: public gbrain PRs/issues, public personal repos); count tonight; accept small n.
- F6 HIGH: whole slice is free to download; replay compares only "no consult" vs "paid consult". Fix: mandatory free-checklist arm (even n=3-5); reframe value as finding/buying the right intervention at the stuck point within a budget, with receipts.
- F7 HIGH: reputation model differs between 01 and 02; both yield null at n~10. Fix: freeze simplest (human-only display + visible service failures); defer weighted formula/windows/disputes.
- F8 HIGH: signing/registry trust/freshness contradict (01 hash-pinned static registry + one Ed25519 key vs 04 signed status feed, Minisign, delegated keys). Fix: 01 wins for the build.
- F9 HIGH: refunds contradict (01 manual unguaranteed vs 02 funded reserve). Fix: no external paid orders in the hackathon; manual disclosed refunds; defer reserve.
- F10 HIGH: autonomous signing needs a separate OS user + signer (costly). Fix: default = human-operated wallet signs, broker builds/validates messages and enforces caps; autonomous signer only if it passes a canary test by 2026-10-10 noon.
- F11 MEDIUM: question publication gate (human approves exact bytes) vs "agent buys by itself". Fix: keep the gate; present as egress policy; fixed approved question set for the demo; disclose.
- F12 MEDIUM: reputation shows nothing at n~10. Fix: show the outcome ledger itself (source, eligibility, exclusion reasons) and say "unrated until 3 independent buyers"; do not compute a number from founder data.
- F13 MEDIUM: "avoided-loss" implies money; follow 01: rename to "prevented-incident replay" (counts, minutes, spend).
- F14 MEDIUM: pre-check constants differ (expiry 5 min vs 120 s; caps; rate limits; token caps). Fix: one canonical table.
- F15 MEDIUM: custom non-x402 rail needs a one-sentence justification for Solana judges; keep the 30-min x402 spike.
- F16 MEDIUM: receipts imported into the buyer's gbrain may poison later sessions; import under a prefixed path with quoted-evidence wrapper; add a planted-instruction readback test; else store locally and import metadata only.
- F17 MEDIUM: unverified claims in docs (model names in the review record, Presidio URL, Bun version, contribution counts, Visasq/Apple splits).
- F18 MEDIUM: the single mainnet payment is founder->founder (wash); use one canonical honest-traction sentence; prefer an independent consenting buyer if one exists.
- F19 MEDIUM: open founder approvals assumed by designs (cloud spend, LLM cost owner, private remote).
- F20 LOW: gate dates differ; 05 links a non-existent 03 anchor.
- F21 LOW: free pre-check is an answerability oracle; acceptable because slice is public.

Top changes: (1) scope-cut decision; (2) write D3 into 01 and re-cut storyboard; (3) bounded fan-out pre-check; (4) AI never touches private brain; (5) admissible incident pool; (6) human-signed wallet default; (7) mandatory free-checklist arm; (8) one canonical constants table; (9) get founder decisions on open items and default to local/extractive; (10) remove unverified claims and use one honest-traction sentence.
Strengths: structural no-charge-on-decline; atomic split with exact-bytes discipline; spend policy outside the agent; honesty machinery; fail-closed seller data boundary.
