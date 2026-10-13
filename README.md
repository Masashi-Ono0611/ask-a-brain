# Ask a Brain

A stuck AI agent buys an expert's sealed, human-approved answer by itself. One Solana
transaction splits the payment between the seller and the marketplace (9000 / 1000 of a
0.01-unit price, a 1000 bps fee). **"Declined = no charge" holds by construction**: the quote
is free, and only a human-signed, finalized transaction releases the answer.

Underlying concept: **Market Harness**, a harness that lets AI agents buy expertise safely
(budget, payee allowlist, out-of-process policy, receipts, outcome ledger). The first seller is
the founder, with five approved lessons about operating AI coding agents.

> Hackathon build for the Colosseum Crypto World's Fair, Solana Ecosystem track.
> Every claim below is stated at the strength of the evidence linked next to it.

## What has been verified

| Claim | Evidence | Strength |
|---|---|---|
| One legacy transaction pays two recipients: seller +9000, marketplace +1000, payer −10000 (atomic units of a test token) | `docs/evidence/gate1/SUMMARY-live-devnet-20261009.md` and the raw RPC responses beside it | Live **devnet**, re-derived from the chain by a second path. Test token on throwaway keys |
| A failing second leg moves nothing: `InstructionError [1, Custom 17]`, all token deltas 0, only the network fee is charged | same directory | Live devnet |
| After `SIGKILL` at five points (after-sign, after-broadcast, after-receipt, after-freeze, before-thaw), a later run returns the identical answer and receipt, with no replacement transaction | same directory | Live devnet |
| A founder-to-founder split on Solana mainnet-beta: 0.01 USDC as 9000 + 1000 in one legacy transaction (two `transferChecked` and a memo), USDC deltas −10000 / +9000 / +1000, no error | [Explorer](https://explorer.solana.com/tx/Yb9vEynr6weKCF7sjfm8MsA8hm9gtESr1TwZJiMsuzHKJit2on8zdkuB6mAdkgKsq5EhtZ3dRe5XuQAPeoGutbU) | Live **mainnet**, finalized (slot 456338684) and re-derived from a public RPC. One attempt, founder to founder; **not** an agent purchase |
| Five lessons and their questions were approved by the founder, then sealed with SHA-256 hashes | `docs/evidence/content/approval-index.md` | Human approval record |
| A matched A/B/C study with Codex as the buyer (A no consultation, B free checklist, C paid consultation, **simulated payment**): no difference detected | `docs/impl/decision-log.md`, entries L8 and L9 | Exploratory, n = 6 incidents × 1 run; passes A 2 / B 2 / C 2 of 18 slots, nothing improved or regressed |
| Returning the procedural denial code to the agent (a labelled follow-up variant, not merged with the study above) raised passes from 6 to 11 of 18 | same entries | Exploratory, post-hoc variant; the same 6 incidents |
| The test suite and a secret scan pass | `npm run check` | Full tree: 1002 pass, 0 skipped. This public snapshot: 1000 pass, 2 skipped on purpose (see below) |

## What is not claimed

- **The mainnet run is a transfer, not a purchase.** It used the same transaction shape, founder to founder. The full agent purchase (broker, seller, quote, human-signed approval) has not been run on mainnet. We do not claim demand, and this hackathon takes no external paid orders.
- A human-signed devnet purchase did not land: the approval took about 60 s while a devnet blockhash
  lives about 37 s, so the transaction expired before broadcast and no funds moved. A same-quote
  renewal path (new blockhash, same quote) is implemented and tested, but has not yet been run on a real terminal.
- The A/B/C study shows no benefit of consulting. It is a toy task, and four of six incidents stop at
  the same completion gate in every arm, so it cannot measure a difference. We do not claim prevention,
  a paid-consultation advantage, demand, or revenue.
- Codex was run on the host with a restricted tool set. It was **not isolated**, and its token limit could not be enforced.
- Runtime isolation of the seller worker and a live policy proof are not verified (Gate 1 items c and d).

## How it fits together

| Area | Where |
|---|---|
| Strict JSON (JCS) parsing, domain-separated Ed25519 signatures, schemas | `src/wire` |
| Solana transaction build and finalized verification (`@solana/kit`), human-signer helpers | `src/chain` |
| Buyer broker: budget reservation, durable sign/broadcast recovery, receipts, outcome ledger | `src/broker` |
| Extractive seller, revocation tombstones, payment recovery | `src/seller` |
| Publisher: inventory, scan, seal | `src/publish` |
| Restricted MCP server for buyer agents | `src/mcp` |
| A/B/C runner and grader | `src/eval` |

Design: `docs/design/10-master-design.md` (normative). Founder decisions: `docs/decisions.md`.

## Run it

Requires Node 24.13.0 and npm 11.6.2. Dependencies are exact-pinned and installed without scripts.

```bash
npm ci --ignore-scripts
npm run check   # toolchain, typecheck, import boundaries, tests, secret scan
```

This public snapshot omits the approved lesson text (the paid answers). Two tests that need it are
skipped on purpose and reported as skipped, not as passed. Devnet setup is in `scripts/devnet-setup.ts`
and needs network access. Tests use ephemeral keys only. Never commit key material.

## Licence

Code: MIT (`LICENSE`). Lesson content, where published: CC BY 4.0.
