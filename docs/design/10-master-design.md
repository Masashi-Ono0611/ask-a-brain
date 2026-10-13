## 要約
Ask a Brain は、AI が専門知識を決められた範囲で購入し、支払いと結果を確認できる仕組みです。
裏側の考え方を Market Harness と呼び、gbrain の公開スライスを最初の市場にします。
最初は役立つ公開ページ5枚を基本とし、最大10枚。回答は審査済みの抜粋に限定します。
質問は承認済みの文面だけを送り、送金は別プロセスで検査して人間のウォレットで署名します。
2〜3件の掲載先に無料確認し、「一方は辞退、もう一方は回答」を示します。
業務情報を含む元の脳の検索・候補選び・事例調査は、AI セッション外で創業者だけが行います。
公開した資料は無料で取得できます。売るのは秘密ではなく、必要な助言の選択と適用です。
撤回した資料は支払い後でも返さず、再起動後のキャッシュも止め、返金の未処理額を残します。
評価は失敗の再現、無料チェックリスト、有料相談の3条件で比べ、実際の件数・時間・支出を示します。
自己購入は資金移動の技術検証です。需要・収益性・独立した評判の証明にはしません。
10月12日18時JSTに提出物を完成させ、公式締切の10月13日15時59分JSTまで余裕を残します。

# Ask a Brain — normative master design

Status: design contract, 2026-10-08 evening JST. No application implementation, runtime control, payment, content approval, incident count or submission is verified by this document. One founder **F** and one AI implementer **I** execute the plan; role names do not imply additional staff. This pass creates documents only.

<a id="m00"></a>
## M00 — Authority and supersession

**Precedence: `decisions.md` > this master > `00-brief.md` / `00a-seller-priorities.md` > `01-architecture.md` / `02-economics-trust.md` / `04-seller-data-and-hosting.md` / `05-slice-readiness.md` > `03-security-eval-plan.md`.** The supplied [official-rules facts](../research/cwf-official-rules-facts.md) govern contest facts; the older seven startup criteria are superseded. Dates here are JST unless explicitly labeled. D0's “due Oct 12” is the organizer's PT calendar date, not a JST midnight deadline; no founder decision is reversed.

The master wins where older text conflicts. Unmentioned compatible details may be reused only within this scope and constants. A citation to an older section does not revive its conflicting examples, parameters, extra services or workload. No permission to spend, publish selected content, expose private data, create the remote, or sign mainnet follows from a design default. Binding ledger decisions are not reopened. New conflicts with that ledger must be flagged before dependent work.

