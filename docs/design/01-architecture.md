## 要約
公開を承認した固定スライスだけを販売し、元の gbrain には販売サービスから接続しない。
無料事前確認で回答と引用を生成・検証・保存し、回答可能な場合だけ支払い見積を発行する。
支払いは Solana の単一トランザクションで売り手と市場へ分配し、確定後に保存済み回答を返す。
購入側の別プロセスで予算・送金先・署名を制御し、エージェントから上限を変更できなくする。
署名は出所と改変検出を担い、回答の正しさや有用性を保証するものではない。
2日目に devnet 分配、3日目に公開審査と10件の再現評価を検証し、失敗時は明示した縮退へ移る。
mainnet は実行時の人間承認を伴う1回のみとし、自己購入は技術検証として表示する。

# 01 — Architecture

Status: implementation contract proposed for adversarial review, 2026-10-08. Binding input: [00-brief.md](00-brief.md), especially §§3–5. This document makes engineering decisions; it does not report implemented functionality, successful payments, seller consent, or evaluation results. All amounts, limits, and durations below are **chosen prototype settings**, not measured demand or performance. Owners are roles until the founder assigns names.

The minimum thesis is: a budgeted buyer agent obtains useful, source-verifiable help from a separately operated public brain, pays seller and marketplace in one transaction, and records the outcome. Ten personal-ops replays can support a narrow usefulness claim; they cannot establish a market (brief §§1, 4–6).

Conflict register: no agreed decision is intentionally changed. Merchant-then-payout and two separate charges conflict with the one-transaction requirement (brief §§1, 4); they are evaluated but rejected. Plain billing option B cannot structurally prevent a later model abstention; the selected B/C hybrid closes that hole. A fallback that cannot pass the atomic split test blocks the paid demo, rather than silently relaxing the brief. Pay.sh integration is not an agreed requirement; unsupported interoperability must be disclosed.

## 1. System context and component diagram (ASCII)

```text
 Human buyer: sets caps, enrolls wallets/payees; approves ONE mainnet purchase
       | protected admin UI / OS account (not an agent tool)
       v
 +-- TB1: untrusted agent sandbox -----------------------------------+
 | Buyer agent --> thin MCP transport client (no keys, no policy edit) |
 +---------------------------|---------------------------------------+
                             | typed tool calls only
 +-- TB2: trusted buyer OS service, separate identity ----------------+
 | Buyer MCP broker                                                 |
 |  policy + durable spend reservations + transaction validator      |
 |  receipt WAL/outbox --> buyer's own gbrain (private receipt store) |
 |  wallet signer boundary: buyer payment key Kb (human-created)      |
 |  protected invitation token; no arbitrary sign/HTTP/file tool      |
 +--------|--------------------------|-------------------------------+
          | HTTPS                    | signed transaction
          v                          v
 +-- TB3: marketplace ----------+   +-- TB5: Solana ------------------+
 | Static registry JSON        |   | devnet normally                 |
 | settlement/fee-split spec    |<->| one approval-gated mainnet run  |
 | read-only payment verifier  |   | atomic seller + fee transfers   |
 | reputation SQLite store     |   +-----------^---------------------+
 | fee wallet Km: human only   |               | read-only RPC
 +---------------|-------------+               |
                 | listing / outcome references|
                 v                             |
 +-- TB4: seller service -----------------------|--------------------+
 | public-slice index --> answer engine --> abstain/citation policy   |
 | quote/answer SQLite --> signer Ks (non-payment identity key)       |
 | payment verifier --> immutable answer reveal                     |
 | seller payment wallet Kr: seller human only, not service          |
 +------------------------------^-----------------------------------+
                                | approved frozen artifact ONLY
 +-- TB0: private authoring workstation -----------------------------+
 | live gbrain --> explicit export --> pre-publication gate          |
 | allowlist + secret/business/customer/member guard + human approve |
 | No service mount, API credential, or network path to live gbrain  |
 +------------------------------------------------------------------+

 Replay-evaluation harness (separate sandbox, devnet-only buyer policy)
   sanitized incident fixtures --> paired agent runs --> verdicts/report
   uses Buyer MCP; cannot access held-out rubrics or private live brain
```

Deploy one marketplace process, one seller process per listing, and one buyer broker. Use TypeScript on a pinned Node LTS, HTTP JSON, local SQLite transactions, and a Markdown artifact directory; no queue cluster, vector database, custom on-chain program, or account abstraction. A single host may run the marketplace and founder seller under separate service identities. A second demo seller must use a separate slice and identity key; it is still labeled founder-operated demo. Independent seller deployment is supported by the same HTTP contract, not required for technical verification (brief §3 D1/D2.2, §4).

Keys: Kb signs payments only through the isolated buyer service; Ks signs manifests, quotes, and answers only; Kr and Km receive funds and sign manual refunds under their respective humans. The authoring AI never creates, reads, prints, imports, or handles private keys (brief §5). Human operators provision signer handles; implementation tests can inject a signing interface without supplying secrets to an agent. Registry operator identity is pinned by a buyer-approved registry file hash and HTTPS origin, avoiding another signing system. Changes to endpoints, Ks, Kr, Km, network, or mint require human repinning. The marketplace never holds seller proceeds or buyer keys.

Trust assumptions: the buyer trusts its OS broker/admin, enrolled registry operator, RPC providers for chain observations, and seller to deliver after payment. A compromised agent may spend within its allowed budget and give dishonest feedback; it must not obtain signing or policy-admin access. A seller can lie with a valid signature. There is no trustless exchange of payment for useful knowledge.

## 2. Decision S1-A (billing order)

| Option | Benefit | Defect against this brief | Decision / reversal evidence |
|---|---|---|---|
| A: pay, generate, refund unknown | Least free inference | Unknown is charged first; refund can fail, costs fees, needs recipient cooperation | Reject: contradicts §1 and §4.1 even if refunds usually work |
| B: lightweight free eligibility check, pay, generate | Cheap screening, founder recommendation | Retrieval hit does not guarantee a valid answer; post-payment refusal remains possible | Insufficient alone; reverse only with a deterministic answering contract that cannot subsequently abstain |
| C: pre-generate, show commitment, pay, reveal | Answer exists before charge; exact response can be pinned | Seller bears unpaid inference; hash proves neither quality nor recoverability | Good mechanism; retain its commitment and durable cache |
| **B+: free check includes C's validated preparation** | B's buyer flow, C's pre-payment readiness | More expensive free check, requires abuse controls | **Choose**. No generation after payment; a quote is an offer for fixed bytes |
| Conditional escrow/reveal program | Could couple payment to a revealed secret | Program, escrow, audits; revealing bytes still cannot prove usefulness | Defer beyond 4 days; revisit only with audited ready integration |

### Free pre-check contract

`POST /v1/quotes`, authenticated by a manually issued buyer invitation token held only in the broker. Input: protocol version, buyer ID, enrolled payer public key, seller ID, exact question, random request nonce, idempotency key, network, registry version, requested slice version, and maximum total token price. No attachments, URLs to fetch, private context upload, or tool descriptions. UTF-8 question <=4 KiB and <=2,000 characters; one question, no batch enumeration. Before any outbound request, the buyer broker scans for secrets/prohibited identifiers; the runtime agent receives only human-approved personal-ops context and has no business-data mounts/connectors. An uncertain input is blocked locally. This is not a claim that regexes establish data provenance; unrestricted work agents are outside this prototype's admissible runtime. Seller repeats input scanning before model use. The question is sent directly to the seller, not through marketplace logs.

Seller performs topic matching, bounded local retrieval, generation, support validation, and output scanning (§7). It then either:

* Returns `declined`, `abstain:true`, `quote:null`, `charged_atomic:"0"`, generic `reason:"unavailable"`. This deliberately conflates absent evidence, unsafe input, and unsupported question. Operational overload returns a separate retryable 429/503, still with no quote.
* Durably commits a signed, non-abstaining answer and an immutable signed quote referencing its hash, then returns `ready` plus the quote. It reveals price, seller/slice IDs already in the registry, expiry, answer commitment, payment destinations, and delivery terms. **No answer text, citation IDs, snippets, similarity scores, token counts, coverage scores, or unpublished topic list.**

The answer commitment contains a random 128-bit salt inside the hidden answer payload, preventing dictionary checks against likely short answers. Generate the answer's quote ID before preparation; create no payable quote until validation and durable commit succeed. Quote expiry is 5 minutes from issue, nonce is random 128 bits, and quote is bound to one buyer, payer, question hash, registry version, network/genesis hash, mint, two destinations, exact amounts, slice, and answer hash (§5). Prices are fixed per listing, not content-dependent; that avoids price becoming a knowledge oracle. Seller absorbs all pre-check compute costs.

Prototype limits, enforced before LLM calls in seller SQLite: per enrolled buyer+seller 3 new checks/minute, 20/day UTC, one active check, one unarmed ready quote; per IP 10/minute; per seller 100 new checks/day, two model calls in flight, $2/day configured model-cost budget. Reserve the worst-case model cost before starting. If pricing cannot be resolved, disable inference. One generation and one verifier invocation, maximum 12k input tokens combined and 2k output tokens combined, 30-second total deadline; no automatic model retries. Cache identical `(buyer, question_hash, slice)` outcomes for 10 minutes, but never extend a quote's expiry. A duplicate idempotency key consumes no extra inference budget. Changed body with the same key returns 409. Question variants still hit buyer/global caps; invitation revocation is the manual abuse control. Log counters and keyed hashes, not raw questions or bearer tokens.

