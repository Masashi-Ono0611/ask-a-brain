# Ask a Brain: working notes for AI sessions

Read first: `docs/handoff/2026-10-10-handoff.md` (state, paths, safety rules, remaining work), then `docs/decisions.md` (founder decisions D0 to D18, binding).

Hard rules (details in the handoff, section 1):
- Per-action founder approval is needed ONLY for the mainnet purchase (D18). Devnet, test keys, scans, tests and docs proceed without asking.
- Ask the founder once before: making the repo public / pushing, submitting to the hackathon, reading `~/.aab-seller/*`, or moving real funds.
- Never print, paste or commit key material or auth files. `.local/` is gitignored and holds private/unapproved material.
- Never claim more than the evidence shows (handoff section 9). A guard is not verified until you have seen it fire.
- Run `npm run check` before reporting code work done. Do not report done with failing tests.
- No remote exists (D7). Do not push.
