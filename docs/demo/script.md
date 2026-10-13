# Demo script (target 2:45, hard limit 3:00)

Status of each scene is stated up front so nothing is presented as shown when it was not.

| # | Time | Scene | What the viewer sees | Source | Status |
|---|---|---|---|---|---|
| 1 | 0:00-0:20 | The problem | A Codex agent repeats a completion claim without checking the state behind it. Caption: "stuck, and no way to buy a human's checked answer" | Recorded replay incident (study, arm A) | Material exists; clip not cut |
| 2 | 0:20-0:45 | Free quote | The agent calls the restricted MCP tool, gets a quote: price 0.01, split 9000/1000, payee, expiry. Caption: "a quote is free; declined means no charge" | `src/mcp`, `src/broker` | Needs a screen recording |
| 3 | 0:45-1:25 | Human approval | The terminal shows network, mint, both recipients, split, fee and message digest. The founder types the wallet approval | `scripts/integration/gate1-human-live.ts` flow, same-quote renewal (T11d) | **Mainnet scene not yet recorded.** Renewal not yet run on a real terminal |
| 4 | 1:25-1:55 | One transaction | Explorer link: seller +9000, marketplace +1000 in one legacy transaction | Mainnet link when it exists. Until then the devnet re-derivation in `docs/evidence/gate1/SUMMARY-live-devnet-20261009.md` | **Mainnet link: none yet.** Devnet is test-token evidence only |
| 5 | 1:55-2:15 | Signed answer and receipt | A signed, cited answer and the saved receipt; replaying after a crash returns the identical receipt | Crash-recovery evidence (five SIGKILL points) | Evidence exists; clip not cut |
| 6 | 2:15-2:45 | Honest result | One slide: study result (no difference detected, exploratory, simulated payment), no demand claim, no external paid orders | README "What is not claimed" | Text ready |

## Rules for the recording
- Say "devnet" or "mainnet" on screen whenever a transaction is shown. Never show a devnet link as a mainnet result.
- The one mainnet purchase is recorded once; retakes reuse that recording (design M11).
- No key material, seed, `~/.aab-seller` contents or wallet app seed screens on camera.
- Do not say "isolated", "prevented", "proven", "revenue" or "demand".
- Mandatory line: "The founder-to-founder mainnet test is [not completed / verified at <link>]. It shows funds movement and the fee split, not demand. This hackathon takes no external paid orders."

## Open before recording
1. Founder wallets funded and the mainnet purchase approved at run time (D17, D18).
2. Renewal (new blockhash, same quote) checked on a real terminal first, with devnet, so a slow approval does not waste the single mainnet purchase.
3. Decide whether scene 1 uses the recorded replay clip or a fresh run.