The answerability bit and timing necessarily leak limited slice membership information. Use a minimum 2-second response time, no detailed decline reason, no anonymous enrollment, and the limits above; do not claim that padding prevents traffic analysis. Public-safe content is the security boundary. A public source can be scraped independently; the product sells synthesis/convenience, not secrecy. Invitation gating is a temporary cost defense consistent with deferring onboarding strangers (brief §4).

### The no-charge invariant and its limits

Only `READY` quotes whose cached answers satisfy `abstain=false` can be armed for payment. The broker cannot request signing without a verified READY quote and matching seller arm ticket. A decline has no payable quote or transaction construction path. An unknown question therefore causes **zero transaction submissions and zero purchase/network fees through this protocol**. Test this by asserting signer-call count zero, no transaction signature, unchanged balances, and a zero-charge receipt for every abstain fixture.

The invariant is about system-declared unknowns, not omniscience: a false positive may be wrong yet sold. Cached-answer loss after payment is delivery failure, not retroactive abstention; it invokes §9 rescue. A person can voluntarily send tokens outside this protocol; no server can prevent unsolicited transfers. Do not promise that such transfers, malicious sellers, or false-positive answers are prevented cryptographically.

## 3. Decision on payment rail and fee split

### Evidence boundary

Brief §6 is the starting evidence ledger. Documentation checked on 2026-10-08 describes Pay.sh wrapping payment challenges and sandbox wallets; it does **not** make sandbox equivalent to Solana devnet ([Pay.sh overview](https://pay.sh/docs)). Pay's README describes permission support for `exact`, `upto`, and `batch-settlement`; no installed version or end-to-end compatibility was tested for this document ([Pay source](https://github.com/solana-foundation/pay)).

x402's documented Solana `exact` examples expose a single `payTo`; they do not establish acceptance of our extra fee transfer ([exact](https://docs.x402.org/schemes/exact)). Its Solana `upto` design involves a channel ceiling and settlement; its Solana batch design uses a funded channel and later voucher redemption ([upto](https://docs.x402.org/schemes/upto), [batch](https://docs.x402.org/schemes/batch-settlement)). These are stronger evidence of documented SVM support than the press report in brief §6, but are not runtime proof that a specific facilitator/Pay binary supports our split. All such integration claims remain gated.

### Alternatives

Estimates below are engineering estimates for one implementer, excluding seller/evaluation work; they are not promises.

| Rail | Split atomicity / trust / custody | Pay CLI and schemes, as known | Estimate and failure behavior |
|---|---|---|---|
| (a) x402 marketplace merchant, then payout | Buyer payment and seller payout are separate; marketplace temporarily controls seller money | A single merchant payment fits documented `exact` shape. `upto`/batch may settle to merchant but do not make subsequent payout atomic. Actual Pay/devnet integration unknown | 0.5–1 day initial gateway, +1 day payout/reconciliation. Payout failure strands seller proceeds. Reject: brief §§4–5/8 conflict |
| (b) x402 seller payee + separate fee | No joint atomicity; buyer may pay one leg only. No central custody but two debts | Could be two `exact` flows if supported; not a single split. `upto`/batch do not establish cross-payment atomicity | 1–2 days. Partial payment requires compensation; reject |
| **(c) custom transaction: two SPL transfers + memo** | Both legs execute or revert together; direct buyer-to-recipient transfers, no custody. Buyer trusts local validator and RPC, seller for delivery | Our HTTP contract is **not x402**, and no Pay `pay` compatibility claimed for any scheme. A generic Solana wallet must sign the transaction | **1–1.5 days** plus 0.5 day negative tests. Failure moves neither token leg; network fee may remain. Choose |
| (d) x402/channel-native split extension | Potentially elegant if a pinned program + facilitator + client proves two recipients atomically | `upto`/batch channel machinery is documented, but our fee recipient configuration and one-event semantics are UNKNOWN; exact extra-instruction acceptance UNKNOWN | 30-minute evidence spike only; production integration 2–4+ days. Delayed distribution, deposits, expiry recovery increase scope. Revisit after hackathon |
| (e) same custom transaction, two native SOL transfers + memo | Same direct atomic split, no mint/ATA setup; SOL-denominated pricing and volatile purchasing power | Not x402 and not claimed Pay-compatible | 0.5 day if (c)'s broker/verifier exists. **Fallback** for SPL setup/tooling failure, not for broken isolation or chain verification |

Solana supports multiple instructions with atomic state changes; transaction fees can still be charged on failure ([Solana transactions](https://solana.com/docs/core/transactions)). Atomic payment legs do **not** imply atomic answer delivery.

### Selected transaction and verification

Use legacy SPL Token only (no Token-2022 transfer fees/hooks), one founder-created devnet test mint with 6 decimals, explicitly named TEST tokens with no monetary value. Mainnet uses an independently verified USDC mint with 6 decimals; the address is a deployment input, never guessed from its symbol. Prototype listing: total `10000` atomic units (0.01 token), seller `9000`, marketplace `1000`; experimental 10% fee, not a validated take rate. `fee=floor(total*1000/10000)`, `seller=total-fee`; both must be positive. Fee rate is pinned in registry and quote. Buyer pays SOL network fees separately.

Pre-create buyer/seller/marketplace associated token accounts with humans during setup. A purchase contains exactly two `TransferChecked` instructions and one Memo, in that order, in a legacy message with a recent blockhash, one buyer authority/fee payer, no address lookup tables. No approvals, delegates, account creation/closing, arbitrary extra instructions, priority-fee instructions, or durable nonce accounts in v1. Memo ASCII: `aab:v1:<quote_id>:<quote_nonce>`; never question text or question hash. Buyer broker builds this transaction locally from the signed quote, decodes it again, and validates exact bytes before asking the human-provisioned wallet signer. A seller-supplied serialized transaction is never signed.

Before signing, the broker reserves spending, obtains a recent blockhash + last-valid block height, and calls seller `POST /v1/quotes/{id}/arm` with the unsigned message bytes and its hash. Seller checks the cached answer, unexpired quote, buyer auth, exact instruction template and destinations, and durably stores **one** allowed message hash/blockhash for that quote; it returns a signed arm ticket. This transitions the quote to payment pending. No second message/blockhash is allowed for that quote, including after timeouts. Buyer persists the signed transaction/signature before any broadcast and retries **identical bytes only**.

Quote expiry is the deadline to arm, not the deadline to observe confirmation. Arming pins an answer and grants that single recent-blockhash transaction its normal chain validity window. A late observation of a valid armed payment is honored, even after quote expiry. Blockchain memo does not itself enforce quote uniqueness/expiry: broker and seller databases do. Direct unarmed payments are unsupported and routed to manual reconciliation. Replacing an expired attempt requires a new quote only after the prior message is conclusively expired and absent; ambiguous attempts remain pending and budget-reserved.

Seller and buyer independently fetch the transaction, require `finalized` and `meta.err=null`, verify enrolled buyer signer/fee payer, exact armed message hash, network genesis, token program, mint/decimals, source account authority, destination accounts/owners, amounts and memo. Check actual pre/post token balance deltas as well as decoded instructions. Marketplace repeats verification before accepting a reputation-bearing settlement. A transaction lookup returning null is not proof of failure ([RPC getTransaction](https://solana.com/docs/rpc/http/gettransaction)). Prototype `PAYMENT_CONFIRMED` means finalized; a merely `confirmed` observation is displayed as pending-finality. No unlock from a screenshot, wallet balance, client-supplied amount, or transaction signature alone.

Fallback (e) replaces only the mint/ATA/transfer validator with System Program SOL transfers; quote asset is `SOL`, amounts are lamports, fee arithmetic unchanged. Set fixed prototype total `1000000` lamports, seller `900000`, fee `100000`; label the SOL amount and do not invent a USD conversion. In the registry/quote use `mint:null`, `decimals:9`, `token_program:null`, and null token-account fields; owner fields are the direct system-account destinations. Both recipient addresses must be distinct from each other and the payer on either rail, even in founder self-purchases, so explorer deltas are unambiguous. A new pinned network/asset policy and quote are required; never reinterpret an SPL quote as SOL.

### Gate 1: end of day 2, 2026-10-09 23:59 JST

Payment owner supplies saved devnet RPC responses and `https://explorer.solana.com/tx/<signature>?cluster=devnet` showing:

1. A real finalized transaction with two token transfers, correct owners/mint/amounts, memo quote+nonce, and network fee. Balance deltas are +9000/+1000 TEST atomic units. Before/after values and signature are in the receipt.
2. A second transaction deliberately fails one transfer: both token legs remain unchanged; any network fee is separately reported.
3. Replaying proof twice/restarting broker does not sign a second message, pay again, or create a second entitlement. Wrong network, memo, mint, payee, and under/overpayment proofs never unlock an answer.
4. Unknown question produces no signer invocation. Agent attempts to edit caps, request arbitrary signing, or exceed concurrent daily reservations fail outside the agent process.
5. Approved sandbox answer is revealed only after finality; its commitment, signature, and cited bytes verify. Simulate a lost HTTP response and recover without a new purchase.

If SPL-specific setup or tooling fails Gate 1, freeze SPL work and spend **at most four hours at the start of day 3** on native-SOL fallback (e), rerunning all five tests with lamports. If RPC availability is the cause, use the configured secondary RPC, not another network labeled devnet. If atomicity, buyer isolation, proof verification, or fallback tests still fail, disable paid consults, retain free/evaluation demonstrations, and explicitly report the core paid thesis unproven. No non-atomic merchant fallback, no fake transaction, and no mainnet attempt. An unresolved hard gate is not “shipped.”

For the one mainnet transaction (brief §3 Q3/D2.4), founder sees and explicitly approves network, exact asset/mint, total, both recipients, fee, estimated SOL fee, quote hash and expiry in the protected wallet UI at runtime. Approval is one-use, bound to the unsigned message hash, and expires with that message. Never reuse devnet approval or infer approval from this document. Mainnet deployment limit: one successful purchase; retries use identical signed bytes, any replacement requires fresh human approval. Mainnet explorer URL omits `?cluster=devnet`; demo shows both transfer instructions, memo, status, actual fee, and receipt. Preparation/funding transactions are separate, human-operated, disclosed, and never counted as the purchase. Never call a TEST-token transfer real money.

## 4. Consult state machine

```text
 NEW --> PRECHECK_RUNNING (ANSWER_GENERATING, unpaid)
             |-- unknown / unsafe / no support --> DECLINED [no quote]
             |-- provider/parse/time budget error --> PRECHECK_FAILED [no quote]
             v
       QUOTE_ISSUED (validated answer durably READY)
             |-- expires before arm --> QUOTE_EXPIRED
             |-- broker blocks / approval denied --> CANCELLED [no payment]
             |-- reserve + arm one message --> PAYMENT_PENDING
                         |-- confirmed, not finalized --> PAYMENT_PENDING
                         |-- final err / proven expired+absent --> PAYMENT_FAILED
                         |-- malformed externally sent amount --> UNDERPAID / OVERPAID
                         |                                      [manual reconciliation]
                         |-- finalized, exact verified message --> PAYMENT_CONFIRMED
                                                                      |
                                                      reveal fixed bytes
                                                          |           |
                                                     DELIVERED    DELIVERY_FAILED
                                                          ^           |
                                                          +-- cached retry
                                                          |           +--> REFUND_PENDING
                                                   FEEDBACK_RECORDED          |
                                                                    PARTIAL_REFUND / REFUNDED
```

Payment, delivery, feedback, refund, and gbrain-import status are persisted as separate fields: a delivered consult can later be refunded; `FEEDBACK_RECORDED` does not overwrite delivery evidence. The diagram shows the normal progression, not a single field losing history. State changes use SQLite transactions with expected-version compare-and-swap and an append-only event sequence.

| Transition / timeout | Authority and persisted evidence | Invalid transition and prevention |
|---|---|---|
| NEW → PRECHECK, <=30 s | Seller stores authenticated buyer, question hash, idempotency key, request digest, rate/model-cost reservations | Reused key with another body: 409; duplicate concurrent call joins the same job |
| PRECHECK → READY/DECLINED/FAILED | Answer+signature+quote committed together; crash leaves no issued payable quote | `DECLINED → PAYMENT_PENDING` has no quote row or signing permit |
| QUOTE → EXPIRED after 5 min unarmed | Seller clock controls arm deadline; broker refuses with <30 s remaining | EXPIRED → arm rejected; new quote ID required |
| QUOTE → PENDING | Broker spend reservation, seller arm ticket, broker signed message WAL | New message for armed quote rejected by unique quote constraint; agent cannot directly broadcast via signer |
| PENDING → FAILED | On-chain error or finalized chain beyond lastValidBlockHeight plus absent signature on primary and secondary RPC | RPC null/timeout alone cannot release reservation; no automatic repurchase |
| PENDING → CONFIRMED | Full finalized transaction verification and unique `(genesis, tx_signature)` consumption | One tx cannot credit two quotes; wrong buyer/memo/payee never accepted |
| UNDERPAID/OVERPAID | Only external/nonconforming transfers; record actual leg values and discrepancy | Never add a second “top-up” payment to complete a purchase; never silently keep excess |
| CONFIRMED → DELIVERED | Seller returns cached signed bytes; buyer verifies and writes local receipt before tool success | No post-payment model invocation or quote replacement allowed |
| CONFIRMED → DELIVERY_FAILED | Cached blob missing/corrupt, signature/hash/citation mismatch, or repeated retrieval error | Never turn this into paid abstention or fabricate a regenerated answer |
| DELIVERED → FEEDBACK_RECORDED | Marketplace validates buyer token + verified payment + delivery hash; unique consult/source | Third-party bearer proof cannot submit feedback for enrolled buyer; duplicates idempotent |

HTTP waits: pre-check 30 s; payment foreground wait 60 s, then return a consult ID and `payment_pending`; status polling backs off 2/4/8/15 s. When human approval is needed, return `approval_required` on the existing consult and show the offer in the protected human UI. The human action resumes that same broker job; `status` only reads state and cannot grant approval. Do not arm while waiting for a human to review the offer. After the human elects to proceed, construct/arm a fresh message and obtain its exact-message wallet approval; expired quotes/messages require fresh review, never silent renewal. Seller verifier continues every 15 s while healthy. At 10 minutes unresolved, show “payment status unknown—do not pay again” and open rescue. Do not discard pending rows on a wall-clock timeout. A paid reveal has a 10-second response target, three same-ID HTTP retries over 60 seconds, then `delivery_failed` with rescue pending.

Payment failure may still incur SOL transaction fees; failed/declined purchase amounts and network fees are different receipt fields. Budget reservations for ambiguous payments survive process restart and midnight. Failed token transfers release only token reservations, retaining actual SOL fees; refunds do not replenish the day's purchase budget.

Idempotency hierarchy: client `request_id` UUID scoped to enrolled buyer; seller quote nonce/ID; unique armed message per quote; unique chain signature across marketplace payments; receipt ID = consult ID; feedback key `(consult_id, source)` with one value in v1. Same `request_id` returns the original consult even after expiry/failure, never silently initiates another purchase. A new request requires a deliberate new tool call and available budget.

Persistence: seller SQLite stores answers, quote/arm rows, payment proofs and reveal events; marketplace SQLite stores registry snapshots, unique settlements, feedback and rescue records; broker SQLite stores reservations, protected policy version, exact transaction bytes/signature, receipts and gbrain outbox. No database shared with agent credentials. Retain unresolved payment records indefinitely until adjudicated; retain paid answer/receipt artifacts for the prototype's disclosed 30-day support window, with encrypted host backup. Unarmed expired answer caches can be deleted after 24 hours. Questions need not be retained by seller after answer preparation; only salted/keyed dedup metadata remains. Buyer retains its own question in its private receipt.

HTTP ownership: seller exposes `POST /v1/quotes`, `POST /v1/quotes/{id}/arm`, `POST /v1/quotes/{id}/payment` (proof locator), and `GET /v1/quotes/{id}/answer` (202 until finalized, then immutable envelope), plus the public manifest/page routes. Marketplace exposes `GET /v1/registry`, `POST /v1/settlements`, and `POST /v1/feedback`. After verified reveal the broker queues a settlement registration containing signed quote, arm ticket, payment proof and signed answer; marketplace validates them and retains hashes/payment metadata, not answer prose. Receipt persists before this asynchronous registration; marketplace outage does not withhold an already paid answer. Feedback waits for settlement registration. “Delivered” for reputation is the authenticated broker's acknowledgement of a verified envelope, not cryptographic proof that a human read it. Each origin has its own invitation token bound server-side to buyer ID and payer; never forward credentials between origins or trust a body-supplied buyer identity. All private routes enforce buyer ownership of the quote/consult.

## 5. Messages and data shapes (JSON examples)

Examples are illustrative, **not executable payment instructions**. Strings inside `<...>` stand for validated public addresses, hashes, or signatures; dates/IDs are fixtures, not observed events. All amounts are unsigned base-10 integer strings; no float arithmetic. Hashes are lowercase SHA-256 hex, public keys/chain signatures base58, off-chain Ed25519 signatures base64url. Strict parsers reject duplicate JSON keys, unexpected fields, out-of-range lengths, and version mismatches. HTTPS only outside localhost tests; invitation tokens are Authorization headers and never serialized into these records.

### Registry entry

```json
{
  "v": 1,
  "registry_version": "registry-001",
  "seller_id": "founder-ops",
  "display_name": "Founder public agent-ops brain",
  "operator_id": "founder",
  "listing_kind": "founder",
  "endpoint": "https://seller.example.invalid",
  "topics": ["agent-completion-checks", "personal-harness"],
  "signing_key": {"id": "ks-001", "algorithm": "Ed25519", "public_key": "<seller-public-key>"},
  "slice": {
    "id": "ops-public-001",
    "manifest_sha256": "<manifest-hash>",
    "manifest_url": "https://seller.example.invalid/v1/slices/ops-public-001/manifest",
    "approved_at": "2026-10-08T13:00:00Z"
  },
  "payment": {
    "rail": "solana-split-v1",
    "network": "devnet",
    "genesis_hash": "<verified-devnet-genesis>",
    "asset": "TEST",
    "mint": "<founder-devnet-test-mint>",
    "decimals": 6,
    "token_program": "<legacy-token-program-id>",
    "total_atomic": "10000",
    "fee_bps": 1000,
    "seller_owner": "<seller-receive-public-key>",
    "seller_token_account": "<seller-ata>",
    "marketplace_owner": "<marketplace-receive-public-key>",
    "marketplace_token_account": "<marketplace-ata>"
  },
  "trust": {
    "as_of": "2026-10-08T13:00:00Z",
    "status": "unrated",
    "score": null,
    "eligible_human_yes": 0,
    "eligible_human_no": 0,
    "agent_yes": 0,
    "agent_no": 0,
    "technical_verifications": 0
  }
}
```

`listing_kind` is `independent`, `founder`, or `demo`. The static listing set has at least two entries; the marketplace rewrites only their derived trust snapshot atomically from its feedback store. Broker compares a pinned security-fields digest excluding `trust`, so outcome counts can update without changing destinations. No dynamic seller onboarding/ranking service.

### Quote request / response

```json
{
  "v": 1,
  "request_id": "8bdbce11-0b2d-4cc7-a2bb-1d9f5dd23e01",
  "request_nonce": "<128-bit-random-base64url>",
  "buyer_id": "buyer-founder",
  "payer": "<buyer-public-key>",
  "seller_id": "founder-ops",
  "registry_version": "registry-001",
  "slice_id": "ops-public-001",
  "network": "devnet",
  "question": "What evidence should a completion report include for leftover checks?",
  "max_total_atomic": "10000"
}
```

```json
{
  "status": "ready",
  "quote": {
    "payload": {
      "v": 1,
      "quote_id": "q_01",
      "nonce": "<quote-random-128-bits>",
      "request_id": "8bdbce11-0b2d-4cc7-a2bb-1d9f5dd23e01",
      "buyer_id": "buyer-founder",
      "payer": "<buyer-public-key>",
      "seller_id": "founder-ops",
      "registry_version": "registry-001",
      "question_sha256": "<hash-of-exact-question-utf8>",
      "slice_id": "ops-public-001",
      "manifest_sha256": "<manifest-hash>",
      "answer_sha256": "<hash-of-canonical-answer-payload>",
      "issued_at": "2026-10-09T01:00:00Z",
      "expires_at": "2026-10-09T01:05:00Z",
      "rail": "solana-split-v1",
      "network": "devnet",
      "genesis_hash": "<verified-devnet-genesis>",
      "asset": "TEST",
      "mint": "<devnet-mint>",
      "decimals": 6,
      "token_program": "<legacy-token-program-id>",
      "total_atomic": "10000",
      "seller_atomic": "9000",
      "fee_atomic": "1000",
      "seller_owner": "<seller-public-receive-key>",
      "seller_token_account": "<seller-ata>",
      "marketplace_owner": "<marketplace-public-receive-key>",
      "marketplace_token_account": "<marketplace-ata>",
      "memo": "aab:v1:q_01:<quote-random-128-bits>",
      "delivery": "immutable-answer-after-finalized",
      "refund_terms": "aab-prototype-refund-v1"
    },
    "signature": {"key_id": "ks-001", "algorithm": "Ed25519", "value": "<signature>"}
  }
}
```

```json
{
  "status": "declined",
  "abstain": true,
  "quote": null,
  "charged_atomic": "0",
  "reason": "unavailable"
}
```

Arm request includes `quote_id`, `message_base64`, `message_sha256`, `recent_blockhash`, `last_valid_block_height`. The signed arm-ticket payload contains these except full bytes, plus `buyer_id`, `quote_sha256`, `armed_at`; seller validates blockhash metadata with its RPC. It is domain-signed as `arm`, has no power to raise a cap, and is not an on-chain authorization. Memo nonce is public after broadcast and is not a secret credential.

### Payment proof

```json
{
  "v": 1,
  "consult_id": "c_01",
  "quote_id": "q_01",
  "quote_sha256": "<quote-payload-hash>",
  "arm_ticket_sha256": "<arm-ticket-payload-hash>",
  "network": "devnet",
  "genesis_hash": "<devnet-genesis>",
  "transaction_signature": "<base58-transaction-signature>",
  "message_sha256": "<armed-message-hash>"
}
```

Proof is a locator, not trusted evidence; verifier appends its own slot, commitment, `meta.err`, transfer values, RPC observation time, and message digest. Receipt generation must distinguish submitted from independently verified proofs.

### Answer envelope

```json
{
  "payload": {
    "v": 1,
    "quote_id": "q_01",
    "seller_id": "founder-ops",
    "buyer_id": "buyer-founder",
    "question_sha256": "<question-hash>",
    "slice_id": "ops-public-001",
    "manifest_sha256": "<manifest-hash>",
    "commitment_salt": "<128-bit-random-base64url>",
    "created_at": "2026-10-09T00:59:59Z",
    "answer": "Run the explicit leftover check before reporting completion. [c1]",
    "claims": [{"text": "Run the explicit leftover check before reporting completion.", "citation_ids": ["c1"]}],
    "citations": [{
      "id": "c1",
      "page_id": "public/leftover-checks",
      "content_sha256": "<hash-of-whole-exported-page-bytes>",
      "byte_start": 0,
      "byte_end": 84,
      "excerpt": "<exact-utf8-substring-of-that-page>",
      "source_url": "https://seller.example.invalid/v1/slices/ops-public-001/pages/public%2Fleftover-checks"
    }],
    "abstain": false,
    "engine_version": "seller-engine-001"
  },
  "signature": {"key_id": "ks-001", "algorithm": "Ed25519", "value": "<seller-signature>"}
}
```

The illustrative excerpt/offsets above must be replaced with internally consistent actual page bytes in implementation fixtures. The server renders `answer` from validated `claims`; it cannot append uncited model prose. An unknown pre-check uses the decline response, never a paid answer envelope with `abstain:true`.

### Receipt

```json
{
  "v": 1,
  "receipt_id": "c_01",
  "request_id": "8bdbce11-0b2d-4cc7-a2bb-1d9f5dd23e01",
  "buyer_id": "buyer-founder",
  "seller_id": "founder-ops",
  "classification": "technical_verification",
  "question": "What evidence should a completion report include for leftover checks?",
  "quote_id": "q_01",
  "quote_sha256": "<quote-hash>",
  "answer_sha256": "<answer-hash>",
  "payment_state": "confirmed",
  "delivery_state": "delivered",
  "feedback_state": "none",
  "network": "devnet",
  "asset": "TEST",
  "total_atomic": "10000",
  "seller_atomic": "9000",
  "fee_atomic": "1000",
  "network_fee_lamports": "<observed-integer>",
  "transaction_signature": "<signature>",
  "finalized_slot": 123456,
  "explorer_url": "https://explorer.solana.com/tx/<signature>?cluster=devnet",
  "verified": {"chain": true, "seller_signature": true, "answer_commitment": true, "source_hashes": true},
  "artifact_refs": {"quote": "quotes/q_01.json", "answer": "answers/c_01.json", "manifest": "slices/ops-public-001.json"},
  "refund": {"status": "none", "returned_atomic": "0", "transactions": []},
  "latency_ms": {"precheck": 12000, "finality": 18000, "delivery": 400},
  "gbrain": {"page_id": "consults/c_01", "sync_state": "pending"}
}
```

A declined receipt sets all purchase amounts to zero, chain signature/quote/answer to null, and verification fields to `not_applicable` rather than true. Buyer stores the complete signed quote, answer, manifest, cited public pages, payment evidence, policy version and receipt together; artifact refs must resolve within its protected store. Latencies in this example are invented fixtures, never used in the demo as measurements.

### Feedback record

```json
{
  "v": 1,
  "feedback_id": "f_01",
  "consult_id": "c_01",
  "quote_id": "q_01",
  "answer_sha256": "<answer-hash>",
  "buyer_id": "buyer-founder",
  "seller_id": "founder-ops",
  "source": "agent",
  "useful": true,
  "reason_code": "prevented_missed_check",
  "transaction_signature": "<signature>",
  "classification": "technical_verification",
  "eligible_for_trust": false,
  "exclusion_reason": "same_operator",
  "recorded_at": "2026-10-09T01:02:00Z"
}
```

Buyer supplies only consult ID, useful boolean and reason code. Marketplace derives payer, source, seller, payment, classification, eligibility and timestamps. The agent cannot label its feedback human or independent; §6 defines distinct entry points.

## 6. Identity, provenance and verification

Choose seller-specific **Ed25519**, separate from seller payment keys, with a pinned public key in each registry entry. Do not add ENS, DID, SAS, certificates for brain ownership, or an on-chain identity registry (brief §4 cuts, §7.3). Human seller enrollment records claimed operator identity, consent, key fingerprint, payment destinations and public-slice approval. This is an operator-attested directory, not verified universal identity.

Sign `UTF8("ask-a-brain/v1/" + type + "\n") || JCS(payload)` for types `manifest`, `quote`, `arm`, and `answer`. Use RFC 8785 JCS canonical bytes and SHA-256 of those payload bytes for commitments; avoid ordinary JSON stringification and float amounts ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)). Signature covers all payload fields, not the surrounding signature object. Reject unknown key IDs and duplicate JSON property names; retain old public keys for verifying old receipts. Human repinning is required for rotation. No transaction or LLM tool can ask Ks to sign arbitrary external messages.

Manifest payload contains seller ID, slice ID, creation time, gate version, approval ID, and sorted `{page_id, content_sha256, size_bytes}` entries; page hashes bind exact exported UTF-8 bytes, without a second normalization at verification. Gate records remain private except approval ID/time. The manifest is signed and its hash pinned in the registry and quote. Public approved pages and manifest are readable without payment; the paid artifact is synthesis. Quote pre-check itself never exposes which pages matched.

Buyer verification order: authenticate the pinned listing; verify quote and arm signatures; verify network/payment; verify answer signature and answer commitment against quote; verify quote/buyer/question/slice IDs; fetch signed manifest and whole cited pages from the pinned seller origin; hash whole pages; validate byte ranges and exact excerpts; persist results before returning a verified answer. Disallow redirects, private-network source URLs, path traversal, arbitrary external URLs and oversized pages (64 KiB/page, 512 KiB total verification fetch). Failure yields `verification_failed` and rescue, not trusted text. Public pages are archived in the receipt to avoid future link rot.

Signature proves that the holder of the listed key committed to these bytes. Page hashes prove correspondence to that signed snapshot, not original authorship, consent, truth, freshness, completeness, semantic entailment, expert status, or utility. A seller can publish fabricated pages and faithfully cite them. A registry operator can misrepresent an operator until caught; buyer pinning limits silent key substitution. Revocation stops new quotes but cannot revoke already-public knowledge. No cryptographic fairness between payment and delivery is claimed.

### Outcome reputation decision

Options: raw thumbs count (easy to game); chain-payment-weighted score (wash trading still cheap); complex sybil-resistant credentials (out of scope); **source-separated, payment-linked, manually enrolled outcomes** (choose). Record all valid observations with provenance; do not collapse them into an invented universal quality number (brief §§3 Q6/Q8, 7.4).

For the displayed trust score, eligible observations are human thumbs on verified delivered **mainnet** purchases by manually enrolled independent operators. Exclude founder-to-founder, demo sellers, devnet, replays, fully refunded purchases, and duplicate buyer-operator/seller votes within a UTC day. Human votes require the broker's protected human UI session, no agent-accessible token, and an explicit click for that receipt. Agent self-reports have source `agent` and separate counts; replay verdicts have source `replay` and a fixture/run digest. Neither raises the public human trust score. Missing feedback is missing, not negative.

Store useful yes/no counts `y,n`; with >=3 distinct eligible buyer operators, display `round(100*(y+1)/(y+n+2))` as “smoothed human usefulness, y/(y+n), distinct buyers k.” Below that, score is null / “unrated (k observations).” Show separate agent/replay/technical counts so the feedback loop remains visible even when public trust stays unrated. Refund corrections append an event and recompute eligibility; no silent deletion. One immutable vote per consult/source in v1; disputes are operator notes, not an overwrite endpoint.

`find` uses topic inclusion and stable seller-ID order, **not trust ranking**; two sellers do not justify ranking machinery (brief §4). Score appears as context. A buyer must choose a seller ID; omit multi-seller auto-shopping. Manual enrollment, payer linkage, operator deduplication and one vote/day reduce trivial gaming but do not solve collusion or hidden shared ownership. Reverse this design only with enough independent outcomes to validate a better metric; never count the founder's second wallet as a new human.

## 7. Seller engine

### Frozen export and publication gate

Choose a **frozen, reviewed export**, not a filtered live gbrain read. Filter bugs, linked graph expansion, embeddings built from private pages, and changes after approval would cross brief §5's hard boundary. Re-exporting is slower but gives stable citation hashes and a small auditable surface. The seller runtime contains no live-brain credentials, symlink, database mount or search endpoint. Build its index only from exported bytes, not existing live-brain embeddings, backlinks, titles or metadata. Filtering is not the protection boundary; separate storage and permissions are.

Founder-only `list` workflow (brief §3 D2.1/D2.3): export proposed pages to a staging directory → run gate → show exact diff and hashes to human → sign manifest through human-provisioned identity signer → deploy read-only artifact → update the two-entry static registry. `list` is an operator command, not a buyer tool. No automatic third-party publication.

Gate is fail-closed, in this order:

1. **Explicit allowlist:** exact page IDs and source hashes approved for personal, public agent-ops knowledge; no glob-all, graph traversal, attachments or external fetch. Reject symlinks, hidden files, binary files, missing provenance, path escapes and unlisted links that would be bundled. Maximum 30 pages, 64 KiB/page for the prototype.
2. **Secret scan:** pinned scanner plus patterns for private keys, seed phrases, tokens, auth headers, connection strings and high-entropy suspicious strings. Scan final bytes including frontmatter, links and filenames. Findings stop export. Test the scanner against synthetic secret fixtures. Scanner absence/error is failure, not a clean result.
3. **Business/customer/member guard:** reject anything originating from the founder's employer or other organisation workspaces (Org data), customer records, member lists, internal communications, tickets, identifiers or non-public membership—even if names are redacted. Case-insensitive deny terms are an extra tripwire, not sufficient classification. Each page needs a provenance declaration `personal_public_ops` or `consented_public_source`; ambiguous origin is rejected, not transformed by an LLM. Never copy prohibited material into a cloud “safety classifier.” This also applies to incident fixtures (brief §§4.6, 5).
4. **Content review:** reject embedded instructions to agents, payment redirects, executable HTML/scripts, credential requests and contradictory playbook rules. Local automated checks flag candidates; human reads **every exact final page**, including metadata and quoted examples. A public source is not automatically safe operational advice.
5. **Human approval:** approval record binds manifest digest, reviewed page IDs/hashes, reviewer identity, timestamp, gate version and decision. Any byte change invalidates approval. No unattended “approve all”; no AI approval substitute. Publish only after a pass and explicit human approval.

If a page might contain prohibited data, exclude the entire page. If too few safe pages remain, reduce topic coverage; never weaken the gate to satisfy demo coverage. If prohibited data is discovered after publication, disable listing, stop new quotes, remove hosted artifacts, notify affected participants through a human, and report that already downloaded bytes cannot be recalled.

### Small answer engine and abstention

Start with SQLite FTS5/BM25 over Markdown sections in the frozen export; no gbrain runtime or vector service dependency. Store section/page IDs and exact byte spans. Predefined topic labels gate retrieval. Retrieve at most five sections with a combined 4k-token evidence ceiling, leaving room to repeat that evidence during verification within §2's combined model-input limit. Because BM25 scores are corpus-dependent, **do not invent a universal numeric similarity threshold**.

Concrete initial eligibility rules: question must match an approved topic; after fixed English tokenization/stopwords, at least two distinct substantive query terms must appear in retrieved evidence (or one exact approved technical identifier from a human-authored alias list). No hits, incompatible versions/dates, unsupported request for current facts, conflicting instructions, private/person-specific question, or an “export all pages” request ⇒ decline. These are chosen conservative rules, calibrated on safe fixtures, not claimed confidence probabilities.

The LLM has no tools, web, filesystem, wallet, registry-write or live-brain access. Prompt treats question and retrieved text as untrusted data and asks for 1–5 concise claims with citations from the supplied section IDs. Deterministic validator requires every claim to have >=1 citation, valid IDs/spans, exact excerpts, no new URLs/secrets, and <=1,500 answer characters. A separate bounded verifier invocation must label **every claim** supported and no contradiction; `unsupported`, `uncertain`, missing label, malformed JSON, refusal or timeout ⇒ no quote. A model's stated confidence is ignored. Verifier can share a model/version for cost; correlated errors remain a limitation.

Generate final prose only from accepted claims. The seller signs and stores exactly that answer before quoting. No paid generation exists. On evidence ambiguity, return “unavailable” rather than unsupported elaboration. Day-1 tests include answerable questions, at least five out-of-scope/unknown questions, conflicting pages, stale facts, planted payment/policy instructions, malformed output and provider refusal. Required observed result: no ready quotes for the seeded unsafe/unsupported fixtures, valid citations for every ready quote. This is a regression gate, not proof of perfect hallucination detection.

Fallback if model/verification quality fails: use only human-approved extractive answer templates tied to cited page spans and exact topic/identifier matches; arbitrary questions decline. Label answers “curated extractive prototype.” This reduces generality while preserving the buyer/payment/citation experiment. Reverse the frozen export decision only after a demonstrably isolated, versioned export pipeline; never connect the live brain as a four-day shortcut.

### Injection, leakage and service abuse boundaries

Retrieved content cannot call tools or alter schemas/payment terms. The buyer also treats the entire returned answer as untrusted external content; it is rendered as plain text with citations, never executed as commands or fed into a privileged system prompt. Malicious text can still influence the buyer agent, so §8's independent budget/payee controls remain essential. Pin seller origins and deny HTTP redirects/private IP destinations to avoid SSRF. Restrict seller egress to its chosen model provider and RPC endpoints; no network fetches requested by content. HTTP/proxy/model logs redact question bodies, auth and answers; public excerpts are not permission to log buyer questions. Errors expose codes/IDs, not source prompts. Apply body/response limits before parsing and global inference reservations before model work.

## 8. Buyer MCP API

The user installs one MCP endpoint; internally it reaches an isolated buyer broker (brief §§1, 4.5, 7.6). Tools: `find`, `consult`, `status`, `feedback`, `report`. `consult(question,max_price)` additionally requires seller and request IDs to avoid hidden seller selection and duplicate payment. There is no `set_budget`, arbitrary `pay`, `sign`, `fetch_url`, `shell`, refund-signing, or policy-override tool.

### Tool JSON schemas

This JSON Schema 2020-12 bundle defines reusable schemas and each tool's input/output under `$defs`; registration selects the corresponding definition (e.g. `#/$defs/ConsultInput`). Bounds shown are normative. Semantic checks—signature verification, amount comparison, source eligibility, state-dependent nullability—are additional mandatory broker checks, not replaceable by JSON Schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:ask-a-brain:mcp:v1",
  "$defs": {
    "Id": {"type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[A-Za-z0-9_./-]+$"},
    "Atomic": {"type": "string", "pattern": "^(0|[1-9][0-9]{0,19})$"},
    "Hash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
    "Price": {
      "type": "object", "additionalProperties": false,
      "required": ["network", "asset_id", "amount_atomic"],
      "properties": {
        "network": {"enum": ["devnet", "mainnet-beta"]},
        "asset_id": {"type": "string", "minLength": 1, "maxLength": 64},
        "amount_atomic": {"$ref": "#/$defs/Atomic"}
      }
    },
    "FindInput": {
      "type": "object", "additionalProperties": false, "required": ["topic"],
      "properties": {"topic": {"type": "string", "minLength": 1, "maxLength": 80}}
    },
    "ListingSummary": {
      "type": "object", "additionalProperties": false,
      "required": ["seller_id", "label", "kind", "topics", "price", "trust_display"],
      "properties": {
        "seller_id": {"$ref": "#/$defs/Id"},
        "label": {"type": "string", "maxLength": 120},
        "kind": {"enum": ["independent", "founder", "demo"]},
        "topics": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 80}},
        "price": {"$ref": "#/$defs/Price"},
        "trust_display": {"type": "string", "maxLength": 240}
      }
    },
    "FindOutput": {
      "type": "object", "additionalProperties": false, "required": ["listings"],
      "properties": {"listings": {"type": "array", "maxItems": 20, "items": {"$ref": "#/$defs/ListingSummary"}}}
    },
    "ConsultInput": {
      "type": "object", "additionalProperties": false,
      "required": ["request_id", "seller_id", "question", "max_price"],
      "properties": {
        "request_id": {"type": "string", "format": "uuid"},
        "seller_id": {"$ref": "#/$defs/Id"},
        "question": {"type": "string", "minLength": 1, "maxLength": 2000},
        "max_price": {"$ref": "#/$defs/Price"}
      }
    },
    "StatusInput": {
      "type": "object", "additionalProperties": false, "required": ["consult_id"],
      "properties": {"consult_id": {"$ref": "#/$defs/Id"}}
    },
    "CitationView": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "page_id", "content_sha256", "excerpt"],
      "properties": {
        "id": {"$ref": "#/$defs/Id"}, "page_id": {"$ref": "#/$defs/Id"},
        "content_sha256": {"$ref": "#/$defs/Hash"},
        "excerpt": {"type": "string", "maxLength": 2000}
      }
    },
    "AnswerView": {
      "type": "object", "additionalProperties": false,
      "required": ["text", "citations", "answer_sha256", "verified", "untrusted_content"],
      "properties": {
        "text": {"type": "string", "maxLength": 1500},
        "citations": {"type": "array", "minItems": 1, "maxItems": 10, "items": {"$ref": "#/$defs/CitationView"}},
        "answer_sha256": {"$ref": "#/$defs/Hash"},
        "verified": {"const": true}, "untrusted_content": {"const": true}
      }
    },
    "ConsultOutput": {
      "type": "object", "additionalProperties": false,
      "required": ["consult_id", "state", "receipt_id", "purchase_amount_atomic", "answer", "message"],
      "properties": {
        "consult_id": {"$ref": "#/$defs/Id"}, "receipt_id": {"$ref": "#/$defs/Id"},
        "state": {"enum": ["precheck_running", "declined", "precheck_failed", "quote_issued", "quote_expired", "approval_required", "cancelled", "payment_pending", "payment_failed", "underpaid", "overpaid", "delivered", "delivery_failed", "verification_failed", "refund_pending", "partial_refund", "refunded"]},
        "purchase_amount_atomic": {"anyOf": [{"$ref": "#/$defs/Atomic"}, {"type": "null"}]},
        "answer": {"anyOf": [{"$ref": "#/$defs/AnswerView"}, {"type": "null"}]},
        "message": {"type": "string", "maxLength": 300}
      }
    },
    "StatusOutput": {"$ref": "#/$defs/ConsultOutput"},
    "FeedbackInput": {
      "type": "object", "additionalProperties": false,
      "required": ["consult_id", "useful", "reason_code"],
      "properties": {
        "consult_id": {"$ref": "#/$defs/Id"}, "useful": {"type": "boolean"},
        "reason_code": {"enum": ["prevented_missed_check", "unblocked_task", "already_known", "incorrect", "not_actionable", "other"]}
      }
    },
    "FeedbackOutput": {
      "type": "object", "additionalProperties": false,
      "required": ["feedback_id", "source", "eligible_for_trust"],
      "properties": {
        "feedback_id": {"$ref": "#/$defs/Id"}, "source": {"const": "agent"},
        "eligible_for_trust": {"const": false}
      }
    },
    "ReportInput": {
      "type": "object", "additionalProperties": false, "required": ["date_utc"],
      "properties": {"date_utc": {"type": "string", "format": "date"}}
    },
    "ReportOutput": {
      "type": "object", "additionalProperties": false,
      "required": ["markdown", "receipt_ids", "gbrain_pending_count"],
      "properties": {
        "markdown": {"type": "string", "maxLength": 12000},
        "receipt_ids": {"type": "array", "maxItems": 100, "items": {"$ref": "#/$defs/Id"}},
        "gbrain_pending_count": {"type": "integer", "minimum": 0}
      }
    },
    "Error": {
      "type": "object", "additionalProperties": false,
      "required": ["code", "retryable", "consult_id", "message"],
      "properties": {
        "code": {"enum": ["INVALID_INPUT", "UNAUTHORIZED", "UNKNOWN_SELLER", "POLICY_DENIED", "BUDGET_EXCEEDED", "APPROVAL_REQUIRED", "RATE_LIMITED", "QUOTE_EXPIRED", "IDEMPOTENCY_CONFLICT", "NETWORK_MISMATCH", "PAYMENT_UNCERTAIN", "PAYMENT_INVALID", "SELLER_UNAVAILABLE", "VERIFICATION_FAILED", "RECEIPT_STORE_UNAVAILABLE", "INTERNAL_ERROR"]},
        "retryable": {"type": "boolean"},
        "consult_id": {"anyOf": [{"$ref": "#/$defs/Id"}, {"type": "null"}]},
        "message": {"type": "string", "maxLength": 300}
      }
    }
  }
}
```

Each registered output schema is `oneOf` the named success output and `Error`; an error sets MCP `isError:true`. A decline is success with no charge, not a tool error. `ConsultOutput.answer` is non-null only for buyer-verified delivered content; `purchase_amount_atomic` is null while chain result is uncertain, zero for known no-payment, actual paid amount otherwise. Status can display `delivered` plus feedback/refund details through the receipt/report; feedback is not a second purchase state. Enforce UUID/date formats explicitly in the validator. `asset_id` is the pinned mint address or literal `SOL`, never a free-form symbol lookup. IDs are identifiers, never concatenated into filesystem paths without a fixed mapping.

### Spend enforcement outside the agent

The trusted broker runs under a separate OS identity or isolated host/container with protected filesystem and signer IPC; a mere child process owned by an unrestricted coding agent is **not** a security boundary. The agent can access typed MCP calls but cannot read the broker's config/DB/token, attach to its process, access its wallet backend, use the protected human UI, or contact its admin socket. On this developer machine, authoring and runtime roles must be separated before the demo. If that isolation cannot be demonstrated, paid mode is disabled. Read-only config alone does not defeat a same-user agent with shell access.

Human chooses immutable boot policy: enrolled buyer/payer, approved seller IDs and HTTPS origins, Ks, seller+fee owners/accounts, network/genesis, mint/program, per-call/daily token caps, SOL fee caps, approval threshold, policy version. Suggested devnet limits: 0.05 TEST/call (`50000`), 0.50 TEST/day (`500000`), human approval above 0.02 TEST (`20000`). Suggested SOL transaction-fee ceiling: 100000 lamports/call, 1000000/day, separate from purchase amount. Mainnet permits only one explicitly approved 0.01 USDC purchase, with the same network-fee ceiling; every mainnet purchase requires approval regardless of amount. In native fallback, use a separately approved policy with 1000000 lamports purchase/call, 10000000/day, and an approval threshold of 1000000; mainnet still always prompts. No runtime defaults silently enable mainnet.

The signed quote's exact total must be <= both tool `max_price` and broker per-call cap, match the pinned listing price, and fit remaining daily capacity; otherwise reject it. Never reduce the payment to a lower cap and thereby underpay. Agent-provided maxima can only lower permission. Broker checks policy before pre-check and again against exact message immediately before signing; signer accepts only a single-use permit from this broker. Fee recipient and amount are allowlisted too. Broker refuses unsigned/mismatching quotes, unsupported programs, excessive network fee estimates, unapproved origin changes, and mainnet when approval is absent.

Within one DB transaction, reserve total purchase plus maximum network fee before arming/signing. Daily usage includes all confirmed spending and outstanding reservations across **all** agent sessions and sellers for that payer. Across midnight, unresolved reservations count against the new day's available budget as well; changing clocks/policy cannot erase them. Use trusted UTC day; backwards clock jumps block new purchases until reconciled. Restart reloads reservations. A concurrency test with two permitted 0.03 TEST listings and only 0.05 TEST daily capacity remaining must accept at most one reservation. A malicious seller's answer asking the agent to raise caps has no corresponding API and cannot mutate the enforcing process.

### Buyer-owned receipts and one-page report

Broker creates a local receipt row before returning any state, including decline. After delivery it atomically queues a buyer-gbrain import under `consults/<consult_id>`, with signed artifacts and cited bytes. Treat imported seller text as quoted external evidence, never as gbrain instructions or configuration. Receipt synchronization has its own state; gbrain outage must not repurchase an answer. Retry idempotent imports by receipt ID and content hash. Exact gbrain write/import interface is **UNKNOWN** and verified in §10; a local outbox is a recovery mechanism, not a claim that storage in gbrain is complete. Gate 2 requires observed readback from the buyer's actual gbrain.

One-page Markdown report, <=700 words plus compact rows: buyer goal/questions; seller and founder/demo/independent labels; declined/paid/delivered/failed counts; per-asset seller income, marketplace fee, network fees and pending exposure; answer/citation/receipt links; human vs agent usefulness; unresolved refunds/imports; policy limits and remaining budget; replay prevented/regressed/unchanged counts, n and costs/time; one mainnet explorer link if actually executed. No email, weekly digest, or business data. Honest-traction sentence is mandatory (§10).

## 9. Failure modes and rescue map (table)

Refund terms `aab-prototype-refund-v1`: for verified non-delivery or corrupted committed bytes, owe **100% of purchase amount**, including marketplace fee; each recipient returns its received share manually. No automated, escrowed or guaranteed refund; seller and marketplace must agree to these terms before listing. Prototype target is within 24 hours of detection, with 30-day claim window. Network fees are not refunded by default. A usable but disliked answer records negative feedback; discretionary goodwill refunds may be partial. Partial means “only this amount returned; this remainder remains owed/disputed,” never “fully refunded.” All mainnet refund transfers also require explicit runtime human approval. The one planned mainnet purchase does not authorize remediation transfers.

| Failure | Detection | User-visible result | Rescue action / preventing recurrence |
|---|---|---|---|
| Payment succeeded but answer failed | Finalized exact split, cached blob missing/hash invalid or reveal retry exhausted | `delivery_failed`, exact paid amount, receipt/rescue ID; never “unknown, uncharged” | Retry same immutable blob for 60 s; restore approved cached backup, otherwise manual full purchase refund from both recipients; do not regenerate or charge again |
| Confirmation delay | Tx observed confirmed, not finalized, or temporarily absent | `payment_pending`; reserved amount; “do not pay again” after 10 min | Poll same signature, secondary RPC, reconcile before any new quote; honor late finality for armed message |
| RPC outage | Timeout/error/contradictory network or chain result | `payment status unknown`, no answer unlock/new sign | Secondary pinned RPC; preserve WAL/reservations; human check. Null is not failure |
| Wrong network | Genesis mismatch before signing; proof lookup on wrong cluster | `NETWORK_MISMATCH`, zero protocol submission if caught early | Reject; correct human configuration. If external wrong-chain transfer happened, manual refund request; never credit another network |
| Replayed payment proof | Unique signature/message/quote constraint; buyer identity mismatch | Same buyer gets existing result, another gets rejected | No second entitlement or payment; preserve consumed-signature index |
| Quote reuse | Already armed, expired, different request/payer/body | 409 or expired; no signing | Return existing consult; new quote only after safe reconciliation; memo alone is not replay protection |
| Underpayment / overpayment | Actual destination deltas differ from signed split | `underpaid`/`overpaid`, no automatic reveal or top-up | Quarantine unexpected transfer. Refund all erroneous purchase funds or excess only by human agreement; correct quote must be a separate reconciled purchase |
| Partial refund during four-day build | Only one recipient returned its share or goodwill amount | `partial_refund`, returned/owed amounts and separate signatures | Track remaining debt; founder pursues other recipient. Do not invent refund atomicity; exclude full-refund consult from eligible score |
| Seller offline before/after payment | Pre-check/arm/reveal health timeout | Before: no payment; after: delivery failure/pending rescue | No seller failover after payment; same seller cache retry/backup, then refund terms |
| Clock skew / late confirmation | Broker-server time difference >30 s or <30 s quote time remaining | Stop new arm, show clock/expiry error; pending payment preserved | Synchronize trusted clock/reissue unarmed quote. Armed transaction is governed by pinned blockhash lifetime, not late HTTP time |
| LLM refusal / malformed output | Refusal flag, schema/claim failure, deadline | `precheck_failed` or generic decline, zero charge | No quote; apply rate budget; use curated extractive fallback if repeated. There is no post-payment generation |
| Buyer/gbrain outage | Local WAL/write/import failure | Pre-sign store failure blocks purchase; post-pay answer durable locally with `gbrain_pending` | Recover same receipt and idempotent outbox; read back actual gbrain page before calling sync complete |
| Process crash after sign / before reply | WAL contains exact message and signature; server already has arm ticket | Resuming original consult, not starting again | Rebroadcast identical bytes only; verify chain, recover cached answer; unresolved signatures retain budget |
| Prompt injection / wallet drain attempt | Unexpected tool fields, cap change, disallowed transaction instruction/payee | `POLICY_DENIED` independent of model | No admin/signing tool; quarantine seller listing and inspect receipt; permitted-budget waste remains possible |
| Public-slice leak discovered | Gate audit or human report | Listing disabled; explicit incident record | Remove hosted slice and prevent new quotes; human-led notification/review; do not claim downloaded content was erased |

## 10. Open decisions you could NOT close, each with owner, evidence needed, deadline (relative to the 4-day plan)

### Bounded verification register

Every check below gets **30 minutes maximum**. An unavailable dependency or inconclusive observation takes its stated fallback; extending a spike needs an explicit scope decision. These checks are implementation work, not claims performed while writing this file. CLI spellings not confirmed by local help are not invented. No check authorizes a mainnet signature or private-key access by the authoring AI.

| Unknown / assumption | Owner; evidence needed and exact 30-minute check | Deadline / fallback |
|---|---|---|
| x402 exact can carry our extra recipient | Payment owner: inspect [exact SVM source](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/svm), pin commit; trace transaction construction and facilitator instruction validation. If a two-recipient devnet proof can be run within the window, capture both deltas and acceptance; source possibility alone is insufficient | Day 1 first half; assume unavailable, use custom split. Do not delay build for extension |
| Installed Pay/devnet and exact headers | Payment owner: `pay --version`, `pay --help`, `pay mcp --help`; inspect [Pay docs](https://pay.sh/docs) and source for supported RPC/network settings. Run documented `pay --sandbox curl https://debugger.pay.sh/mpp/quote/AAPL` only with human-provisioned sandbox setup, capture redacted challenge/retry headers and actual RPC genesis. That MPP sandbox test is **not** x402/devnet proof; require separately observed x402 challenge/retry on configured devnet to mark it verified | Day 1; absent install/config/endpoint means unverified, no Pay dependency. Never infer headers from another x402 version |
| Pay.sh registry PR format | Marketplace owner: [contribution guide](https://github.com/solana-foundation/pay-skills/blob/main/CONTRIBUTING.md) currently documents `providers/<operator>/<name>/PAY.md`, local OpenAPI and `pay catalog check`. In scratch space inspect `pay catalog --help` and validate a non-published example; observe parser/probe output. Compatibility of our non-x402 service remains unverified | Day 1; retain local static JSON, no external registry PR dependency or interoperability claim |
| Safe wallet signing without exposing keys, OS isolation | Buyer owner + founder: inspect chosen wallet adapter documentation/help, human signs a devnet split through its UI/backend; agent sees only public key/signature. From agent sandbox, attempts to read broker policy/token/DB, invoke admin signer IPC and alter caps must fail | Day 1 go/no-go; use external human-operated wallet signing via the same broker if unattended devnet signing is unavailable. If isolation cannot hold, no paid mode; disclose loss of autonomous-payment claim |
| gbrain frozen export and receipt import interface | gbrain owner: run `gbrain --help`; inspect documented export/import or connected MCP tools, not private page contents. Human exports one explicitly approved personal test page; import receipt `consults/test-receipt`, repeat idempotently, read it back and compare artifact hashes | Day 1; if no native export, human copies approved Markdown into staging. If no native write tool, use documented file-ingestion route with observed readback. No working ingestion by Gate 2 means receipt requirement remains failed, local outbox only |
| Mainnet USDC mint/account availability | Payment owner + founder: verify mint from [Circle's official address list](https://developers.circle.com/stablecoins/usdc-contract-addresses), compare configured mint/decimals/program using read-only Solana RPC account data, inspect both destination ATAs and fee balance | Day 2; never use symbol-matched arbitrary tokens. If token setup unavailable, preverified native-SOL fallback with newly approved lamport policy; no runtime approval means no mainnet purchase |
| Independent sellers / consent | Founder: 30-minute review of actual replies to an authorized community invitation, record opt-in and approved slice availability; aspiration/name recognition is not evidence. This document does not authorize sending invitations | Day 2; if absent, second listing is clearly `demo`, no independent-supply claim |
| Willingness to pay | Founder: offer a consenting independent tester the actual quoted price for a real allowed question; observe accept/decline and an independently funded payment if approved. Record number approached and outcome, no invented conversions | Day 3; if absent/declined, demand remains unvalidated; all own purchases technical verification |
| Safe personal incidents and eval leakage | Evaluation owner: 30-minute local inventory of personal-only records, count ten admissible before-action snapshots with objective failure assertions and provenance; compare against slice pages for exact incident/solution leakage | Day 1 inventory, Gate 2 ready; use fewer actual cases and disclose n if fewer survive, but mark ten-case target missed; never substitute business records or count synthetic cases as real |
| Model cost/support calibration | Seller owner: run fixed safe positive/unknown/injection fixtures with pinned model ID/prompt and capture latency, billed tokens, validator decisions. Observe unsupported fixture quote count=0 and cited positive result | Day 1; curated extractive fallback, or disable topic if even extraction cannot support it |
| Contest cutoff time/timezone | Founder: inspect the official submission page linked from the event registration; record exact deadline and upload requirements (brief §2 supplies only the date) | Day 1; internal cutoff Oct 11 18:00 JST, never assume the last hours of Oct 12 are available |

The native-SOL fallback, fee rate, quote TTL, invitations and conservative thresholds are closed prototype choices, not open architecture debates. Reverse the custom rail only if the **same Gate-1 observations** are obtained with a pinned simpler standard implementation before the deadline; a marketing statement or supported scheme name is not enough. No migration after Gate 1 merely to claim x402 compatibility.

### Replay-evaluation harness (brief §§4.6, 7.7)

Use approximately ten **real past personal agent-ops incidents**, sanitized and approved through the publication gate; no employer/customer/member records. Encode: incident ID; source provenance and permission; before-action task/context; environment fixture hash; expected failure assertion; allowed actions; fixed time/token/tool budgets; held-out verdict rubric; disjoint topic/slice version; and contamination flag. Ground truth must be frozen before running the evaluated agents. The incident's resolution and rubric are unavailable to both agent arms and seller. Seller may see general lessons, but exact incidents/answers copied into the slice are marked contaminated and excluded from the primary result. Report this as historical replay with hindsight, not prospective evidence.

Operational definition: for an incident with predeclared assertion `R`, “prevented” means baseline violates `R` while consulted run satisfies `R` within the same overall task budget and without a new critical failure. Example: completion report must include a command/result proving mandatory leftover checks; a polite recommendation alone does not pass. “Regression” is baseline pass, consulted fail; both pass and both fail are separate. Report gross prevented, regressions, net prevented minus regressions, and all four cells. No currency avoided-loss figure unless a real attributable historical loss and causal assumptions are documented; otherwise report incident counts and observed seconds/tokens/cost.

For each case, clone identical sanitized environment state into two isolated runs. Pin model/version, temperature (0 where supported), prompt, tool responses, public slice, and budget. Baseline has no consult; treatment gets one consult with the same fixed total task token/time allowance (including consult time), and a separate disclosed payment cap. Run order is alternated; no network beyond allowlisted seller/model/devnet RPC, no live remediation, and no ground-truth access. Base task cannot use free source-fetching tools unavailable in the historical setting; disclose the chosen tool restrictions. Hash and retain logs. LLM nondeterminism remains; repeat each pair once if budget allows, report both rather than selecting the better run. If only one pair/case, state it plainly.

Each treatment run uses actual devnet protocol/payment when answerable; declined runs remain in the intention-to-treat denominator. A prerecorded answer replay may debug harness logic but is marked simulation and excluded from live-payment counts. Report TEST purchase quantities separately from **actual** model/RPC expenses; TEST tokens are not revenue. Human rubric review is blind to arm labels where possible; disagreements with automated assertions are adjudicated with recorded reasons before aggregate publication. Never grade by “the agent said it was useful.” Reputation receives these verdicts as replay evidence, not independent customer ratings.

### Four-day execution plan, gates and cut lines

Calendar assumption: day 1 Oct 8, day 2 Oct 9, day 3 Oct 10, day 4 Oct 11, all deadlines JST. Brief §2 gives an Oct 12 submission date; exact cutoff remains the check above. The late start on Oct 8 makes the schedule aggressive; if the founder cannot allocate the remaining day-1 hours, compress scope to extractive answers immediately rather than moving the hard gates invisibly. Owner labels denote workstreams, not an assumption of a staffed team.

| Day | Deliverables | Acceptance / stop condition |
|---|---|---|
| 1 | Freeze contracts and two-entry registry; human-provision keys and isolated broker; export/gate first public slice; inventory ten incidents; one signed cached answer and one decline; bounded unknown checks | Demonstrated isolation, no private-data dependency, reproducible signature/hash verification. No safe slice or signer boundary → block payments |
| 2 | Integrate atomic split, arm/WAL/retry protocol, spend reservations, proof verification, cached reveal, receipt outbox; failure tests | **Gate 1 by 23:59 JST**, §3 five observed checks; native-SOL rescue only under stated conditions |
| 3 | **Gate 2 by Oct 10 18:00 JST:** human-approved slice manifest + ten approved incident fixtures/rubrics + actual buyer-gbrain receipt readback; run paired replays; human feedback path + trust recomputation; assess seller/demand evidence | Missing ten safe real cases → publish actual n and gate miss. Missing slice approval → no listing. Missing gbrain ingestion → report storage incomplete. No gate waived by a pretty report |
| 4 | Fix only critical failures; rehearse failure/decline and successful flow; perform one small mainnet purchase after runtime human approval; capture explorer/receipts; finalize one-page report, <=3-minute video, 2–3-minute pitch and code reuse disclosure | At **Oct 11 12:00 JST** cut all optional work; internal submission package ready by 18:00 JST. No mainnet before Gate 1, isolation and approved slice pass |

At the Oct 11 noon cut line, drop Pay.sh adapters/external catalog PR, semantic search, second independent-seller onboarding in progress (keep labeled demo listing), fancy UI, repeat evaluation pairs, automatic refunds, ranking and extra topics. Do **not** drop spend enforcement, publication review, cached-answer invariant, atomic split proof, feedback, receipts, or honest labels. If time remains insufficient for those, ship an explicitly incomplete experiment rather than claim the agreed product works. No multi-model runtime ensemble, general marketplace discovery, SAS, digest or onboarding platform (brief §§3–4, 8).

### Demo storyboard and claims

* **0:00–0:20:** buyer's stuck personal-ops agent, human-set budget, two listing labels. Say what source slice is public; show no private brain connection.
* **0:20–0:45:** ask unsupported question; “declined, 0 charged,” no transaction ID and zero signer calls. Show receipt and unchanged purchase balances, not merely a friendly refusal string.
* **0:45–1:30:** eligible question → committed quote → isolated policy check → finalized split → cited signed answer → buyer's gbrain receipt. Mainnet clip includes the actual human approval; otherwise use devnet for rehearsals and label them.
* **1:30–1:55:** explorer: correct cluster, one transaction, two recipients/amounts, memo, fee, finality. Mainnet purchase can be the successful flow above; never execute a second purchase just for this shot.
* **1:55–2:15:** usefulness feedback and provenance; show recorded agent/human signal, technical-verification exclusion and unrated trust when appropriate, not a fabricated score increase.
* **2:15–2:50:** replay contingency table, actual n, prevented/regressed/net, cost/time; one concrete rubric outcome, limitations visible.
* **2:50–3:00:** thesis and honest traction sentence, with next independent-buyer experiment.

Required honest-traction statement, fill only from evidence: “We ran [n] historical personal-ops replays. [p] were prevented and [r] regressed under this rubric. [k] independent buyers completed [m] independently funded purchases. Founder self-purchases and demo sellers are technical verification, not traction. [Mainnet transaction link, or ‘mainnet payment not completed’].” If k=m=0, say zero. No Garry Tan participation claim or dependency (brief §§3 Q7/Q9, 5). Disclose any reused pre-existing code/ideas and what was built during the window (brief §2).

## Self-critique: the 5 weakest points of this design

1. **Pre-generation moves the economic risk to the seller.** Invitations and a $2/day inference cap make a safe demo, not an open profitable market. Even legitimate abandoned quotes can make inference costs exceed sales. Measure pre-check-to-payment conversion and cost before claiming viability.
2. **No cryptographic payment-for-answer fairness.** Buyers still trust a seller to serve bytes after irreversible payment. Cached blobs and manual refunds are operational mitigations, not enforcement. A malicious seller can take money and disappear; reputation will be too sparse to protect the first buyers.
3. **The claimed knowledge boundary is imperfect.** A model/verifier pair can jointly accept an unsupported answer, and exact citations do not prove entailment. The guarantee covers declared abstentions, not every fact the brain actually does not know. Extractive fallback is safer but may be too weak to justify buying.
4. **Isolation and crash recovery may consume the schedule.** Separate OS identities, wallet integration, armed-message reconciliation and durable spend accounting are the most likely four-day implementation failures. A same-user MCP process with a key file would invalidate the security claim, even if the video looked autonomous.
5. **Usefulness and reputation evidence will be thin and biased.** Ten hindsight replays, founder-authored rubrics and mostly self-purchases can overstate value. The human score is likely to remain unrated; custom payment tooling proves the rail, not independent demand or interoperability. A second demo seller satisfies a listing requirement, not supply validation.

## What would make us abandon this design

* Any need to sell employer/customer/non-public member data, expose the live brain, let the authoring AI handle private keys, or bypass runtime mainnet approval: stop the affected path immediately; these are brief §5 boundaries, not trade-offs.
* Failure to demonstrate atomic split and independent spend enforcement by Gate 1 plus the bounded native-SOL rescue: abandon the paid architecture for this submission and report an incomplete experiment. Do not substitute merchant custody or two payments without flagging a change to the binding brief.
* Post-payment generation becoming necessary to answer most useful questions: the no-paid-abstention construction no longer holds. Narrow topics or stop; do not retain the guarantee in marketing.
* Seeded unsupported/injection questions repeatedly yielding payable quotes even after extractive fallback, or inability to verify source hashes: disable that seller/topic before taking money.
* Paired evaluation showing zero net prevented incidents, materially slower completion without compensating benefit, or frequent harmful regressions: abandon the present agent-ops value proposition rather than cherry-pick the best case.
* Independent testers consistently decline the actual price, or measured unpaid inference cost exceeds plausible income: the revenue thesis remains unsupported. Change the business experiment after the hackathon; do not present technical self-payments as validation.
