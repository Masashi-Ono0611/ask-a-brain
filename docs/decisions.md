# Decision ledger (founder decisions; newest last)

This ledger records decisions made by the founder (the only source of approval). Design documents must not contradict it; conflicts are flagged, never silently resolved. Dates JST.

| ID | Date | Decision | Source of approval |
|---|---|---|---|
| D0 | 2026-10-08 | Solana primary; target Colosseum "Crypto World's Fair" (due 2026-10-12). New repo, private first. | Founder chat |
| D1 | 2026-10-08 | Review mode SCOPE REDUCTION (4-day build). | Founder answer |
| Q1-Q4 | 2026-10-08 | Story = buyer's ("a stuck agent buys an expert's answer"); first real user = founder; "real" = real money moved; goal = an income path. | Founder answers |
| Q5 | 2026-10-08 | Income = marketplace fee (+ own sales as a seller). | Founder answer |
| Q6/Q8 | 2026-10-08 | Fee justified by convenience (one MCP) + outcome reputation. | Founder answers |
| Q7/Q9 | 2026-10-08 | First sellers = founder + other gbrain users (names TBD). Garry Tan is an aspiration, never a dependency or claim. | Founder answers |
| Q10 | 2026-10-08 | Rebuild a minimal marketplace skeleton. | Founder answer |
| D2.1-D2.4 | 2026-10-08 | Digest shrinks to a one-page report; registry reinstated as a minimal static list; one-command listing shrinks to a `list` command; one small mainnet payment, approval-gated. | Founder answers + Q10 |
| P1-P3 | 2026-10-08 | Seller-side priorities: (P1) personal-info and injection safety, (P2) hosting/upload of a slice, (P3) slice-readiness of a brain not built for slicing. See `design/00a-seller-priorities.md`. | Founder messages |
| D3 | 2026-10-08 | **Positioning = "Market Harness"**: the product is a harness that lets AI agents buy expertise safely (budget, payee allowlist, out-of-process policy, receipts, outcome reputation). The first market is gbrain brains. Not "a knowledge marketplace" as the headline; the brain market is the first demo of the harness. No scope change. | Founder answer ("3") |
| D4 | 2026-10-08 | **Service name = "Ask a Brain"** (for now). **"Market Harness" is the underlying (back) concept**, used to explain what the product is; the user-facing name stays Ask a Brain. | Founder message |

| D5 | 2026-10-08 (night) | **Signing**: the founder's wallet signs every purchase (human-signed); autonomous signing is not part of the plan. Resolves master J1 / F3. | Founder answer |
| D6 | 2026-10-08 (night) | **Questions**: only founder-approved questions or fixed templates may be sent (egress policy); the demo discloses this autonomy limit. Resolves master J2. | Founder answer |
| D7 | 2026-10-08 (night) | **Remote**: no remote repository for now; local only. (Public OSS release at submission is still required by the official "Open-source" criterion and needs a later explicit decision.) | Founder answer |
| D8 | 2026-10-08 (night) | **Capacity**: about 16 focused founder hours plus 2 reserve across 10/9-10/12. Resolves master F1. | Founder answer |

