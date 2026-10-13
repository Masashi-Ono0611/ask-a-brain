# 00 — Design Brief (input to all design passes)

Status: DRAFT input. Date: 2026-10-08. Working name: **ask-a-brain** (name TBD).
Audience: design authors (Codex-led), reviewers (Claude, Antigravity), the founder.
Language: write design docs in English; each doc starts with a short Japanese summary (要約) of 5-8 lines.

## 1. One-sentence definition (agreed upstream)

A stuck AI agent installs one MCP and asks "any brain" a question. Brains that do not know decline and are **not charged**. Brains that answer cite sources and are paid per answer on Solana; one transaction splits the payment between the seller and the marketplace (the fee). After a consult, "was it useful?" is recorded and feeds the seller's trust score. The founder earns (a) as a seller and (b) as the marketplace operator via a fee.

## 2. Why this exists (founder context)

- Founder: Japan-based developer. Heavy daily user of **gbrain** (personal "second brain": Markdown pages + knowledge graph + hybrid search + MCP + contradiction detection + timeline + "takes"/calibration). 95 verified contributions upstream (67 merged per GitHub + 28 absorbed). Runs a Claude Code harness (hooks, safety gates, completion checks, multi-model review). Built **cypher-brain** (age encryption, Shamir, signing, MCP server in TypeScript/Bun, ENS-scoped agent wallet).
- Real recurring pain: agent completion reports repeatedly miss a mandatory leftover-check; monthly usage limits stop work.
- Goal: an income path. Competition target: Colosseum "Crypto World's Fair" (Solana track primary), **submission due 2026-10-12**; judging is startup-style (founder-market fit, insight, product+execution, market size, communication, viability, traction). Demo video <= 3 min, pitch 2-3 min, GitHub repo. Pre-existing code allowed if disclosed, but only work in the window is judged => this is a NEW repo; reused ideas from cypher-brain must be disclosed, code must not be silently copied.

## 3. Agreed decisions (the ledger — do not re-litigate; flag conflicts)

| ID | Decision |
|---|---|
| D1 | Review mode SCOPE REDUCTION. Keep scope minimal; 4 days. |
| Q1 | Story = the **buyer's**: "an agent that is stuck buys an expert's answer by itself". Human sets goal + budget, sees results. |
| Q2 | First real user = the founder (as buyer). |
| Q3 | "Real" = **real money moved** (small mainnet payment once, with explicit human approval at run time). |
| Q4/Q5 | Income = marketplace fee (+ own sales as a seller). |
| Q6/Q8 | Fee is justified by (1) convenience: one MCP reaches any brain, and (2) **outcome reputation**: usefulness recorded after each consult feeds seller trust. |
| Q7/Q9 | First sellers = founder + other gbrain users (names TBD, community call). Garry Tan's participation is an aspiration, NEVER a dependency, never to be claimed. |
| Q10 | Rebuild a minimal marketplace skeleton. |
| D2.2 | Registry: reinstated as a **minimal static list** (JSON), >= 2 listings; if no second real seller by demo time, the second listing is labeled "demo seller". |
| D2.1/D2.3 | Weekly digest -> shrink to a one-page report. One-command listing -> shrink to a `list` command for the founder's own brain. |
| D2.4 | One small **mainnet** payment, executed only after explicit human approval; everything else on devnet. |
| S1-A | **OPEN**: billing order. Candidates: A) pay first, refund if unknown; B) free pre-check ("can I answer + price"), then pay, then answer; C) answer pre-generated, hash shown, reveal after payment. Founder-side recommendation: B. Design must decide and justify. |

## 4. Minimal scope (must be designable in 4 days)

1. Seller service: answers only from a **public slice** of a brain; cites sources; declines when it does not know (no charge); returns the answer only after payment is confirmed.
2. Fee-split settlement: ONE payment event distributes to seller and marketplace.
3. Outcome reputation: record "was it useful" after a consult; update the seller's trust score; anti-gaming basics.
4. Static registry (JSON) with >= 2 listings, price, topics, endpoint, trust score.
5. Buyer MCP: `find`, `consult(question, max_price)`, per-call and daily spend caps, receipts saved to the buyer's own gbrain.
6. **Avoided-loss replay evaluation**: ~10 real past agent-ops incidents (personal harness records; NO business data). Replay each with and without a paid consult; report prevented incidents, cost, time. Small sample must be stated as small.
7. One small mainnet payment (approval-gated).
8. Mandatory pre-publication gate: allowlist + secret scan + business-data guard before any page becomes sellable.

Deferred/cut: marketplace-scale discovery, multi-brain ranking, general onboarding for strangers, SAS attestations, weekly email digest.

## 5. Hard constraints

