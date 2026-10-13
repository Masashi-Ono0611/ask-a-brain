# T12c host-mode replay handoff

This is an **exploratory, amended host-mode study**, not M10-compliant isolated
Codex, not prevention evidence, and not a live-paid study. C uses **SIMULATED**
consultation through the real seller `prepareAnswer`, with no wallet, payment,
receipt, transaction or signing capability. No Codex or network was run by this
worker. Do not infer actual host acceptance from the subprocess-double tests.

## Freeze and architecture

The user supplied the T12c ownership/acceptance contract; this checkout's task
graph has T12 but **no T12c section**. Only additions under `scripts/replay/`,
`test/replay/`, and `config/eval/protocol-amendment.json` are changed. No commits,
dependencies, original replay scripts, T12b fixtures/rubrics, or docs were edited.

The amendment must be reviewed and hash-pinned before outcomes. It explicitly
supersedes M02/M10's removable-tool premise and hard token cap per measured L6:
identical residual built-ins in all arms, shell disabled, read-only sandbox, no
task network, observed tokens, supervisor wall/call caps from M03. The manager
requires model-provider access; "no network" describes task effects, not the
manager's inference transport. Unix-domain IPC is local. View-image host reads
and collaboration/subagent effects are residual risks, not proven isolation.

- `mcp-host.ts` is a Node-permission-restricted stdio frontend. It imports no
  rubric, fixture engine, seller, grader or protected run configuration. The
  only application I/O is validated tool calls over one fixed Unix socket.
  The read allowlist covers its code, wire/MCP code and installed dependencies;
  it excludes fixture data, rubrics, auth, knowledge and other attempts.
- The supervisor owns the frozen T12b transition engine. The transition engine
  and hidden scoring predicates share the same T12b rubric file, so both stay
  **outside** MCP. Responses expose only its existing public tool projections.
  Action snapshots stay in the protected journal. Node permissions are a
  process-path guard, not an OS isolation claim against hostile same-user code.
- B returns exact approved pages and the normalized approved selection index.
  C invokes real seller extraction on the verified sealed projection on each
  consult. Preflight checks all ten questions for exact B/C source-span parity.
  C has the five task tools plus `consult(question_id)` only; it deliberately
  has no find/status/feedback/report, payment or mainnet operation.
- Every supervisor request is counted before admission; responses and private
  snapshots are fsynced before delivery. Reconnecting MCP cannot reset caps.
  CLI JSON events and observed usage are journaled; CLI telemetry completeness
  for residual built-in invocations remains UNVERIFIED. No model prose grades.
- The watchdog kills the Codex process group; call exhaustion closes task access
  and kills the group. Attempt directories are exclusive. A restart refuses to
  reuse an attempt; interruption leaves the fsynced journal. Study reports are
  immutable cumulative snapshots, before and after every attempted slot.
- Grading replays frozen T12b actions and exact predicates from the journal.
  A local wrapper disables only T12b's token-based verdict; original tokens and
  overages remain in the result. Missing usage remains null, never fabricated.
- All three complete inventories are captured and checked for residual symmetry
  before any study outcome. Every attempt repeats its inventory preflight and
  checks that frozen residual hash before loading auth or starting inference.
  The capture stores every raw provider request (without auth headers), argv,
  CLI process result and extracted top-level/nested tool list. Unknown accepted
  config/tool schema or any extra/missing tool fails closed.
- The approved six cases and rotation are unchanged. Pooled, no-overlap (I2),
  and overlapped (I1/I4/I5/I6/I8) figures include overlap labels. A-C and B-C
  cells, failure/unknown/unrun/incomplete counts and all attempts are retained.
  Human time and expenses are not measured; principal/live-paid counts are zero.

## Exact lead commands

Use Node 24.13.0, the existing installed lockfile, and **Codex 0.160.0**. Do not
install/fetch/upgrade for this task. Review and commit the implementation first:
the driver requires a clean root whose HEAD equals `code_revision`, and verifies
the Codex executable file hash. If the executable is a wrapper, record its
underlying binary/version too; wrapper hashing alone is not a binary pin.

First complete the controls on the real host (no Codex inference):

