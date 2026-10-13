## Verdict

**do-not-ship** the current documents as an implementation contract.  
**Biggest risk:** independently reasonable designs disagree at the payment, publication, and revocation boundaries; combining them can charge for unverifiable answers or reveal withdrawn data.  
A reduced supervised demo remains plausible. This was a read-only design review; neither runtime behavior nor payments were verified, and no 03 document exists.

## Findings

### F1 — CRITICAL — Types 1, 2, 5: Revocation does not consistently stop disclosure

**Where:** `docs/design/01-architecture.md` §§4, 6–7, 9 versus `04-seller-data-and-hosting.md` A2/A5 and `05-slice-readiness.md` D6; binding `00-brief.md` §5.

**Wrong:** 01 promises immutable cached delivery and describes revocation as stopping new quotes. 04/05 also prohibit pending reveals and public-page access. The latter behavior is not incorporated into 01’s state machine.

**Failure:** A quote is armed, prohibited customer information is discovered, payment finalizes, and 01’s recovery path restores and reveals the cached answer.

**Fix:** **04/05 win because the business-data prohibition overrides delivery obligations.** Add revocation checks to arm, reveal, page fetch, cache restoration and restart. Transition affected purchases to `recovery_required`; preserve financial evidence, withhold content, and pursue the full-price remedy.

### F2 — HIGH — Types 1, 2, 5: Question publication has incompatible safety gates

**Where:** `01-architecture.md` §2; `04-seller-data-and-hosting.md` B4.2 versus `02-economics-trust.md` interface table/§2; binding `00-brief.md` §5.

**Wrong:** 01 permits questions generated from approved context plus scanning. 04 additionally relies on users avoiding confidential questions. 02 requires approved exact bytes or constrained templates. These are different admission policies.

**Failure:** An agent includes an unrecognized customer identifier in a question; it reaches the seller/provider before anyone approves disclosure.

**Fix:** **02’s stricter gate wins for this prototype.** Start with approved question templates and independently constrained inputs. Bind approval to transmitted bytes, including retries. Reject other questions before network dispatch. Explicitly disclose the resulting limit on autonomy.

### F3 — HIGH — Types 1, 4, 5: There is no interoperable protocol

**Where:** `01-architecture.md` §§2, 5–6 versus `04-seller-data-and-hosting.md` A3/A4/B3/B4; proposed reconciliation in `05-slice-readiness.md` “Conflicts found.”

**Wrong:** JCS/domain-separated Ed25519 versus exact-file Minisign; one seller key versus offline/delegated keys; pinned registry digest versus signed expiring revisions; pre-signed committed answers versus post-payment signatures. 05 proposes reconciliation but explicitly leaves acceptance open.

**Failure:** Payment succeeds, then the buyer rejects the seller’s otherwise valid signature or commitment.

**Fix:** **Use 01’s wire format for the four-day build**, incorporating 04’s complete file inventory and revocation requirements. Delete superseded normative examples. Require one shared fixture covering registry → manifest → quote → arm → answer before separate components proceed.

### F4 — HIGH — Types 1, 5, 6: “Verified citation” means different things

**Where:** `01-architecture.md` §6 versus `04-seller-data-and-hosting.md` A3/A4/C1; `05-slice-readiness.md` D5.

**Wrong:** 01 requires whole-page retrieval and exact excerpt verification. 04 prohibits page-download routes and trusts the seller’s assertion of excerpt equality.

**Failure:** A seller signs a fabricated excerpt referencing a real page hash. A 04-compatible buyer accepts it; the demo calls it independently verified evidence.

**Fix:** **01/05 win:** expose only approved public pages and verify exact UTF-8 spans. Remove the no-page-download contract from 04. State visibly that buyers can obtain the source corpus freely; the paid product is its useful application.

### F5 — HIGH — Types 1, 6: Refunds can clean a seller’s reputation

**Where:** `01-architecture.md` §6 versus `02-economics-trust.md` §3.

**Wrong:** 01 excludes fully refunded purchases and requires delivered purchases for eligible human votes. 02 preserves verified delivery failures as negative evidence. They also disagree on weights, daily/weekly deduplication, thresholds and score scale.

**Failure:** A seller refunds every failed delivery, retains successful purchases, and displays an inflated score.

**Fix:** **02’s failure-retention principle wins.** For scope, keep simple source-separated counts and human usefulness feedback; retain refunded failures in a visible service-reliability denominator. Freeze one eligibility policy. With ten founder replays, market reputation has **zero independent observations**, not ten.

### F6 — HIGH — Types 1, 4: The schedule is several overlapping projects without a solo critical path

**Where:** `04-seller-data-and-hosting.md` C2; `05-slice-readiness.md` D8/D10; `01-architecture.md` §§3, 10 versus `docs/decisions.md` D1.

**Wrong:** 04 budgets approximately four engineering days for the seller lane alone. 05 adds roughly 11.5 hours at 15 pages, partly overlapping. 01 separately estimates substantial payment work. Replay preparation, founder review, actual isolation, wallet integration and recording remain.

