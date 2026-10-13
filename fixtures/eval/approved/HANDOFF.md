# HANDOFF — T12b

Status: six deterministic executable toy fixtures delivered; full T12b acceptance remains BLOCKED/UNVERIFIED as listed below. No commit, dependency change, network call, private-brain access, wallet access, or source-document edit was made. The frozen order and primary designation remain I1, I2, I4, I5, I6, I8. All six incident and all five lesson source SHA-256 values matched approval-index.md before implementation.

## Files

- `fixtures/eval/approved/public/{I1,I2,I4,I5,I6,I8}.json`: identical task prompt, visible initial state and neutral finite fix descriptions for all arms. Only the single case projection may be mounted in a buyer.
- `fixtures/eval/approved/adapter.ts`: protected local transition/evidence/grader adapter using T8 wire `ActionRecord`, `TaskEvidence`, `Observation`, `FixtureView` and five named tool signatures. No arbitrary code, file, URL, shell or reset tool. Raw JSON admission is strict. Grading reconstructs actions from an initial snapshot, then evaluates held-out final-state predicates.
- `fixtures/eval/approved/knowledge.ts`: hash-approved lesson admission and fail-closed B/C corpus/map adapter. The expected paid support method is an offline comparator, NOT a paid service or payment simulator.
- `fixtures/eval/approved/protocol.ts` and `config/eval/protocol.json`: M03-derived budgets, arms/tools, frozen rotation, no optional repeats, all-attempt denominators, unresolved model/runtime bindings.
- `fixtures/eval/approved/lessons/{L1,L2,L3,L4,L5}.md`: exact approved bytes, without rewriting or summarizing B's material.
- `fixtures/eval/approved/manifest.json`: exact-byte fixture, held-out rubric, test-path, source and lesson hashes. Protocol binds this manifest's exact hash.
- `fixtures/eval/approved/approved.test.ts`: focused tests. This location is deliberate: the checked-out task graph has NO T12b section, so no additional test path ownership could be verified. It is NOT automatically discovered by `npm test` and NOT included in the root tsconfig unless imported. A supplementary typecheck used the exact root compiler options with this directory explicitly included.
- `fixtures/eval/approved/HANDOFF.md`: this handoff.
- Protected, gitignored `.local/eval/rubrics/{I1,I2,I4,I5,I6,I8}.json`: full transition models and pass/fail/critical predicates. NEVER mount to buyer or seller.
- Protected, gitignored `.local/eval/rubrics/{I1,I2,I4,I5,I6,I8}.paths.json`: scripted correct, tempting wrong and reachable critical paths, test-only.
- Protected, gitignored `.local/eval/rubrics/verification.json`: exact local check counts and unchanged-HEAD failure comparison.
- Protected, gitignored `.local/eval/rubrics/overlap.json`: all 30 incident/lesson assessments and family clusters. Lead must preserve these ignored artifacts separately; a commit of public files does not transfer them.

## Verification

- `npm run typecheck`: exit 0.
- Additional `tsc --noEmit -p /tmp/aab-t12b-tsconfig.json`: exit 0. Temporary config extends the repository tsconfig, explicitly includes `fixtures/eval/approved/**/*.ts`, and uses the installed Node types. No root tsconfig was modified.
- `npm run check:boundaries`: exit 0; 377 imports/exports; buyer and seller-worker role reachability PASS.
- `node --test fixtures/eval/approved/approved.test.ts`: exit 0; 83 tests, 80 PASS, 0 FAIL, 3 SKIPPED, 0 cancelled. Skips are I4 critical-action path, I6 critical-action path, and approved B/C map parity. Skipped evidence is not counted as verified.
- `npm test`: exit 1; 836 tests, 833 PASS, 1 FAIL, 2 SKIPPED. Failure: `test/seller/listener-abort.test.ts:19`, `listen EPERM: operation not permitted 127.0.0.1`. An untouched `git archive HEAD` in OS temp reproduced exactly that single test failure (1 test, 0 pass, 1 fail, exit 1). No unrelated code was changed to bypass the sandbox. Existing Unix socket tests were also skipped by the sandbox.
- `git diff --check`: exit 0; new-file whitespace additionally checked separately.
- `git check-ignore .local/eval/rubrics/I1.json`: confirms hidden artifacts ignored.
- Logs: `/tmp/aab-t12b-focused.log`, `/tmp/aab-t12b-regression.log`, `/tmp/aab-t12b-baseline.log`.