- Never use the founder's employer/business data (any organisation's confidential or Org data), customer data, or non-public member information. Public slice only; explicit allowlist.
- No self-dealing counted as traction: the founder buying from his own brain does NOT count. Report such runs as "technical verification".
- Paid on-chain operations on mainnet need explicit human approval at run time. Devnet first. The AI authoring this repo must never see or handle private keys; wallets are created by the founder on his own machine.
- Do not assume any third party's consent (including Garry Tan).
- Honest claims only: unverified numbers must be labeled unverified.

## 6. Verified facts vs unknowns (do not invent beyond this)

Verified (with source):
- Pay.sh (Solana Foundation + Google Cloud, 2026-05): agents pay APIs per request with stablecoins on Solana; wallet is the credential; open-source registry (GitHub PR); provider paid in fiat; docs list x402 "exact", "upto", "batch-settlement" schemes and MPP. CLI `pay` wraps curl/wget/claude/codex, detects x402/MPP challenges, signs with local wallet, retries; `pay --sandbox` uses an ephemeral wallet; `pay server` puts a payment gateway in front of an API; `pay mcp`, `pay skills` exist. License MIT. Repo: github.com/solana-foundation/pay (folders: rust, typescript, docs, skills/pay, web-ui). Sources: pay.sh/docs, solana.com/news/solana-foundation-launches-pay-sh-in-collaboration-with-google-cloud.
- x402 batch settlement went live on Solana around 2026-10-07 (PayAI, BlockRun); a single Solana-Foundation-maintained payment-channels program is described. (Press reports; verify before depending.)
- Solana Attestation Service live on mainnet since 2025-05 (not in scope, noted for later).
- Agent-originated share of x402 settlement volume is small (estimated 0.6-7.5%, third-party analysis). Do not claim a large agent economy.
- Visasq (Japanese expert network) is the analogy: prepaid, fee ~30-40% (older article), from ~5,000 yen/hour; its fee is justified by matching, compliance and payment handling — convenience alone is a weak moat.
- Prior Frontier winners in this space: Flovia (analytics for machine-paid APIs), Sudont (agent security), Clawpump (agentic finance).

UNKNOWN (design must not assume; give a verification step with a 30-minute cap each):
- Whether ONE transaction can pay multiple recipients under x402 "exact" on Solana, or whether a second transfer / custom program / marketplace-as-merchant is needed.
- devnet support and exact request/response headers of the x402/MPP flow in `pay`.
- The registry PR format for Pay.sh.
- Whether independent sellers will exist by the demo date.
- Actual willingness of any agent/human to pay for these answers.

## 7. Questions the design MUST answer (each with options, trade-offs, a decision and the evidence that would reverse it)

1. Billing order (S1-A), including abuse limits for the free pre-check (scraping/probing) and what the pre-check may reveal.
2. Payment rail and fee split: compare (a) x402 with marketplace as merchant then payout, (b) x402 payee = seller + separate fee payment, (c) custom SPL transaction with two transfers + memo, (d) other. Pick one for the 4-day build, with a fallback and a Gate-1 test.
3. Identity and trust: seller identity, registry entry schema, how a buyer verifies an answer came from the listed brain (signing/provenance).
4. Reputation model: what is measured ("useful" signal source: agent self-report, human thumbs, replay verdict), cold start, anti-gaming (self-dealing, collusion, sybil), how it is displayed, how it affects ranking.
5. Seller engine: how a public slice is produced from a gbrain (frozen export vs filtered read-only), abstain policy (when to say "I don't know"), citation format, prompt-injection resistance for content in the slice.
6. Buyer MCP API: tool names, inputs/outputs, spend policy enforcement out-of-process, receipt format, human-facing report.
7. Replay evaluation: how incidents are encoded, what "avoided loss" means operationally, how with/without runs are executed deterministically enough, how to avoid fooling ourselves (n~10).
8. Security/threat model: wallet drain via prompt injection, malicious seller content, replay/double-spend, fee-wallet custody, key handling, logging that leaks, DoS/cost abuse of the seller's LLM.
9. Failure modes and rescue: payment succeeded but answer failed; confirmation delay; RPC outage; partial refund policy.
10. Four-day plan with day-by-day deliverables, Gate 1 (devnet fee-split works by end of day 2), Gate 2 (public slice + 10 incidents ready), and cut lines (what is dropped at 2026-10-11 12:00 JST).
11. Demo storyboard (<= 3 min) where the "refuse -> no charge" moment, the fee-split transaction on the explorer, and the replay result are all visible; plus an honest-traction statement.

## 8. Non-goals

Token/ICO, custody of other people's funds, guaranteed returns, handling of any private business data, a full marketplace UI, claims of market size beyond verified facts.