| Older source and explicit sections superseded | Replacement and reason |
|---|---|
| 00 §1; §§3 Q1/Q6/Q8, 4.3–6, 7.4/7.7 | M01/M02/M09/M10: supervised purchases, outcome ledger rather than numeric score, bounded fan-out, actual small n and mandatory free comparator. Preserve buyer story, fee and minimal market skeleton. |
| 00 §2 contest paragraph; §§6–7 factual/unknown deadline claims | M12/M13: official six criteria and precise deadline; founder claims are attributed; documentation is not runtime evidence. Video lengths remain internal targets pending form check. |
| 00a P2 cloud recommendation/page estimate; P3 S-B staging, 30–60-page estimate and distillation wording | M07/M08: local H1, five useful pages minimum/ten maximum, directory staging; no private inputs to any AI session. P1–P3 remain mandatory. |
| 01 §1 signer/marketplace deployment; §§2/7 generation; §8 seller-required consult and spend approval threshold | M02–M05/M08: human wallet, lightweight local ledger, extractive preparation, bounded free fan-out; all signatures supervised. |
| 01 §3 alternatives/fallback (e) and four-hour native-SOL rescue | M05: one SPL rail; failed Gate 1 blocks paid demo, with no second rail. |
| 01 §§4/6–7/9 revocation and cache recovery | M06/M07: safety revocation blocks all further disclosure, including restored caches. |
| 01 §§5–6 registry trust snapshot/formula; §8 receipt path | M04/M09: entire static registry hash pinned, outcomes separate, no score; isolated prefixed receipt import. |
| 01 §10 calendar, replay, open decisions and storyboard | M10–M15: one calendar, three arms, founder hours, current unknowns, D3/D4 narrative. |
| 02 interfaces/§§2–4 preparation caps, external pricing, reserves, numeric reputation, alternate registry schema | M03–M06/M09/M15: canonical limits and 01 wire fields; external orders closed; manual refunds; raw outcomes. External price hypotheses are future experiments only. |
| 02 §§5–7 quotation/publishing details, competing traction sentences, currency avoided-loss model | M03/M07/M09/M10/M13: useful extract limits, founder-only selection, one honest sentence, counts/minutes/actual spend only. |
| 02 §§8–10 external launch, calendars and review-model attribution | M12–M15: no launch during contest; model identities unverified; post-contest conditions are not current implementation tasks. |
| 04 A2–A4/A6, B3/C1 Minisign, delegated keys, signed registry, post-payment signature, no-page endpoint | M04/M07/M11: one Ed25519/JCS system, precommitted answer, complete public pages, unified controls. |
| 04 A4/B1/B3–B5 limits, Bun, cloud default, models, retention and signed status feed | M03/M06/M08: Node, local H1, no inference, paid-safe retention, durable seller revocation flag plus delisting. |
| 04 C2 separate four-day seller plan | M12: one implementer and founder capacity budget, no additive staffed workstream. |
| 05 conflicts/D2/D7–D10 page targets, native source, generation, optional checklist, calendars | M07/M10/M12: five-page baseline, optional staging deferred, mandatory matched comparator, actual n. |
| 05 D3–D6/D8 private helpers, offline LLM drafting, custom license placeholder, status-feed freshness | M07/M08/M14: founder-only private work, approved bytes only to AI; actual terms required; local flag/freshness gate without feed. |
| 05 D7 reserved `03-threat-model-and-evaluation.md` link | Evaluation authority is [M10](#m10); compatible test detail is [03 §4](03-security-eval-plan.md#4-avoided-loss-replay-evaluation). No such reserved file is required. |
| 03 C01–C18, §§2–3/G05/G14/G15/G22/G24, §5 suites | M01–M11: remove dual crypto, autonomous signing baseline, reserve, score and feed tests; retain applicable security intent in the smaller acceptance matrix. |
| 03 §§4/6–9, cut order, seven-criterion pitch and gate table | M10–M14: matched free arm cannot be cut; current calendar and official criteria; public OSS release at submission. |

<a id="m01"></a>
## M01 — Decisions and implementation defaults

`DECIDED-BY-LEDGER` means an explicit ledger requirement (including its binding brief/P1–P3 constraints); it is not newly approved here. `PROPOSED-PENDING-FOUNDER` means a concrete implementation default, not a falsely attributed founder decision. The requested reductions below govern preparatory implementation. F's unresolved execution choices are enumerated in M14; silence never authorizes a spend, signature or publication. F may narrow defaults; changes to hard constraints require a new explicit ledger decision, not a code shortcut.

| ID | Status | Default and boundary |
|---|---|---|
| Position | DECIDED-BY-LEDGER D3/D4 | **Ask a Brain** is the service; **Market Harness** means a harness for bounded, auditable purchases of expertise by AI agents. gbrain slices are the **first market**, not the headline category. No additional markets built now. |
| Scope | DECIDED-BY-LEDGER D1/D2/Q10 | SCOPE REDUCTION; minimal static market, `list`, one-page report, one approval-gated small mainnet purchase. |
| J1 signing | PROPOSED-PENDING-FOUNDER | Human-operated wallet signs every devnet/mainnet purchase; separate broker builds and validates exact messages, caps and payees. Autonomous OS-isolated signer is stretch only if canary acceptance passes by **Oct 10 12:00**; otherwise defer beyond submission. No autonomous mode in the release without explicit F choice. |
| J2 questions | PROPOSED-PENDING-FOUNDER | Exact approved UTF-8 question bytes or fixed templates with finite approved slot values only. This is an egress policy, not regex-based privacy certification. F approves the set; disclose constrained autonomy. |
| J3 slice | PROPOSED-PENDING-FOUNDER | **5 useful pages minimum, 10 maximum per slice; start at 5.** No padding or relaxed review. A second founder-operated synthetic slice is labeled demo; its short five-page fixture is reviewed separately. |
| J4 answers | PROPOSED-PENDING-FOUNDER | Curated extractive interventions mapped to approved question IDs. No generative calls in the minimum. Generation may be reconsidered only after all mandatory work fits; requires an explicit amendment with prices/caps/tests, never a hidden fallback. |
| J5 hosting | PROPOSED-PENDING-FOUNDER | H4 registry-only marketplace + **H1 local isolated container/VM**. Cloud H2 requires F's explicit provider/region/spend approval. No assumed cloud bill. |
| J6 identity | PROPOSED-PENDING-FOUNDER | 01 wire fields and one seller-specific Ed25519 key over canonical JSON; whole static registry hash pinned. No Minisign, delegated keys, registry signing or signed status feed. Revocation = durable seller flag plus delisting. |
| J7 commerce | PROPOSED-PENDING-FOUNDER | No external paid orders during the hackathon; founder-controlled tests only. Manual disclosed refunds, no funded reserve, no automatic refund signer. |
| J8 reputation | PROPOSED-PENDING-FOUNDER | Source-separated outcome ledger with exclusions and service failures; **“unrated until 3 independent buyers”**. No numeric score, even after three; future scoring is a separate decision. |
| J9 discovery | PROPOSED-PENDING-FOUNDER | Bounded free pre-check across 2–3 pinned listings; show one declines free and one can answer. Select at most one permitted offer; never hidden paid fan-out. |
| J10 revocation | DECIDED-BY-LEDGER P1 / brief §5 | Safety/data prohibition outranks delivery. Revoked content is never quoted, armed or revealed by the controlled system, including cache restoration/restart. Already copied public bytes cannot be recalled. M06 gives the enforcing refinement. |
| J11 citations | PROPOSED-PENDING-FOUNDER | F explicitly approves whole public-page download. Buyer verifies page hashes and exact byte spans. Charge for application/selection, not secrecy. |
| J12 payment | DECIDED-BY-LEDGER D0/D2.4 + recorded R2 | Solana, one atomic split, devnet before mainnet; failed Gate 1 blocks paid demo. The **single SPL implementation choice** in M05 is the proposed engineering default, not a previously approved mint/fee/funding choice. |
| J13 memory | PROPOSED-PENDING-FOUNDER | Isolated prefixed receipt path + quoted-evidence wrapper + planted-instruction readback. If unsafe, full receipt local and metadata-only gbrain import; state the full-content requirement shortfall. |
| J14 private inputs | DECIDED-BY-LEDGER P1/P3 / brief §5 | Private-brain search, candidate selection, incident inventory and distillation inputs are founder-run locally **outside any AI session**, including local AI. This requested operating rule tightens implementation of the data boundary; AI receives only approved bytes or counts. |
| J15 value | PROPOSED-PENDING-FOUNDER | “Prevented-incident replay”: counts, minutes, actual spend, no currency savings. Public founder-owned gbrain PRs/issues and personal repositories plus clearly personal incidents form the admissible pool. Mandatory matched free-checklist arm; actual small n; retrospective assistance evidence. |

<a id="m02"></a>
## M02 — Smallest end-to-end product and execution boundary

Thesis: when a task stalls or falsely reports completion, Ask a Brain lets a constrained buyer agent request a relevant intervention, reject unauthorized purchases, obtain one permitted cited answer, and leave inspectable payment and task evidence. The first market offers founder-approved gbrain lessons. Whether people will pay for selection/application of free source material is unknown.

One MCP offers `find`, `consult`, `status`, `feedback`, `report`. One Node codebase contains shared schemas, broker, seller controller/worker and small operator commands; SQLite provides durable state. **No separate marketplace backend is required**: a hash-pinned JSON registry and broker-local settlement/outcome tables produce the report. One seller controller may host two clearly founder-operated listing namespaces with separate manifests, keys and state; no multi-tenant isolation claim. A real independently operated seller would need its own deployment, deferred.

```text
F offline/private -> approves public bytes -> publisher -> sealed local seller slice
Constrained buyer agent -> typed MCP -> broker (separate process/protected state)
                                         | -> 2–3 seller free checks -> one quote
                                         | -> human wallet signs exact armed message
                                         | -> Solana -> finalized proof -> fixed answer
                                         + -> local receipt/outcome -> safe gbrain import
Registry: one reviewed static file; seller content never resides in marketplace custody.
```

**Selected runtime persona:** a task runner under a dedicated sandbox account/container, a pinned buyer-model snapshot chosen and logged before evaluation, and an explicit tool allowlist. No unrestricted coding assistant is the runtime buyer. Allowed task tools are named operations such as `inspect_fixture`, `check_leftovers`, `apply_fixture_fix(fix_id)`, `verify_fixture`, and `finish_with_evidence`; arguments are enums/opaque IDs resolved inside one disposable task volume. No arbitrary command string, shell, browser, package installation, path, network URL, private connector or out-of-sandbox write. These are interfaces to implement, not existing commands. Task-tool enforcement is outside the model and identical across evaluation arms. Useful checks/repairs can execute without coaching; consequential operations outside that allowlist require human action and are outside the evaluation.

The broker is a separate protected process outside the runtime agent sandbox. The sandbox has no shared broker DB/config, host home, Docker socket, process-attach permission, admin route, wallet UI or private-brain connector. A same-user child process alone is insufficient. Authoring I can implement using synthetic fixtures but never handle wallet or seller private keys. F creates/provisions keys out of recorded/agent-visible sessions; dummy canaries test access denial. Host administrator and broker remain trusted. Human signing reduces scope; it does not excuse mutable policy or missing reservations.

`find(topic)` reads only the pinned registry and displays labels, flat prices and an outcome-ledger reference. It does not transmit arbitrary topic text to sellers. `consult(request_id, question_id, template_values?, max_price)` resolves exact approved bytes locally; the compatibility `question` field, if offered, must equal the resolved bytes exactly. No arbitrary context attachment. Approved scope binds permitted seller origins and network; retries cannot rewrite text. `max_price` can only lower the boot-policy cap. No agent tool can change policy, sign arbitrary bytes or mark feedback as human.

For each new consult, prefilter the pinned two/three listings by approved topic, origin, network/asset, demo permission and cap; free checks use independent idempotency keys derived from request + seller. Make no more than M03 fan-out. Await each bounded check; show per-listing `ready`, `declined` or `unavailable` without pretending outages mean ignorance. Choose the lowest total eligible ready offer, then stable seller ID on ties; no reputation ranking. Persist selection before approval. Ignore late offers after selection; unselected quotes expire unarmed. Before arming, recheck eligibility. After arm, never fail over or buy again automatically. All-decline means zero signatures and zero purchase/network fees. Mainnet fan-out may observe a demo listing's free decline, but only the founder-owned non-demo listing can be selected for the one mainnet purchase; independent and demo listings are not payable on mainnet in this build.

<a id="m03"></a>
## M03 — Canonical constants (only normative parameter table)

These are chosen prototype limits, not performance, safety or demand measurements. 02/04/05 and all generated configs MUST defer here. Limits are enforced before work; no truncation of signed content. Timeouts affect UI/control, not proof of chain failure. `day` means UTC; all human schedule deadlines in M12 remain JST.

| Constant | Chosen value / enforcement | Conflicting or retired values |
|---|---|---|
| Runtime | One pinned Node LTS + TypeScript + SQLite; exact versions locked after U2 | 04 Bun default; no second serving runtime or required gbrain runtime |
| Listings / fan-out | 2 active labeled listings baseline; hard max 3 checks/consult, one selected purchase | 01 manual single seller / 04 no fan-out |
| Slice size | 5–10 useful pages per slice; first founder slice 5; demo slice 5 short synthetic pages | 00a 30–60 estimate; 01 30; 04 10–30/300; 05 15–30 |
| Worker resource ceiling | 1 GiB memory; record actual RSS/restarts; CPU/PID limits pinned in deployment config after U3 | 04 measured-looking RSS targets remain unverified |
| Payload | 64 KiB/page, 1 MiB sealed payload, ≤100 chunks; approved files only | 04 256 KiB/page, 100 MiB, 10,000 chunks |
| Question | ≤4 KiB UTF-8 AND ≤2,000 Unicode scalars; exact approval additionally required | 04 model-token-only question cap; scanning alone never admits |
| Quote TTL / arm margin | 300 s from issue; refuse arm with <30 s remaining; >30 s clock skew blocks new purchases | 04 120 s / vague “initiated” deadline |
| Cache dedup | 10 min keyed by buyer/seller/question/slice/policy; never extends quote expiry | No cross-buyer cache or fresh quote under same request ID |
| Per-buyer/seller free checks | 3 new/minute, 20/day; one active and one unarmed ready quote | 04/03 proposed 2/minute, 10/day; choose 01 to accommodate tests and replay |
| Global admission | IP 10/minute; seller 100/day; 2 active jobs/seller; queue 4, wait ≤2 s | 20 model attempts/day retired, because no model calls |
| Seller inference | **0 calls; 0 input/output model tokens; $0 seller-model spend** | All 01/02/04/05 one/two-call, 12k/2k, 6k/768, $0.01/$0.02/$0.05 and $2/day models disabled |
| Extractive preparation | ≤5 sections, ≤16 KiB evidence; deterministic approved question-to-span map; no tokenization dependency | Generative support verifier/BM25 threshold machinery deferred |
| Output | ≤1,500 Unicode scalars in answer; 1–3 citations; ≤8 KiB signed envelope; ≤1,000 quoted scalars total across answer/citations (overlapping source spans counted once) | 02/05 200-scalar total and 04 10%-of-page copy caps would amputate useful extracts; explicitly superseded for extractive mode. No DRM claim; entire source is downloadable |
| HTTP body / fetch | Ingress ≤16 KiB; cited page ≤64 KiB, total citation fetch ≤512 KiB; no redirects | Larger payloads rejected before parsing; public routes map IDs, never arbitrary paths |
| Pre-check / response | ≤30 s end-to-end check including queue; minimum 2 s ready/decline response | 04 10 s and unmeasured p95 promises retired; padding not timing secrecy |
| Payment wait | Foreground 60 s then pending; poll 2/4/8/15 s; seller reconciliation every 15 s | No timeout means paid/failed; 04 confirmed unlock retired |
| Finality | `finalized`, `meta.err=null`, exact message/instructions AND token balance deltas | `confirmed` alone never unlocks |
| Reveal / rescue | Per attempt 10 s; initial + at most 2 same-ID retries within 60 s; then rescue visible; 10 min after finality without delivery records non-delivery | No generation, top-up or repurchase to rescue |
| Price / fee | Total 10,000 atomic units; seller 9,000; marketplace 1,000; 6 decimals; experimental 1,000 bps | Devnet = 0.01 TEST; mainnet = 0.01 verified USDC. 02 $0.25 external pilot not active |
| Devnet purchase caps | 50,000 atomic/call; 500,000/day/payer across all sellers/sessions | No autonomous signing threshold; all purchases human-signed |
| SOL fee caps | 100,000 lamports/purchase; 1,000,000/day devnet; reserve separately from principal | Setup/rent/funding are separately human-approved and not purchases |
| Mainnet budget | One successful 10,000-unit purchase for entire demonstration; 100,000-lamport fee ceiling for that attempt | No native-SOL fallback; failed/ambiguous attempts never automatically replaced |
| Retention | Unarmed expired content 24 h after expiry; safe paid answers/receipts 30 days after finality; unresolved armed content retained until resolution unless revoked; content-free unresolved liabilities/WAL/tombstones until adjudicated | 04 deleting paid bytes 24 h after quote expiry superseded; backup uses same withdrawal rules |
| Logs / private staging | Counters 7 days; raw seller question only in request memory; rejected local draft copies 7 days unless F records need (originals untouched) | No raw body/token logging; paid buyer question stays in protected receipt |
| Revocation / freshness | Check durable flag at quote/arm/page/reveal/restore/startup; F lineage acknowledgement ≤24 h and before every session; no CDN/feed | 04/05 signed 120-s status feed removed. Missing state/overdue acknowledgement fails closed; human discovery target 15 min, not SLA |
| Revoked content cleanup | Serving blocked immediately; controlled copies/backups removed within 24 h; optional isolated F-only incident copy 7 days | Never restore revoked content into serving; old signatures do not reactivate |
| Feedback | 7-day collection window; later append-only corrections; one observation/consult/source; no score/windows/weights | 01 daily score vs 02 weekly/90-day weighted score removed |
| Refund support | Manual request window 30 days; aim to initiate human recovery within 24 h, no guarantee; partial amount remains owed | No funded reserve/full-price guarantee or autonomous refund promise |
| Replay per arm | 10 min wall time; 8,000 buyer-model tokens; 30 task/MCP calls; ≤1 devnet purchase in paid arm | Seller token budget remains zero; wallet/finality time included; equal buyer budget for all arms |
| Discovery spikes | Each unresolved capability gets ≤30 min initial verification; dependency work then scheduled or cut | No unbounded research or four-hour second-rail rescue |

Buyer-model API expense is separate from seller inference and token transfer caps. F must set an actual experiment spending ceiling after U2 verifies current rates; absent an approved ceiling, use offline fixtures only and mark live replay unrun. Do not imply that zero seller inference makes buyer evaluation free. All count/cost reservations survive restart; repeated tests must fit quotas, with separate synthetic test namespaces, never invented identities to evade live limits.

<a id="m04"></a>
## M04 — One wire, registry and signature contract

Reuse **01 §5 messages and §6 identity**, with the precise deltas here. Implement a single strict shared schema package; do not accept both 01 and 02/04 payloads. Unsigned amount strings are base-10 integers, no floats; SHA-256 is lowercase hex, public keys/transaction signatures base58, off-chain signatures base64url. Reject duplicate JSON keys, unknown fields, invalid UTF-8, bad lengths, unknown versions and key IDs before verification.

Sign `UTF8("ask-a-brain/v1/" + type + "\n") || JCS(payload)` with Ed25519, for `manifest`, `quote`, `arm`, `answer`; use RFC 8785 canonical JSON. Hash JCS payload bytes for commitments; page hashes use exact published UTF-8 bytes with no verifier normalization. Off-chain seller key Ks is distinct from human payment keys. No bespoke cryptography, second seal format or delegation chain. Human creates/provisions Ks in protected storage; the answer worker and authoring AI cannot read it. Signing interface accepts only validated typed records; manifest signing additionally requires protected approval of the exact payload hash. Pinned manifest hash plus human approval limits unauthorized publication even though one Ks signs all four types. Key compromise still requires suspension and repinning.

| Artifact | Canonical content and amendment to 01 |
|---|---|
| Registry | Retain `v`, `registry_version`, `seller_id`, `operator_id`, `listing_kind`, endpoint, topics, `signing_key`, `slice`, `payment`. Add listing `status` (active/suspended). Remove mutable `trust` object; report outcomes outside registry. Store the registry file as JCS bytes and F pins SHA-256 of the **entire canonical registry file** locally; any change requires human repin. No signed registry. No automatic rewriting for feedback. |
| Manifest | 01 seller/slice/time/gate/approval/pages plus monotonic `version`, `previous_manifest_hash`, `policy_sha256`, complete sorted `files[{path,size_bytes,sha256}]`. Inventory covers pages, approved answer map, policy and any derived spans; excludes manifest/envelope itself. No secrets, private evidence hashes or recursive self-hash. |
| Quote | Use all 01 §5 quote payload bindings: buyer/payer, seller, request, question hash, registry version, slice/manifest, salted answer hash, issue/expiry, rail/network/genesis/mint/program/decimals, exact owners/accounts/amounts, memo and delivery/refund terms. New quote/arm uses the current human-pinned file; recovery verifies the archived originally approved snapshot and current revocation overlay. No unsigned endpoint overrides. |
| Answer | 01 answer envelope pre-signed and committed before quote. Curated claim text is exact approved spans; fixed connective labels only, no uncited generated assertion. Salt stays hidden until paid reveal. `engine_version` identifies extractive map/build, not an invented model. |
| Arm | 01 arm fields: quote hash, buyer, message hash, blockhash, last-valid block height, armed time. Persist one permitted message per quote. No payment reference inside pre-payment answer. |
| Proof / receipt | 01 proof is a locator only; receipt carries independently observed finality, fees and deltas, all artifact hashes and separate payment/delivery/refund/import/feedback states. Add per-listing fan-out dispositions and question-policy hash. Null/`not_applicable` for declined verification fields. |
| Outcome | Keep 01 consult/source/useful/reason/classification/exclusion fields; no `score`, weights or rank. Broker derives identity/eligibility rather than trusting agent fields. |

Require **one public golden fixture** for registry → manifest → quote → arm → answer → payment evidence → receipt, verified by publisher, seller and buyer against the same schemas before wiring services. Use public signature test vectors or F-operated test signing; never place secret test keys in AI context. Mutated bytes/domains/duplicate fields must fail. A fixture proves format compatibility, not a live payment.

Seller routes are `POST /v1/quotes`, `POST /v1/quotes/{id}/arm`, `POST /v1/quotes/{id}/payment` (proof locator), `GET /v1/quotes/{id}/answer`, plus manifest/page and readiness routes. Each private route authenticates an origin-specific invitation token held by the broker and binds it server-side to F's buyer ID/payer; never trust a body-supplied identity or forward tokens between origins. Every quote/answer/status lookup enforces buyer ownership. External paid enrollment is disabled. Public approved pages need no payment/authentication but still obey revocation. Plain HTTP is limited to the explicitly isolated loopback test path; exposed endpoints require HTTPS. Marketplace registration/feedback remain local authenticated broker operations, not a separate public service.

`list` takes only a sealed approved bundle and public deployment configuration, validates contents, gives an inert preview, and emits a listing proposal. F approves activation/repin. It never searches the private brain or publishes automatically. Interfaces from 04 B3 are reusable as internal phases of this operator command, not a requirement for a large publisher CLI/UI.

Public page URLs are generated from pinned origin and manifest IDs. Buyer obtains whole pages and checks hash, UTF-8 boundary-aligned exclusive spans and exact excerpt equality. Refuse redirects, arbitrary URLs, path traversal and unexpected private/LAN destinations. Local H1 is an explicit exception for the exact enrolled loopback/VM seller endpoint only; no general private-network access. Signature establishes listed-key authorship of bytes, **not truth, consent, freshness, expertise, semantic entailment or usefulness**.

<a id="m05"></a>
## M05 — Payment, human signing and Gate 1

**One rail: `solana-split-v1`, legacy SPL Token, two `TransferChecked` instructions + one Memo in a legacy transaction.** No Token-2022 hooks/fees, program deployment, custody, escrow, merchant payout, separate fee transaction, native-SOL fallback, lookup table, delegate/approval instruction, priority-fee instruction or purchase-time account creation. Setup pre-creates all three associated token accounts. Buyer fee payer/authority, seller recipient and marketplace recipient are distinct public addresses even though F owns all three. Mint/network/decimals/account ownership are pinned; names such as “USDC” are never address validation.

Instruction order is seller transfer, marketplace transfer, Memo `aab:v1:<quote_id>:<nonce>`. Both principal legs succeed or revert together; failed transactions may still consume SOL fees. This is atomic **payment**, not atomic exchange of money for useful delivery. Devnet uses a F-created six-decimal TEST mint; mainnet uses the verified six-decimal USDC mint (U5), never a guessed address.

1. Broker verifies exact approved question, registry/quote/answer commitment and caps; seller already durably stored validated non-abstaining answer/signature. F reviews the offer before arm; waiting for a human does not extend expiry.
2. SQLite transaction reserves principal and maximum fee across all sessions/sellers. Build unsigned message locally from pinned data, decode again and compare all fields. Seller-supplied serialized transactions are never signed.
3. Obtain blockhash/last-valid height, ask seller to arm the exact message hash. Seller rechecks revocation/readiness/expiry, validates template, persists exactly one message and returns signed arm ticket. Broker persists arm and reservation **before** asking wallet to sign.
4. Human wallet signs that exact message. Broker rejects returned message substitution, verifies signature, durably stores signed bytes/signature before broadcast, and broadcasts those bytes. Wallet must support sign-without-autobroadcast or an equivalently evidenced durable boundary; if its adapter cannot provide that in U1, paid mode is blocked, not silently weakened.
5. Lost response or restart resumes the same consult and rebroadcasts identical signed bytes only. If the wallet signed but the broker did not receive/persist the result, keep reservation; recover the same signed message or reconcile expiry. Never request a new message for that quote.
6. Buyer and seller independently fetch finalized transaction, check genesis, payer, armed hash, exact instructions/memo/program/mint/decimals/accounts/owners/amounts and actual token deltas. Broker's ledger records verified settlement once; no separate marketplace service repeats it. Reconcile network fees separately.
7. Recheck revocation before reveal. Verify answer/manifest/pages, persist receipt before MCP returns success; record actual task outcome separately. No model call after payment.

Ambiguous RPC/null/timeout is pending; keep principal and fee reservations across restarts and UTC midnight. Release principal only after finalized failure, or finalized height beyond expiry plus absent signature on primary and secondary RPC and no provider disagreement. Preserve actual charged fee. New quote after conclusive failure requires a new deliberate request and fresh approval; a refund does not refill the daily spending budget. No automatically signed replacement while status is uncertain.

**Gate 1, Oct 10 18:00 JST:** capture on the exact implementation revision (a) finalized devnet +9,000/+1,000 TEST atomic recipient deltas and memo; (b) deliberately failed second leg, both principal legs unchanged and actual fee shown; (c) proof replay, wrong buyer/network/payee/memo/mint/amount, crash/restart and concurrent cap attempts rejected; (d) unsupported question and blocked unauthorized purchase each cause zero signing/broadcast; (e) lost-response recovery returns the identical non-revoked answer/receipt after finality; (f) human wallet/broker and runtime isolation controls pass. Save raw read-only RPC evidence, signature, before/after balances and correct-cluster explorer link. A simulation/local validator is not Gate 1.

**Exact failure branch:** any unobserved Gate-1 item at its deadline means Gate 1 failed/unverified, paid demo blocked and mainnet disabled. Freeze payment expansion; retain free pre-check, safe slice, labeled simulated protocol and whatever retrospective evaluation can honestly run. No native-SOL retry rail, merchant custody or two-purchase substitute. An affected defect can be repaired on the same SPL rail before the cut; reopening paid mode requires every Gate-1 item to pass, logged as **late recovery**, plus F acceptance of schedule impact. Failure remaining at the cut means submit the smaller unpaid experiment with the core paid milestone explicitly missed.

Mainnet requires Gate 1, safe final slice/hosting/receipt fallback acceptance, all applicable M11 controls and fresh human approval. F reviews network, verified mint, both recipient accounts, split, maximum/estimated fee, quote/manifest/policy and exact message digest. The one successful purchase locks mainnet mode; video retakes reuse the recording. Separate setup/funding transactions and fees are disclosed. No private wallet/key is created, printed, imported or captured by an authoring agent.

**Composability sentence for the pitch:** “We use a custom Solana SPL split because one atomic seller-and-fee transfer is our tested contract; x402/Pay.sh interoperability is not yet verified.” Say “tested” only after Gate 1; beforehand use “required.”

Keep a **single 30-minute x402/Pay.sh spike** on Oct 9: inspect pinned official source/docs/version for exact SVM extra-transfer acceptance, actual devnet configuration, challenge headers and registry entry format. Record supported/unknown per item; sandbox is not proof of devnet. Stop at the cap; no rail switch during this build. Adapter path after submission: map authenticated challenge/resource to signed quote → use the same policy/arm/reservation validator → facilitator must accept and verify both recipients in one transaction → verify finalized deltas → reveal same commitment/receipt. Pin package/facilitator versions and rerun all Gate-1 tests. Unsupported two-leg settlement keeps adapter disabled; do not advertise x402 compatibility or claim to improve on capabilities not compared.

<a id="m06"></a>
## M06 — States, recovery and revocation precedence

Persist orthogonal fields for payment, content eligibility, delivery, refund, feedback and import. Do not grow a single state enum that erases financial history. Use SQLite transactions, expected-version updates and append-only events. Keys: buyer request UUID, per-seller request key, unique quote/armed message, unique `(genesis, signature)`, stable receipt ID, `(consult_id, source)` feedback. Same request/body returns the existing record; changed body with same key = conflict. Never convert status polling into a new purchase.

| Event | Required transition / visible behavior |
|---|---|
| Unsupported approved question | `declined`, no quote/arm, zero signer and broadcast calls, zero purchase/network fee; locally stored receipt. |
| Ready answer | Validated answer + signature + quote committed together, then `quote_issued`. Crash before commit cannot expose payable quote. |
| Approval denied/expired unarmed quote | `cancelled` / `quote_expired`; no payment. Repeating request ID does not create a fresh quote. |
| Arm / sign / submit | Durable `payment_pending` reservation and arm; one exact message. Missing durable storage blocks signing. |
| Confirmed but not finalized; RPC unavailable | Keep pending; “payment status unknown—do not pay again.” Never report zero spend until known. |
| Valid finalized payment | Record actual principal/fee and `payment_finalized`; attempt exact reveal only if content still eligible. |
| Cached answer missing, corrupt or invalid | `delivery_failed`, recovery record; no regeneration. Restore only hash-matching, non-revoked bytes. |
| Safety/rights revocation at any point | Content `revoked`; no new quote/arm/page fetch/reveal or trusted cached readback. Pending payment may still finalize: reconcile it, keep amounts owed and enter `recovery_required`. |
| Ordinary supersession/stale origin | Stop new quote/arm; safe old paid snapshot may recover, labeled with original date. If safety/rights status is uncertain, withhold content until cleared; never use stale as a revocation loophole. |
| Refund one/both shares | Append actual return signatures/amounts; `partial_refund` until full principal reconciled, then `refunded`. Original delivery failure remains visible. |
| Import unavailable | Local receipt/outbox remains; `metadata_only` or `import_pending` accurately displayed. Never repurchase for import failure. |

**Revocation implementation:** F sets a durable monotonic digest tombstone in seller state first, then delists/suspends and repins the static registry. A stale buyer registry cannot override the seller flag. Quote/arm/page/reveal routes acquire the same eligibility lock or generation check; revocation and final delivery authorization serialize. A request linearized before revocation may already have released bytes and cannot be recalled; no request authorized after the flag commits may send them. Do not promise recall of in-flight or downloaded bytes.

On restart, load tombstones and current eligibility **before** any route becomes ready. Restored backups must be checked against the newest independent tombstone record, never overwrite it with old state. Missing or uncertain revocation state keeps service offline. F keeps the tiny content-free tombstone file separately from content backups; restoration requires reconciliation with it. Broker also records revocations it learns, suppresses affected local answer display/import/readback, and requires online seller eligibility confirmation before re-serving old cached prose. No offline cache bypass. Static registry alone is not a revocation service.

Refund scope is founder-operated technical verification only. Record the full principal as requested recovery for non-delivery, unsafe output or failed provenance. F manually returns seller share and marketplace share from their respective wallets, with separate runtime approvals on mainnet. No reserve, automatic key, escrow, insurance, guaranteed time or guaranteed recovery. Network fees normally remain spent; disclose them. A partial return is an outstanding balance, not a successful full remedy. Suspend new paid tests with unresolved delivery obligations. Unsolicited external transfers create reconciliation records, not paid-order acceptance or demand evidence.

<a id="m07"></a>
## M07 — Part D: make the first slice ready (P1/P3)

**Hard boundary:** private-brain search, metadata inventory, candidate selection, private incident inventory, provenance inspection and all private distillation inputs are F-only local work outside **any AI session**. No hosted or offline assistant reads private candidates. I provides generic worksheets/tools against synthetic data and receives only deliberately approved public bytes or aggregate counts. Do not use current workspace access, a gbrain connector, `default` source search or screen capture as implied authorization. Selection scans over original private inputs are run by F locally; their raw output stays private.

Eligible first-slice origins: F-owned public technical work (including F-authored portions of public gbrain PRs/issues and personal repositories) or clearly personal non-business experiments/observations. Public availability alone is not rights or non-business provenance: employer/customer work remains excluded even if public, and third-party issue comments are not F-owned. Transcripts, transcript-derived pages, dream-generated material, ambiguous lineage, private third-party information, employer/business/customer/member data remain excluded. Redaction or “clean-room” rewriting does not legalize forbidden origin. New neutral experiments may supply new independently supported lessons, labeled as such; they cannot become historical incidents by relabeling.

Use five distinct, short lessons: candidate themes are completion evidence, leftover checks, bounded retries, interruption recovery and distinguishing process existence from completion. These are suggestions, **not observed inventory**. F chooses the actual pages. AI may help draft only after F has approved every supplied input byte for public use. Slice title/body follows Trigger / Failure mode / Fix / Evidence / Limits. Review full qualification with the fix; a clipped imperative is not a useful intervention.

**S-C → S-A minimum:** new standalone public lessons from eligible approved evidence, then exact allowlist/review/seal. S-B native public-source staging is deferred; a dedicated Markdown directory is sufficient. Never migrate the archive or clone its database/index. No full-brain upload, graph traversal, inherited embeddings or live gbrain service. Founder slice starts with five pages; I can prepare a separate five-page synthetic demo fixture that F reviews, clearly labeled not independent supply or historical evidence.

Retain the nine-field review worksheet from **05 D3**, with these interpretations:

| Local review fields | Public projection / condition |
|---|---|
| `visibility`, `origin`, `sensitivity`, `review_status` | Public/personal-public/none/approved only after gate. Labels alone are not authorization. |
| `derived_from` | Nonempty real evidence references/hashes kept only in F's private lineage map. No private hashes, parent counts, slugs or filenames published. Public owned evidence may use an approved public reference in the separate evidence record. |
| `reviewer`, `last_reviewed` | Accountable F handle and timestamp, with self-review disclosed. |
| `license`, `right_to_sell` | Actual reviewed content terms and opaque attestation reference; no `LicenseRef` placeholder treated as a license. F decides M14. Code and content licenses are separate. |

Publishing sequence (manual operator tooling, not a new onboarding product):

1. F selects exact eligible evidence/pages and records excluded/unknown counts locally; I never searches to rescue a low count. F drafts or hands approved public source bytes to I. Freeze a new public projection with opaque IDs.
2. Drop excluded links **and labels**, private paths, raw provenance, backlinks, attachments, images, active HTML and graph statistics. If a claim needs hidden context to make sense, remove/rewrite with independently public evidence or exclude it. First slice body uses no fetched URLs; public provenance links can stay in separately approved evidence records. No transclusion.
3. F runs mandatory pinned secret scanner + business-marker guard over selected originals and final projection locally. Scans fail closed on missing tool, skipped bytes, error or unresolved finding. I may run the same tools over approved public copies/synthetic fixtures. Candidate-supplied ignores cannot suppress scanner rules. English/Japanese patterns plus full F reading cover PII review; Presidio is deferred and automated PII coverage is explicitly limited.
4. F reads every final byte and metadata in an inert text/diff view, checks rights, provenance, accuracy and injection-shaped instructions. Green scan is not approval. A finding of prohibited origin cannot be overridden. Record exact hashes, policy, reviewer/time and whole-page public-download permission.
5. Build in an empty directory: exact approved pages, deterministic question-to-span answer map, file inventory and manifest. Set equality must hold for approved IDs, pages and indexed spans. Reject symlinks/hardlinks, hidden/unlisted files, traversal, non-regular files and UTF-8 span errors. No live chunks or private DB. Freeze bytes before approval/signing; changing even metadata requires new approval.
6. Human-controlled Ks signs canonical manifest. Verify full inactive bundle, run safe canaries and citations, then F activates/repins `list` proposal. Interrupted copy leaves previous eligible version or offline state, never a half-published bundle.
7. Before each session and at least daily F checks selected origins' hashes **and rights/withdrawal state** locally, sends only public-digest eligibility acknowledgement to service. Changed/missing/unknown origin suspends sale; rights/safety withdrawal revokes every dependent version. No automatic private-brain watcher is required.

Keep 04 A1/A2 classification and 05 D4–D6 lineage/link details where compatible. The artifact is approved public knowledge; extract caps are response-size controls, not anti-scraping promises. Pre-check answerability/timing remains a limited oracle over deliberately public material. Generic decline and admission limits bound abuse; do not claim secrecy or perfect anonymity.

**Readiness proof:** two synthetic private corpora behind identical approved public bytes must produce identical public files, IDs, manifests (with fixed test metadata), span maps and fixed-query results. Outside canary never appears in logs/answers. Changed origin, withdrawn rights without byte change, missing parent, changed approved byte and restored revoked cache each block the appropriate path. A valid unchanged public page must still pass.

For a stranger later, reuse a short worksheet, five-page example, exclusion examples, local scanner instructions, full-byte approval and takedown drill. No generic uploader or claim that arbitrary brains are slice-ready. Admission, rights, independent operations and refunds require a separate post-contest decision.

<a id="m08"></a>
## M08 — H1 deployment and seller engine (P2)

Default H1 uses a dedicated local Linux VM/container environment with host home-sharing disabled. Mount only approved bundle read-only; worker runs unprivileged, network-disabled, read-only root, dropped capabilities, no-new-privileges, bounded resources and ephemeral scratch. No host networking, host PID namespace, Docker socket, devices, SSH agent, Keychain, private gbrain, logs or credentials. The separate controller owns authenticated HTTP, protected SQLite and typed signing access; worker gets no key or arbitrary signing/fetch capability. Reuse the isolation mechanics in **04 B2** after dropping cloud/model/delegation components. Resource ceiling is in M03; U3 records actual usage rather than assuming it fits.

Loopback/VM-only demo is sufficient; if a public URL is needed, F approves a tunnel exposing only the controller, never live gbrain/admin ports. Controller egress is limited to configured chain RPC; broker has explicit seller/RPC endpoints and a separate supported gbrain import route. No model-provider connection on seller. Pin exact endpoint/private-address exception; arbitrary DNS redirects remain denied. No uptime promise from laptop/tunnel. `/healthz` reports liveness, `/readyz` verified bundle/durable state/eligibility only, without page inventory/secrets. Readiness is checked before arming; a health success cannot un-revoke a slice.

Question map is finite: approved question/template expansion → approved answer spans or decline. A known question may be unsupported by one listing and supported by another. No probabilistic topic threshold, graph query, embedding, query rewrite or general knowledge answer. For each ready answer, reconstruct exact spans from approved pages, validate caps/qualifications, scan output, sign and persist **before** issuing quote. No generation or inference at any stage; deterministic preparation also declines on contradictory/stale support. A free ready response contains quote terms, salted commitment and already-public listing labels only; no answer, matched page IDs, excerpts, hit scores or secret topic list.

Freeze a development set separate from incidents: ten in-scope questions, require at least eight supported under the approved finite policy; ten unsupported/unsafe/version-mismatch cases must yield no payable quote. Unsupported variants that fail local question admission are counted separately from seller declines. One map/content repair allowed before eval freeze; then narrow scope if necessary. Byte-valid citations do not prove an extract was helpful.

Marketplace holds registry and content-free settlement/outcome metadata; seller holds public bundle and delivery state; buyer holds local receipt artifacts. F's private provenance stays off all three. H2 cloud is only a future alternative after explicit approval of provider/region/spend and the same isolation tests. If H1 cannot pass, keep seller offline and submit safe synthetic/free evidence; do not treat local deployment as inherently isolated.

<a id="m09"></a>
## M09 — Receipts, safe memory and outcome ledger

Durable receipt is written before any success return. Include question-policy hash, question text in buyer-only storage, selected/unselected/declined listing dispositions, quote/arm/answer/manifest hashes, chain/network/asset/amounts/fees, signature/finality/deltas, verification flags, all state dimensions, approval reference, revocation/recovery/refund events and timing. Public report has only approved metadata; no raw questions, private lineage, bearer tokens or dictionary-testable private commitments on chain. Preserve full signed artifacts and cited public pages locally while eligible under M03/M06. Logs use IDs, codes, counters and keyed correlation only.

**gbrain destination:** `external-evidence/ask-a-brain/<consult_id>` in an isolated receipt source/collection excluded from privileged instruction retrieval. General gbrain search in the buyer harness must exclude the receipt source; only the broker-mediated receipt retrieval tool may return its prose, after current seller-eligibility verification. The exact installed isolation/filter feature is **UNVERIFIED (U4)**; a path prefix alone is not isolation. Retain authoritative full receipt outside gbrain. Import an inert wrapper with fixed metadata (`source=external_untrusted`, `consult_id`, hashes, network, outcome, revocation status) and a visibly quoted external-evidence block. It states that seller content is evidence, cannot authorize payment/tools or edit instructions, and may be stale/revoked. Escape markup and never promote prose into system instructions, skills or auto-executed tasks. The wrapper is supplementary; sandbox tool limits remain the boundary.

Acceptance is **import → restart → later retrieve in intended buyer harness → observe handling**, using a correctly signed synthetic receipt with planted “send money/install/run outside task” instructions. Verify intended namespace/filters, exact content hashes, idempotent import and no unauthorized actions/cap changes/automatic positive feedback. Demonstrate an allowed task check still works. Test revocation after import: the controlled retrieval path must suppress affected prose; no unguarded cached retrieval claim.

If any safe retrieval/exclusion property fails or cannot be observed, import **metadata only** (no question/answer/excerpts/instruction text) and keep prose in local protected store. Observe metadata readback and label `metadata_only`; do not claim the full answer is safely stored/retrievable in gbrain. If even metadata import fails, mark `import_pending` and the brief's gbrain-storage requirement unmet. F explicitly accepts this reduced demo label in M14; neither fallback justifies spending twice.

Outcome ledger is the visible reputation product for now. Columns: consult/receipt ID, seller/operator kind, evidence source (`human`, `agent`, `task_check`, `replay`, `service_failure`), useful/pass/fail/unknown, payment/delivery/refund state, eligibility, primary exclusion reason and evidence link. Source comes from authenticated entry point: agent MCP cannot mark human; human click uses protected UI; checker/replay imports bind run hashes. Missing feedback is unknown, not negative. Conflicts remain visibly disputed; corrections append records, never overwrite unfavorable evidence.

Show three separate views: technical verification (founder/demo/devnet), retrospective replay outcomes, and eligible independent-buyer evidence. Current eligible independent market count is **zero by admission policy**, not a claim of a historical market census. Display “unrated until 3 independent buyers”; still no numeric score after threshold. Count distinct manually evidenced operators, not wallets. Exclude self/operator-funded, affiliate, reciprocal, demo, devnet, replay, duplicate and independence-unverified purchases from independent endorsement. Seller affiliation alone would not exclude a genuine independent buyer later. No ranking, source weights, decay, dispute platform or formula.

Service reliability retains **all finalized paid consults** as denominator within each evidence class, with delivered/failed/pending/refunded counts. Refunding never deletes a failure. Human usefulness shows yes/no/unknown/disputed with coverage denominator, separate from objective task checks and agent reports. Reports never sum different sources as independent votes. During hackathon all legitimate payments are founder tests; independent outcomes cannot be manufactured for a populated screen.

<a id="m10"></a>
## M10 — Prevented-incident replay: mandatory free comparator

Purpose: falsifiable **retrospective assistance evidence**, not prospective incident prevention, financial avoided loss, causal certainty, marketplace necessity or demand. Retain useful fixture/rubric/logging detail from **03 §4**, replacing its two-arm plan and monetary model here. Aim for ten real incidents; budget initially for **3–5**, report actual n and the ten-case target shortfall. One honest reconstructible case beats fabricated ten. No minimum n implies statistical credibility.

F privately inventories the admissible pool: F-authored public gbrain PRs/issues, public personal repos with owned reusable evidence, plus clearly personal non-business incidents. No employer/customer/public-business exception, copied third-party incident dataset, private community messages or raw transcript upload. F inspects any private evidence alone, supplies approved before-state fixtures/counts. Public PRs can contain others' words or work provenance; classify rather than bulk-scrape. New neutral experiments are synthetic/development evidence, never real historical n.

Freeze a chronological candidate window (default latest 90 days ending Oct 8), root-cause-family IDs, exclusion reasons and case order **before** results. Take the first eligible reconstructible case per episode/family; record family clustering if retaining related cases for description. Scope expansion before runs requires a dated amendment. F verifies recorded before-state/failure, rights and sanitization fidelity. After 30-minute inventory, publish counts/unknowns; no promise those records exist.

Each case requires opaque ID, public-safe source/provenance approval, historical/synthetic label, before-action snapshot hash, shared task prompt, allowed tools, failure/success/critical-regression predicates, held-out checker/rubric hash, question-policy hash, generic lesson/family-overlap assessment, model/config hash, budget, all-attempt log and expense/time fields. Hidden rubric and historical solution are outside buyer and seller mounts. Freeze incidents and family-level contamination map before tuning answers. Exact resolution/hidden criterion in the slice or treatment prompt excludes the case from primary evidence; general retrospective lesson overlap is disclosed, not called prospective generalization.

**Three matched arms for every primary case**, including the featured video case:

| Arm | Knowledge and tools | What it tests |
|---|---|---|
| A baseline | Original public-safe task/context and same named task tools; no added lesson/consult | Reconstructed untreated behavior; never disable existing checks to manufacture failure |
| B free checklist | Same task plus free access to the exact approved source corpus and same frozen selection index/question-to-span map through `read_checklist(question_id)` | Strong direct alternative using the same knowledge and selection; no pay, signature or seller advantage hidden in the comparator |
| C permitted consult | Same task plus `consult` under frozen question scope, one actual human-signed devnet purchase if answerable | Full harness overhead, verified selection/application, receipt and task outcome |

B is deliberately a strong comparator: do not make the free checklist hard to find or bury the relevant page. Its content is byte-identical to the support used by C, with same readable token limit and access opportunity. It may match C; that limits the paid-value claim rather than invalidating the comparison. A versus C tests access plus protocol; B versus C tests whether the measured outcome justifies paid mediation in these cases. No positive delta proves willingness to pay. If some cases cannot complete all three arms, keep them in attempted/unresolved totals and label incomplete triples; never feature a C success with an omitted B.

All arms run identical clean snapshots, same buyer model/version/prompt except tool availability, same per-arm M03 time/token/tool allowance, same safe tools and existing safeguards. Buyer model and wallet/finality waiting consume time; C's chain overhead is measured. Rotate A/B/C order by case index; fresh context/storage between arms. No human coaching after start; wallet review/signing is a logged procedural action only. One primary run per arm; model nondeterminism remains. Optional repeats must cover entire triples, never rerun only failures or replace the primary result. If Gate 1 fails, C may be demonstrated only as labeled simulated consultation; it is excluded from live-paid counts, and paid-arm completion is unmet.

Score deterministic predicates on final state/action evidence. PASS requires actual permitted check/repair and correct terminal evidence; merely recommending a check or doing nothing does not pass. FAIL includes observed failure or budget exhaustion without required completion; UNKNOWN means observation missing/corrupt. Preserve unknowns, refusals, non-use, failed delivery, harm and all attempts. F reviews output with arm labels hidden where practical but is not independent; AI critique is not a second human judge. Record unblinding and unresolved disagreement.

Report per-arm counts and A–C **and B–C** contingency cells: both pass, both fail, improvement, regression, unknown; totals and denominators reconcile. Call FAIL→PASS “observed paired improvement consistent with assistance” only when trace shows the intervention before changed action; otherwise unexplained improvement. “Prevented” is the operational predicate label inside a retrospective replay, never proven real-world causal prevention. Show actual n, exclusions/families, incomplete triples, task wall minutes, measured human active minutes (or “not measured”), buyer tokens, actual model/RPC/hosting expenses, test token quantities, and mainnet principal/fees separately. No currency savings, hourly wage, annualization, ROI or success percentage from this sample.

Gate 2 freezes actual safe cases; it does not claim runs completed. Time the first full triple and founder adjudication separately. At ten cases the cap alone allows 300 serial runtime minutes plus human signing; the smaller budget needs fewer actual cases or earlier execution, not fake speed. Primary case IDs are frozen before results; if capacity runs out, report the remaining cases unrun in original order. Mandatory B is never cut to preserve n.

<a id="m11"></a>
## M11 — Falsifiable acceptance and minimal implementation sequence

Every guard is **UNVERIFIED** until its bad fixture is rejected, a clean counterpart succeeds and restored/restarted state behaves correctly. Save implementation SHA, config/image/tool versions, timestamp/network, input/evidence hashes, expected/observed behavior and signer/dispatch/amount counts. Synthetic attack fixtures stay outside real brain; no real secret probes or mainnet negative tests. Keep actual transaction WAL/obligations when restoring tests. “Not run” and infrastructure-blocked are not passes. This matrix replaces 03's oversized guard implementation plan; its G IDs remain useful fixture references.

| Acceptance bundle | Bad/control pair and evidence needed | Gate / older detail |
|---|---|---|
| T1 wire + exact bytes | Tampered manifest/quote/arm/answer/domain/duplicate key/spans fail; complete public golden vector and Japanese UTF-8 spans pass | Before integration; 03 G14/G16/G17, 01 §§5–6 |
| T2 question + fan-out | One changed byte, arbitrary template slot or attachment rejected **before seller network**; approved question contacts ≤3 listings, one decline/one ready, ≤1 selected purchase | Gate 1 + release; G09/G18, M02 |
| T3 money boundary | Cap+1/payee substitution/extra instruction/concurrent reservation/restart-midnight/admin access denied; exactly permitted transaction accepted; wallet-return message substitution rejected | Gate 1; G01–G06/G21/G23/G27 |
| T4 chain + recovery | Actual devnet atomic failed leg, wrong/replayed proof, confirmed-only, RPC null, lost response and crash; exact finalized split/recovery works once | Gate 1; G19–G22/G28 |
| T5 publication + P3 | Secret scanner built-in fixture and independent custom marker each detected; business/PII/lineage/link/canary/unlisted files/changed approval fail; clean reviewed bytes pass and synthetic private-corpus variants do not affect output | Gate 2; G10–G13/G26, 04 A6, 05 D5 |
| T6 host + three injection directions | Force malicious slice text through test retrieval, approved-looking hostile buyer input, and correctly signed hostile answer through buyer boundary; no outside canary, network callback, key/admin access or unauthorized task tool. Clean supported check/repair succeeds | Before paid activation; G06–G08/G16/G23 |
| T7 revocation | Revoke ready/armed/paid/cache/backup/imported states; restart with older content backup and current tombstones; all new disclosure stops, liability survives. Non-revoked lost-response recovery passes | Gate 2 + release; G15/G28, M06 |
| T8 receipt persistence | Pre-sign DB failure blocks; post-pay import outage keeps receipt without repurchase; import twice/read after restart yields one record; planted instruction cannot gain authority; metadata fallback tested | Gate 2; G25/G29, M09 |
| T9 outcomes + accounting | Forged human source/other buyer/duplicate feedback rejected; self/demo/replay exclusions explicit; refund keeps failure; honest clean signal recorded, no numeric score | Release; G24, M09 |
| T10 evaluation | Rubric/cross-arm canaries inaccessible; identical A/A fixture grades identically; changed frozen fixture aborts; actual A/B/C runs use same allowed actions/budgets and report negative/unknown evidence | Before claims; G30, M10 |

Minimal build order: shared schemas/golden fixture → protected broker + human wallet interface → deterministic seller/quotes + static two-listing registry → SPL/arm/durable proof recovery → safe publisher/host/revocation → receipt fallback/outcomes → three-arm fixtures/report → recorded release. Content/keys need early F time; I can use public synthetic fixtures while waiting, but no paid final-content activation without approval.

Use one lockfile, reviewed pinned dependency versions and no secret-bearing builds. Prefer platform crypto/HTTP/test facilities plus one Solana SDK family, strict JSON/schema/JCS parser, SQLite and pinned scanner; native install scripts require review. No Minisign, LLM SDK on seller, vector stack, Presidio integration or UI framework needed. Reuse public test vectors. CI: type/schema checks, applicable deterministic unit/integration tests, secret/business scan, dependency/license check and build. OS isolation, actual wallet/devnet, final content approval and gbrain readback are separate release evidence on exact revision. Green CI cannot replace them. Run affected checks after fixes, then one exact-release smoke; no tests added merely to mirror trivial code.

<a id="m12"></a>
## M12 — One calendar and founder-hour critical path

Today = **Oct 8 evening JST**. Official contest and registration end = **2026-10-12 23:59 PT = 2026-10-13 15:59 JST**, per supplied rules §5. Internal package/submission target = **Oct 12 18:00 JST**. This replaces both older gate calendars: Gate 1 moves from Oct 9/Oct 10 23:59 to **Oct 10 18:00**; Gate 2 moves from Oct 10 18:00/Oct 11 10:00 to **Oct 11 10:00**. These are proposed execution milestones under D1, accepted as planning defaults here, not fabricated historical founder approval. F confirms capacity by Oct 9 10:00; missed times remain misses.

Planning estimate **UNVERIFIED**: 16 focused F hours minimum, plus 2 h reserve; 28–34 active I hours across Oct 9–12. AI runtime/waits are not founder labor; wallet signing and content decisions are. Time first two pages, one wallet flow and one triple under bounded probes; recalculate early. Do not add 04/05 task totals on top of this budget or assume a reviewer is another implementer.

| JST date | F-only active hours (estimate) | I deliverable / approximate active hours | Acceptance / dependency |
|---|---:|---|---|
| Oct 8 evening | **0.5 h**: confirm priorities/availability; private admissible inventory counts | Read handoff; no coding dependency tonight | Actual counts or UNVERIFIED; no private text to AI |
| Oct 9 | **5 h**: 1.25 wallet/key/test funding; 2 first-page/content work; 1 incident provenance/before-state approval; 0.75 defaults, public-download/license/remote choices | 8–10 h: wire fixture, human-signing adapter, broker boundary, extractive seller/decline; 30-min x402 spike included | By 10:00 F capacity/defaults; by 12:00 key interface feasible; by evening five-page draft and actual candidate counts; use synthetic fixtures if F content pending |
| Oct 10 | **3.5 h**: 1.25 finish exact-byte page/demo-fixture review and sealing; 1 devnet signatures/negative tests; 0.75 rubric/checklist approval; 0.5 host/takedown acceptance | 8–10 h: SPL/WAL/recovery, publisher/host, revocation, receipt import probe; freeze eval protocol by 18:00 | Autonomous-signer stretch cutoff noon; **Gate 1 at 18:00**; first full triple timing by evening after pass |
| Oct 11 | **4 h**: 0.75 Gate 2 review; 1 replay signatures + verdicts; 0.5 mainnet provisioning/approval; 1.25 narration/capture; 0.5 claims/cut decisions | 8–9 h: Gate 2 controls, triple evaluation, outcome report, one mainnet clip if safe; prepare package | **Gate 2 at 10:00**, **cut at 12:00**; first complete recording by 18:00; no new features afterward |
| Oct 12 | **3 h**: 1 final video/pitch; 0.75 release/OSS privacy check; 0.75 registration/submission; 0.5 contingency | 4–5 h: critical fixes only, exact-release smoke, reproducibility docs/links | Package public/reproducible and submitted target **18:00**; save actual submission confirmation |
| Oct 13 before official end | **Up to 2 h reserved**, not feature capacity | Submission-link/platform recovery only | Official end **15:59**; use margin for failures, not extra features |

**Founder serial critical path:** private eligibility/content approval → public exact-byte seal → host/takedown acceptance → Gate 2 → final claims/video → OSS release/submission. **Payment path:** F private keys/funding + I wallet/broker boundary → devnet evidence Gate 1 → F mainnet setup and exact-message approval → final proof/recording. **Evaluation path:** F actual case inventory/approvals + I fixture/checkers → frozen three arms → F devnet signatures/adjudication → honest report. I cannot compress these by authorizing on F's behalf.

Gate 2 requires: five useful approved founder pages (and operational labeled demo listing), scans/lineage/host/citation/revocation controls; frozen actual admissible case set and full A/B/C protocol; observed supported receipt import/readback or the explicitly labeled safe fallback. Target ten historical cases is reported separately: fewer is a **target shortfall**, not a privacy gate failure. At least one real matched triple must be executable to claim historical evaluation readiness. Zero admissible cases permits synthetic demo only with evaluation milestone missed. Metadata-only import is reduced conformance, not full-answer storage success. Gate verdict lists each dimension; no aggregate “all green” hiding shortfalls.

**Cut at Oct 11 12:00, exact order:**

1. Cancel any residual adapter/catalog work and autonomous-signer stretch; these are already excluded from minimum, so claim no newly saved time if never started.
2. Cancel generative inference, embeddings, local models, native gbrain publication source and page expansion beyond five; retain the already-reviewed demo fixture. These too are not baseline tasks.
3. Stop independent seller onboarding; use the operational founder-operated demo listing. Keep two listings and free fan-out.
4. Remove custom graphical UI, publisher UI, automatic lineage watcher and presentation polish; keep inert review, manual freshness, enforced revocation and required `list`/MCP/report.
5. Drop optional repeat triples and additional predeclared cases that have not started, retaining their unrun count. **Never drop free B from a retained primary case**, cherry-pick results or erase negative evidence.
6. Reduce video embellishment/extra clips, preserving actual failure/result/boundary/receipt evidence and required artifact lengths.
7. If mandatory work still does not fit F's remaining hours, disable paid mode and submit the smaller explicitly incomplete experiment. If no safe public content exists, synthetic-only demonstration. Mainnet, full receipt import or historical eval misses stay visible.

Never cut data provenance, key isolation, exact-message approvals, spend reservations, atomicity proof, free-decline invariant, signature/citation verification, revocation/restart checks or honest reporting. No external paid launch, numerical reputation, reserve or second rail is waiting below the cut line.

<a id="m13"></a>
## M13 — Evidence hygiene, demo and official judging criteria

The following is the claims ledger at authoring time; read dates refer to source documents, not new verification by this integration pass. Linked external capabilities are documented claims already described in supplied files. Moving URLs, installed versions and review model labels remain unverified locally. Unknown verification owners and 30-minute fallbacks are M14. Do not quietly promote a source citation to runtime success.

| Evidence class | Permitted statement / source + date | Verification boundary and release rule |
|---|---|---|
| (a) Founder-reported | Daily gbrain/harness use, recurring missed leftover checks, source `default`, approximate page/chunk counts: 00 §2, 00a P1/P3, reported 2026-10-08 | Attributed context, no current census. No private search by AI. Omit inventory numbers from pitch unless useful and F reconfirms counts locally. |
| (a) Founder contribution claim | 00 §2 says 95 = 67 merged + 28 absorbed | **UNVERIFIED**. U6: record repo(s), author identity, cutoff, unique PR IDs/merge state and evidence for each absorbed contribution; deduplicate overlap. No GitHub PR count plus unsourced “absorbed” total. Omit absent reproducible method/list. |
| (b) Contest rules | Supplied [official facts](../research/cwf-official-rules-facts.md), verified 2026-10-08, PDF §§5/8; six criteria and PT/JST deadline | Use this source, not older seven criteria. Actual form/video/pre-existing-code/AI rules remain U7; absence from extracted PDF is not permission or prohibition. |
| (b) Solana/JCS | 01 §3/§6, documentation read 2026-10-08: [transaction atomicity](https://solana.com/docs/core/transactions), [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) | Documented design basis only; actual SDK/transaction/schema compatibility remains Gate 1/T1. |
| (b) Pay.sh/x402 | 01 §3 and reviews, read 2026-10-08: [Pay docs](https://pay.sh/docs), [Pay source](https://github.com/solana-foundation/pay), [x402 exact](https://docs.x402.org/schemes/exact) describe paid request tooling/single-payee examples | No claimed custom split acceptance, tested headers, installed Pay version or devnet compatibility; U8 captures exact source/version. Unsupported URL = UNVERIFIED, omit specific feature assertion. |
| (b) gbrain | 04 B6 / 05 D1, read 2026-10-08: [sources/grants](https://github.com/garrytan/gbrain/blob/master/docs/architecture/brains-and-sources.md), [memory boundaries](https://github.com/garrytan/gbrain/blob/master/docs/guides/memory-boundaries.md) | Documentation distinguishes sources from serving isolation; installed export/import/retrieval behavior is **UNVERIFIED U4**. Do not repeat an unverified Bun minimum. |
| (b) Review identities / third-party detail | Review filenames identify three review records; 02 closing review attribution and Claude record contain model labels, all dated 2026-10-08 | Model identities/execution provenance **UNVERIFIED**; label reviewers by record filename only. Presidio URL, Visasq/Apple splits, contest-winner names and launch maturity claims are not needed and omitted from pitch; U6 can check primary sources in 30 min if retained. |
| (c) Runtime-verified results | **NONE at master authoring**: no payment, sandbox, page approval, import, model behavior, eval or deploy verified here | Only attach an actual artifact/revision/environment/time to change this class. Fixtures and green CI do not count as all layers. |
| (d) External estimates | Sol review F16 attributes TRM 0.6–7.5% to **screened commerce value**, not all settlement volume; [TRM analysis](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain), cited by review 2026-10-08 | Source period, sample size, screening method and current URL **UNVERIFIED** here. Omit number from pitch; U6 must capture all denominators before use. Never use it as TAM. |
| (d) Cost/market estimates | 02 §2 hypothetical cohort; 04 hosting ranges; M12 F/I hours | Planning assumptions, not observed margins/prices. Record cohort N, conversion K/N, expense period, tasks/buyer/month and labor minutes if used; no fabricated opportunity total. |

**One canonical honest-traction sentence** (fill bracket only from records):

> “The founder-to-founder mainnet test is [not completed / verified at transaction link]; it demonstrates money movement and the fee split only when verified, not demand, and this hackathon admits no external paid orders.”

Use this sentence in report/demo/pitch; do not substitute another “traction” formulation. It does not claim no historical demand exists everywhere. Independent demand remains unvalidated by this build. Forbidden: “organic revenue,” “paying customers” for self-tests, “two independent sellers” for demo rows, “autonomous purchases” without human-signing disclosure, “injection-proof,” “x402-compatible” without adapter evidence, “saved $X,” “95 verified contributions” without method, “profitable” from gross transfers, and “independently evaluated” for F/AI review. A mainnet signature alone does not prove fee split or useful delivery.

**Demo storyboard, target 2:55 (maximum 3:00 internally):**

| Time | Evidence and story |
|---|---|
| 0:00–0:25 | Open with an **observed** task failure and changed outcome from the frozen case; show failed check versus successful allowed action, with retrospective label and free-checklist result beside it. If no observed improvement, open with that null result and narrow the claim. “Ask a Brain: a Market Harness; gbrain is our first market.” |
| 0:25–0:45 | Correctly signed hostile advice/unauthorized purchase attempt hits the external broker/tool boundary: no signature/broadcast, unchanged caps. Label the synthetic attack. No staged success claimed as live proof. |
| 0:45–1:10 | One approved question reaches two labeled listings: one declines free, one has a prepared answer. Show zero-charge disposition and ready offer; source pages openly downloadable. |
| 1:10–1:45 | Permitted purchase: visible human wallet approval, exact split, finalized proof, same precommitted extract, then actual allowed task action. Use the single mainnet recording if completed; otherwise clearly labeled devnet and unmet mainnet milestone. |
| 1:45–2:05 | One explorer transaction, seller/fee deltas and network fee; short shot. State composability limitation. No retake purchase. |
| 2:05–2:35 | Receipt with actual import mode/readback, outcome ledger source and exclusion, failures/refunds retained; actual n and A/B/C outcomes/minutes/spend. “Unrated until 3 independent buyers.” |
| 2:35–2:55 | Canonical honest-traction sentence, remaining limitations, public OSS repo/reproduction path and next independent-value experiment (after contest). |

Screenshots/recordings identify revision, network, receipt ID and recorded/accelerated status. A failed live attempt uses genuine saved evidence with label; no fabricated transaction or substituted synthetic historical case. No raw private evidence, keys, notifications or third-party identities in capture.

**Pitch, 2–3 minutes; official six criteria only:**

| Official criterion | Concrete pitch claim / artifact, including honest limit |
|---|---|
| Functionality | Observed task and three-arm result, blocked unauthorized purchase, allowed human-signed atomic split, decline/recovery/receipt evidence on exact release. Unpassed gates visible. |
| Potential Impact | Initial segment: personal agent-harness maintainers with recurring completion/retry/recovery failures. Bottom-up opportunity is a hypothesis; future markets are not implemented. No agent-economy TAM from transaction volume. |
| Novelty | Combination of constrained purchase admission, auditable intervention and source-separated outcomes is the proposed distinction. Do not claim API payment itself is new or that Pay.sh lacks untested features. |
| UX | One MCP, bounded free fan-out, explicit decline, understandable approval and recovery, safe receipt. Disclose finite questions, human signatures and setup friction; demonstrate exact supported path. |
| Open-source | Repository **public with an OSS license at submission**, reproducible devnet setup, public contracts/fixtures/evidence and dependency notices. Use composability sentence and M05 adapter path, not proprietary-protocol omission. |
| Business Plan | Marketplace fee + own sales per Q5; experimental split, labor-inclusive cost record, direct/free alternative and no external orders now. Next test is independent own-task willingness to pay after rights/refund readiness, not claimed validation. |

Submission checklist: F verifies registration/form requirements (U7), reviews complete public release/history for secrets/rights, selects actual OSS/content terms, publishes repository and notices, pins release SHA, includes tested devnet reproduction and human key setup, records code/idea reuse with source/license/build-window disclosure, checks logged-out repo/video links and playable durations, submits and saves confirmation/time. “Private first” from D0 is development posture, not submission posture. If F cannot approve public OSS release, flag an Open-source submission conflict; do not call a private repo open-source. Original docs remain historical and are clearly linked as superseded by this master.

<a id="m14"></a>
## M14 — Open founder choices and bounded unknowns

These are concrete unresolved execution choices, not requests to reopen D0–D4/Q1–Q10. Default means preparation can follow it; it never counts as publication, spending or wallet approval. Missed decision deadlines take the listed safe reduced path, not presumed consent.

| Decision | Default; required F act | If F disagrees / misses it | Deadline JST |
|---|---|---|---|
| F1 capacity and reductions | M12 16 h + 2 h reserve; J1–J15 as scoped defaults; F confirms available hours | Cut immediately using M12; expanding scope needs rebudget, cannot silently remove controls | Oct 9 10:00 |
| F2 exact public pages/questions/incidents | Five useful owned pages, finite question set, actual admissible n; F provides approved bytes/counts and exact-byte approval | Use new owned public experiments, label synthetic/nonhistorical; no private search by I. No eligible five-page slice = no active real seller | First inventory Oct 9 10:00; freeze by Oct 10 18:00 |
| F3 human signing / public key configuration | Human wallet all purchases; F creates/provisions keys and confirms sign-only adapter | Other wallet only after U1; no isolation/sign-only proof = paid blocked. Autonomous option needs explicit F choice plus noon canary, otherwise defer | Adapter Oct 9 noon; stretch Oct 10 noon |
| F4 hosted exposure/spend | H1 local; no public tunnel/cloud by default | F approves exact tunnel or H2 provider/region/budget before activation; no decision = local only, availability limitation | Oct 9 18:00 if hosting required |
| F5 seller inference cost | Extractive seller, zero LLM cost; buyer experiment API ceiling separately set by F | Generative seller needs priced/tested amended profile and F cost ownership; absent approval stay extractive. Buyer budget absent = no live model replay | Before first API experiment; no stretch after cut |
| F6 private remote and public OSS release | Ledger remote approval still open; local work may proceed. Propose MIT for new code, CC BY 4.0 for F-owned public lesson text/fixtures after rights check | F chooses compatible actual terms; cannot use placeholder license. No remote approval = local preparation only. No public release approval = submission criterion unmet | Remote Oct 9 10:00; license before seal; public release Oct 12 noon |
| F7 public download and fee/funding | Public full pages; one-cent technical test / 10% fee; F approves exact addresses, caps and setup/funding | Different price/split requires new registry/policy/quotes and affected tests; secret sources incompatible with exact-page model. Runtime mainnet approval always separate | Before seal/setup; mainnet Oct 11 after gates |
| F8 safe gbrain fallback | Prefer isolated quoted prose if T8 passes; otherwise metadata-only with full local receipt | Reject reduced import = mark requirement blocked; never unsafe prose to meet a checkbox | Gate 2 Oct 11 10:00 |
| F9 outside participants | No external paid orders; second listing founder-operated demo unless independent seller already consented and ready | No outreach/payment inferred. External paid launch requires a post-contest decision on refunds/rights/spend; no independent-buyer exception during contest | Seller cut Oct 11 noon |

Every **UNVERIFIED** capability/claim gets a maximum 30-minute initial check, not an assertion it can be implemented or legalized in that time. F performs private-only checks; I performs public/synthetic checks. Missing outcome takes fallback. Do not invent flags, URLs, model versions, mint addresses or consent.

| Check | Owner / evidence to capture in ≤30 min | Deadline / fallback |
|---|---|---|
| U1 wallet/signer | F + I: official wallet docs/help and public version; exact-message sign-only return; dummy secret/admin canary denied; devnet request | Oct 9 noon; alternate already-available human wallet within budget or paid blocked |
| U2 runtime, scanners, buyer model and cost | I checks current official docs/help/version and public vectors, scanner bad/clean fixtures; F accepts buyer-model maximum experiment expense from actual rates/token/run counts | Oct 9; pin working minimal tools. Missing mandatory scanner/crypto blocks release; no model expense approval means no live replay |
| U3 H1 boundary/availability | I/F inspect sanitized mounts/permissions, outside-home canary, denied worker network/host routes and restart; observe local response/RSS | Oct 10 noon; no passing host = seller offline. Cloud cannot be assumed rescue |
| U4 gbrain import | Help/version first, synthetic isolated import/readback twice then actual F-controlled prefixed receipt readback and planted-instruction retrieval; never private search | Initial Oct 9; T8 by Gate 2. Metadata-only or local pending, accurately labeled |
| U5 chain/mint/fees | F verifies [Circle official USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), live RPC mint/program/decimals/accounts/genesis, wallet setup fees and public balances; I observes public outputs only | Before mainnet; missing verification/approval = no mainnet, milestone missed |
| U6 claims/URLs | I primary-source check for each retained contribution/third-party statistic/model attribution; record exact date, method, sample/denominator and evidence. F may supply public contribution IDs | Before pitch freeze; omit optional claim when unavailable. No broad research needed for removed claims |
| U7 form and rights | F checks actual official registration/form, field/video limits, pre-existing/AI-code disclosure, license compatibility and public-content rights; save source/date | Oct 9 initial; Oct 12 before submission. Known official cutoff unchanged; unclear form requirement stays UNVERIFIED and resolved before claim/submission |
| U8 x402/Pay.sh | I performs the single M05 spike using official source/docs; pin version and observed versus merely documented fields | Oct 9; custom SPL remains only rail; leave unsupported compatibility unclaimed |
| U9 inventory/throughput | F alone counts admissible pages/cases, times first two page reviews; I times one approved triple with F signing and checks active labor separately | Inventory Oct 8/9; triple Oct 10 after Gate 1. Actual small n, target shortfall and unrun cases, no synthetic substitution |

<a id="m15"></a>
## M15 — Economics, self-critique and abandon criteria

Initial buyer hypothesis: personal agent-harness maintainers repeatedly lose completion/recovery time and might pay for an appropriately selected, bounded intervention with receipts. Initial acquisition hypothesis: a small explicitly consenting gbrain-user pilot after submission; no named seller/buyer commitment is presumed, and Garry Tan is neither claimed nor required. A free checklist/direct tool may satisfy the same need better.

Experimental fee = M03 split; the one-cent self-purchase produces an internal 0.001 USDC fee transfer, **not consolidated income**. The later 02 §2 price hypothesis (0.25 USDC per answer, 5–15% fee exploration) is UNVERIFIED and not enabled during hackathon. Measure actual F curation, approval, refresh, setup, support and refund minutes alongside buyer-model/hosting/RPC bills. Seller inference is zero in this mode; curation is not. Record gross principal, seller/fee legs, refunds and fees separately by network and evidence class. No profit or labor-savings claim from moving funds among F's wallets.

A bottom-up model can be shown only with assumption labels and denominators: `reachable consenting maintainers × genuine in-scope tasks/buyer/month × paid conversion × accepted price × fee`, minus support/curation/hosting/refunds. All factors are **UNVERIFIED**, so no numeric market size is filled now. 02's hypothetical cohort is illustrative arithmetic, not calibration. Post-contest price research begins with observed free-versus-paid preference and labor, not an agent-volume statistic.

| Weakest point / falsifier | Action |
|---|---|
| Founder cannot supply safe, useful content within hours; hidden restricted lineage keeps appearing | Stop archive extraction. Use new owned public experiments only with honest labels; fewer than five useful pages blocks real slice sale. Never declassify business material by rewriting. |
| Human signing, finite questions and exact extracts feel like a scripted demo | Disclose these limits. Demonstrate real independent enforcement, admissible action and recovery. No claim of general autonomous expertise buying. Expand only after evidence/time justify it. |
| One key, host admin, RPC and manual revocation remain trusted; signatures do not prove truth | Record residual trust. Any key exposure, unauthorized payment or private-data leak suspends paid mode immediately; no safety claim from unexecuted controls. |
| Atomic payment succeeds but answer/refund fails | Withhold unsafe bytes, preserve owed amounts and failure evidence, manual recovery. No fair-exchange or guarantee claim. No external paid launch until funded remedy policy and operation are separately proven. |
| C has no better task outcome than B, or has worse time/harm | Limit result to harness enforcement/accounting. Do not claim paid advice advantage. If both knowledge arms add no benefit, abandon current intervention product and consider a direct completion-check/recovery tool. |
| Retrospective hindsight, small n, F authorship or stochastic variation explains apparent success | Publish family overlap, all arms/attempts/negative outcomes and uncertainty. Do not infer generality or demand; subsequent prospective independent tasks are a new experiment. |
| F time or required controls run out at cut | Smaller unpaid/synthetic demo with unmet milestones, not an all-green paid product. Registration/public-license constraints may still prevent a qualifying submission. |

**Single-seller fallback:** preserve the binding two-listing skeleton for this hackathon (with demo label) if safe; do not claim two-sided validation. After the contest, if no independent supply or independent own-task purchases appear after at most ten qualified opportunities or 30 days of an authorized pilot, stop marketplace expansion and offer one founder-operated tool. Report recruitment denominator and nonresponse; failure to recruit is not proof of universal lack of demand. A change of first market or single-seller packaging need not abandon the Market Harness concept; however, if constrained purchase/receipt machinery adds no value over a free direct tool, abandon that product hypothesis too.

Any scope reduction that loses mainnet, whole-receipt gbrain storage, historical evaluation or public OSS submission is recorded as a missed requirement, never silently redefined as complete. This master is buildable only if its founder-hour and runtime gates actually pass; its design review is not that evidence.

<a id="m16"></a>
## M16 — Landscape and differentiation (added 2026-10-08 after founder question; search-based, not exhaustive)

Founder question: do agent-facing marketplaces already exist, and is a gbrain-specific one unique? Findings from web searches on 2026-10-08 (secondary sources; counts and scale claims are vendor/third-party and UNVERIFIED here):

| Existing market | What it sells | Relation to Ask a Brain |
|---|---|---|
| [x402 Bazaar](https://dev.to/wintyx57/your-ai-agent-just-got-a-credit-card-introducing-x402-bazaar-1g64) (Coinbase ecosystem; also MCP wrappers) | Pay-per-call APIs and tools (token-safety checks, OCR, etc.), mostly Base | Closest on payment mechanics; sells tools, not source-cited expertise. A natural future adapter target. |
| [Virtuals ACP](https://github.com/Virtual-Protocol/agent-commerce-protocol) | Agent-to-agent jobs: request, negotiation, escrow, evaluation, settlement (Base) | **Closest competitor in spirit** (it has an evaluation phase comparable to our outcome ledger). Differs: job market with an agent-token ecosystem vs per-answer purchases of approved, cited slices with a decline-is-free invariant; Base vs Solana. |
| [Agentverse (Fetch.ai)](https://agentverse.ai/blog/ai-agent-marketplace-platforms) | Agent discovery and payments | Registration counts are large but real economic activity is unclear. |
| Pay.sh (Solana Foundation + Google Cloud) | Pay-per-request APIs on Solana, open registry | Neighbour and likely distribution channel; adapter path in M05. |
| Expert-clone platforms such as Delphi | Subscriptions to an expert's AI clone (human buyers) | Similar seller motivation; buyer is a human, not a bounded agent. |

No dedicated marketplace for AI agents buying source-cited expert knowledge, and no gbrain-specific marketplace, was found. Absence in search results is not proof of absence. gbrain's own "sources/grants" scoping is documented as team access control, not a sales channel.

**Why existing markets are a positive signal and where we differ (claims limited to what the build can show):**
1. Product: source-cited, human-approved expertise, with a structural "declined = no charge" invariant (precommitted answers; no post-payment generation).
2. Market Harness (D3): the differentiator is the purchase boundary (out-of-process caps and payee policy, exact-message approval, receipts, outcome ledger), not discovery or payment rails alone.
3. gbrain-native supply: sealed, founder-approved slices of a personal brain; none of the markets above is built around that supply.
4. Outcome evidence instead of volume or stars: a ledger by evidence source, "unrated" until independent buyers exist.
5. Chain: Solana-native, while the larger agent-commerce markets found are Base-centred.

**Limits to state honestly:** the existence of these markets does not prove that agents will pay for expertise; agent-originated x402 value is a small share by a third-party estimate (denominators UNVERIFIED, see M13); ACP could host expertise agents and is the main substitution risk; composability with x402/Pay.sh/ACP is a documented adapter path (M05), not a tested feature. Do not claim "first" or "only" in the pitch; say "we did not find another". Pitch mapping: Novelty and Business Plan rows in M13 may cite this section; Open-source row cites the adapter path.