**Failure:** The founder finishes scaffolding and schemas but reaches submission with neither a verified safety boundary nor completed value evaluation.

**Fix:** **D1 wins.** Replace workstream calendars with one founder-hour critical path. Cut to five independently useful approved pages, extractive answers, one runtime, one payment rail and manual publication tools. The briefs do not require 15 pages. Keep the ten-incident target separate; report any shortfall.

### F7 — HIGH — Types 4, 5: Buyer-side injection protection is a requirement without a concrete execution boundary

**Where:** `01-architecture.md` §§7–8; `04-seller-data-and-hosting.md` A4/A6; `00a-seller-priorities.md` P1.

**Wrong:** Plain text, signatures and `untrusted_content:true` do not stop an agent from following malicious advice. Receipt ingestion also creates a second exposure when gbrain later retrieves the answer. 04 recognizes this, but no selected harness/tool policy implements it.

**Failure:** A correctly signed answer induces a destructive shell action, another allowed purchase, or a malicious instruction resurfacing from memory. Wallet caps constrain payment loss, not those actions.

**Fix:** Specify the actual runtime agent, allowed tools, sandbox and human approval boundary. Test hostile signed answers both immediately and after receipt readback. Until that passes, require human review before consequential follow-up actions. Keep all authoring AI access outside the human-provisioned signer boundary.

### F8 — HIGH — Types 1, 4, 6: Refund obligations and retention cannot both be implemented as written

**Where:** `01-architecture.md` §§4, 9 versus `02-economics-trust.md` §2 and `04-seller-data-and-hosting.md` B4.

**Wrong:** 01 offers unguaranteed manual recipient refunds and 30-day paid-answer retention. 02 promises an operator-funded full-price remedy for external orders. 04 deletes ordinary prepared-answer content around 24 hours after quote expiry.

**Failure:** A buyer requests recovery on day two; the answer is gone, the seller is unavailable, and the operator has neither the reserve nor the agreed responsibility.

**Fix:** Retain safe paid answers for the agreed support window; safety revocation remains F1’s exception. **Use 02’s funded remedy before external paid orders, or keep those orders closed.** The founder technical test can use explicitly disclosed manual recovery. Define reserve release and claim deadlines once.

### F9 — HIGH — Types 4, 6: Replay design is careful, but the executable experiment is missing

**Where:** `01-architecture.md` §10; `02-economics-trust.md` §7; `05-slice-readiness.md` D7/D10; absent `docs/design/03-security-eval-plan.md`.

**Wrong:** The documents establish principles, not actual incident fixtures, assertions or a frozen consult-trigger policy. Exact-case overlap checks alone do not prevent closely related incident families from sharing the same solution.

**Failure:** The treatment agent is prompted to recognize the missing check, gets a useful lesson, and “prevents” an incident that the prompt itself already diagnosed.

**Fix:** Before tuning answers, freeze eligible incidents, family-level overlap, rubric, common task prompt and consult policy. Time one complete pair. Record exclusions, abstentions and all four outcome cells. Call the result retrospective assistance evidence; do not imply prospective avoided losses or measured human savings without observing them.

### F10 — HIGH — Types 6, 7: The decisive alternative is optional, and value appears too late

**Where:** `05-slice-readiness.md` D7’s optional checklist comparison; `02-economics-trust.md` §7; `01-architecture.md` §10 storyboard.

**Wrong:** Treatment gets relevant knowledge while baseline lacks it; that tests access to advice, not the necessity of paid synthesis. The storyboard spends most of its early time on refusal, payment, explorer and feedback.

**Failure:** A judge sees a working payment flow and asks why the agent could not read the public checklist for free.

**Fix:** Make a small matched free-checklist comparison mandatory on representative cases, cutting page expansion first. Open the video with the observed task failure and changed outcome; then show the policy boundary and payment evidence. If free access performs equally well, limit the claim to harness behavior and accounting.

### F11 — HIGH — Types 1, 7: The design still pitches the superseded marketplace thesis

**Where:** `docs/decisions.md` D3/D4 versus `01-architecture.md` opening thesis/storyboard and `02-economics-trust.md` §§1, 382–386.

**Wrong:** The design centers a knowledge marketplace and proposes a later single-seller pivot without distinguishing that application from the underlying Market Harness. The binding positioning is absent from the reviewed documents’ core explanation.

**Failure:** A skeptical judge says: “You paid yourself for a public checklist. Pay.sh already enables paid API calls. Where is the useful intervention, independent demand, or differentiated safety?”

**Fix:** **D3/D4 win.** Use: “Ask a Brain is a Market Harness for bounded purchases of expertise; approved gbrain slices are its first market.” Demonstrate rejected unauthorized spending, useful permitted intervention, and auditable outcomes. Keep independent demand at zero unless observed. Changing the first market need not abandon the harness thesis.

### F12 — MEDIUM — Types 1, 4: Conflicting operational constants will produce false failures

