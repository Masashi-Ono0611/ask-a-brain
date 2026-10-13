## 要約
- 4日間で証明するのは、公開可能な個人の運用知識を購入し、その有用性と支払いを追跡できることです。
- 手数料は接続の手間と結果記録への対価ですが、需要も適正料率も未検証です。
- 無料の事前判定、価格確認、支払い、回答の順とし、無料判定には件数・費用の上限を設けます。
- 評判は少数標本を平滑化し、自己取引・デモ・再現実験を独立した購入者の実績から除外します。
- 販売対象は本人が承認した公開スライスだけで、業務・顧客・会員・第三者の非公開情報は扱いません。
- メインネット送金は資金移動の技術検証であり、需要の証明とは呼びません。
- 約10件の再現実験は件数と時間幅で報告し、第三者の反復購入がなければ単一販売者ツールへの転換を検討します。

# 02 — Economics and trust

Date: 2026-10-08. Binding input: [00-brief.md](00-brief.md), especially §§3–5. This is a business policy and implementation contract, not payment-rail, MCP, or state-machine architecture. The architecture pass owns those mechanisms. Existing decisions stand; unresolved interface conflicts must be logged, never silently resolved by weakening the brief. The concurrently added [00a-seller-priorities.md](00a-seller-priorities.md) was also read; its P1–P3 requirements are addressed here as content, cost and publication rules, with hosting/isolation mechanisms owned by 01. Its suggested distillation from private material does not override brief §5: no business-derived or third-party-private content is made eligible by rewriting it.

**Evidence convention.** `POLICY` identifies a chosen implementation parameter, not an observed fact. `UNVERIFIED` identifies an empirical hypothesis or illustrative assumption; its verification step is given nearby. Unless explicitly described as observed, examples are fictional and counts are not traction. All dates below use JST. Do not implement onboarding, automated ranking, identity vendors, or a reputation service for the hackathon. A static registry, bounded seller endpoint, receipts, and a locally generated one-page report suffice (brief §§3–4, D1).

Interfaces required from 01; names describe contracts, not mandated implementations:

| Interface | Minimum economics/trust contract |
|---|---|
| `SettlementRail` | Confirm one Solana transaction, identified by one confirmed signature, splitting the exact quoted amount between seller and marketplace; expose chain, asset, amount, recipient amounts, confirmation evidence and unique payment ID. Report network costs separately. No merchant custody assumption. Report reversals/refunds separately from gross transfers. Mainnet execution requires explicit human approval at runtime; authoring agents never receive private keys (brief §§3–5). |
| `AnswerReadiness` | Before a payable quote exists, attest durable approved answer bytes and their commitment, successful content/provenance validation and `abstain=false`. Economics treats all preparation as free-stage cost, even for quotes never purchased; 01 owns caching/reveal mechanisms. |
| `QuoteStore` | Bind quote ID, buyer, brain ID, question commitment, slice/policy version, asset, total price, seller amount, fee amount/rate, `payout_config_hash` and its exact seller/marketplace recipient addresses, expiry and delivery/refund terms. Accepted quote contents are immutable; neither repricing nor recipient changes are allowed. Expose whether an accepted quote was paid, delivered, expired or refunded, without defining the state machine here. |
| `BudgetGuard` | Enforce buyer per-call/daily limits outside the answering LLM, including quoted network-cost ceiling; atomically reserve seller pre-check/paid-fulfillment cost budgets and operator refund exposure before admission. Fail closed when a bound is unavailable. |
| `QuestionPublicationGate` | Fail closed before pre-check network/model dispatch unless human approval binds the exact public-safe question bytes (or approved template/version with independently constrained safe inputs). No arbitrary private agent context; no raw request/proxy logs. |
| `SellerIsolation` | Treat slice text and buyer questions as untrusted data; answer engine has no tools/network authority or access beyond approved sealed content. Seller output cannot authorize buyer actions or feedback. 01 owns mechanism; 03 verifies controls. |
| `SliceManifest` / `ProvenanceVerifier` | Identify only approved export bytes, policy hash, public citations, signing key/version and answer commitment; verify answers against the registry. A signature proves key control, not expertise or content rights. Private signing keys stay with the seller-controlled signer; authoring agents receive only public material. |
| `OutcomeLedger` / `ReportBuilder` | Deduplicated receipt-linked signals, relationship/eligibility decisions, immutable corrections, aggregated score snapshot, disjoint payment-event classes and a separately deduplicated interest funnel. Registry score is derived from this ledger, never seller supplied. |

## 1. The marketplace thesis stress-test

**Thesis:** a buyer pays for a small, cited intervention at a stuck point; a seller sells repeatable answers from an approved personal knowledge slice. The marketplace must save more integration/selection effort than its fee and add credible information about outcomes. Access to otherwise secret information is not the product (brief §§1, 3 Q1/Q6/Q8, 5).

| Pillar | Buyer reason to transact here | Seller reason | Defensibility and bypass risk |
|---|---|---|---|
| One MCP reaches any listed brain | One discovery/consult contract, budget controls, receipts and consistent declines. “Any” means listed compatible brains, not the world's experts. | Avoid building a buyer-specific integration; shared discovery and receipt handling. | Weak moat. A gateway can copy the adapter. With one useful seller, a direct endpoint is simpler. Once buyer and seller meet, repeat purchases can bypass us. |
| Outcome reputation | See task outcomes and evidence quality before choosing an unfamiliar seller. | Good outcomes can earn future attention without an established personal brand. | Potentially cumulative, but UNVERIFIED. At launch there is essentially no independent evidence. Portability, manipulated reports, task mix and selective nonresponse all weaken it. A displayed number without reliable outcomes is negative value. |

What the fee actually buys in this build: registry maintenance, common consult/receipt conventions, budget integration, source/provenance validation, outcome aggregation and operator handling of delivery disputes. It does **not** buy expert credential verification, an indemnity, correctness insurance, enterprise compliance, or guaranteed results. Seller inference and curation are paid from the seller share. Network charges are separately disclosed. No exclusive seller agreement or attempt to prevent buyers using public citations directly; a sustainable fee must earn repeat use.

