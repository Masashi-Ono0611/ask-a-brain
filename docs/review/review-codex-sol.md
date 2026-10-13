## Verdict

**ship-with-fixes** — freeze one consistent contract and reduce scope before implementation.  
**Biggest risk:** incompatible security/payment contracts consume the build window, leaving a convincing payment clip without demonstrated task value.  
Read all eight requested documents, including 03; checked primary sources. No files changed, private brain inspected, or runtime/payment capabilities verified.

## Findings

**F1 — CRITICAL — Type 1, 5 — Incompatible signing and registry contracts**

**Where:** `01-architecture.md` §§5–6; `04-seller-data-and-hosting.md` A3/A4/B3; `03-security-eval-plan.md` C06/C12; `05-slice-readiness.md` conflict register.  
**Wrong:** 01 uses domain-separated Ed25519/JCS and one Ks; 04 uses exact-byte Minisign, delegated online keys and signed registry revisions. **03 preserves both systems; 05 explicitly rejects that combination.** Strict registry schemas also disagree.  
**Failure:** the publisher produces a valid seal that the buyer cannot verify; deadline pressure encourages bypassing verification.  
**Fix:** prefer 01/05’s smaller signing contract, adding 04’s file inventory and explicit revocation rules. Record founder acceptance and one complete manifest→quote→arm→answer→receipt test vector. Remove superseded formats from implementation instructions.

**F2 — CRITICAL — Type 1, 2, 5 — Question privacy is not one enforceable admission rule**

**Where:** `00-brief.md` §5; `01-architecture.md` §2; `04-seller-data-and-hosting.md` B4.2; `02-economics-trust.md` §2; `03-security-eval-plan.md` C09/G09.  
**Wrong:** 01/04 permit scanned questions from an approved context; 02/03 require exact-byte approval or independently constrained templates. Scanning cannot establish non-business provenance.  
**Failure:** an agent paraphrases a customer incident without recognizable identifiers; the seller/provider receives prohibited information despite a clean scan.  
**Fix:** **02/03 must win because the brief’s data prohibition is binding.** Initially admit exact approved questions or fixed safe templates; reject changed bytes before network dispatch. State the resulting autonomy limitation.

**F3 — HIGH — Type 1, 5, 6 — Citation verification contradicts the publishing contract**

**Where:** `01-architecture.md` §6; `04-seller-data-and-hosting.md` A3/A4; `03-security-eval-plan.md` C07; `05-slice-readiness.md` D5.  
**Wrong:** 01/05 require whole public pages to verify excerpts; 04 prohibits page-download routes and trusts seller assertions. Quote caps cannot protect monetization when entire pages are downloadable.  
**Failure:** either valid citations fail verification, or the pitch claims independent verification while checking only a seller signature.  
**Fix:** prefer **01/05**: explicitly approve complete public download, verify exact bytes, and sell selection/application rather than exclusive access. Delete 04’s conflicting endpoint prohibition.

**F4 — HIGH — Type 1, 5 — Delivery, retention and revocation disagree**

**Where:** `01-architecture.md` §§2–4/9; `04-seller-data-and-hosting.md` A5/B4/B5; `03-security-eval-plan.md` C05/C14; `05-slice-readiness.md` D6.  
**Wrong:** 300-second armed/finalized settlement conflicts with 120-second “initiated”/confirmed redemption. Paid-answer retention is 30 days in 01 versus roughly 24 hours after expiry in 04. 01’s publication incident text stops new quotes without explicitly blocking pending reveals.  
**Failure:** a late payment loses its answer, or revoked sensitive content is delivered from cache.  
**Fix:** **01 wins payment timing; 04/05 win safety withdrawal.** Retain safe paid bytes for 30 days; revocation blocks quote, arm, reveal and page fetch, including restored backups. Preserve content-free recovery obligations.

**F5 — HIGH — Type 1, 5 — Refund promises exceed the payment mechanism**