**Where:** `01-architecture.md` §§2, 7; `02-economics-trust.md` §§2, 5; `04-seller-data-and-hosting.md` A4/B3/B4; `05-slice-readiness.md` D7.

**Wrong:** Five-minute versus 120-second quotes; two model calls versus one; $0.05 versus $0.01 preparation reservations; different request quotas, timeouts, excerpt limits and runtimes.

**Failure:** 01’s required support-verifier call is rejected by 04’s one-call broker, or a buyer submits a quote already expired under the seller’s policy.

**Fix:** Create one normative configuration table. Prefer 01’s payment/readiness timings, 05’s reconciled output limits and a single runtime. If using extractive preparation, remove model-call machinery entirely. Do not silently choose whichever value makes each component pass.

### F13 — MEDIUM — Types 2, 3: The brief’s “verified facts” heading overstates the evidence

**Where:** `00-brief.md` §§2, 6; evidence registers in `01-architecture.md` §3 and `04/05`.

**Wrong:** The brief combines sourced documentation, third-party estimates, older prices and an unsupported contribution count under authoritative wording. “95 verified contributions,” the agent-volume percentage’s denominator/method, and contest-winner claims lack reproducible evidence in these files.

**Checked:** Current official documentation supports Pay’s challenge/wallet flow, x402’s single-`payTo` examples, Solana instruction atomicity, and gbrain’s distinction between remote grants and trusted local access. It does **not** demonstrate this build’s split interoperability, installed export behavior or receipt ingestion. [Pay](https://pay.sh/docs), [x402](https://docs.x402.org/schemes/exact), [Solana](https://solana.com/docs/core/transactions), [gbrain](https://github.com/garrytan/gbrain/blob/master/docs/architecture/brains-and-sources.md).

**Failure:** A pitch turns protocol documentation or secondary estimates into claims of tested capability or market size.

**Fix:** Separate founder-reported facts, documented capabilities, runtime-verified results and external estimates. Attach dates, versions, sources and denominators; omit unsupported numbers from the pitch. I could not verify the contribution tally or locate primary evidence for the quoted market estimate in this review.

### F14 — MEDIUM — Types 6, 7: The revenue story is priced below its manual operating model

**Where:** `02-economics-trust.md` §§1–3, 9; `05-slice-readiness.md` D8/D9.

**Wrong:** A $0.25 answer at 10% produces $0.025 gross marketplace fee, while admission, provenance, disputes and recovery require human work. The document acknowledges this but supplies no measured operating throughput or focused market-size model.

**Failure:** Even real purchases validate cheap advice while every additional seller or dispute increases losses. Illustratively, ten minutes at an assumed $30/hour consumes the gross fees from 200 purchases.

**Fix:** Measure curation and support minutes alongside compute. Pitch a narrow buyer segment, recurring costly task and explicit price hypothesis. Use an assumption-labeled bottom-up opportunity model; do not treat x402 volume as the addressable market.

## Top 10 changes to make before building

1. **Freeze one canonical protocol.** Resolve F1–F5 and F8; mark superseded sections non-normative.
2. **Prove the buyer boundary first.** Select the actual sandbox and human-controlled signer; demonstrate denied key/admin access and denied unauthorized actions.
3. **Cut content to five useful approved pages.** Remove 15–30-page targets and archive-wide readiness ambitions; retain lineage, scans and exact-byte approval.
4. **Use curated extractive answers initially.** Cut hosted generation, support-model integration, embeddings and local-model setup.
5. **Implement one payment rail.** Prefer the documented native-SOL option if it removes SPL setup; freeze asset policy and rerun all atomicity/replay tests. Cut Pay.sh/x402 integration.
6. **Replace publishing infrastructure with bounded local tools.** Use a standard inert diff, manifest builder and human signing; cut native public-source staging and bespoke review UI.
7. **Freeze the evaluation before tuning content.** Prepare the real incident inventory, one complete paired run and a small free-checklist comparison.
8. **Cut numerical reputation and external paid admission for this demo.** Preserve receipt-linked feedback, exclusions and failure counts; display “unrated.” Defer weighted scoring and dispute machinery.
9. **Unify revocation and recovery.** Test revoked quotes, armed payments, cached reveals, restart and ordinary lost-response recovery. Do not cut these tests.
10. **Rewrite the demo around D3/D4 and observed value.** Preserve two labeled listings, gbrain receipt readback, one runtime-approved mainnet split after gates, and honest traction reporting.

**Minimum demo proves:** a restricted agent can obtain a useful approved intervention, decline without charge, stay within externally enforced spending policy, complete one atomic split, and retain a verifiable receipt and outcome. It does **not** prove an open marketplace, robust reputation, x402 compatibility, profitable supply or independent demand.

## What is genuinely strong

- Business-derived material remains prohibited after redaction or rewriting.
- Prepared answers make declared abstention structurally unpayable.
- Armed-message binding, identical-byte retries and durable reservations address real replay and uncertainty hazards.
- Founder purchases, demo listings and replay results are explicitly separated from traction.
- The replay proposal includes regressions, abstentions and contamination rather than reporting successes alone.