| Comparator | What sustains its fee | Implication for us |
|---|---|---|
| Visasq-style expert network | Matching, screening/compliance processes and payment handling. Current official direct-interview guidance says the expert receives 70% of the payment and the platform 30%; full-service pricing differs. [Official payment explanation](https://support.expert.visasq.com/hc/ja/articles/50675331871001--direct-%E3%82%A4%E3%83%B3%E3%82%BF%E3%83%93%E3%83%A5%E3%83%BC-%E8%AC%9D%E7%A4%BC%E9%87%91%E9%A1%8D-%E6%94%AF%E6%89%95%E3%81%84%E9%87%91%E9%A1%8D-%E5%8F%97%E3%81%91%E5%8F%96%E3%82%8A%E9%87%91%E9%A1%8D%E3%81%AE%E9%81%95%E3%81%84), [compliance practices](https://corp.visasq.co.jp/compliance). | Human matching and compliance work explain a larger take rate. We do not supply an equivalent service. The brief §6 older 30–40% / ¥5,000-hour analogy is not a current universal tariff; the latter remains UNVERIFIED and is not used in calculations. |
| Pay.sh / API gateways | Common discovery/payment tooling reduces integration costs. Pay.sh already documents `mcp`, `skills`, payment challenges and a server gateway. [Official docs](https://pay.sh/docs). | “An agent can pay an API” is not differentiation. Our proposed addition is incident-specific knowledge and outcome evidence. Pay.sh's fee is **UNKNOWN / UNVERIFIED**; absence of a fee in the overview does not mean zero. Verify official commercial terms or ask its operator, with a 30-minute research cap; do not block the build. |
| App stores | Distribution, discovery, platform tooling, trust/safety and commerce. Apple describes these services; its Small Business Program advertises a 15% commission, with terms varying by program and region. [Services](https://developer.apple.com/support/apps-in-the-eu), [program](https://developer.apple.com/news/?id=6lyxewwp). | We have no captive distribution or established audience. App-store rates are context, not permission to charge the same rate. |

**Decision:** implement the agreed fee split, but call it an experimental service fee. At hackathon scale it is technically demonstrable; economic justification is **not established**. Plausible testing range **UNVERIFIED: 5–15% of the answer price**, hypothesized to leave sellers most of the value while funding very light operations. `fee_bps` is the operator-exposed parameter; **POLICY: 1,000 bps default, permitted pilot settings 0–1,500 bps**. Zero is for an explicitly labeled comparison cohort; the required fee-split demonstration uses a nonzero fee. Sellers accept the current rate before listing; buyers see total price and split before paying. Never quietly change an outstanding quote. A change to global `fee_bps` invalidates affected listing approvals for new quotes until each seller accepts the new rate; the approval log binds fee rate and registry version.

Verify the range through sequential, disclosed pilot cohorts at comparable total prices and topics; show counts until there is enough volume to estimate effects. Measure pre-check→quote→payment→delivery→outcome→repeat-purchase funnels, seller net contribution, operator support minutes, retention, and direct-endpoint preference. A founder-selected price plus self-pay cannot estimate willingness to pay. Interview buyers who decline; separately ask whether price, relevance, wallet friction or trust caused the decline. A fee reduction test must document who receives the saving (seller or buyer); otherwise it confounds take rate and willingness to pay. Reverse the default if seller contribution is negative or independent buyers demonstrably prefer direct access despite the offered services. Do not raise the rate merely because transactions technically work.

## 2. Pricing and unit economics

**Price owner:** seller sets one flat per-answer price per listing/version; marketplace sets a published fee. No auction, dynamic difficulty pricing, token resale, or paid follow-up hidden in an answer. Each new question needs a new quote. **POLICY: initial bounds US$0.10–US$2.00 equivalent, default US$0.25 equivalent**, paid in the settlement asset selected by 01. These bounds apply to external paid pilot orders and are operating choices, not measured willingness to pay. The single founder-funded technical verification may use 01's $0.01-equivalent amount below that floor, with runtime approval and an explicit technical-test label; it is not a tested market price. Price is fixed in asset atomic units when quoted; any USD/JPY display is timestamped and labeled approximate. Stablecoin units are not guaranteed redeemable dollars. `SettlementRail` must supply asset/network/decimals and a verified amount conversion before an executable listing; no mint or exchange rate is guessed here.

Choose **B+ at the interface: free pre-check, then pay, then reveal**, using 01 §2's prepared-answer readiness contract (brief §3 S1-A and §7.1). Initial economics favored a lightweight B, but the parallel architecture establishes the missing dependency: a retrieval hit cannot rule out post-payment abstention. Therefore `QuoteStore` may offer payment only after `AnswerReadiness` confirms a durable, validated, non-abstaining answer. This is C's preparation cost inside B's buyer flow; label it honestly. A charges unknowns before refund; lightweight B is cheaper but cannot uphold “decline → no charge” alone. Pre-generation increases unpaid work and a hash does not establish usefulness. A deterministic curated answer prepared without an LLM is the smallest fallback when inference cannot fit the budget. Reverse this mechanism only with a demonstrated cheaper readiness guarantee; never silently allow paid unknowns.

Free response contains only `can_answer`, a coarse public topic, total price/split, expiry and quote ID, or a generic refusal reason. No snippets, page titles, citation list, private corpus inventory, confidence transcript, partial solution or extractive explanation. Public listing topics are already visible. Declines are free; budget exhaustion is labeled `unavailable`, not “doesn't know,” and neither affects usefulness. Question input must itself exclude business/private data. For the four-day pilot, `QuestionPublicationGate` admits only pre-reviewed personal/synthetic questions or a new question explicitly approved for public-safe dispatch before any seller/model request; do not send arbitrary agent context and scan it afterward. The seller handles approved question text only in memory for the request, disables raw request/body logging, and persists only approved answer/receipt metadata and nonpublic commitments. Model-provider retention/processing terms must be checked before enabling that provider; if unknown, stay with approved local/deterministic curated preparation. Buyer retains its original question in its own gbrain, not the marketplace. 01 owns enforcement, including proxy/model logs (brief §5, 00a P1). Wallet ownership is a rate-limit key, not proof of a unique human.

Use one currency unit consistently in the following model; exchange costs are separate:

- `N`: admitted pre-checks, including declines and accepted quotes that never convert. `a`: fraction producing quotes; `b`: fraction of quotes paid; `q = a*b`; `K = N*q` paid consults.
- `P`: gross per-answer price; `f`: fee fraction; `r`: fraction fully refunded. Partial refunds are not offered in this pilot. `R0`, `R1`: retrieval/embedding/preparation compute before payment and delivery/verification compute after payment, respectively. `tin_j`, `tout_j`, `pin`, `pout`: tokens and currency per million tokens for stage `j`.
- `c0 = R0 + Σ_j(tin_j*pin_j + tout_j*pout_j)/1e6`, summed over all pre-payment generation/validation calls: average cost of **every** admitted pre-check, whether it converts or not. Include the full prepared answer, including discarded expired quotes. A deterministic curated-answer preparation sets the LLM term to zero.
- `c1 = R1 + delivery_storage_egress + retry_cost`: average marginal serving/verification cost per paid consult, including failed deliveries. There is no new answer generation after payment; do not charge prepared-answer compute to both `c0` and `c1`. `h_s`: seller support and refund-processing cost per paid consult. `F_s`: allocated seller-side hosting, sealed-export preparation/upload, index preparation, curation labor and fixed costs per period. Full-brain upload is not a cost assumption; only an approved sealed bundle may leave the seller machine (00a P2).
- `seller_profit = K * [(1-r)*(1-f)*P - c1 - h_s] - N*c0 - F_s`.
- `q_break_even = (c0 + F_s/N) / [(1-r)*(1-f)*P - c1 - h_s]`. Denominator ≤ 0 means no conversion rate can rescue that price; a result > 1 is infeasible. Variable-cost break-even sets `F_s = 0`. When `N = 0`, profit is `-F_s` and conversion is undefined.
- With `m0` marketplace cost per pre-check, `m1` per paid consult and fixed cost `F_m`, `marketplace_profit = K*[(1-r)*f*P - m1 - d*(1-f)*P] - N*m0 - F_m`, where `d` is the fraction of all paid consults whose refunded seller share the operator cannot recover (`0<=d<=r`). Include support labor, refund network fees, monitoring and any fee subsidy in those terms. Seller profit above recognizes its contractual refund obligation even if unpaid; disclose outstanding seller refund liabilities separately from cash received. Operator bad debt must not disappear because the seller promised to repay it. Founder-as-seller revenue and marketplace revenue are reported separately; internal transfers are not consolidated income.

**Worked example — all cost, price, conversion and refund inputs UNVERIFIED assumptions, not measurements:** a multi-day cohort `N=100`, `a=0.5`, `b=0.4`, thus `q=0.2`, `K=20`; `P=$0.25`, `f=0.10`, `r=0.05`, `c0=$0.029` including unpaid answer preparation, `c1=$0.004`, `h_s=$0.005`, `F_s=$2` for the cohort. Expected retained seller receipt per paid consult is `$0.21375`; contribution before free preparation and fixed costs is `$0.20475`. Variable break-even `q` is `0.029/0.20475 ≈ 0.141636`; including fixed cost it is `0.049/0.20475 ≈ 0.239316`. Seller profit is `20*0.20475 - 100*0.029 - 2 = -$0.805`. It earns `$1.195` before fixed cost but loses money after it; non-converting requests still cost money. This recalculation uses 01's prepared-answer interface, not the cheaper abandoned lightweight-check assumption.

For the same example, **UNVERIFIED** `m0=$0.0005`, `m1=$0.003`, `F_m=$2`, `d=0` (every seller refund share recovered) gives retained platform fees `$0.475`, variable contribution `$0.365`, and loss `$1.635` after fixed costs. Positive variable margin at either layer does not establish a profitable business. Verify inputs using provider billing/token records, retrieval timings, all admitted attempts and a manual labor log over the first pilot cohort; reconcile refunds rather than using the example's expected fraction. First cost calibration is a 30-minute bounded exercise before any real paid use; missing cost evidence means no profitability claim.

**Bound the free option — POLICY, initial caps subject to measurement:**

| Control | Initial rule |
|---|---|
| Admission | Pilot buyer allowlist with relationship declaration and wallet-control proof. Max 3 pre-checks/minute and 20/day per buyer cluster per seller. Network-level throttling is supplementary, not identity. |
| Work | At most one answer generation and one validation call before payment; combined caps 12,000 input and 2,000 output tokens, zero automatic model retries. No need to fill these maxima. Oversized questions rejected before model spend; deterministic curated preparation may avoid model calls entirely. |
| Monetary ceiling | Reserve at most $0.05 equivalent per preparation; at most 100 admitted pre-checks/seller/day and $2.00 seller/day; $4.00 across the two-listing pilot/day. The monetary limit may stop admission before the count limit. Enforce both counts and projected cost before dispatch, including concurrent requests. |
| Reservation | `BudgetGuard` uses current provider rates and worst-case token/retrieval charges, not an average. If caps cannot fit the configured provider, use deterministic curated preparation or refuse admission. Refund unused reservation only after measured completion. |
| Repeated probes | Cache identical question commitments for the same buyer, brain and slice version for 10 minutes; quotes expire after 5 minutes. One outstanding quote per buyer/brain; generic refusal to enumeration. Neither cache nor wallet limits defeat Sybils; global budget is the final bound. |
| Paid fulfillment | Separate reserved capacity for already accepted quotes; stop new quotes before paid work would lose its budget. Pre-check quota exhaustion never cancels a paid obligation. |

These cap **metered pre-check variable spend**, not fixed hosting, arbitrary infrastructure attacks or curation labor. Bounded tokens are insufficient without actual provider prices. Verify concurrent exhaustion and zero-model-call rejection with 01's tests before opening the pilot (brief §7.8).

Delivery policy required from 01 (brief §7.9): declare a **POLICY 10-minute delivery deadline after confirmed payment**, retain the identical answer for receipt-linked retry without another charge, and provide a full quoted-price refund for non-delivery, later abstention or invalid/missing required provenance. Buyer gets the whole answer price even if collection from seller fails: the operator funds a small disclosed refund reserve from its own funds and reserves each accepted quote's full price before admission, refusing additional quotes when worst-case outstanding obligations would exceed the reserve; this is not custody or escrow. Reserve is released only after the applicable delivery/remedy obligation ends or a refund completes; retain a separately budgeted incident buffer for later upheld complaints. Seller agrees to return its share; platform returns its fee. Network charges are disclosed as normally unrecoverable, with operator-funded recovery fees. Subjective “not useful” changes reputation and is not automatically refundable. Dangerous/private output triggers removal and a full-price refund. No pro-rata refunds or promise of automatic refunds until 01 demonstrates the path. Settlement policy must not erase an adverse outcome when refunding it. If refund funding/path is unavailable, do not admit external paid pilot orders; preserve the authorized technical demonstration and disclose the limitation.

## 3. Outcome reputation model (the core differentiator)

**Meaning:** “useful” means the consult materially helped the buyer complete the stated task or avoid the stated failure, within the recorded evaluation window. Mere delivery, payment, attractive prose, citations, or an agent saying “thanks” are not success. Task success after consultation is an association; incremental causation requires comparison evidence (brief §§3 Q6/Q8, 4.3, 7.4).

Collect all sources, but select **one** scored verdict per eligible consult, never four votes:

| Source / quality order | Required evidence | Score weight |
|---|---|---|
| Objective check, strongest for its narrow criterion | Criterion recorded before answer, check/version and result artifact from the buyer's task, scope and independence from seller. A passing syntax check cannot establish incident prevention. | 1.00 |
| Verified service failure | Independent receipt/deadline or provenance check establishes paid non-delivery or invalid required provenance; no buyer thumb needed. | 1.00, always `y=0` |
| Human thumbs | Authenticated buyer says useful/not useful against the recorded task; optional reason and observed task result. | 0.75 |
| Agent task-success self-report | Buyer-side agent identifies original goal, outcome and how the answer helped; signed/receipt-linked buyer report. An instruction in seller content is not a vote. | 0.25 |
| Replay verdict | Paired incident ID, rubric and evaluator evidence. Stronger experimental structure than a thumb, but founder-selected historical tasks are a different population. | **0 in market score**; separate evaluation ledger, even if money moved. |

Verified service failure takes precedence over a claimed successful delivery; otherwise the ordering expresses evidential strength, not an empirical reliability calibration (**UNVERIFIED**; verify by comparing source disagreements on the pilot's first adjudicated cases). Objective verdict is used only if its predeclared criterion measures the stated task outcome; otherwise use human, then agent. Higher-quality evidence supersedes a lower-quality verdict via a logged correction, never adds another observation. Equally authoritative contradictions supported by artifacts become `disputed` and unscored pending review; an unsupported seller objection or unilateral retaliatory purchase cannot remove a negative vote; publish the disputed count and retain the original evidence. A contested eligibility exclusion requires artifact-backed evidence and an uninvolved reviewer; while such an exclusion is unresolved, suppress the aggregate numeric score as `disputed` so exclusion cannot manufacture an endorsement. This does not let an unsupported complaint suppress a competitor's score. Seller cannot adjudicate a complaint against itself. Founder conflicts require an uninvolved reviewer; if unavailable, leave the dispute unresolved and visible. Negative agent reports receive the same weight as positive ones.

**Eligibility:** paid, genuine task, verified delivery (or adjudicated delivery failure), receipt linked, non-demo buyer and seller, buyer cluster independently established for the pilot, and no self-dealing, seller-funded purchase, reciprocal purchase arrangement or replay. Purchases by founder/operator-affiliated **buyers** are excluded even when buying a different seller: they show testing, not independent market reputation. An independently funded, unaffiliated buyer purchasing the founder's brain **is eligible**; seller affiliation alone does not exclude it. Devnet evaluations never count. Reconciliation with brief §§1/4.3: every consult's usefulness is recorded and feeds its appropriate evidence view; only eligible independent outcomes update the public market score. The demo can show the recording/exclusion pipeline with a null market score, plus a clearly separated test/replay summary. A refund due to verified bad delivery remains one scored service failure (`y=0`, `w=1`), with that failure source shown separately; a payment that never confirmed is a technical failure, not a seller usefulness vote. Missing feedback is `unknown`, not failure or success; report coverage against all eligible consults so silence is visible. Quoting/declining is separately counted and does not inflate usefulness.

**Record privately:** consult/payment/quote IDs; buyer cluster and relationship declaration; brain/owner/key/slice/policy versions; topic and predeclared task criterion; timestamps and assessment window; network and payment/refund status; delivery/provenance result; all signal types, verdicts and evidence references; selected signal, weight, exclusion reason, adjudicator and correction history. Store no raw business questions or source excerpts in the public ledger or on-chain memo. Question commitments must not be public unsalted hashes of guessable private questions; 01 owns the safe commitment mechanism. Buyer retains its own receipt in gbrain. Public evidence is consented aggregates and redacted artifacts only.

**POLICY: observation window 7 days after delivery.** Unknown remains unknown if no signal arrives. Later well-evidenced corrections are allowed with an audit entry and recomputation; never rewrite a historical report silently. For score concentration control, select only the earliest eligible paid consult per buyer-cluster/seller in each fixed UTC calendar week, based on payment time, before knowing its verdict. Missing feedback on that consult does not let a later positive one substitute. Other genuine purchases remain in sales/feedback totals, labeled “repeat observations not scored.” This is intentionally conservative and can underrepresent improvement; it prevents one friendly buyer buying a reputation.

**Formula (POLICY):** use a Beta(1,1) prior and a trailing **90-day window**, based on payment time. This hard window is our simple decay rule; no time-weighting job or stale lifetime badge. At report time, for selected resolved observations `i`, let `y_i` be 1 useful or 0 not useful and `w_i` the source weight. Then:

`S = Σ w_i*y_i; F = Σ w_i*(1-y_i); score = (1+S)/(2+S+F)`.

`n` is the integer number of selected resolved observations, `n_eff = S+F` is weighted evidence, and `buyers_n` counts distinct buyer clusters. These are descriptive weighted pseudo-counts; do not call the score a calibrated probability of success or attach a statistically literal posterior interval to dependent/adversarial feedback. **Cold start:** when `n=0`, store `score=null`, not a visible 50% endorsement. **POLICY: until `n>=5` and `buyers_n>=3`, label “insufficient independent evidence.”** These thresholds are design choices; they are not statistical significance. Recompute on new signals, corrections and at least daily so expired observations leave the window; a snapshot older than 24 hours is labeled stale, its numeric score is suppressed, and it cannot be used for ordering.

Example, **fictional:** two objective successes and one human failure give `S=2`, `F=0.75`, `score=3/4.75≈0.632`, `n=3`, `n_eff=2.75`, `buyers_n=3`. Display: “Provisional usefulness 0.63/1; insufficient independent evidence. 2 useful / 3 assessed; 3 independent buyers; effective evidence 2.75; last 90 days. Sources: 2 objective, 1 human.” Also show eligible consult total, unknown, disputed, refund/failure, and excluded counts by reason. Do not display “63% accurate.” The founder may have zero independent score despite many impressive replay outcomes.

**Ranking:** no automated multi-brain ranking in this build (brief §4 deferred scope). `find` filters by topic, availability, price cap and explicit demo eligibility, then stable brain ID; score is visible evidence for buyer choice, never a hidden founder boost. Post-hackathon only, test whether showing outcomes changes selection/retention with a fixed eligible set before making it a tie-breaker. A small high score must not bury cold-start sellers. Relevance comes before reputation, and changing ranking requires a separate decision.

| Attack | Minimal control | Disclosure and residual weakness |
|---|---|---|
| Founder buys own brain / shared owner | Operator and seller owner IDs/known wallets mapped to one relationship cluster; exclude payments funded or coordinated by the founder/operator/seller or their affiliates from score and traction. Founder affiliation of the seller alone is not an exclusion. | Show technical-verification count and amount separately. Different wallets do not create different owners. |
| Collusion / reciprocal reviews | Manual pilot admission; declare funding/relationships; flag reciprocity and repeated funding patterns for evidence review, not automatic removal. Only supported, independently reviewed exclusions affect either polarity; unresolved contested exclusion suppresses numeric endorsement. | Show “under review” count; suspicion is not proof. Quiet collusion can pass these controls. |
| Sybil buyers | One reviewed human/team cluster across wallets; unverified identities remain unscored. Paid receipts alone are insufficient. | Show unverified paid activity separately; no “unique humans” claim from wallet counts. Independent identity checks are manual and fallible. |
| Review bombing | Only buyer-linked paid consult feedback; one selected observation/cluster/week; no anonymous score votes; symmetric appeal process. | Legitimate negatives stay. Excluding negative feedback merely because it hurts the founder is prohibited. Genuine paid attackers can still lower the score. |
| Selective reporting / seller reset | Coverage denominators include unanswered requests and unresolved disputes; key rotations stay attached to owner/brain history; replaced slices disclose version changes. | Do not erase old complaints by re-listing. New-topic performance cannot be inferred from old-topic outcomes. |

Publish exclusion counts (`self_dealing`, `operator_affiliated`, `demo`, `replay`, `devnet`, `funded_or_reciprocal`, `unverified_identity`, `duplicate`, `repeat_observation`, `disputed`) with a deterministic primary reason to avoid double counting and optional secondary flags. Do not publish private identity/funding evidence. Score does **not** prove factual accuracy, expertise, legality, confidentiality, future utility, independent causality, sybil resistance, or performance on untested topics. Four days can prove honest recording and exclusion rules, not a trustworthy network effect.

## 4. Registry

Static JSON with at least two listings, per brief §3 D2.2 and §4.4. This is the schema contract; it does not create a registry file in this pass. JSON Schema Draft 2020-12; runtime checks below are mandatory because JSON Schema cannot establish identity, content rights or score provenance.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "fee_bps", "last_updated", "listings"],
  "properties": {
    "version": {"const": 1},
    "fee_bps": {"type": "integer", "minimum": 0, "maximum": 1500},
    "last_updated": {"type": "string", "format": "date-time"},
    "listings": {"type": "array", "minItems": 2, "items": {"$ref": "#/$defs/listing"}}
  },
  "$defs": {
    "digest": {"type": ["string", "null"], "pattern": "^sha256:[0-9a-f]{64}$"},
    "listing": {
      "type": "object",
      "additionalProperties": false,
      "required": ["brain_id", "owner", "public_key", "key_id", "topics", "price", "endpoint", "slice_policy_hash", "slice_hash", "payout_config_hash", "approval_ref", "status", "demo_seller", "demo_label", "trust", "last_updated"],
      "properties": {
        "brain_id": {"type": "string", "pattern": "^[a-z0-9][a-z0-9-]{2,63}$"},
        "owner": {
          "type": "object", "additionalProperties": false,
          "required": ["id", "display_name", "operator_affiliated"],
          "properties": {
            "id": {"type": "string", "minLength": 1},
            "display_name": {"type": "string", "minLength": 1},
            "operator_affiliated": {"type": "boolean"}
          }
        },
        "public_key": {"type": ["string", "null"], "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"},
        "key_id": {"type": ["string", "null"]},
        "topics": {"type": "array", "minItems": 1, "uniqueItems": true, "items": {"type": "string", "minLength": 1}},
        "price": {
          "type": "object", "additionalProperties": false,
          "required": ["asset_ref", "amount_atomic"],
          "properties": {
            "asset_ref": {"type": ["string", "null"]},
            "amount_atomic": {"type": ["string", "null"], "pattern": "^[1-9][0-9]*$"}
          }
        },
        "endpoint": {"type": ["string", "null"], "format": "uri", "pattern": "^https://"},
        "slice_policy_hash": {"$ref": "#/$defs/digest"},
        "slice_hash": {"$ref": "#/$defs/digest"},
        "payout_config_hash": {"$ref": "#/$defs/digest"},
        "approval_ref": {"type": ["string", "null"]},
        "status": {"enum": ["draft", "active", "suspended"]},
        "demo_seller": {"type": "boolean"},
        "demo_label": {"type": ["string", "null"]},
        "trust": {
          "type": "object", "additionalProperties": false,
          "required": ["score", "n", "n_eff", "buyers_n", "window_days", "status", "as_of", "ledger_ref"],
          "properties": {
            "score": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
            "n": {"type": "integer", "minimum": 0},
            "n_eff": {"type": "number", "minimum": 0},
            "buyers_n": {"type": "integer", "minimum": 0},
            "window_days": {"const": 90},
            "status": {"enum": ["unrated", "insufficient", "observed", "disputed", "stale"]},
            "as_of": {"type": "string", "format": "date-time"},
            "ledger_ref": {"type": ["string", "null"]}
          }
        },
        "last_updated": {"type": "string", "format": "date-time"}
      }
    }
  }
}
```

Two **illustrative draft listings**, not claims of deployed sellers. Null means unconfigured; never substitute a fake working key, hash, price or endpoint:

```json
{
  "version": 1,
  "fee_bps": 1000,
  "last_updated": "2026-10-08T00:00:00+09:00",
  "listings": [
    {
      "brain_id": "founder-agent-ops",
      "owner": {"id": "founder", "display_name": "Founder", "operator_affiliated": true},
      "public_key": null, "key_id": null,
      "topics": ["agent-completion-checks", "personal-harness-ops"],
      "price": {"asset_ref": null, "amount_atomic": null},
      "endpoint": null, "slice_policy_hash": null, "slice_hash": null, "payout_config_hash": null, "approval_ref": null,
      "status": "draft", "demo_seller": false, "demo_label": null,
      "trust": {"score": null, "n": 0, "n_eff": 0, "buyers_n": 0, "window_days": 90, "status": "unrated", "as_of": "2026-10-08T00:00:00+09:00", "ledger_ref": null},
      "last_updated": "2026-10-08T00:00:00+09:00"
    },
    {
      "brain_id": "demo-public-runbooks",
      "owner": {"id": "founder", "display_name": "Founder-operated fixture", "operator_affiliated": true},
      "public_key": null, "key_id": null,
      "topics": ["synthetic-runbook-examples"],
      "price": {"asset_ref": null, "amount_atomic": null},
      "endpoint": null, "slice_policy_hash": null, "slice_hash": null, "payout_config_hash": null, "approval_ref": null,
      "status": "draft", "demo_seller": true,
      "demo_label": "DEMO SELLER — founder-operated fixture; not independent supply",
      "trust": {"score": null, "n": 0, "n_eff": 0, "buyers_n": 0, "window_days": 90, "status": "unrated", "as_of": "2026-10-08T00:00:00+09:00", "ledger_ref": null},
      "last_updated": "2026-10-08T00:00:00+09:00"
    }
  ]
}
```

Runtime publication rules: unique brain IDs; decode signing public key to the agreed Ed25519 representation and verify control; require non-null key/key ID, registered asset/atomic price, reachable endpoint, manifest/policy/payout-config hashes and approval reference before `active`; enforce §2 price bounds. 01 may map its existing signing identity into these fields, but cannot drop verifiability. `asset_ref` resolves via 01's asset configuration to exact network, mint and decimals, never a symbol alone. Public signing key need not equal settlement recipient; receipt/quote must bind the approved payout recipient to the listing. `payout_config_hash` binds a publicly retrievable immutable configuration containing network, asset, seller recipient and marketplace recipient; both seller and operator approve it. 01 chooses its storage/signing representation. Buyer verifies this binding before payment; endpoint-provided replacement addresses are not authority. A recipient change requires a new approved configuration and quote. Fee rounding must leave `seller_amount + fee_amount = price` exactly. Trust `status` is `unrated` with zero resolved eligible evidence, `insufficient` below §3 thresholds, otherwise `observed`; `disputed` or `stale` overrides those labels. Public score is null for `unrated`, `disputed` or `stale`; retain internal calculations in the ledger, and display the reason and counts. Validate `n_eff<=n`, `buyers_n<=n`, score against the ledger and stale timestamps. Hashes bind approved bytes, not a mutable folder name.

Founder `list` path: explicit approved export + policy/approval references + price/topics + public key/endpoint → validation → preview of public metadata and fee → owner approves publication → write/update static listing with zero independently earned trust. This is an interface for the `list` command, not a prescribed CLI syntax (brief §3 D2.1/D2.3). It must never enumerate/export the entire personal brain or publish on a failed gate. Human publication approval is a required business gate, separate from mainnet payment approval.

Second seller: personally consented gbrain user supplies an approved public export, own identity/control proof, accepted fee/refund terms and endpoint. Founder manually reviews and adds a second static entry; no stranger signup system. If unavailable at **2026-10-11 12:00 JST**, keep an operational synthetic demo listing. That listing may demonstrate routing on devnet after passing the same content/provenance gate, but all outcomes remain demo-only and its market score stays null. Label it in registry, `find`, quotes, receipts, report and pitch; exclude it from default paid buyer selection unless the buyer explicitly enables demo mode. No borrowed name/photo, invented expert, presumed consent, or claim of two independent sellers. Draft entries satisfy schema cardinality, not readiness: by demo time both entries must be usable for their stated real/devnet-demo role. A real second seller with no purchases is “listed,” not validated supply.

## 5. Pre-publication gate policy (business rules; architecture is in 01)

Only seller-authored, deliberately public personal agent-ops knowledge and rights-cleared public references may be sold. Every page must independently pass; permission on a directory or prior export is insufficient (brief §§4.1/4.8, 5, 7.5). A page being online does not alone establish a right to resell it. The value is curated application with citations, not copying public documents for exclusivity.

**Forbidden:** employer/business data (any Org or confidential data); customer records; non-public member information; credentials/private keys/tokens; third-party private communications or personal data; internal code/logs, privileged incidents or derived summaries of these. “Anonymized,” renamed, or model-summarized business material is still prohibited. A rights declaration does not override this product boundary. Do not give the seller process a full private-brain connection and rely on a prompt to filter it.

Select the founder slice from independently authored personal harness/incident notes: first identify eligible non-business origins, then create a small frozen export with explicit page IDs, versions and hashes. No inherited graph edges, attachments, backlink titles, filesystem paths or citations to unapproved pages. Per 00a P1/P3, the existing single source is not a publication boundary: transcript-derived and dream-generated pages default to excluded based on `raw_source`, `source_kind`, `ingested_via` and `dream_generated`; missing/ambiguous provenance also fails closed. A public-source label or read grant alone never makes a page safe. A personal lesson learned while doing employer work does not automatically qualify; if its provenance cannot be disentangled, omit it. If fewer than approximately ten genuine eligible incidents exist, report the shortfall rather than use business incidents or present synthetic ones as real.

Slice-readiness business contract (00a P3, Part D): prefer a few newly authored, rights-clear personal public lessons over attempting to sanitize the whole brain; an optional dedicated public source is staging, not the serving security boundary. Each candidate needs `visibility`, `origin_category`, `sensitivity`, `review_status`, content/version hash and private provenance/derived-from references where applicable. Promote only after review, then seal an immutable export. Remove cross-boundary links rather than inventing public citations; unknown dependency provenance rejects the candidate. Keep private lineage outside the public manifest. Any origin/policy change flags dependent pages for re-review; a takedown withdraws dependent public versions and blocks new quotes. 01 owns dependency tracking and serving isolation; if automatic change detection is unavailable, freeze the approved export for the pilot and require a manual withdrawal check before each listing refresh.

Founder-time allowance **UNVERIFIED planning estimate:** 2–4 hours for 5–10 short public lessons, including provenance review and sealing; verify by timing the first two pages in a 30-minute trial, then cut page count if needed. 00a's 30–60-page estimate is not a minimum; approximately ten replay incidents do not require ten sale pages. No finished slice-readiness tool is presumed. Strangers need the same metadata worksheet, reject examples and manual promotion process in §8. Use `SliceManifest` to expose only the approved sealed bundle; marketplace holds registry/receipt metadata, while 01 chooses seller-side hosting and upload transport (00a P2).

Seller-side injection/extraction business limits (00a P1): require `SellerIsolation` from 01 to prevent retrieved text or buyer questions granting tools, network access or any filesystem access beyond the sealed export. Answer content cannot authorize a buyer action, wallet operation or feedback signal. **POLICY:** at most 2,000 characters of answer text, at most 200 characters of verbatim source quotation in total and at most 3 approved citations per answer; requests to enumerate/export the slice decline without charge. Public citations may still reveal the knowledge and paraphrases can still reconstruct it: these limits reduce bulk extraction, not provide DRM. Repeated probing remains bounded by §2. Verify these limits and all three injection directions using 03's positive/negative controls before serving; do not claim “injection-proof.”

Concrete gate checklist (every item required before publication):

- [ ] Owner records page origin, authorship, intended public audience and rights basis; any employer/customer/member/private-conversation origin rejects the page.
- [ ] Explicit allowlist contains immutable page ID and content hash; export contains only those pages and separately approved dependencies.
- [ ] Human reads the **actual exported bytes**, front matter, examples, links and metadata; approves public sale and confirms no private/business-derived material.
- [ ] Secret scan and business-data guard pass on the export; record scanner/rule versions and findings. A clean scan supplements human review; it does not certify privacy.
- [ ] Citation targets are included approved public content or rights-cleared public URLs; all attached/linked local material is independently checked. No internal identifiers or private paths.
- [ ] Reviewer checks content for executable/prompt instructions, wallet directions or fabricated authority. Any illustrative command remains untrusted knowledge, not authority to execute it; 01 enforces isolation.
- [ ] Approval log records approver, UTC timestamp, source category, rights basis, page/export/policy hashes, tool reports, decision/reason and revocation route. Founder self-approval is explicitly labeled; never “independently audited.”
- [ ] `list` verifies exact hash equality to that approval; subsequent content or policy change invalidates approval and blocks serving until reviewed again. Revoke/remove a leaked page, stop new sales and invalidate affected quotes; 01 owns the mechanics.

Keep the detailed approval log access-controlled; publish only sanitized approval references and approved-manifest information. Even rejected page titles may be private. Do not commit rejected source text to the marketplace repo. No private keys enter this workflow.

| Example page type (no real contents) | Allowed? | Reason |
|---|---|---|
| Founder-authored checklist for checking leftovers in a personal toy-agent exercise | Allowed after gate | Personal origin, rights clear, public artifact and bounded lesson. |
| Personal sandbox runbook explaining an invented timeout, using dummy identifiers | Allowed after gate; synthetic label if used in demo | Public-safe instructional content; cannot count as a real historical incident. |
| Employer deployment postmortem with company names removed | Not allowed | Business provenance survives redaction. |
| Customer ticket, member directory, or private community conversation summarized by an LLM | Not allowed | Customer/member/private third-party information and uncertain consent/rights. |
| Personal operations note containing a real API token, private URL or copied confidential snippet | Not allowed as submitted | Remove the entire sensitive source dependency; only independently safe material can be separately reviewed. Rotating a token does not make the original page sellable. |

## 6. Honest-traction ledger

Use disjoint primary classifications for payment/consult events and separate dimensions (payment network, buyer affiliation, refund, useful signal). Interest is a person-level funnel metric, not another transaction count: the headline interest count is currently unconverted prospects; historical expressions remain in the ledger when a person converts but leave that headline. Never sum people, payments and tests into one traction number. A receipt cannot be counted once as demo and again as a customer. Count distinct buyer clusters separately from transaction counts; retries/duplicate receipts are one consult. Save evidence as it occurs; no back-filled testimonials (brief §§3 Q2/Q3, 5).

| Class | Counting rule | Required evidence | Exact permitted pitch wording | Wording prohibited for that evidence |
|---|---|---|---|---|
| (i) Technical verification | Founder/self/affiliate-funded runs, reciprocal tests, synthetic sellers, replay and devnet transactions. Count successful flows, failed flows and networks separately. Self-pay never becomes traction because it is on mainnet. | Quote, signed answer or decline, provenance verification, receipt, relationship tags, split explorer evidence for confirmed payments; runtime approval record for mainnet. | “We verified [N] end-to-end test consults, including [M] founder-funded mainnet payments. These are technical tests, not customer demand.” | “We have [N] customers”; “Organic revenue”; “Product-market fit”; “Two independent sellers” when one is a fixture. |
| (ii) Invited interest | Unique currently unconverted independent person explicitly says they want to try/buy or contribute a slice. Count buyer and seller interests separately, deduplicate roles when giving a combined total. An invitation sent, view, like or unanswered message counts zero. A listed seller requires consent and completed listing gates beyond mere interest. | Dated consented message/interview note; intended use, role and relationship recorded; no invented commitments. | “[N] independent prospects expressed interest after invitation and have not purchased; expressions of interest are not purchases.” Or “[S] independent sellers have consented and completed listing; purchases are reported separately.” | “Signed customers”; “Paid users”; “Validated demand”; name-dropping a hoped-for participant. |
| (iii) Real third-party transaction | Confirmed mainnet purchase for a buyer's genuine task, funded by an independent buyer, non-demo seller, no founder reimbursement, incentive contingent on purchase, reciprocity or agreed test-only purchase. Buyer may have been invited; label acquisition source. For demand count require delivered answer; non-delivery is a separate external payment/failure, not a completed purchase. | Receipt/quote and delivery evidence; buyer confirmation of own task and funding; relationship declaration/review; refund status; consent to publish any identifying detail. | “[N] independent buyers completed [T] paid consults for their own tasks, totaling [amount/asset] gross, [refunds] refunded and [net] retained; [I] buyers were invited. Utility is reported separately.” | “Organic” for invited users; “Profitable” from gross sales; “Useful answers” solely from payment; “Unique people” from wallet count; demand from a subsidized purchase. |

Report external but independence-unverified payments as “unverified external activity,” excluded from verified-third-party totals pending review. Refunded completed orders stay in the historical transaction count with their refund flag, but never in retained-sales totals; delivery failures have their own count. Show full-refund and repeat-purchase counts so gross numbers cannot conceal them. If a later relationship discovery invalidates eligibility, publish a correction and revise totals.

**Mandatory mainnet sentence:** “This mainnet transaction proves that money moved and the fee split worked; it does not prove demand.” Use only after confirming both recipient amounts. If no independently funded transaction exists: “We have no verified third-party paid demand yet.” The brief's definition of “real” (real money moved, §3 Q3) is a technical milestone, not a license to redefine customer demand. Founder buying his own answer creates neither external seller income nor external marketplace revenue on consolidation.

When questions are preapproved, say “The agent selects and purchases a consult within a human-approved safe question scope and budget.” Do not imply arbitrary private-context questions can be dispatched autonomously. Runtime human approval still applies to the required mainnet payment.

One-page pitch report carries three labeled totals: **technical verification / invited interest / verified independent purchases**, plus number of independent active sellers and demo listings. Unknown counts remain “not measured”; counts backed by a complete ledger can be zero. Keep permissioned evidence separate from public screenshots. Do not contact anyone or execute any payment merely to satisfy a pitch number.

## 7. The avoided-loss replay as the value proof

Economic estimand: the **incremental loss avoided by using a consult versus not using it on the same recorded incident**, including consult overhead and possible harm. “Loss” is a missed task check, repeated operator work or a measurable recovery delay; not hypothetical lost customer revenue, total historical project cost, or catastrophic damage that never occurred (brief §§4.6, 5, 7.7). Execution protocol belongs to a later pass.

For incident `i`, retain paired raw measurements and uncertainty ranges:

- `L0_i`: baseline human remediation minutes; `L1_i`: consulted human remediation minutes; `H_i`: extra human reading/decision/setup time caused by consulting. Human time saved `ΔT_i = L0_i - L1_i - H_i`. Negative values remain negative.
- Measure elapsed agent/wall-clock time separately. Do not multiply unattended waiting by an engineer's hourly rate, nor count wall-clock savings and human labor savings twice.
- With declared hourly opportunity cost `W` in the buyer's currency, `V_i = ΔT_i*W/60 + avoided_external_cost_i - incremental_other_compute_i`. Define `incremental_other_compute_i = other_task_compute_with_consult - other_task_compute_without_consult`, excluding the consult price, its seller inference and its network/conversion fees. It may be negative; subtract it exactly once. `avoided_external_cost_i` contains only separately evidenced non-compute cash savings, so it cannot duplicate that compute delta. `W` is a buyer-supplied assumption, not realized cash savings.
- `C_i = quoted_answer_price + attributable_network_cost + conversion_cost`, in the same currency. `net_value_i = V_i - C_i`. Price-vs-avoided-loss ratio `ρ_i=C_i/V_i` only when `V_i>0`; smaller is better. If `V_i<=0`, report “no positive avoided loss,” not an infinite return claim. Answer-price-only `P/V` may be supplemental, never hide total buyer cost.

**Worked example — UNVERIFIED assumptions, not a replay result:** baseline remediation 30–45 human minutes, consulted remediation plus overhead 10–15 minutes → conservative saved-time range 15–35 minutes. Assume `W=¥3,000/hour`, no other savings and no extra compute: `V=¥750–¥1,750`. Assume answer `$0.25`, total cost `$0.26`, illustrative exchange rate `¥150/$` → answer `¥37.50`, total `¥39`, net modeled value `¥711–¥1,711`, `ρ≈0.022–0.052`. Equivalent modeled value is `$5.00–$11.67`. None is a verified exchange rate, fee or buyer wage. Verify actual timings from paired logs, actual rail cost from receipts, dated FX from a named source, and `W` with the evaluator before reporting; cap initial FX/cost lookup at 30 minutes. If any input is unavailable, report minutes and native asset cost without fabricated currency conversion.

For approximately ten cases, publish per-incident paired minutes/ranges, pass/fail/unknown, consult cost, reason for abstention, deterioration and failed delivery. Use counts: “[k] of [n] eligible historical cases met the predeclared prevention criterion; [h] worsened; [u] unresolved.” Show discordant pair counts (baseline failed/consult succeeded and reverse), median and min–max paired time changes, and total measured spend. If statistical uncertainty is computed later, label method and assumptions; simple observed ranges are **not** confidence intervals. No “80% effective,” projected population uplift, annualized savings, or dropping ambiguous cases from the denominator. Separate real eligible incidents from synthetic demo exercises and disclose exclusions/reasons.

A credible replay can support “helped in these incidents,” not “buyers will pay” or “the marketplace was necessary.” A public checklist, a direct seller endpoint or the same corpus without the marketplace may provide equal value. To stress-test pricing, ask independent prospective buyers which recorded interventions they would buy at a shown total price; stated preference is invited interest until a genuine funded task purchase occurs. Replaying ten curated founder failures is neither ten customers nor independent market reputation. Require the later evaluation owner to document corpus overlap, hindsight leakage, selection and evaluator conflicts before asserting causality.

## 8. Seller onboarding path for strangers (post-hackathon, light)

Deferred by brief §4. Smallest next path is a manually reviewed request, not an open upload product: seller identity/control check → explain public-only boundary → authorship/rights/employer-conflict declaration → owner exports a few approved pages → human content gate → signed sample answer/provenance check → accept published fees and delivery/refund terms → one manually approved static listing → limited pilot → retained-sales/outcome review before increasing volume. New sellers start with no independent score. Stop on unresolved origin/consent rather than asking an LLM to declare content safe.

Questions to close before admitting strangers, not assertions that a checkbox satisfies the law:

- Who owns the underlying notes and the transformation? Does the seller have permission to sell summaries or excerpts derived from other people's conversations? Consent to participating in a conversation is not presumed consent to resale.
- Is there an employment agreement, confidentiality duty or client contract affecting the knowledge? The product's absolute business-data exclusion remains even if a seller offers a waiver.
- Which participants must consent to public release, processing by model providers and any retention? What can be withdrawn, and what cannot be recalled once an answer was delivered?
- Who handles deletion, complaints, payout/refund obligations, tax invoices, sanctions/payment restrictions and consumer terms for the seller's/buyer's jurisdictions? Do not claim the noncustodial design settles these questions.
- What buyer questions and evaluation artifacts may be retained, where, for how long, and with what access? **POLICY proposal:** raw pilot questions stay in the buyer's own records; the marketplace keeps only minimum receipt/evidence metadata, with a retention schedule approved before stranger launch.

Founder must obtain qualified jurisdiction-specific advice where needed before that expansion. The Japanese PPC's [official laws/guidance index](https://www.ppc.go.jp/en/legal/) is a starting source for personal-data review, not a finding that this design is compliant. Exact obligations and content rights remain **UNVERIFIED**; a 30-minute issue-spotting session can identify the required review but cannot certify legality. No new legal/compliance machinery is part of the four-day build. The invite-only pilot still needs seller consent, explicit price/refund acceptance and review of applicable payment/provider terms before external paid orders; deferring stranger onboarding is not an exemption.

## 9. Risks to the business model and early-warning metrics; kill criteria after launch

All thresholds below are **POLICY experiment stop rules**, not statistically validated market benchmarks. Start the observation clock on the first externally accessible approved pilot, not the hackathon demonstration. Use 30 calendar days, and report both raw denominators and acquisition method. A “qualified buyer opportunity” is a unique independent buyer with a genuine in-scope task who received a usable quote; count once per buyer in the initial demand test. Recruit at most 10 such opportunities for the first decision; lack of recruitment is itself evidence about distribution, not proof that nobody needs the product.

| Risk | Early warning / evidence | Stop or change rule |
|---|---|---|
| Public knowledge is not worth buying | Qualified quotes, refusal reasons, independent funded purchases and repeat task purchases; compare public checklist/direct access. | Zero completed independent purchases after 10 qualified opportunities, or no path to recruit 10 within 30 days: stop marketplace expansion, retain only technical evidence and reassess a single-seller tool. |
| Marketplace adds no value over direct | Buyers' stated integration burden and observed channel choice; repeat purchases bypass the marketplace; second seller topic coverage. | By day 30, no independent approved seller, or all measured utility/purchases are founder-only and buyers prefer direct access: use the fallback below. Do not pretend two registry rows are a market. |
| Low prices cannot fund operation | Cohort profit using §2, including unsuccessful pre-checks, retries, labor, refunds, FX/network subsidies and curation. | Two consecutive weekly cohorts with negative variable contribution at the maximum tested acceptable price: stop paid acquisition; narrow scope/raise price once only if buyers accept, otherwise stop monetized pilot. Fixed-cost loss is shown separately and cannot be hidden. |
| Free pre-check attracts extraction/abuse | Admitted/blocked counts, cost-cap trips, quote conversion, per-cluster concentration and source leakage attempts. | Immediately stop new quotes on budget exhaustion; repeated daily exhaustion without independent conversions triggers invite-only tightening or deterministic curated preparation. Never bill a decline to solve this. |
| Reputation is decorative/manipulable | Resolved outcomes versus eligible consults, independent buyer clusters, source disagreements, exclusions/appeals, concentration and missingness. | If fewer than 5 independent resolved observations from 3 buyers by day 30, retain “insufficient evidence,” no ranking claims. Any confirmed vote manipulation removes affected observations with an audit entry; no seller-controlled edits. |
| Answers cause rework or fail delivery | Signed delivery failures, full-price refunds, paired replay harm and task-level negative outcomes. | Any private-data exposure or unauthorized payment: suspend affected sales immediately. Two unfulfilled paid obligations pending refund: suspend affected seller until resolved. If observed net time/value is nonpositive for a majority of the eligible replay cases, stop claiming avoided-loss value and revise the slice before paid expansion. |
| Seller work is hidden | Curation and support minutes, net retained seller payout, removal/refresh burden. | If the independent seller would not continue at observed compensation, count that as failed supply economics; do not subsidize indefinitely and call it scale. |

These are learning/stop decisions, not grounds to erase successful or negative history. At a tiny sample, preserve uncertainty. Do not continue marketplace growth solely because the fee-split explorer link works. The founder owns the day-30 decision and must publish the observed counts and the chosen next experiment in the one-page report.

## 10. Open decisions you could NOT close, each with owner, evidence needed, deadline

Closed here: prepared-answer B+ interface aligned to 01, seller-set flat pilot pricing, fee default/range, bounded preparation, no automated ranking, static/manual listing and strict public-only gate. The score/exclusion policy and funded full-price remedy are concrete proposals from this economics pass, pending the explicit 01/02 reconciliation below. Other open items are implementation dependencies or empirical unknowns, not permission to re-litigate the brief.

| Decision / conflict to resolve | Owner | Evidence needed; bounded next step | Deadline / fallback |
|---|---|---|---|
| Asset/network, atomic split, network-cost cap and delivery/refund feasibility | 01 architecture lead + founder | Gate-1 devnet receipt proving one confirmed Solana transaction signature containing both exact recipient transfers and receipt-linked delivery/lost-response recovery; separately require refund-path and reserve evidence before external paid orders. 01 Gate 1 itself does not test refund execution. Each unknown from brief §6 gets a 30-minute probe, not assumed support. Reconcile all interface names with 01. | End of day 2, **2026-10-10 00:00 JST** (day 1 = Oct 8). If the rail cannot meet the binding split/no-custody requirement, flag failure; do not silently substitute sequential settlement or claim Gate 1 passed. No external paid pilot until refund liabilities are funded. Still UNVERIFIED until 01 supplies this evidence. |
| Actual seller/model cost and viable price | Founder as seller | 30-minute bounded cost calibration using chosen provider rates and all attempts; receipt reconciliation; explain fixed labor separately. Then observe independent quote conversion. | Before first mainnet demonstration for spend bounds; before first external sale for pilot budget; demand readout 30 days after pilot opens. If unknown, stay devnet and make no margin claim. |
| Independent second seller and publication consent | Founder / community outreach owner | Named user's explicit consent, clean approved slice, endpoint and control proof. A 30-minute outreach preparation/check does not manufacture consent; wait for an actual reply. | **2026-10-11 12:00 JST** cut line: label and use demo seller if absent; never infer participation. |
| Eligible public slice and roughly ten real personal incidents | Founder + later replay owner | Signed gate log, immutable manifests, incident-origin review and an honest shortfall count. Selection/protocol review is capped at 30 minutes initially; prepare actual safe artifacts separately. | Gate 2 evidence ready by **2026-10-10 18:00 JST**, aligned to 01; Oct 11 noon remains the final cut line. If insufficient, flag Gate 2 shortfall and reduce claims, not privacy standards. |
| Economic meaning of replay success and uncertainty | Later replay-design owner | Predeclared outcome rubric, paired timing boundaries, leakage assessment and independent review where available. | Before running/reporting replay; protocol frozen by **2026-10-10 18:00 JST**. Unknowns remain unresolved cases; no extrapolation. |
| Fee willingness, buyer valuation and direct-access alternative | Founder / product owner | Genuine quotes, non-purchase reasons and funded own-task purchases; initial interview protocol prepared in 30 minutes. No one can verify market willingness in a research lookup. | First 10 qualified opportunities or day 30 after pilot, whichever comes first. Keep fee hypothesis labeled UNVERIFIED until evidence supports it. |
| Pay.sh commercial fee | Product owner | Official terms/operator response, maximum 30 minutes initial research. | Before final pitch by **2026-10-12**; leave “unknown” if unavailable. No dependency on its price or adoption claims. |
| Rights/consent, retention, tax and payment terms for strangers; independent dispute reviewer | Founder with qualified adviser / uninvolved reviewer | 30-minute issue triage; actual relevant agreements/advice and named review owner before admission. Founder cannot review his own contested seller claims. | Before stranger pilot, not a hackathon feature. Keep onboarding manual/closed and disputes visibly unresolved if evidence is unavailable. |
| 01 consistency after independent design review | Design owner + 01 author | Two-model review completed as recorded below; architecture author still needs to accept or flag the conflicts and interface mapping below, especially trust eligibility, reserves and privacy admission. | Before implementation handoff; 01 appeared during final validation and was cross-read; compatibility is not yet accepted by its author. Do not treat document review as runtime proof. |

Cross-pass reconciliation, based on the newly available [01-architecture.md](01-architecture.md): these are explicit conflicts, not permission for an implementer to choose silently. Brief decisions remain binding. §2 above now adopts 01's prepared-answer interface and cost profile; the technical $0.01 test is explicitly separate from pilot pricing. Its one-signature/two-transfer rail satisfies the requested shape, subject to actual Gate-1 proof.

| Remaining mismatch | Proposed resolution / owner / evidence / deadline |
|---|---|
| 01 §6 scores only human votes, one buyer/seller/day, excludes fully refunded purchases and uses different cold-start/display rules; 02 §3 weights task checks/humans/agents, limits weekly concentration and keeps service failures. | Economics owner + 01 owner must freeze one `OutcomeLedger` policy before implementing feedback, no later than **Oct 9 18:00 JST**. Preserve at minimum failure visibility: refunds must not erase negative service evidence. If choosing the simpler human-only score, label it as such and show objective/agent/service-failure counts alongside it. No claim these incompatible formulas are already integrated. |
| 01 §9 promises manual recipient refunds without an operator guarantee and permits discretionary partial goodwill refunds; 02 §2 requires funded full-price remedies for external paid orders and no partial product remedy. | Founder + payment owner decide before any external paid order, **Oct 9 18:00 JST** design freeze. Show an operator reserve and recovery procedure or keep external paid pilot closed. Partial on-chain recovery is a receipt status, not fulfillment of the full-price obligation. The founder-only technical test may explicitly disclose 01's unguaranteed manual recovery. |
| 01 specifies a 30-day support/claim window and fast delivery rescue; 02 distinguishes a 10-minute delivery deadline and 7-day usefulness window. | These clocks serve different purposes: keep 7-day outcome collection, adopt 30-day remedy claims only after pricing the reserve exposure, and allow earlier rescue. Founder/payment owner must fix reserve release timing and disclosure by **Oct 9 18:00 JST**. Until fixed, do not release pilot refund reserves merely on delivery. |
| Registry/quote names and structures differ: 01 embeds recipients and pins the registry; 02 uses `brain_id`, `payout_config_hash` and derived trust fields. | 01 owner maps the economic schema to one canonical wire format before implementation, **Oct 9 18:00 JST**; equivalent immutable bindings are acceptable. Never maintain two competing authoritative registries. Schema examples here are policy contracts, not deployed formats. |
| 01 Gate 2 is **Oct 10 18:00 JST**; initial economics fallback discussion allowed evidence until the Oct 11 noon cut line. | Use the earlier **Oct 10 18:00 JST** Gate 2; Oct 11 noon is the final scope cut, not a gate extension. Founder/replay owner records any shortfall rather than moving the goalpost. |
| 01 buyer input uses approved context plus scans; 02 asks for approval of exact question bytes or constrained safe templates. | Security/01 owner demonstrates that allowed question construction cannot import private agent context, before any external dispatch and by **Oct 9 18:00 JST**. If not demonstrated, use a fixed preapproved question set and describe that limitation. |

Submission is due 2026-10-12 per brief §2; exact submission time is **UNVERIFIED**. Founder checks organizer deadline/timezone within 30 minutes before scheduling final submission. This document introduces no deployment/payment authorization and changes none of the brief's agreed milestones.

Adversarial review record (2026-10-08): separate read-only reviews by **GPT-6 Astra** (economics/abuse) and **GPT-6 Sol** (trust/interface/brief consistency). Both read 00 before 02. Material findings incorporated: buyer-versus-seller affiliation distinction; seller-authored rather than founder-only publication; unrecovered seller refunds and pre-admission reserves; evidence-gated exclusions and explicit service-failure weight; immutable payout binding; interest-to-purchase deduplication; single-transaction wording; buyer-question privacy admission; fee reapproval; and a single, signed compute-cost delta. These are adversarial document checks, not two human audits, runtime validation, or market evidence. Follow-up review confirmed the material corrections; final interface wording explicitly binds quote recipients and question approval before dispatch. 01 arrived afterward and was cross-read: prepared-answer economics was recalculated, while the explicit disagreements above remain open. Full 01 integration remains open.

## Self-critique: the 5 weakest points of this design

1. **The marketplace has almost no demonstrated reason to exist.** One useful founder brain plus a fixture proves routing, not a two-sided market. Every claimed network effect is currently a hypothesis.
2. **The reputation number can look more scientific than its inputs deserve.** Fractional weights and windows are arbitrary policy; manual identity review, correlated tasks and selective feedback leave it gameable. The honest demo score may be null.
3. **The margin example hides an unforgiving scale problem even while labeling it.** Pennies of fee cannot pay human disputes, curation and careful rights review at low volume. Cheap model inference does not make the business cheap.
4. **The safe slice may remove the knowledge people actually value.** Personal public-only incidents could be too generic; recovering usefulness by slipping in business-derived detail would violate the product, not improve it.
5. **The replay can reward hindsight and a founder-specific corpus.** Ten cherry-picked operational failures can flatter the seller and show no causal marketplace benefit. Even a clean positive replay cannot establish recurring independent demand.

## What would make us abandon the marketplace framing and fall back to a single-seller tool

After honoring the hackathon's agreed marketplace skeleton, switch framing if the day-30 gates show no independent supply or funded buyer demand, if repeat buyers prefer a direct integration, or if operating trust/refunds costs more than any accepted fee. Also switch if useful outcomes depend on founder-specific curation that strangers cannot reproduce safely. Do not wait for a statistically impressive sample if privacy or unauthorized-payment harm appears; suspend first.

The fallback is explicitly **one founder-operated paid knowledge tool**: one public slice, one seller endpoint/MCP integration, transparent price, citations, budget limits, abstention, receipts and a visible personal evaluation report. Remove marketplace supply/network-effect claims and internal fee transfers from revenue claims; keep outcomes and limitations visible. A useful single-seller tool can be a successful result. A fictitious marketplace cannot.
