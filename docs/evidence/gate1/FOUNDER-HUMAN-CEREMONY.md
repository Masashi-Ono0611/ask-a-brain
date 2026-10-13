# Founder human-signed devnet ceremony

T11d implementation note: the renewal orchestration is present, but **production
renewal remains disabled (`NOT_READY`) pending the lead-owned
`src/wire/constants.ts` addition `M03.messageRenewalsMax = constant(3,
'renewals/consult')`**. The task graph in this checkout has no T11d ownership
section; constants and the generic human CLI adapter were not edited. Offline
tests inject the proposed limit explicitly. This document is not live evidence.
The command below remains devnet-only; mainnet ceremony integration is UNVERIFIED.

1. Lead first commits the reviewed revision and completes throwaway `.local/devnet/t2` setup.
2. Lead verifies the two distinct canonical HTTPS devnet RPC URLs used in the literal flags below; seller ports 18191/18192 must be free.
3. Lead must reconcile any existing active run first. This command refuses a different active run and refuses to reuse a TestSigner run. Preserve all accounting/state.
4. From the repository root, in your real terminal, run this one line with literal flags (no same-line environment assignments). These are the providers recorded in the prior devnet evidence; the lead must recheck availability. The existing run is pinned to its original revision: the lead must reconcile and approve its state transition before running a repaired revision; do not change run IDs to bypass this guard.

```sh
node scripts/integration/gate1-human-live.ts --execute --run founder-human --primary https://api.devnet.solana.com/ --secondary https://solana-devnet.api.onfinality.io/public --seller-ports 18191,18192
```

5. Review the synthetic offer and terms. To continue, type `review <quoteHash>` using the displayed hash.
6. The separate helper shows devnet/genesis, payer and fee payer, mint, seller/marketplace owners and token accounts, 10000 total split as 9000/1000, memo, fees, blockhash expiry, all bound hashes and exact message bytes.
7. Take time to review the offer before typing `review`; the broker fetches the blockhash afterwards. At the exact-message prompt, check the fields and the one-line remaining-block countdown, then type exactly `approve <messageHash>` within about **30 seconds of the prompt appearing**. The height is authoritative; 30 seconds is guidance, not a guaranteed lifetime. Anything else refuses signing. Approval never refreshes expiry. If the blockhash expires before signing, the helper reports `EXPIRED_BEFORE_APPROVAL` and creates no signature. Retain the same run and reservation. After the shared cap contract above is integrated, the same run offers a fresh message only after recovering a durable, message-bound expiry refusal (or proving the broker never entered signing), confirming old-window expiry on both pinned providers, and rechecking quote lifetime and eligibility. It preserves the quote, request, reservation, original UTC accounting day and all counters. There are at most three renewals, with each old arm/message archived immutably. The seller replaces its arm conditionally against the previous arm hash; a retry after a lost seller reply resumes the exact persisted replacement. A fresh message always needs a new displayed hash and new exact approval; the old phrase is never reusable.
8. The helper alone opens the setup's throwaway `buyer.json`. Never paste a key, seed or wallet-file contents into the prompt. Do not use a real wallet or mainnet funds.
9. Wait for both providers' finalized proof. Expected successful output:

```text
Gate1(a)=PASS Gate1(f)=PASS host_isolation=UNVERIFIED paid_mode=false mainnet_enabled=false
```

10. Raw RPC, signature/explorer link, balance deltas and verdict are under `docs/evidence/gate1/founder-human/`.
11. Item f covers live human signing plus refused message substitution here; OS canaries/host isolation and other Gate1 items remain separate and unverified.
12. On interruption or uncertainty, do NOT change run ID, approve another purchase, delete WAL/journals, or reset counters. Re-run the identical command only after the lead reconciles the state and confirms any locked process exited. Recovery first reads the original helper journal. A missing reply, missing journal result or possibly-signed attempt cannot authorize renewal. Already signed transactions recover/broadcast identical bytes only. The explicit ceremony renewal loop can request a replacement only with the proof described above; status polling itself never signs a replacement.
13. No CLI dry-run/auto-approval option exists. Scripted approval and fake RPC occur only in tests. This is synthetic content and a devnet technical self-purchase, not revenue or content approval.

## T11d scope and conservative adapters

- The ceremony journals possible signing before loading key bytes, and commits
  expiry refusals as append-only message-bound events before replying. A crash
  after that attempt marker, including expiry during key loading, stays pending
  on original-message recovery. No journal or accounting reset is permitted.
- The generic `src/chain/human-cli.ts` adapter still accepts signed recovery
  replies only. `parseHumanRecovery` provides strict message-bound refusal
  parsing for this ceremony. Integrating the same behavior directly into the
  generic helper/client is a lead contract request, not completed work here.
- Both broker and seller require two finalized-height observations even when a
  helper refusal exists. This is deliberately stricter than the D18/T11d
  signer-refusal alternative. Provider unavailability retains the reservation.
- Seller renewal trusts the authenticated protected broker's no-sign assertion;
  it checks the previous arm, payment/proof state, count and expiry independently.
  There is no public route that reads the helper's private journal.
- Offline tests cover ephemeral signing, old-phrase rejection, ambiguous and
  missing replies, cap/fee/quote/height guards, double-renewal CAS, preserved
  midnight accounting, immutable archives, restart and a lost seller reply.
  They do not prove real terminal timing, provider availability, host isolation,
  or a human-signed renewed transaction finalized on devnet/mainnet.