```sh
npm run typecheck
npm run check:boundaries
AAB_REQUIRE_SOCKET_TEST=1 node --test test/replay/host.test.ts test/replay/host-knowledge.test.ts test/replay/host-ipc.test.ts
node --test test/seller/listener-abort.test.ts
AAB_REQUIRE_SOCKET_TEST=1 npm test
```

Prepare these explicit variables with **real reviewed absolute paths**, and pin
the exact available model and effort before results. Model/effort defaults are
intentionally absent. The lead provisions a separate auth directory; the worker
never reads `~/.codex`. The runner copies only `auth.json`, never config, rules,
history, skills or any directory. Paths containing `.codex` are rejected. The
fresh attempt CODEX_HOME is removed after exit. Do not put secrets in the request.

```sh
export AAB_REPLAY_ROOT="$PWD"
export AAB_CODEX_BIN=/absolute/path/to/codex
export AAB_CODEX_AUTH_DIR=/absolute/separately-provisioned/replay-auth
export AAB_REPLAY_MODEL=LEAD_PIN_EXACT_MODEL
export AAB_REPLAY_EFFORT=high
export AAB_REPLAY_OUT=/absolute/new/study-output
export AAB_REPLAY_INVENTORY=/absolute/new/inventory-output
export AAB_REPLAY_RUBRICS=/absolute/protected/approved-rubrics
export AAB_REPLAY_PROJECTION=/absolute/approved/sealed-projection
export AAB_REPLAY_SEAL=/absolute/approved/sealed.json
export AAB_REPLAY_PUBLIC_KEY=/absolute/approved/seller-public-key.json
export AAB_REPLAY_QUESTIONS=/absolute/approved/questions.json
export AAB_REPLAY_MAP=/absolute/approved/answer-map.json
export AAB_REPLAY_ORIGIN=https://seller.example.invalid
export AAB_REPLAY_REQUEST=/absolute/new/host-request.json
```

The source question/map bytes must match Approval 2. The sealed file is the
existing publisher output `{manifest, approval, scans}`; the projection contains
only the manifest's approved page/map/policy files. The public key is the existing
`SellerPublicKey` object. This task creates no real seals, approvals or keys.

Capture inventories via the real CLI and loopback fake provider, with **no auth**:

```sh
node scripts/replay/capture-inventory-mock.ts "$AAB_REPLAY_ROOT" "$AAB_REPLAY_INVENTORY" "$AAB_REPLAY_MODEL" "$AAB_REPLAY_EFFORT" "$AAB_CODEX_BIN"
```

Exit zero is required for all three arms. Inspect `A|B|C/request-*.json`,
`argv.json`, `process.json`, `inventory.json`. The provider override and MOCK_KEY
are used only for capture; production attempts do not inherit them. Capture uses
exact runner flags including Node permission MCP arguments. A mismatch is a
blocker; do not expand an allowlist from model statements or remove strict mode.

Observe strict-config's negative control on the actual pinned CLI using a fresh
OS-temp CODEX_HOME. This command must fail for the unknown key before inference:

```sh
AAB_STRICT_HOME="$(mktemp -d)"
env -i PATH="$PATH" HOME="$AAB_STRICT_HOME" CODEX_HOME="$AAB_STRICT_HOME" \
  "$AAB_CODEX_BIN" exec --strict-config --ignore-user-config --ignore-rules \
  --ephemeral -s read-only --skip-git-repo-check --cd "$AAB_STRICT_HOME" \
  --disable shell_tool --disable goals --disable sleep_tool \
  -c aab_deliberately_unknown_config_key=true --json 'Reply ok'
# Expected nonzero, unknown-key diagnostic; the successful capture is the clean pair.
```

Before study launch, also observe real host canaries on this exact flag/role
configuration: attempted apply_patch write denied with unchanged dummy canary;
no shell entry; network callback denied from task operations; residual subagents
cannot acquire effectful tools or read protected rubric/auth; view_image cannot
be used to disclose protected images. Restore each dummy canary and show the
permitted MCP action. These properties are **UNVERIFIED here**. The measured
residual image/subagent surfaces may mean some cannot be established: retain
that limitation and obtain a revised frozen amendment before results, rather
than calling the manager isolated. The Node-permission test proves only the MCP
process read path. Observe descendant cleanup on real watchdog expiration too.

