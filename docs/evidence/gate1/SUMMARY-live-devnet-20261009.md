# Gate 1 live devnet run, 2026-10-09 (JST)

Revision: `f3ed094` (run `gate1-f3ed094`). Network: Solana devnet, genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Providers: `https://api.devnet.solana.com/` (primary) and
`https://solana-devnet.api.onfinality.io/public` (secondary, free tier, throttled). Test mint is our own
6-decimal TEST token created by `scripts/devnet-setup.ts` on throwaway keys (never real funds).
Signer: `TestSigner` (ephemeral throwaway key). This is NOT human-signed evidence.

| Item | Verdict recorded by the runner | Independent re-derivation by the lead (direct devnet RPC) |
|---|---|---|
| a. exact split | PASS | tx `22iN3Nat...Sf3ct6`: 3 instructions (transferChecked, transferChecked, memo); payer -10000, seller +9000, marketplace +1000; fee 5000 lamports; err null |
| b. failed second leg | PASS | tx `5h99jEne...Q11NYf5`: `InstructionError [1, Custom 17]` (marketplace token account frozen), all token deltas 0, fee 5000 charged |
| c. security/replay/runtime controls | UNVERIFIED | engineering tests exist (offline); live/runtime controls not run |
| d. policy zero-I/O live proof | UNVERIFIED | engineering tests exist (offline); live proof not run |
| e. restart/lost response | PASS | after a SIGKILL sequence (after-sign, after-broadcast, after-receipt, after-freeze, before-thaw) a later invocation returned identical answer and receipt hashes with no replacement transaction |
| f. human wallet ceremony | UNVERIFIED | requires the founder's controlling TTY; the helper's success alone never passes f |

**Gate 1 is therefore NOT complete**: c, d, f remain unverified. Paid mode and mainnet remain disabled.

Caveats: the second provider is a free throttled endpoint, and the runner paces and retries only on throttling
(commit `f3ed094`); success still requires both providers to agree. A first run (`gate1-3f5a68a`) was retired
(non-resumable after that change); its data are retained and it is not evidence. Full raw RPC responses for
every call are in this directory (`attempt-*`). No key material is in this directory.

## Update: rerun at revision 03511b3 (after review fixes T3c/T3b and the broadcast fix T11c)
The full automatic sequence (after-sign, after-broadcast, after-receipt, after-freeze, before-thaw, no fault) was rerun on devnet at
revision `03511b3` (run `gate1-03511b3`): a PASS, b PASS, e PASS, c/d/f UNVERIFIED, same independent re-derivation as above (see the commit message / evidence).
Two founder human-signed attempts (`founder-human`, `founder-human-2`, 2026-10-09) did not land: the signature was valid for the exact approved
message (substitution refused, zero extra signatures) but the human approval took about 60 s while a devnet blockhash lives about 37 s, so the
transaction expired before broadcast (`BlockhashNotFound`, no funds moved). Per D18 devnet runs are automatic; item f is deferred to the mainnet
purchase, and a same-quote fresh-message renewal path must exist before that purchase.