All six correct paths PASS and all six tempting wrong paths FAIL. I1/I2/I5/I8 have observed critical-action failures that remain latched through later repair. Every named critical predicate has a bad/clean pure-final-state pair. Fault-injected state is explicitly rejected as UNKNOWN by the action-trace grader; this is not a substitute for an executable approved critical-action path. All six have A/A reproducibility, source-predicate transcription, frozen-byte/schema/UTF8/duplicate-key, allowed-ID, evidence, budget and projection checks.

## Per-incident rubric and lesson overlap

P/F/C counts are final-state pass predicates / complementary fail predicates / critical predicates. Common evidence and budget guards are additional, shared requirements, not inflated into these counts.

| Fixture | Family | P/F/C | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|---|
| I1 | F01 | 6/6/2 | G | G | N | **R** | N |
| I2 | F02 | 8/8/2 | G | G | N | N | N |
| I4 | F04 | 6/6/2 | G | N | **R** | N | N |
| I5 | F05 | 5/5/1 | G | **R** | N | G | N |
| I6 | F06 | 6/6/2 | **R** | N | N | N | N |
| I8 | F08 | 8/8/3 | G | G | **R** | G | N |

N = no case-specific resolution found; G = general principle overlap; R = substantive operational/historical resolution overlap flagged. Exact toy identities, fix IDs and predicates were absent from lesson pages in the inspected bytes. That does NOT establish semantic holdout. I1/L4 shares the recovery sequence; I4/L3 shares bounded observation/fresh run/terminal verification; I5/L2 shares task-owned scratch; I6/L1 shares missing release metadata/artifact verification; I8/L3 shares timing/stale-rerun precautions. M10's contamination limitation remains despite founder primary designation. No incident was removed/reordered and no rubric was weakened. F02/F05 and F04/F08 are related clusters; six cases are not six independent families of generalization.

## CONTRACT REQUESTS

1. `src/eval/types.ts` symbols `Fixture`, `Rubric`, `Study`, `RunnerDependencies`; `src/eval/fixtures.ts` symbols `parseFixture`/`parseRubric`; `src/eval/tools.ts:createTaskTools`; `src/eval/runner.ts:createReplayRunner`; `src/eval/grader.ts:gradeAttempt`: lead should add a protected fixture-engine injection/version that accepts historical-derived toy metadata and these transition/evidence semantics. Current T8 accepts only `label: synthetic`, applies static replacements, has no inspection/ownership preconditions or latched harms, and cannot advance verification transitions. Do NOT relabel these as pure synthetic history or weaken the approved predicates. Until that change, use the local adapter only; this task does not claim stock T8 runner compatibility.
2. `docs/impl/01-task-graph.md`, missing `## T12b`: lead should restore the exact owned paths and authorize/discover the focused suite through `test/eval/approved.test.ts` (or another explicit path). Reason: prevent silently editing another owner's tests/root configuration. Root `npm test` currently does not include the 83 focused tests.
3. `.local/approved-src/questions/questions.json` and `answer-map.json`: supply exact Approval 2 bytes, SHA-256 `fc267d1f9ccbc10a0e55c9584a4cfd9abd36df96469c7a8c2ddfe895d53f6ac7` and `1825a74fa6d2f3f420d2182fbf98d54f784c94901cb91b76220ca7a697a94c49`. They were absent throughout this run. Verify their shape against T0's `AnswerMap`; if the approved draft uses another shape, add a byte-preserving local projection, never invent/reselect spans. Bind each incident's approved question before live replay. B/C parity positive control is skipped until these exist.
4. Approved I4 and I6 option/rubric contract: none of their three options explicitly creates a named critical flag. Lead must record unreachable critical-path coverage or obtain an explicit pre-run amendment. Do not silently make I4's status-board claim destroy history, or make I6's report claim fabricate an actual receipt. Pure predicate coverage exists; approved end-to-end critical coverage is UNVERIFIED.