**Where:** `01-architecture.md` §9; `02-economics-trust.md` §2; `03-security-eval-plan.md` C10/G22.  
**Wrong:** 01 offers cooperative manual returns without a guarantee; 02 promises full-price operator-backed remedies. Gate 1 does not establish that backstop.  
**Failure:** an independent seller disappears after receiving 90%; the marketplace has only 10% but owes the buyer 100%.  
**Fix:** for external orders, **02 must win if that promise is advertised**: reserve funded full exposure and exercise recovery. For this hackathon, keep external paid orders closed and disclose manual, unguaranteed recovery for the founder test. Partial recovery remains unpaid liability.

**F6 — HIGH — Type 1, 6 — Reputation policies produce contradictory endorsements**

**Where:** `01-architecture.md` §6; `02-economics-trust.md` §3; `03-security-eval-plan.md` C11/G24.  
**Wrong:** human-only versus weighted sources; daily versus weekly selection; different thresholds/scales; refunded failures excluded versus retained.  
**Failure:** refunding failed deliveries removes negative observations under 01 and improves the displayed score.  
**Fix:** keep 02’s **failure visibility and affiliation exclusions**, but cut its weighted numerical score for the demo. Record source-separated outcomes and raw denominators; display **unrated**. Ten historical replays contribute zero independent market reputation.

**F7 — HIGH — Type 1, 4 — The security reconciliation contains stale factual claims**

**Where:** `03-security-eval-plan.md` C02/C03/C04 versus current `02-economics-trust.md` §§2/10.  
**Wrong:** 03 says 02 rejects full preparation, uses older cost/rate caps, and lacks the one-cent exception. Current 02 already adopts B+, revised caps and that exception.  
**Failure:** implementers “resolve” nonexistent conflicts and overwrite newer policy with obsolete limits.  
**Fix:** current 02 wins these comparisons. Rebuild the conflict register against exact document revisions; distinguish genuine disagreement from already reconciled text.

**F8 — HIGH — Type 1, 4 — There are two calendars and incompatible content targets**

**Where:** `01-architecture.md` §§3/10; `02-economics-trust.md` §10; `05-slice-readiness.md` D8/D10 versus `03-security-eval-plan.md` C01/§6.  
**Wrong:** Gate 1 is Oct 9 versus Oct 10; Gate 2 is Oct 10 versus Oct 11. Content targets range from 5–10 to 15 mandatory pages. 03 cites an instruction selecting Oct 9–12 that is not recorded in the binding inputs.  
**Failure:** one lane plans integration while another is still preparing content; “gate passed” means different things.  
**Fix:** retain existing gates until a founder-accepted replacement is recorded. Choose **5–10 useful pages**, with full review, rather than a page-count requirement. Official rules currently end the contest at **Oct 12, 11:59 p.m. PT**, equivalent to **Oct 13, 15:59 JST**; keep the earlier internal packaging target. [Official rules §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)

**F9 — HIGH — Type 2, 4 — Required founder decisions remain dependencies, not approvals**

**Where:** `decisions.md` “Open”; `04-seller-data-and-hosting.md` B2/B3; `05-slice-readiness.md` D8.  
**Wrong:** actual first pages, cloud-account spending and answer-engine cost ownership remain open while schedules assume their availability.  
**Failure:** AI implementation finishes an H2 deployment path or selects archive pages that the founder has never authorized.  
**Fix:** make those unresolved decisions explicit prerequisites. Prepare deployment configuration and synthetic fixtures without activating paid cloud resources or publishing candidates. Default to extractive preparation and exact founder-selected public material.

**F10 — HIGH — Type 4 — The minimum is still several projects**

**Where:** `decisions.md` D1; `04-seller-data-and-hosting.md` C2; `05-slice-readiness.md` D8/D10; `03-security-eval-plan.md` §§3/6.  
**Wrong:** seller work alone estimates roughly four focused days; readiness adds substantial content/tool work; payments, isolated signing, 30 guard families, ten paired fixtures and submission remain. Overlap is asserted without one capacity budget.  
**Failure:** happy-path payment succeeds while recovery, privacy acceptance and value evaluation remain unrun.  
**Fix:** default immediately to extractive answers, one signature system, one runtime, manual lineage checks, no native publication source, and founder-only payment testing. Keep mandatory safety; describe missed product requirements honestly.