Generate the strict request (the model placeholder is rejected by pinSchema):

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const need = (name) => { const v = process.env[name]; if (!v) throw Error(name); return v; };
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const root = need('AAB_REPLAY_ROOT'), codex = need('AAB_CODEX_BIN');
const sealed = need('AAB_REPLAY_SEAL'), key = need('AAB_REPLAY_PUBLIC_KEY');
const request = {
  root, output: need('AAB_REPLAY_OUT'), rubric_directory: need('AAB_REPLAY_RUBRICS'),
  projection_directory: need('AAB_REPLAY_PROJECTION'), sealed_file: sealed,
  signing_key_file: key, source_questions: need('AAB_REPLAY_QUESTIONS'),
  source_map: need('AAB_REPLAY_MAP'), origin: need('AAB_REPLAY_ORIGIN'),
  pin: { model: need('AAB_REPLAY_MODEL'), effort: need('AAB_REPLAY_EFFORT') },
  codex, codex_sha256: hash(codex), code_revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  sealed_sha256: hash(sealed), signing_key_sha256: hash(key),
  amendment_sha256: hash(join(root, 'config/eval/protocol-amendment.json'))
};
writeFileSync(need('AAB_REPLAY_REQUEST'), JSON.stringify(request, null, 2), {flag:'wx', mode:0o600});
JS
node scripts/replay/run-study.ts "$AAB_REPLAY_REQUEST"
```

The driver executes 18 primary slots in frozen rotation. Preflight errors retain
failed/incomplete attempts; reports do not erase failures or replace primaries.
If killed during a slot, its started snapshot counts it as incomplete with unknown metrics. If killed between slots, the latest `report-NN-0-started.json` / `report-NN-1-finished.json` keeps the rest unrun. Preserve
all existing directories/journals; no selective retry. A separate single-attempt
command exists for a separately frozen rehearsal request/output, **not** for
replacing a study outcome:

```sh
node scripts/replay/run-study.ts "$AAB_REPLAY_REQUEST" --single I2 A
```

Inspect every result/journal, actual requested/effective model, usage event shape,
wall/call counters, inventory hashes, B/C parity and incomplete triples. Effective
model identity and CLI usage schema remain UNVERIFIED until live observation.
Artifacts contain approved public task text plus protected rubric-derived action
states; keep the raw supervisor journals protected and do not publish them as a
source corpus. Public reporting uses `report-NN-0-started.json` / `report-NN-1-finished.json`, not raw journals.

## Contract requests and design judgments

1. **CONTRACT REQUEST — `fixtures/eval/approved/knowledge.ts`, `approvedKnowledge`:**
   normalize its exact pinned source `Qxx -> [{page,start_byte,end_byte,text}]`
   into `AnswerMap` before `parseCorpus`. It currently passes source bytes into
   the incompatible internal-map parser. Observed source hashes match Approval 2.
   T12c adapts locally in `host-knowledge.ts`; no frozen file changed. Related
   T12b test expects `.entries` on that source; owner should review separately.
2. **Owner request — `test/seller/listener-abort.test.ts`:** run its unchanged
   test on a real host (or owner may add a narrowly scoped sandbox-EPERM skip).
   This worker cannot change seller-owned files or make sandbox TCP listen work.
   Pristine HEAD independently reproduces the exact failure (1 test, 0 pass,
   1 fail, exit 1). It is not a T12c regression or a passing result.
3. No shared T0 contract changes requested. Host result/config/input types are
   local adapters, because the original synthetic replay contracts and token
   grader do not represent L6 host-mode evidence.
4. M02/M08 isolation deviation: fixture/seller extraction occurs in a protected
   supervisor, not an isolated container; MCP frontend is a permission-restricted
   client. Do not claim the T12a VM route was used or verified. This is explicitly
   disclosed in the amendment, and needs lead acceptance before outcomes.
5. M10 C interface/payment deviation: six tools including simulated consult,
   no market side effects. M03 token deviation: usage observed and overages shown,
   never a hard cap. M10 task predicates and frozen case selection are unchanged.
6. Record 6 governs both strata plus pooled results; no efficacy/prevention,
   paid-consult advantage, demand, independence or generalization claim is made.

## Remaining UNVERIFIED

Real Codex strict/MCP configuration, complete inventory schema/naming with MCP,
model/effective effort, subscription authentication, CLI usage completeness,
real OS/read-only/no-task-network enforcement and inherited subagent behavior,
view_image protection, Unix MCP integration (sandbox EPERM), real process-group
and descendant kill, final sealed bundle/rights/freshness, any live study outcome,
all live-paid/mainnet/devnet/payment measures. TCP mock endpoint response support
is implemented from L6's measured fixture but was exercised only via a fake
endpoint double here. Real hosted seller isolation is not implemented by this
host adapter. No guard is claimed observed merely because it appears in config.

## Fixtures and verification

`test/replay/approved-questions.json` and `approved-answer-map.json` are exact
approved public source copies from this worktree's supplied approved source,
not incident resolutions. They retain Approval 2 SHA-256:

- questions: `fc267d1f9ccbc10a0e55c9584a4cfd9abd36df96469c7a8c2ddfe895d53f6ac7`
- answer map: `1825a74fa6d2f3f420d2182fbf98d54f784c94901cb91b76220ca7a697a94c49`
- unchanged fixture manifest: `09bb7d38a0e6ef2782e73b41bc311e2ea8c4f182b5615167892e4a5c2a72db5c`
- unchanged protocol: `999bf14efe3f7c84bcfbab7d81e32c2e5d3012dcaa48d3842069b52d8cc6175e`

Keys in tests are ephemeral Ed25519 keypairs created in memory, never serialized
or committed. Test-only seals/scan attestations are not founder approval evidence.
Final exact worker test totals are recorded in the worker handoff.

## Final worker verification (2026-10-09)

Base HEAD: `36225f758897e2cfe4ebbae675bb140bb8a8b7ab`; all T12c additions are
uncommitted for lead review.

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run check:boundaries` | exit 0; 377 imports/exports; buyer/seller-worker reachability PASS |
| `node --test test/replay/host.test.ts test/replay/host-knowledge.test.ts test/replay/host-ipc.test.ts` | exit 0; 17 tests, 16 pass, 0 fail, 1 skipped, 0 cancelled |
| `npm test` | exit 1; 996 tests, 992 pass, 1 fail, 3 skipped, 0 cancelled; 36,736.221291 ms |
| pristine `git archive HEAD`, unchanged `test/seller/listener-abort.test.ts` | exit 1; 1 test, 0 pass, 1 fail; same `listen EPERM 127.0.0.1` |

