# Implementation stack and layout

## 要約

Node 24.13.0・TypeScript 5.9.3・`node:sqlite` の単一パッケージに固定する。Solana は `web3.js` と `spl-token` を使い、送金2件と Memo を1つの legacy transaction に収める。開発は TestSigner と公開・架空資料で先行し、実際の鍵・公開承認・mainnet・録画は創業者だけが扱う。Codex の通常の sandbox 設定だけでは鍵の読み取り隔離を証明できないため、別環境とツール制限を実測する。以下は実装仕様であり、稼働・送金・安全性の合格記録ではない。

## Authority and status

Prepared 2026-10-09 JST for the internal **2026-10-12 18:00 JST** deadline. [Decisions D5–D17](../decisions.md) bind this document; [master M03–M12](../design/10-master-design.md) supplies the protocol and gates. These are implementation choices, **provisional, founder may overrule**, recorded individually in [decision-log](decision-log.md). They do not approve publication, private-data access or real spending.

D13 overrides the master's prohibition on AI-created **test** keys. D14 permits public-source candidate drafting before founder approval; exact-byte approval still precedes real activation. D10 selects subscription Codex, not an API experiment. D12 already selects MIT code / CC BY 4.0 eligible public content and release at submission; D7 still means no remote now. Do not revive superseded autonomous-signing, cloud, generative-answer or alternate-payment options from older documents.

During drafting, concurrent commit `486f0cc` added D15–D17 and captured the first two draft documents. D15 additionally permits specific project feedback notes, but this request explicitly asks for a PUBLIC-only content strategy; no such notes or private gbrain are read or required here. D16 fixes the **Colosseum Solana Ecosystem track**. D17 fixes approximately **USD 5 total funding**, approximately 0.03 SOL + 0.1 USDC plus margin, into **new dedicated wallets only**, funded later by founder; the main wallet is never used by this system. These are funding ceilings, not permission to spend or an increase to M03's one 0.01-USDC purchase/fee caps. Founder verifies current total value before funding; do not assume approximate token quantities always fit the dollar ceiling.

Observed here: repository starts at `dd5516a`, no application/package implementation, clean initial git status; Node `v24.13.0`, npm `11.6.2`, Codex CLI `0.160.0` with `exec --json`, `--model`, `--strict-config`, `--ignore-user-config`, `--ephemeral`, `--sandbox`, and `--skip-git-repo-check` in local help. Package versions supplied by the lead are availability facts, **not tested compatibility**. No install, devnet call, model replay or content approval was performed for these documents. Network-dependent probes below belong to the lead, outside the implementation sandbox.

## Stack freeze

| Component | Exact selection | Reason / first verification |
|---|---|---|
| Runtime/package manager | Node `24.13.0`, npm `11.6.2`, ESM (`type: module`) | One runtime and `package-lock.json`; no pnpm/bun workspace, bundler, ts-node or tsx. |
| Chain | `@solana/kit@8.4.0` (revised by R1 below; originally `web3.js@1.99.0` + `spl-token@0.4.15`) | One SDK family, no `spl-token`: SPL `TransferChecked`, Memo and ATA derivation are encoded locally with Kit codecs and verified on devnet. Lead probe: all needed APIs exist and a legacy message compiles on Node 24. |
| MCP | `@modelcontextprotocol/sdk@1.32.1` | Low-level server + stdio; same strict input schemas at broker boundary. Lead verifies API/peer compatibility. |
| Schemas | `zod@3.25.76` | Single runtime schema/type source, strict objects and explicit semantic checks; exact peer compatibility **UNVERIFIED**. No second Ajv stack. |
| Canonical JSON | `canonicalize@5.1.0` | JCS bytes only after strict parsing/schema admission; golden RFC vectors. |
| JSON syntax | `jsonc-parser@3.3.1` | Token/tree parser with comments and trailing commas disabled, all parse errors fatal, duplicate decoded property names detected per object before materialization. No regex duplicate-key detector. Availability **UNVERIFIED** until lead probe. |
| Type checker | `typescript@5.9.3`, `@types/node@24.0.0` | Conservative JS compiler; Node 24 declarations, avoiding accidental Node 26 APIs. Actual dependency declarations/typecheck **UNVERIFIED**. |
| Storage | Node `node:sqlite`, `DatabaseSync` | No native build/install lifecycle; only `src/common/sqlite-store.ts` imports it. |
| Crypto/HTTP/tests | `node:crypto`, `node:http`, built-in `fetch`, `node:test`, `node:assert/strict` | No web framework, ORM, crypto toolkit, Vitest, UI framework or seller LLM SDK. |
| Secret scanner | Project-local Gitleaks `8.24.2` release binary + official checksum pinned per OS/arch | Lead stages verified binary under `.local/tools/`; mandatory scanner self-test plus independent marker test. Checksum/package availability **UNVERIFIED** here; never invent a checksum or silently skip. |

**R1 — Revision by the lead (2026-10-09, evidence-based, supersedes the web3.js/spl-token choice and the paragraph below it):** the first install of `@solana/web3.js@1.99.0` + `@solana/spl-token@0.4.15` produced 168 packages with `npm audit` = 9 advisories (3 high: `bigint-buffer` toBigIntLE overflow; moderate: `jayson` -> `stream-json`, `uuid`) and one package with an install script (`bigint-buffer`); the suggested fixes were unusable downgrades. `@solana/kit@8.4.0` alone: 48 packages, 0 advisories, 0 install-script packages; the full project tree (with the MCP SDK) is 147 packages, 0 advisories, 0 install-script packages. D11 (minimal, script-free) and the security positioning favour Kit. Cost: local encoding of `TransferChecked` (opcode 12, u64 LE amount, u8 decimals), Memo and ATA creation, covered by tests and by the Gate-1 devnet run. Reversal trigger: the Kit encoding cannot pass the devnet atomic-split test by 2026-10-10 12:00 JST. See decision-log R1.