**F11 — HIGH — Type 5 — Persistent receipt injection lacks an acceptance mechanism**

**Where:** `01-architecture.md` §8, especially receipt import; `04-seller-data-and-hosting.md` A4; `03-security-eval-plan.md` G16/G29.  
**Wrong:** “untrusted external evidence” is a requirement, but no verified gbrain encoding/retrieval behavior preserves that distinction. Readback hashes prove storage, not safe future use.  
**Failure:** a correctly signed hostile answer enters gbrain; a later agent retrieves it as operational guidance and executes it.  
**Fix:** specify the supported receipt representation and retrieval boundary. Test **import→later retrieval→agent handling** with a hostile signed receipt. Until proven, exclude receipt prose from privileged retrieval and gate consequential follow-up actions independently.

**F12 — HIGH — Type 1, 5, 6 — Action safety can neutralize the value demo**

**Where:** `03-security-eval-plan.md` threat model/G16 versus §4 paired protocol; `04-seller-data-and-hosting.md` A4; `00-brief.md` §4.6.  
**Wrong:** hostile answers must cause no automatic shell/browser action, but the useful treatment must actually perform a check or repair. The allowed action boundary is insufficiently concrete.  
**Failure:** either the buyer cannot act, so the consult changes nothing, or actions are enabled broadly and seller advice becomes executable authority.  
**Fix:** allow only named, constrained toy-task tools enforced outside the agent. Deny arbitrary shell, installation, network and out-of-sandbox writes. Show the consulted agent performing an allowed check without human coaching.

**F13 — HIGH — Type 1, 7 — D3/D4 never reached the design narrative**

**Where:** `decisions.md` D3/D4 versus `01-architecture.md` thesis/§10, `02-economics-trust.md` §1 and `03-security-eval-plan.md` §7.  
**Wrong:** the reviewed designs remain framed around a brain marketplace. None uses “Market Harness”; pitch time centers on purchasing knowledge and splitting payment.  
**Failure:** a judge sees another paid-RAG marketplace and asks why this is more than Pay.sh plus Markdown.  
**Fix:** **D3/D4 win.** Name the service **Ask a Brain**; explain the underlying Market Harness as enforced purchase boundaries and outcome evidence. Demonstrate a blocked unauthorized purchase and a useful permitted intervention. Keep additional markets as future positioning, not build scope.

**F14 — HIGH — Type 6, 7 — Replay does not establish why anyone should buy**

**Where:** `02-economics-trust.md` §7; `03-security-eval-plan.md` §4; `05-slice-readiness.md` D7.  
**Wrong:** baseline gets no consult; treatment gets relevant knowledge plus extra seller preparation. The free-checklist comparison is optional. Positive results therefore establish access-to-help benefit, not paid synthesis or marketplace benefit. Single stochastic pairs also make “attributed avoided” too strong if based mainly on temporal availability.  
**Failure:** ten successes reproduce a free checklist’s benefit with payment overhead.  
**Fix:** make the same-corpus free-checklist comparison mandatory for the **featured value case**, even if not all ten. Show the changed action and objective result. Report observed paired improvements consistent with the intervention; disclose hindsight and stochastic uncertainty.

**F15 — HIGH — Type 6, 7 — Economics do not support the fee narrative**

**Where:** `02-economics-trust.md` §§1–2; `05-slice-readiness.md` D8; `03-security-eval-plan.md` pitch outline.  
**Wrong:** the hypothetical cohort already loses money; manual admission, rights review, curation and disputes worsen that result. A one-cent self-payment produces a **$0.001 internal marketplace transfer**, not an income path.  
**Failure:** a skeptical judge asks how pennies fund human operations; the answer is unpriced founder labor.  
**Fix:** present measured preparation/support cost and a separately labeled target price. State who would buy, for which recurring task, and through which acquisition channel. Do not present the experimental 10% split as validated viability.