The one T12c skip is real Unix MCP exchange; two pre-existing skips concern Unix
signer/MCP IPC. The full-suite failure is the pre-existing seller listener bind.
No skipped or infrastructure-blocked control is counted as passed.

Amendment SHA-256:
`6d9a326747291032aab1951883866c704af99bef9a8feac63207137ebbb2b93a`.
No cryptographic vectors were generated. The two added public source-copy hashes
are listed above. The frozen T12b incident and rubric files were not changed.

Timing judgment: inventory/config/auth preflight is separate setup; the M03
watchdog and `elapsed_ms` cover the Codex task process, including task/MCP waits.
The mock preflight has its own M03-bounded process timeout. This is not a claim
that total operator setup plus inference is bounded to one task-wall allowance.

Additional guard branches not individually fired in worker tests remain
**UNVERIFIED**: live request clean-revision/binary/amendment pin admission,
mock HTTP route/body limits, MCP disconnect/concurrent response handling,
auth symlink/hardlink/size rejection, output-overflow process termination, and
real whole-study preflight symmetry on all three CLI inventories. Guards with
observed bad/clean pairs are named in the 17-test output; do not infer broader
runtime evidence from parser presence.

Created files (exact paths):

```text
config/eval/protocol-amendment.json
scripts/replay/LEAD-RUNBOOK-HOST.md
scripts/replay/capture-inventory-mock.ts
scripts/replay/host-config.ts
scripts/replay/host-inventory.ts
scripts/replay/host-knowledge.ts
scripts/replay/host-lines.ts
scripts/replay/host-process.ts
scripts/replay/host-supervisor.ts
scripts/replay/host-surface.ts
scripts/replay/mcp-host.ts
scripts/replay/run-host-attempt.ts
scripts/replay/run-study.ts
test/replay/approved-answer-map.json
test/replay/approved-questions.json
test/replay/host-ipc.test.ts
test/replay/host-knowledge.test.ts
test/replay/host-support.ts
test/replay/host.test.ts
```