The [web3.js project describes its 1.x maintenance branch and Kit successor](https://solana-foundation.github.io/solana-web3.js/); [SPL Token's JS API](https://solana-labs.github.io/solana-program-library/token/js/) provides the corresponding instruction helpers. Kit's modular API and smaller tree-shaken applications are attractive for later browser work. Here there is no browser bundle: decoding, signing and re-verifying one legacy format matters more than size. Familiarity is an engineering judgment, not a package correctness guarantee. Keep SDK objects behind `chain` so a later family migration is possible without changing wire records.

TypeScript 7.0.2 being available does not establish that its compiler packaging, declarations and script-free install work here. Choose 5.9.3, whose stable release is listed by [Microsoft](https://github.com/microsoft/TypeScript/releases), instead of guessing about 7.x or 6.x. The [5.9 documentation](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) establishes the compiler line; only the lead's install/typecheck proves this project's combination. This is not a claim that 7.0.2 is unsafe.

TypeScript settings: `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noEmit: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `skipLibCheck: false`, `types: [node]`, `lib: [ES2023]`. Use explicit `.ts` relative imports and `import type`. No enums, parameter properties, runtime namespaces, path aliases, decorators or TypeScript inside distributed dependency sources. Node strips types but does not typecheck or implement tsconfig transformations; see [Node TypeScript guidance](https://nodejs.org/api/typescript.html). Pinned Node behavior, rather than current documentation's newer runtime, must pass the launch smoke.

Lead install procedure, once T0 creates the manifest: inspect `npm view <name>@<pin> version engines peerDependencies scripts dist.integrity license --json` for every pin; install with `npm install --ignore-scripts --save-exact`; commit the reviewed lockfile. Subsequent worktrees/CI use `npm ci --ignore-scripts`. Do not use `npx` auto-download, global installs, `npm audit fix`, or lifecycle scripts to repair an install. Optional native acceleration must demonstrably fall back to JavaScript with scripts disabled; a required native build is a blocker. Audit dependency tree, install scripts and licenses, including transitive packages; accept MIT/BSD/ISC/Apache-2.0 with notices, review unknown/incompatible licenses. Record findings, not just a zero exit code. Verify the Solana pair, MCP/Zod, JCS and JSON parser together in a small public-vector smoke. Only the lead changes pins and lockfile; dependency failures get an explicit logged revision and affected tests.

`node:sqlite` warning is expected and retained on stderr in development/CI; stdout on MCP is protocol only. Do not set `NODE_NO_WARNINGS` or broadly suppress `ExperimentalWarning`. The pinned API is experimental by environment fact, regardless of newer [SQLite documentation](https://nodejs.org/api/sqlite.html). Startup probes actual SQLite version, opens a transaction, rolls back and checks WAL availability. Use `foreign_keys=ON`, WAL, `synchronous=FULL`, and `busy_timeout=5000`; one process owns each database, local disk only. Transactions are synchronous and short: never await RPC/signing while holding a write transaction. Persist schema version, transactional numbered migrations and backup manifest. Unknown/newer schema = offline. Migration exit: quiesce, reconcile pending money, checkpoint/backup DB with independent tombstones, migrate through the `Store` adapter, then crash/recovery/restore tests. Prefer a later stable built-in API; a native driver requires a new D11-compatible review, not a runtime auto-fallback.

## Repository and import boundaries

```text
package.json / package-lock.json / tsconfig.json / .npmrc / .node-version
src/
  wire/       constants.ts, schemas.ts, contracts.ts, json.ts, crypto.ts, index.ts
  common/     clock.ts, sqlite-store.ts, migrations/, logging.ts, index.ts
  chain/      legacy.ts, rpc.ts, verification.ts, signer.ts, human-cli.ts, index.ts
  broker/     service.ts, policy.ts, reservations.ts, recovery.ts, seller-client.ts
              receipts/, outcomes/, import/, index.ts
  seller/     controller.ts, worker.ts, preparation.ts, eligibility.ts, index.ts
  publish/    scan.ts, inventory.ts, seal.ts, list.ts, index.ts
  mcp/        server.ts, broker-client.ts, index.ts
  eval/       fixtures.ts, tools.ts, arms.ts, runner.ts, grader.ts, report.ts, index.ts
scripts/      role entrypoints, test/check/build launchers, devnet setup, operator CLI
config/       public examples, scanner rules, dependency policy, tooling pins
fixtures/     wire/, chain/, broker/, seller/, publish/, security/, eval/, content/
test/         wire/, common/, chain/, broker/, seller/, publish/, mcp/, eval/
              integration/, acceptance/
deploy/       pinned H1 images and separate broker/seller/buyer role configuration
docs/evidence/  reviewed content-free test/gate/version summaries (later tasks)
.github/workflows/ci.yml
.local/       ignored keys, DB/WAL, candidate material, model auth, runs, receipts, tools
```

T0 must add `.local/` and `dist/` to `.gitignore` **before any key generation**; it is not ignored at planning time. Use mode 0700 directories/0600 secret files; no keys in fixtures, snapshots, stdout or artifacts. Test keys are generated at execution, not deterministic committed seeds. Each role has its own `.local` root in its environment; `.local/` is a naming convention, not an access boundary. Never mount the host `.local` tree into the buyer or seller worker. Read-only git worktrees are authoring organization, not runtime isolation.

| Module | Allowed imports | Boundary |
|---|---|---|
| `wire` | Platform primitives, canonicalize, jsonc-parser, Zod | Owns all cross-module types/schemas/constants; no I/O, SDK, DB or environment reads. |
| `common` | `wire`, platform | Clock/storage/logging adapters only; domain row schemas live in `wire`. |
| `chain` | `wire`, `common`, chosen Solana family | Returns plain immutable records/bytes, never SDK instances. No broker/seller imports. |
| `broker` | `wire`, `common`, `chain` | Owns admission, policy, reservations, durable receipts/outcomes; calls seller over injected port. Never imports seller implementation. |
| `seller` | `wire`, `common`, `chain` | Controller independently verifies chain; worker only `wire` + approved bundle, no chain/storage/key import at runtime. |
| `publish` | `wire`, `common` | Offline sealed artifacts/proposals; no auto activation, private brain connector or payment signer. |
| `mcp` | `wire` + MCP SDK | Unprivileged transport adapter; typed broker IPC client, no DB or `broker` implementation import. |
| `eval` | `wire`, pure helpers from `common` | Named fixture tools, orchestration and grading. Market access via port; hidden grader never mounted with buyer. |
| `scripts` | Role-specific entrypoints | Composition roots inject implementations. No all-in-one buyer process importing broker/signer. |

Only `index.ts` exports and `wire/contracts.ts` types cross directories. Test fixtures may reference all modules; production modules may not import tests. A static import-boundary check enforces this graph and worker/buyer bundles' narrower entrypoint reachability. No worker edits another owner's directory, shared constants or lockfile. Contract requests go to T0's lead owner; merge the contract change before consumer changes.

## Public contracts to freeze in T0

The following is a specification of names/types/signatures, not application implementation. T0 owns their schemas and type exports. All network/IPC input is `unknown` until runtime-validated; TypeScript types are not authority. `Atomic`/`Lamports` are canonical unsigned decimal strings on wire, `bigint` during arithmetic; safe-integer counters only. `Sha256`, `Address`, `Signature`, `Uuid`, `Id`, `IsoTime` are runtime-validated string brands. `Network` is `devnet | mainnet-beta`; no automatic endpoint selection from caller strings.

Wire artifact names are `Registry`, `Listing`, `Manifest`, `Quote`, `Arm`, `Answer`, `ProofLocator`, `Receipt`, `Outcome`, `QuestionPolicy`, `ApprovedQuestion`, `SealedBundle`, `ListingProposal`, `Revocation`, `Eligibility`, `RunSpec`, `RunResult`, `Grade`, `FixtureView`, `TaskEvidence`, `ChecklistView`. Preserve [01 §5](../design/01-architecture.md#5-messages-and-data-shapes-json-examples) fields with **all M04 amendments**, not its obsolete trust object, quote selection, confirmed payment state, citation counts or receipt path. `Signed<T>` is `{payload: T; signature: {key_id: Id; algorithm: 'Ed25519'; value: string}}`. Registry is one canonical `{v: 1, registry_version, listings: Listing[]}` file with sorted seller IDs, no `trust`; every listing has `status: active | suspended`. Its entire JCS hash is pinned.

`ConsultInput` = `{request_id: Uuid; question_id: Id; template_values?: Readonly<Record<string,string>>; max_price: {network: Network; asset_id: Address; amount_atomic: Atomic}}`. Do not implement compatibility raw `question`, attachments, seller override or arbitrary text. A question policy stores exact UTF-8 text/hash plus its finite preexpanded template combinations, topic, allowed origins/networks, and approval hash. `BuyerContext` is server-authenticated `{buyer_id, payer, session_id}`, never accepted from MCP input. `ConsultView` carries consult/receipt IDs, orthogonal states, dispositions, actual/null amounts and eligible verified answer or null. `AgentFeedbackInput` only has consult ID, useful and reason code; human/source/classification are server-assigned.

```ts
// wire/index.ts
parseWire<K extends WireKind>(kind: K, bytes: Uint8Array): WireTypes[K];
canonicalBytes<T extends JsonValue>(payload: T): Uint8Array;
payloadHash<T extends JsonValue>(payload: T): Sha256;
verifyEnvelope<K extends SignedKind>(kind: K, value: Signed<SignedTypes[K]>, key: SellerPublicKey): void;
verifyCitations(answer: Signed<Answer>, manifest: Signed<Manifest>, pages: ReadonlyMap<Id, Uint8Array>): void;
resolveQuestion(policy: QuestionPolicy, input: ConsultInput): ApprovedQuestion;

// common ports (declared in wire/contracts.ts)
interface Clock {
  now(): IsoTime;
  monotonicMs(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
interface Store {
  transaction<T>(body: (tx: StoreTx) => T): T;
  read<K extends TableName>(table: K, key: string): Versioned<RowTypes[K]> | null;
  scan<K extends TableName>(table: K, query: StoreQuery<K>): readonly Versioned<RowTypes[K]>[];
  checkpoint(): void;
  close(): void;
}
interface StoreTx {
  read<K extends TableName>(table: K, key: string): Versioned<RowTypes[K]> | null;
  scan<K extends TableName>(table: K, query: StoreQuery<K>): readonly Versioned<RowTypes[K]>[];
  insert<K extends TableName>(table: K, key: string, row: RowTypes[K]): void;
  compareAndSet<K extends MutableTable>(table: K, key: string, expectedVersion: number, row: RowTypes[K]): void;
  append(event: LedgerEvent): void;
}

// chain ports; a RpcClient is bound to ONE configured origin
interface RpcClient {
  genesis(signal?: AbortSignal): Promise<Address>;
  latestBlockhash(signal?: AbortSignal): Promise<BlockhashWindow>;
  finalizedHeight(signal?: AbortSignal): Promise<number>;
  feeForMessage(message: Uint8Array, signal?: AbortSignal): Promise<Lamports | null>;
  accounts(addresses: readonly Address[], signal?: AbortSignal): Promise<AccountSnapshot>;
  signatureStatus(signature: Signature, signal?: AbortSignal): Promise<SignatureObservation>;
  finalizedTransaction(signature: Signature, signal?: AbortSignal): Promise<FinalizedTransaction | null>;
  broadcastIdentical(signedTransaction: Uint8Array, signal?: AbortSignal): Promise<Signature>;
}
interface Signer {
  publicKey(): Promise<Address>;
  sign(request: SignRequest): Promise<SignResult>;
  recover(requestId: Uuid, messageHash: Sha256): Promise<SignResult | null>;
}
interface OfferApproval {
  review(offer: OfferReview): Promise<ApprovalDecision>;
}
createTestSigner(config: TestSignerConfig): Signer;
createHumanCliSigner(config: HumanSignerIpcConfig): Signer;
buildLegacyPayment(quote: Signed<Quote>, payer: PayerAccounts, blockhash: BlockhashWindow): UnsignedPayment;
validateLegacyMessage(message: Uint8Array, expected: ExpectedPayment): DecodedPayment;
attachSignature(payment: UnsignedPayment, signed: SignResult): SignedPayment;
verifyFinalizedPayment(tx: FinalizedTransaction, expected: ExpectedPayment): SettlementEvidence;
reconcilePayment(expected: ExpectedPayment, signature: Signature, primary: RpcClient, secondary: RpcClient): Promise<Reconciliation>;

// seller service and broker's HTTP adapter implement this identical port
interface SellerClient {
  quote(context: BuyerContext, input: QuoteRequest): Promise<QuoteDisposition>;
  arm(context: BuyerContext, input: ArmRequest): Promise<Signed<Arm>>;
  payment(context: BuyerContext, proof: ProofLocator): Promise<PaymentView>;
  answer(context: BuyerContext, quoteId: Id): Promise<AnswerDisposition>;
  manifest(sliceId: Id): Promise<Signed<Manifest>>;
  page(sliceId: Id, pageId: Id): Promise<Uint8Array>;
  eligibility(sliceId: Id, manifestHash: Sha256): Promise<Eligibility>;
}
interface SellerSealSigner {
  sign<K extends SignedKind>(kind: K, payload: SignedTypes[K], approval: SealAuthorization<K>): Promise<Signed<SignedTypes[K]>>;
}
prepareAnswer(bundle: SealedBundle, question: ApprovedQuestion, context: AnswerContext): PreparedAnswer | Decline;
createSellerService(deps: SellerDeps): SellerClient;
revokeSlice(store: Store, revocation: Revocation, journal: TombstoneJournal): Promise<void>;

// broker service and its restricted IPC client implement this port
interface MarketApi {
  find(context: BuyerContext, input: FindInput): Promise<FindOutput>;
  consult(context: BuyerContext, input: ConsultInput): Promise<ConsultView>;
  status(context: BuyerContext, input: StatusInput): Promise<ConsultView>;
  feedback(context: BuyerContext, input: AgentFeedbackInput): Promise<FeedbackOutput>;
  report(context: BuyerContext, input: ReportInput): Promise<ReportOutput>;
}
createBroker(deps: BrokerDeps): MarketApi;
resumePending(deps: BrokerDeps): Promise<RecoverySummary>;
persistReceipt(tx: StoreTx, receipt: Receipt, artifacts: ReceiptArtifacts): ReceiptId;
interface ReceiptImporter {
  importReceipt(receipt: Receipt, mode: 'quoted' | 'metadata_only'): Promise<ImportResult>;
  readback(receiptId: ReceiptId): Promise<ImportedRecord | null>;
}

// publisher / MCP / evaluation
validateBundle(input: BundleInput, approval: PublicApproval, scans: ScanAttestation): ValidatedBundle;
sealBundle(bundle: ValidatedBundle, signer: SellerSealSigner): Promise<SealedBundle>;
proposeListing(bundle: SealedBundle, deployment: PublicDeployment): ListingProposal;
serveMcp(market: MarketApi, tools: TaskTools, transport: StdioTransport, policy: ToolExposurePolicy): Promise<void>;
interface TaskTools {
  inspect_fixture(input: FixtureIdInput): Promise<FixtureView>;
  check_leftovers(input: FixtureIdInput): Promise<TaskEvidence>;
  apply_fixture_fix(input: FixIdInput): Promise<TaskEvidence>;
  verify_fixture(input: FixtureIdInput): Promise<TaskEvidence>;
  finish_with_evidence(input: FinishInput): Promise<TaskEvidence>;
  read_checklist(input: QuestionIdInput): Promise<ChecklistView>;
}
runArm(spec: RunSpec, market: MarketApi, tools: TaskTools): Promise<RunResult>;
gradeRun(spec: RunSpec, evidence: TaskEvidence): Grade;
renderReplayReport(runs: readonly RunResult[], grades: readonly Grade[]): string;
```

Contract record details that must not be guessed by parallel workers:

- `Versioned<T>` = `{version: number; value: T}`; `StoreQuery<K>` is bounded equality filters on schema-approved indexed fields plus limit/cursor, never raw SQL. Transaction callbacks must return synchronously; the adapter rejects thenables and rolls back rather than committing an accidentally async callback. `TableName` includes consults, free-check counters, quotes, arms, reservations, signed transactions, settlements, receipts, artifacts, outbox, outcomes, refunds, eligibility and tombstones. `MutableTable` excludes append-only settlements/events/outcomes/refunds/tombstones. Artifacts store blobs or hashes of fsynced immutable files; receipt insertion and outbox creation share a DB transaction. Unique constraints enforce request UUID/body hash, seller request key, quote arm hash, `(genesis,signature)`, receipt ID and `(consult_id,source)` observation; correction records refer to the original, never replace it. These are separate role-local schemas, not a shared DB between broker and seller.
- `BlockhashWindow` = `{blockhash: Address; lastValidBlockHeight: number; observedAt: IsoTime}`. `FinalizedTransaction` retains exact legacy serialized transaction/message, slot, `meta.err`, actual fee, compiled instructions, account keys and indexed pre/post token balances including mint/owner/program/decimals. Parsed friendly transfer summaries alone are insufficient. `Reconciliation` = finalized success/evidence, finalized failure/actual fee, conclusively expired/two endpoint observations, or pending/reason. Every RPC adapter has timeouts, redacted error codes and raw evidence capture outside normal logs. Setup-only `DevnetProvisioner` is a separate script capability, never a method exposed to runtime MCP.
- `SignRequest` contains request/quote IDs, network/genesis, exact message bytes/hash, expected payer, signed quote/arm, manifest/registry/question-policy hashes, reservation ID, estimated and maximum fee, blockhash window and offer-approval reference. `SignResult` is denied/reason or `{status: 'signed'; messageHash; publicKey; signature; approvalRef}`. Detached transaction signature is base58 at the boundary. `UnsignedPayment` contains the message and expected instruction/account map; `SignedPayment` contains serialized transaction bytes/signature/hash. No interface permits a buyer-supplied free-form signing payload.
- `OfferReview` has immutable selected quote/hash and readable terms; its approval occurs before arm. `ApprovalDecision` includes approved/denied, exact reviewed hash, actor class (`test` or `human`) and timestamp. A test approval cannot satisfy human-signing evidence. `HumanSignerIpcConfig` has a protected IPC endpoint/public-key expectation, **no wallet path**. Only the human-operated helper accepts a key-file path. `TestSignerConfig` requires a devnet genesis pin or explicit local simulation namespace and a `.local` key path; it refuses mainnet and arbitrary network config.
- `BrokerDeps` = frozen policy/registry/question policy, `Store`, `Clock`, `Signer`, `OfferApproval`, primary/secondary `RpcClient`, origin-bound `SellerClient` map and `ReceiptImporter`. `SellerDeps` = approved bundle, role-local store/clock, controller-only `SellerSealSigner`, independent RPC clients and tombstone journal. Ports do not convey filesystem authority across processes. Publisher phases may use injected test signers; real manifest signing requires protected exact-hash approval.
- Errors are typed `AabError` codes from 01 §8 plus explicit `CONTENT_REVOKED`, `NOT_READY`, `STATE_CONFLICT`, `BUDGET_EXHAUSTED`. Transport preserves code/retryability/consult ID without raw exceptions or seller prose. `status` never starts another quote/payment; `report` emits approved metadata only. State dimensions follow M06, not a single overloaded enum.

## Payment and signer implementation rules

Exactly three legacy instructions: seller `TransferChecked(9000,6)`, marketplace `TransferChecked(1000,6)`, Memo `aab:v1:<quote_id>:<nonce>`. Total 10000; distinct payer/seller/marketplace owners and precreated ATAs; legacy Token Program only. No compute budget, ATA creation, approvals/delegates, lookup tables, Token-2022, priority-fee or fourth instruction. Validate compiled account metas/signers/writability and expected unique accounts as well as decoded fields; reject surplus accounts/signatures. Payer is the sole transaction signer. Memo has only the expected data and no extra signer accounts. Build locally, serialize, decode independently and compare; never sign a seller's transaction.

Use `getFeeForMessage`, not a hardcoded 5000-lamport estimate; missing estimate blocks signing. Reserve maximum SOL fee plus principal atomically across sessions/sellers. Enforce M03 50000/call, 500000/day devnet principal, 100000/purchase and 1000000/day lamports. Charge day is reservation's UTC day; unresolved reservations remain visible and counted against available budget across midnight until resolved. Refunds never refill consumption. Current day pending exposure also includes prior-day unresolved commitments without double-counting settlement. Mainnet is one success for the demo with an explicit attempt latch: failure/ambiguity cannot reset it automatically.

Verify exact signed message, genesis, finality, `meta.err`, instruction bytes and transaction-local token deltas: payer −10000, seller +9000, marketplace +1000, correct owners/mint/program/6 decimals. Account balance reads before/after are supplemental evidence; concurrent transfers make them insufficient alone. Broker and seller fetch/verify independently. Null transaction, nonfinal status, unavailable second endpoint or provider disagreement stays pending. Expiry release needs finalized height beyond last-valid height and absent signature on **two distinct configured RPC endpoints**, not two calls to the same endpoint. Secondary devnet endpoint is **UNVERIFIED**: lead provisions a free permitted endpoint or retains reservations; never silently buys a provider plan.

`HumanCliSigner` uses a small Node terminal helper, not the absent Solana CLI binary. Founder starts it outside the buyer environment, supplies the CLI-format 64-byte secret-key JSON path privately, and verifies permissions/keypair validity/expected public key. Helper owns the key; broker uses protected local IPC. It revalidates message and pinned policy, renders every decoded field (network/genesis/mint/program, payer and both owners/ATAs, amounts, memo, blockhash/expiry, quote/manifest/policy hashes, estimated/max fee) and digest; an inert view offers the exact message base64 as well. Show no executable ANSI/control sequences from remote fields.

The founder first approves the selected offer, then approves the **frozen armed bytes** by typing `approve <message-sha256>` into the helper's controlling TTY. No stdin pipe, environment `YES`, MCP approval or remote HTTP approval. Helper rechecks expiry/arm/revocation readiness before signing; stale approval cannot refresh a blockhash. Use the selected SDK's validated keypair/transaction signing primitives, no custom Ed25519 math. Persist signed bytes/signature and approval reference to the helper's protected journal before returning; broker verifies identical message/signature and durably journals before broadcasting. Helper never broadcasts. Lost IPC response recovers that signature by request/hash, without another prompt or signature on a changed message. If expiry wins, stop/reconcile and require a deliberate new request; never rebuild behind the same approval. Test every branch with a throwaway key and injected terminal/clock. Founder alone exercises the real helper with real file; authoring agents see only public key/hash/status.

## Devnet setup without Solana CLI

Lead runs `node scripts/devnet-setup.ts` after T0/T2 land. It asserts the expected devnet genesis before any signing or faucet call; explicit network flags alone are insufficient. Generate buyer/setup, seller-receive, marketplace-receive, mint and seller-seal test keys with secure randomness under `.local/devnet/<run-set>/`; reuse files thereafter. Seller and marketplace addresses differ even for founder self-tests. Provisioning records public addresses, genesis, setup signatures and finalized observations in a resumable journal. Keep seller signing keys separate from all token/payment keys.

Request 1 devnet SOL for the buyer only if observed balance is below a locally calculated rent + setup fee + suite reserve threshold. On 429/faucet failure use at most three attempts with 15/30/60-second backoff and Retry-After when supplied, then stop automatic requests. Do not rotate identities/IPs or repeatedly create wallets to evade limits. Reuse existing devnet balance, or lead uses the official devnet faucet interactively for that same public address; any existing donated **devnet** SOL is test-only. No real SOL purchase. [Solana documents requestAirdrop](https://solana.com/docs/rpc/http/requestairdrop); quota/availability remains runtime-dependent.

Create a legacy Token mint with decimals 6 and the throwaway setup key as mint/freeze authority, then exactly the three required ATAs. Mint a recorded initial 1,000,000 TEST atomic units to buyer (1 TEST, enough for bounded purchases; spending caps still apply). Setup/rent/mint/freeze operations are separate from purchase transactions and separately recorded. On rerun fetch mint and ATAs: verify program, decimals, authority, owner and expected addresses, create only missing accounts. Reconcile ambiguous setup signatures before resending; never replace a mint on mismatch. If balance runs low, explicit devnet top-up step mints the measured shortfall with its own journal entry, never hidden in a purchase. Do not reset live payment DB/counters to make reruns pass. New request IDs mean new deliberate purchases within quotas, not identity rotation.

For the on-chain failed-second-leg test, first validate, arm and sign while all accounts are valid. Pause at a test-only prebroadcast fault hook, freeze the throwaway marketplace ATA in a separate devnet setup transaction, then send the unchanged signed three-instruction purchase using a fault-harness transport that bypasses RPC preflight only for this test. Keep seller leg valid; do not weaken production frozen-account checks. Confirm finalized failure identifies the second transfer, all three token balances unchanged, actual fee charged; thaw in cleanup, including interrupted-run recovery. This is distinct from production's rejected malformed transaction tests. The harness accepts only the throwaway mint/genesis; no negative mainnet tests. Lead must observe actual chain failure: preflight rejection with no transaction is not atomicity evidence.

Sandbox fallback is a deterministic `RpcClient` transaction simulator: emulate the whole transaction with rollback, finality progression, fees, null/timeouts and restart; use injected clock and signature vectors. It supports complete broker/seller tests, not proof of Solana behavior. **Not Gate 1 evidence:** unit tests, mocked RPC, local validator, simulation, an unsigned message, preflight rejection, confirmed-only signature, explorer screenshot without raw metadata, one successful transfer, TestSigner-only isolation claims. Real devnet suite and founder exercising HumanCliSigner with a throwaway key are still required, along with all M05(a–f).

## Runtime buyer and replay harness

Run the buyer in a dedicated local Linux container/VM with no host home, repository, `.local`, DB, wallet, seller key, Docker socket, privileged PID access or gbrain mount. Give it only a clean disposable task volume and read-only harness entrypoints. Broker, seller controller, human signer and hidden grader remain outside. Seller worker is a separate unprivileged, network-disabled container with read-only approved bundle, read-only root, ephemeral scratch, cap-drop/all, no-new-privileges, 1 GiB memory, provisional 1 CPU/64 PIDs; lead verifies actual host support/RSS/restarts. No host networking or broad LAN route. Scoped broker IPC/proxy exposes exactly market calls; task supervisor exposes only opaque fixture/fix IDs. Both authenticate a run identity independent of model-supplied fields.

MCP stdio server exposes `find`, `consult`, `status`, `feedback`, `report`, `inspect_fixture`, `check_leftovers`, `apply_fixture_fix`, `verify_fixture`, `finish_with_evidence`; `read_checklist` is enabled only for B. A has task tools only; B has task tools + free checklist; C has task tools + five market tools. Broker also rejects market access for A/B, so tool hiding is not the sole control. No generic `exec`, SQL, path, URL, browser, read-file, plugin installation or connector tool. The MCP bridge itself has no protected state; it forwards validated requests to protected services. Fixture tools check fixed root/file allowlists and enums, never interpolate model strings into a shell.

Pinned buyer choice: **Codex `0.160.0`, requested model `gpt-6.1-sol`, reasoning effort `medium`, ChatGPT authentication, zero API-billing authorization**. CLI was observed; account access to that model/resolved model identifier is **UNVERIFIED**. Lead's 30-minute probe runs one synthetic task, captures resolved model from events/session metadata and freezes it before any primary run. If only a moving alias is reported, record that fact and do not claim an immutable snapshot; abort/preserve attempts on observed model drift. If unavailable, lead logs and freezes one available subscription model before starting all arms; no per-arm substitution or API fallback.

Launch shape after tested explicit config is generated (the wrapper controls env and exact argument array):

```sh
codex exec --strict-config --ignore-user-config --ignore-rules --ephemeral \
  --sandbox read-only --skip-git-repo-check --cd /task \
  --model gpt-6.1-sol --json -c model_reasoning_effort='"medium"' \
  -c web_search='"disabled"' - < /run/frozen-prompt.txt
```

Add explicit `-c` entries for the single stdio MCP server (`required=true`, exact enabled-tools list) and all verified feature disables. `--ignore-user-config` means these must be passed explicitly; a profile silently ignored by that flag is not acceptable. No parent personal config/plugins/skills/project instructions are loaded. Start with locally observed feature keys `shell_tool`, `unified_exec`, `apps`, `plugins`, `browser_use`, `browser_use_external`, `computer_use`, `code_mode_host`, `multi_agent`, `multi_agent_v2`, `memories`, `chronicle`, `view_image`, `skill_search`, `skill_mcp_dependency_install`, `remote_plugin`, and `workspace_dependencies` disabled; verify the **actual entire tool inventory**, not this provisional list. If CLI exposes apply_patch, file reads, search or any other nonallowlisted action despite settings, the live harness fails. Do not infer that disabling shell removes all capabilities. [Official config reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents feature controls, while [noninteractive docs](https://learn.chatgpt.com/docs/non-interactive-mode) documents JSONL and required MCP startup. These documents do not prove this particular binary is MCP-only.

Codex's read-only sandbox is not a confidentiality boundary. OS mounts/permissions and a tested capability inventory are required. Subscription transport needs network/auth while task actions must not gain it: runtime manager provisions account auth privately in a protected service home; an egress proxy permits only verified model-auth/service origins and the exact broker bridge. No API keys, personal home bind mount or credentials in model context/logs. MCP process gets an allowlisted environment with auth variables/files absent. Dummy outside-home/DB/key/admin/network canaries must fail and a permitted fixture repair must pass. If narrow tool exposure or filesystem/network separation cannot be proven by T7, retain synthetic harness tests and mark live replay/paid activation blocked; no switch to an unrestricted coding agent.

Freeze per-run CLI version/binary checksum, requested/resolved model, sanitized effective config and hash, tool schema hash, prompts, question/map/corpus hashes, task snapshot, hidden rubric reference, code/image SHA, auth mode (never tokens), arm/order, all attempts and usage. Fresh context/storage each arm; no resume/history/memory. M03 budgets: 10-minute wall watchdog including wallet/finality, 8000 buyer tokens, 30 total task/MCP calls, C at most one devnet purchase. Supervisor rejects call 31 and a second consult purchase server-side, kills on wall deadline but lets protected broker reconcile pending money. Exact token-cap support in this CLI is **UNVERIFIED**: lead tests native rollout-budget controls plus usage events with an intentionally tiny budget. If only terminal usage is observable, record overshoot, classify over-budget runs FAIL/noncompliant and do not claim an enforced 8000 cap. A compliant primary evaluation remains blocked until the cap can be enforced; offline/synthetic results are usable with their labels. Do not invent a CLI `--max-tokens` flag.

D13 allows TestSigner for full rehearsals. Primary M10 C arms and final recorded human-payment claims use HumanCliSigner; founder signing is procedural, no coaching. Subscription usage is measured in reported tokens/run and rate-limit events; incremental buyer API expense is zero under D10, subscription cost is not represented as free labor/computation. Stop on subscription exhaustion. Hidden rubric/history solution/other-arm outputs never enter buyer or seller mounts; grader runs afterward outside them. Free B receives the same exact source corpus and selection map, readable allowance and opportunity as C. It cannot be a weaker summary.

## Candidate content and questions

AI may draft from **public sources only**, using public unauthenticated GitHub views of founder-authored gbrain PR/issue portions and clearly personal public repositories. No private brain, local gbrain database, private connector, private repo, third-party comments, employer/customer material or transcript-derived input. No bulk scrape. A public URL is not ownership/CC BY permission: classify author, origin, license and each reused span. Default to newly written lessons supported by approved references, not relicensing others' text. Candidate material stays inactive under `.local/content-candidates/`; synthetic neutral fixtures can be committed if scanned. This planning task does not fetch or approve actual pages.

Draft five short lessons, each with Trigger / Failure mode / Fix / Evidence / Limits: (1) completion claims need executable evidence; (2) explicit leftover checks before declaring done; (3) bounded retries with stop/unknown outcomes; (4) restart-safe recovery using durable checkpoints; (5) process existence versus readiness/completion. These are proposals, not historical findings. Prepare a separate five-page synthetic demo slice with its own keys/map/manifest, same founder operator label, and at least one approved question it declines while founder listing answers. Do not imply independent supply.

One candidate policy file contains ten development questions (two per lesson), ID/version, exact UTF-8 text + SHA-256, allowed listing origins, network set, topic, and optional templates **expanded to a finite list before approval**. No free slots, private context, runtime paraphrases or attachment fields. Answer map binds question ID/expansion to 1–3 exact page spans with qualifiers, ≤5 sections/16 KiB evidence and M03 output/quote-scalar caps. Freeze ten unsupported/unsafe/version-mismatch cases separately; ≥8/10 in-scope supported and 10/10 negatives nonpayable, with local admission rejections separate from seller declines. At most one development repair before evaluation freeze.

For incidents, draft a chronological candidate inventory from **2026-07-11 through 2026-10-08 JST inclusive** (90 calendar dates), one first eligible reconstructible case per episode/root-cause family. Save public URL/revision/author, rights uncertainty, before-state evidence, proposed safe fixture and exclusions; missing evidence stays unknown. Target 3–5 real cases initially, ten aspirational. Founder reviews public candidates/rights and exact fixture bytes, verifies actual historical failure and sanitization, approves rubric and overlap exclusions. Hidden solution stays outside seller/buyer; a historical fix copied into the slice excludes that case from primary evidence. New experiments remain synthetic, never replacements for historical n.

Founder package minimizes work: inert exact-byte diff, five pages plus demo, finite question expansions/map, public-source attribution sheet, scanner reports, public-download/license attestation, bundle/policy hashes and compact incident/rubric packet. Founder reads every final byte/metadata and approves hashes; any edit requires reapproval. Scans cannot grant approval or override prohibited origin. No real listing activation, real manifest signature or registry repin until that packet is approved. Per-session ≤24-hour lineage/rights acknowledgement remains required. Runtime withdrawal serializes with final delivery and checks independent monotonic tombstones after restore; already downloaded bytes cannot be recalled.

## Tooling, build and future CI

`npm run check` performs local `tsc --noEmit`, schema/golden validation and import-boundary checks. `npm test` invokes an explicit sorted list of `test/**/*.test.ts` using `node --test` (do not rely on implicit TS discovery or a shell glob); unit cases can parallelize, process/crash suites use isolated DBs and serial subtests. `npm run test:acceptance` is deterministic synthetic M11 suite; `npm run test:devnet` is opt-in lead-only and never part of default CI. `npm run build` copies the audited role-specific TS runtime sources/public config into `dist/` and starts each entrypoint's `--self-check` without network/secrets; source execution is the deployment format, no transpile artifact needed. Reject unexpected file imports/mounts. No lint/format dependencies; use tsc, boundary checks and `git diff --check`.

T0 prepares the following `.github/workflows/ci.yml` locally. D7 means it does not run remotely until founder release. Action commit references below are candidates **UNVERIFIED here**; lead resolves them against official action repositories before creating the workflow. No CI secrets, model auth, real seller content, wallet, devnet purchase, deploy or publication job.

```yaml
name: ci
on: [push, pull_request, workflow_dispatch]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  deterministic:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24.13.0
      - run: node scripts/assert-toolchain.ts
      - run: npm ci --ignore-scripts
      - run: npm run check
      - run: npm test
      - run: npm run test:acceptance
      - run: npm run scan:setup
      - run: npm run scan:selftest
      - run: npm run scan:repo
      - run: npm run deps:check
      - run: npm run build
      - run: git diff --check
```

`assert-toolchain` requires npm 11.6.2 as well as Node; lead verifies setup-node's bundled npm, with explicit local pin correction if necessary, never a floating global install. `scan:setup` downloads only pinned platform scanner bytes and checks pinned official checksum; unavailable scanner fails. `scan:repo` covers staged/tracked content and git history plus English/Japanese business markers, blocks unexpected key-like JSON and `.local` tracking; known public attack vectors have exact-path/hash test-only exceptions, never candidate-controlled ignores. `deps:check` verifies pins/lock integrity, package scripts and license inventory and saves `npm audit --json` evidence; relevant unresolved high/critical advisories block release. Network failures are unverified, not clean audits. CI build/tests do not replace H1 isolation, human signer, devnet, content approval or actual gbrain readback.

Receipt default: protected full local receipt/outbox; probe installed gbrain only through synthetic isolated import. Prefer safe quoted import if M11 T8 actually passes, otherwise `metadata_only`; if even that fails, `import_pending`. Fallback label and missed full-content requirement remain visible. No general gbrain search in buyer. Public report keeps technical verification, replay and independent evidence separate, reports zero eligible independent buyers under current admission, and shows “unrated until 3 independent buyers” without a score. Full paid denominator includes failures/refunds. No private questions in public reports.