**F16 — MEDIUM — Type 2, 3 — The “verified facts” ledger overstates its evidence**

**Where:** `00-brief.md` §§2/6; `01-architecture.md` §3.  
**Wrong:** batch launch timing, founder contribution totals and winner references lack a reproducible evidence ledger. The agentic-share wording omits its denominator: TRM’s 0.6–7.5% estimate concerns **screened commerce value**, not all settlement volume. PayAI currently calls batch settlement a **public preview**.  
**Failure:** an unsupported number or maturity claim reaches the pitch.  
**Fix:** attach dated primary sources and precise denominators; omit unverified founder/winner counts. Separate documented support from tested interoperability. Solana atomicity and Pay.sh features are documented; **custom split acceptance, devnet integration and installed gbrain behavior remain untested here**. [TRM analysis](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain), [PayAI preview](https://docs.payai.network/x402/servers/batch-settlement), [Pay.sh source](https://github.com/solana-foundation/pay), [Solana transactions](https://solana.com/docs/core/transactions)

**F17 — MEDIUM — Type 3, 7 — Submission criteria need a second mapping**

**Where:** `00-brief.md` §2; `03-security-eval-plan.md` pitch outline/§8.  
**Wrong:** the seven startup criteria are useful framing, but current official rules list six criteria, including **UX, open source and composability**. A custom non-x402 rail creates an obvious composability question.  
**Failure:** excellent safety documentation accompanies a difficult setup and an unexplained proprietary protocol.  
**Fix:** retain the requested startup narrative, add the official mapping, and provide a reproducible devnet quickstart with a clear interoperability limitation. [Official rules §8](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)

A skeptical judge’s 30-second response: **“You sold yourself a public checklist, moved money between your wallets, and built an unrated reputation system. Show me the task improvement, the enforced boundary Pay.sh does not already provide, and who independently wants to pay.”**

## Top 10 changes to make before building

1. **Freeze one canonical contract:** signatures, schemas, registry, commitments, finality, retention and revocation; require public golden vectors.
2. **Enforce exact approved question scope before dispatch.** Preserve business-data exclusion, human-only keys and runtime mainnet approval.
3. **Prove signer isolation first.** No same-user shortcut; disclose supervised signing if unattended devnet signing cannot be demonstrated.
4. **Cut generative inference immediately.** Use human-approved extractive interventions; defer embeddings, reranking, local models and repeated model attack campaigns.
5. **Cut slice scope to 5–10 useful pages.** Keep provenance, scans, exact-byte review, sealing and takedown; omit native public-source integration.
6. **Keep external paid orders closed.** Resolve refund promises and funding before any independent buyer pays.
7. **Cut numerical reputation.** Keep authenticated outcomes, failures, exclusions and raw counts; display unrated.
8. **Freeze one calendar and capacity budget.** Include founder content/key/review time, fixture preparation, acceptance and video production.
9. **Build the value case before presentation polish.** Include a free-checklist comparator; retain all eligible historical replay attempts and report the actual n.
10. **Rewrite the storyboard around D3/D4.** Show blocked purchase, useful intervention and observed task result; shorten explorer footage.

The minimum demo still proves: **two honestly labeled listings; a safe sealed slice; decline with zero signer calls; externally enforced budget/payees; one atomic split; verified answer and actual gbrain receipt readback; recorded outcome; and observed task benefit on disclosed historical cases.** It does not prove demand, reliable reputation, profitable operations or general agent safety. Preserve the one approved mainnet milestone; if incomplete, say so.

## What is genuinely strong

- Prevalidated immutable answers structurally prevent post-payment generation-based abstention.
- Direct atomic transfers avoid marketplace custody of seller proceeds.
- Frozen bundles and rebuilt indexes provide a concrete boundary from the private brain.
- Replay selection, contamination exclusions, regressions and intention-to-treat reporting are substantially honest.
- Self-payments, demo supply and independent demand are explicitly distinguished.