No changes to wire contracts, constants, dependencies, migrations, existing eval code or docs were made.

## Judgments and deviations

- **M02/M10; T8 task format:** local protected adapter instead of modifying T8. The five tools preserve wire signatures; inspection additionally returns its recorded evidence, and leftovers adds an allowlisted task-state projection. These local subtype additions let finish reference real inspection/ownership receipts. Protected full observations never go through buyer tools.
- **Approved incident common contract; M10:** inspection and repair receipts legitimately refer to earlier states; terminal verification must match the final state and follow the last repair. Requiring all receipts to hash to the final state would invalidate required pre-mutation inspection. Ownership checks must precede ownership-dependent repair. No final-answer confidence is accepted.
- **Approved I4/I8 verification clauses:** two deterministic verification observations represent progress then terminal completion. I4 consumes its one source-defined fresh trigger once. I8 observes the newer run complete before its fresh check completes. The toy budget 18 is source-defined state, not a replacement for M03 wall/token/call caps.
- **Approved initial-state/tool observations:** resolver traces update after table transitions; reclaimed scratch references become absent; the actual extra-card count is visible in inventory observations. These are toy state representations, not historical facts.
- **Approved I2/I8:** baseline/timing flags are set only by recorded inspection. Critical flags latch and cannot be cleared by later repair. Missing/corrupt observations are UNKNOWN (`ungraded`), not manufactured failures or passes.
- **Approved I6/I4; M11:** no unapproved critical action was added. I6's completion-claim option changes summary text only, not inventory or terminal evidence. Two runtime critical-path tests are explicitly skipped.
- **M10 primary evidence/overlap:** retained all founder-frozen primary IDs, but flagged five substantive resolution overlaps. Lexical absence of toy IDs is not proof that a lesson lacks the resolution. No superiority/generalization/historical-count claim is made.
- **M03/M10:** protocol limits derive from `M03`; zero repeats and one primary run per arm. Model/effective configuration, policy, deployment and paid-arm bindings stay unresolved. The existing lead L5 token-cap limitation is not silently waived. Protocol freeze is not a compliant live-run authorization.
- **T12b path constraint:** tests stayed inside the explicitly assigned fixture subtree due to the missing task-graph section. Supplementary typechecking compensates locally; lead still needs normal test discovery integration.

## UNVERIFIED / lead actions

- Exact B/C same-corpus/selection parity, paid answer-span adapter compatibility, incident-to-question binding: missing approved inputs. Copy and verify them; run focused positive controls.
- T8 runner integration, runtime tool inventory, hidden-rubric/cross-arm OS mount isolation and model/config pinning. Only local object/projection separation was tested. Never mount the whole `fixtures/eval/approved` tree or this handoff to a buyer; only the selected public snapshot plus permitted tool results.
- Reachable critical-action paths for I4/I6; see Contract Request 4.
- Semantic contamination adjudication of the five flagged overlaps, rights/lineage completion and any permitted protocol amendment before outcomes. Founder approval is not replaced by these tests.
- Native hard token cap and actual buyer behavior, all 18 primary attempts, complete triples, observed historical n and live-paid n. Scripted fixture checks are infrastructure tests only; observed historical/live-paid triples remain zero.
- Real-host socket tests: rerun `npm test`, including `AAB_REQUIRE_SOCKET_TEST=1` for existing Unix IPC controls. This sandbox's EPERM prevents listener acceptance, even on untouched HEAD.
- Live devnet/Gate 1, actual consultation/payment/receipt evidence and founder/lead procedural obligations from the current ledger. No mainnet, network or wallet work is part of this handoff.

## Hashes

The full per-fixture source/snapshot/rubric/path hashes and lesson hashes are in `manifest.json`. Exact SHA-256:

- `config/eval/protocol.json`: `999bf14efe3f7c84bcfbab7d81e32c2e5d3012dcaa48d3842069b52d8cc6175e`
- `fixtures/eval/approved/manifest.json`: `09bb7d38a0e6ef2782e73b41bc311e2ea8c4f182b5615167892e4a5c2a72db5c`
- `.local/eval/rubrics/overlap.json`: `6e450e7fe1ab5598261f736d973bcdb079e54c6582228443d813493aaa45e343`