| D9 | 2026-10-08 (night) | **Wallet**: the founder uses a Solana CLI keypair (local file). | Founder answer |
| D10 | 2026-10-08 (night) | **Buyer model for replay**: Codex via the ChatGPT subscription (no API billing), sandboxed, model name pinned and logged. | Founder answer |
| D11 | 2026-10-08 (night) | **Dependencies**: minimal, exact-pinned, installed with scripts disabled (`--ignore-scripts`), project-local only, audited and licence-checked. | Founder answer |
| D12 | 2026-10-08 (night) | **Licence/release**: code MIT, public content CC BY 4.0, repository made public at submission (after the founder checks history and rights). | Founder answer |
| D13 | 2026-10-08 (night) | **Test keys and human steps (changes master M05/M11 "AI never creates keys")**: to avoid making the founder a bottleneck, the AI MAY create and use **throwaway test keypairs for devnet/local tests only** (never funded with real assets, never mainnet, never committed: stored under a gitignored `.local/` path, scanned before every commit). The AI runs the whole pipeline end-to-end with a `TestSigner`. The founder's real keypair, real funds, mainnet purchases, content approval of real pages and the final recorded demo remain founder-only. The signer is an interface so the founder's CLI keypair replaces the test signer without code changes. | Founder message |
| D14 | 2026-10-08 (night) | **Decision procedure for unanswered founder topics**: when a question needs the founder but is unanswered, the AI first consults Codex once, adopts the recommendation if it respects this ledger and the hard constraints (no real-money spending, no publication, no private data, no mainnet without runtime approval), and logs it in `docs/impl/decision-log.md` as "provisional, founder may overrule". AI may also draft from PUBLIC sources (e.g., the founder's public PRs/issues) so the founder's remaining work is review and exact-byte approval. | Founder message |
| D15 | 2026-10-08 (night) | **Material for lessons/incidents**: the AI may use this project's auto-memory feedback notes (the founder's own notes about cypher-brain work) and the founder's public Issues/PRs as sources for DRAFT lessons and candidate incident fixtures. The private gbrain stays closed to the AI. The founder only reads and approves exact bytes. | Founder answer |
| D16 | 2026-10-08 (night) | **Track**: Colosseum Solana Ecosystem track. | Founder answer |
| D17 | 2026-10-08 (night) | **Mainnet budget ceiling**: about USD 5 in total (about 0.03 SOL + about 0.1 USDC plus margin) into NEW dedicated wallets only; the founder performs the funding later; the main wallet is never used. | Founder answer |
| D18 | 2026-10-09 | **Devnet autonomy; human approval only for mainnet**: the AI executes all devnet work (throwaway keys, TestSigner, live devnet runs, faucet use) without per-action or per-run founder approval, including re-runs. The founder's typed wallet approval is required only for the mainnet purchase (D5, D17 unchanged). Consequence for Gate 1 item (f): a human-signed devnet purchase is NOT required to proceed on devnet; (f) stays UNVERIFIED as an observation (two founder ceremonies on 2026-10-09 produced an exact-phrase approval, a signature over the exact message and a refused substitution, but the signed transaction expired before broadcast because a human needs about 60 s while a devnet blockhash lives about 37 s) and is to be exercised at the mainnet purchase, where the founder's approval is mandatory. A same-quote fresh-message renewal path must exist before that purchase. | Founder messages |
| D19 | 2026-10-10 | **Hosting and public repository**: (1) the GitHub repository will be PUBLIC (founder, in chat: GH public is OK; this is the "later explicit decision" that D7 anticipated). Creating the remote, pushing and the visibility switch still happen only after the pre-publication audit (history, secrets, rights, private material) and one final confirmation of the exact action. (2) Web hosting = GitHub-connected Vercel, used ONLY for the static H4 side (landing/README site, evidence pages, static registry JSON). (3) The seller controller/worker stays H1 (local isolated VM/container): it needs a durable journal, a no-network worker and a Unix socket, which a serverless host cannot provide. No cloud compute and no new spend beyond the Vercel free tier; any paid plan needs a new founder decision. | Founder answer (chat) + AI scoping |
| D20 | 2026-10-10 | **Public repository contents** (founder, in chat): (1) the commit author email stays as is; (2) employer names are removed from the docs and replaced by generic "Org data" wording; (3) the approved lesson text (`fixtures/eval/approved/lessons/`, `test/replay/approved-answer-map.json`) is NOT published. The public repo is a fresh snapshot with no history (`scripts/publish/export-public.ts`), because the local history contains the lessons and existing commits are not rewritten. The two tests that need the lesson text are skipped explicitly in the snapshot (marker file `PUBLIC_EXPORT`) and fail hard in the full tree. | Founder answer (chat) + AI implementation |

## Rules adopted from review (not founder decisions, for the record)

- R1 (from design pass 02): distillation (clean-room rewriting) applies only to knowledge that originates from the founder's personal harness operations. Business-derived or third-party-private material does NOT become sellable by rewriting it (brief §5).
- R2 (from design pass 01): a paid demo is blocked if the atomic split payment cannot be shown on devnet (Gate 1); the brief's one-transaction requirement is not relaxed silently.

## Open (needs founder input)

- Which pages form the first slice (candidate types: original / concept / pattern, hand-picked; transcript-derived and dream-generated excluded by default).
- Approval to use a cloud account (cost) for the seller container (default: none, local only). The remote repository was deferred by D7; D19 (2026-10-10) decides it will be public, with the remote creation/push still gated on the pre-publication audit and a final confirmation. Licences: D12 (MIT / CC BY 4.0).
- Who bears the answer engine's LLM cost (proposal: founder as first seller, with a cap).
