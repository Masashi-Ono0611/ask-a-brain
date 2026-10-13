# T12a replay runtime handoff

Status: **offline runtime components implemented; live replay BLOCKED**. This is
not a completed live A/B/C study or M10 acceptance. No Codex/Docker executable,
network, wallet, auth file, personal home, or private brain was accessed by this
worker. The worker ran Node subprocess doubles only. No commits or dependency
changes were made.

## What exists

- `bridge.ts`: stdio-to-fixed-`docker exec` relay, opaque container ID + A/B/C
  arguments only. Full container inspection precedes dispatch. The generated
  launcher binds host paths; it has no shell/path/URL argument. A create-exclusive
  claim prevents reconnect from resetting the call counter. Requests are durably
  written to a dedicated T8 `FileJournal` before forwarding, responses before
  exposing them. The complete supervisor journal imports this evidence after
  exit; a killed supervisor leaves the separate bridge journal intact.
- `docker.ts`: fixed `--context colima-aab-probe`, digest-only image, pull never,
  fresh random role and task volume, network none, read-only rootfs, non-root,
  dropped capabilities, no-new-privileges, private namespaces, no ports/devices,
  no restart, exactly one named task volume. CPU/PID pins are read from T7's
  existing deployment plan; memory/time/call/token bounds use M03.
- `config.ts`: fresh 0700 per-run directory, 0600 candidate and audit report;
  active `config.toml` only when every exact assignment and flag has supplied
  documentation plus reviewed disabling semantics. One required MCP server,
  exact requested model/effort from `config/runtime/codex.json`. All configured
  feature switches are false. Candidate `skills.enabled` and `hooks.enabled`
  are explicitly UNKNOWN, not claimed working keys. No native budget setting
  is emitted. Rollout/token budget candidates remain UNVERIFIED.
- `run-attempt.ts`: durable start before config/container checks, strict operator
  request, frozen artifact checks, pre-inference MCP negotiation/tool-schema
  probe, isolated gateway socket readiness probe, Codex-only watchdog, cleanup
  of only this role/volume, observed CLI usage and exit, T8 result and grader.
  Real invocation records a blocked attempt **before any Docker/Codex launch**.
  Only a programmatic test port supplies fake commands; no CLI/environment/JSON
  flag enables a bypass. No separate hand-written SQLite implementation.
- `capture-inventory.ts`: fixed trivial prompt and capture status, help hash and
  actual debug/trace flag mentions. It never manufactures a complete inventory
  from MCP tools/list, expected tools or model prose. Real invocation currently
  records BLOCKED; tests run the trivial prompt against the stub executable.
- `observations.ts`: grades recorded successful finite MCP actions, never model
  recommendations. CLI JSON/usage decoding is a **candidate adapter**, not
  verified 0.160.0 documentation. Missing/corrupt action evidence is UNKNOWN.

The generated launcher is candidate deployment code. End-to-end tests invoke its
relay library against a fake Docker process. The executable shebang/host Docker
context/auth route and actual Codex required-MCP startup remain UNVERIFIED.
No code loads or creates authentication material. A future host binding needs a
public, isolated `DOCKER_CONFIG` containing only the disposable VM context; the
launcher uses an empty manager HOME, not the founder's Docker/Codex directories.
The current blocked route does not create or copy that context.

## Why live must stop (do not delete guards to run it)

1. **No T12a section exists** in this checkout's `docs/impl/01-task-graph.md`.
   The user's supplied brief controls scope: only scripts/replay and test/replay.
2. No local CLI help/config schema was supplied, and the worker was forbidden to
   execute Codex. Therefore every emitted config assignment/flag is BLOCKED until
   locally documented. Existing T7 comments explicitly call these provisional.
   No new CLI switch is invented here. `-c` and the candidate exec switches come
   from the existing T7 plan; that plan is not proof of exact semantics.
3. The checked buyer image can contain only runtime/buyer.ts, mcp and wire.
   It is a client of `/run/aab/gateway.sock`, **not a task engine**. The existing
   gateway/task engine is protected host code. A host Unix socket cannot simply
   be shared across Colima's VM boundary. A fresh task volume has no gateway.
   Starting buyer.ts proves only MCP availability, not usable task operations.
   No gateway, grader, whole eval barrel or broker was smuggled into the image.
4. The CLI's complete model-visible tool inventory has no verified instrumentation
   adapter. No debug flag's existence proves completeness. L5 requires a protocol
   amendment frozen before outcomes if this cannot be established.
5. `Study.mode`, fixture labels and wire `RunEvidence.simulated/historical_n`
   permit synthetic only. Current results honestly retain synthetic/zero history
   and `compliant_primary=false`; no live model output is mislabeled as historical.
6. `inspect_fixture` internally emits an action but its response lacks that
   action's recorded timestamp. Strict action reconstruction cannot invent it.
   Without protected gateway observations, runs containing inspect are ungraded.
   The successful dry control uses repair/check/verify/finish, all with actual
   returned evidence. This is an infrastructure control, not an A-arm policy.

## Exact contract requests (lead/owners only)

- `scripts/runtime/reachability.ts`, `checkRole` and
  `scripts/runtime/gateway.ts`, `createRunGateway`: supply and allowlist a minimal
  isolated task/gateway entrypoint that starts in the disposable role, without
  grader/rubric/broker/key imports. Define staging of approved task data and
  protected typed C-arm broker IPC across the VM boundary without network/home/
  Docker socket mounts. Current `runtime/buyer.ts` must remain the MCP surface;
  a socket merely existing must not stand in for an end-to-end repair probe.
- `src/wire/contracts.ts`, `Observation`/runtime port, plus T8's task controller:
  expose an authenticated protected final observation/action journal (including
  inspect timestamps, rejected calls, in-flight/late money observations), bound
  to run ID and frozen artifacts, never as an extra model-visible tool. This
  replaces incomplete reconstruction from public tool responses.
- `src/wire/contracts.ts`, `RunEvidence`/`AttemptResult`, and `src/eval/types.ts`,
  `Study`, `Fixture`, `Rubric`: add explicit observed-live/restricted-tool-runtime
  mode and honest label/count fields under L5's amended protocol. Preserve
  synthetic compatibility, UNKNOWN, all attempts and no M10-compliance claim.
- `config/runtime/codex.json` and T7's config owner: attach locally observed
  0.160.0 documentation/evidence for exact assignments and complete disabling of
  built-ins/features/plugins/skills/hooks/rules/project config, subscription-only
  authentication, effective model/effort, and complete inventory/event schemas.
  Resolve UNKNOWN keys; never silently omit one or relax `--strict-config`.
- `docs/impl/01-task-graph.md`, `T12a`: lead adds the missing ownership/acceptance
  section and freezes any L5 protocol amendment before observed outcomes.

No package/constants/migration changes requested. No undocumented token flag is
requested. L5's observed-only tokens remain explicitly UNVERIFIED enforcement.

## Offline reproduction

From this worktree with the already-installed dependencies:

```sh
npm run typecheck
npm run check:boundaries
node --test test/replay/guards.test.ts test/replay/runtime.test.ts
npm test
```

The tests create only public synthetic temporary files and Node subprocesses;
no real docker/codex binary is invoked. Test cases pair bad inputs with fresh,
restored clean controls. Tests cover no-inference aborts, forbidden mounts/network,
missing role/bridge/gateway, unknown config, strict parsing, call cap, watchdog,
usage errors, no-op grading, journal reopen/interruption/restart, and truthful
incomplete inventory. The watchdog test shortens **only the injected test timer**;
it asserts production passed exactly `M03.replayWallTimeMax * 60000` and observes
SIGKILL, a recorded aborted attempt, and subsequent cleanup.

## Lead-run commands: public help and blocked-attempt evidence

Run on the lead host, not inside the implementation sandbox. Nothing here installs,
updates, fetches, logs in, copies auth or initiates inference. Use a fresh temp dir:

```sh
AAB_T12A_PROBE=$(mktemp -d /tmp/aab-t12a-probe.XXXXXX)
export AAB_T12A_PROBE
node --version > "$AAB_T12A_PROBE/node-version.txt"
codex --version > "$AAB_T12A_PROBE/codex-version.txt"
codex --help > "$AAB_T12A_PROBE/codex-help.txt"
codex exec --help > "$AAB_T12A_PROBE/codex-exec-help.txt"
codex features list --help > "$AAB_T12A_PROBE/codex-features-help.txt"
codex features list > "$AAB_T12A_PROBE/codex-features.txt"
rg -n 'strict|config|debug|trace|tool|rollout|token|skill|hook|plugin' "$AAB_T12A_PROBE"/*.txt
node scripts/runtime/reachability.ts > "$AAB_T12A_PROBE/role-files.jsonl"
```

Expected version: `codex-cli 0.160.0`, Node `v24.13.0`. Stop on any other version.
If root help names additional debug/schema help commands, capture only the exact
commands it documents. There is **no known verified debug/inventory command** in
this checkout. If absent, record that fact, retain complete=false, and amend L5's
protocol before any outcomes. Do not ask the model to list tools as evidence.
Do not turn a successful strict parse into proof a disable key is effective.

Generate a frozen **synthetic blocked probe**, not a historical case. The image
below is explicitly an unprovisioned placeholder: no Docker is started or pulled.

```sh
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadStudy } from './scripts/eval/synthetic.ts';
import { planRuns } from './src/eval/index.ts';
const root = process.env.AAB_T12A_PROBE;
if (!root) throw new Error('PROBE_DIRECTORY_REQUIRED');
const spec = planRuns(loadStudy(), new Date().toISOString())[0];
const request = {
  spec, directory: join(root, 'blocked-attempt'), journal: join(root, 'attempts.jsonl'),
  image: 'aab/unprovisioned@sha256:' + '0'.repeat(64),
  fixture: resolve('fixtures/eval/synthetic/s1.json'),
  rubric: resolve('fixtures/eval/synthetic/s1.rubric.json'),
  corpus: resolve('fixtures/eval/synthetic/corpus.json')
};
writeFileSync(join(root, 'request.json'), JSON.stringify(request), { flag: 'wx', mode: 0o600 });
writeFileSync(join(root, 'inventory-request.json'), JSON.stringify({ ...request,
  spec: { ...spec, run_id: spec.run_id + '_inventory_probe' },
  directory: join(root, 'blocked-inventory') }), { flag: 'wx', mode: 0o600 });
JS
node scripts/replay/run-attempt.ts "$AAB_T12A_PROBE/request.json" > "$AAB_T12A_PROBE/result.json"
# Expected exit 2, LIVE_PREFLIGHT_BLOCKED; one start/result in attempts.jsonl.
node scripts/replay/capture-inventory.ts "$AAB_T12A_PROBE/inventory-request.json" "$AAB_T12A_PROBE/codex-exec-help.txt" "$AAB_T12A_PROBE/inventory.json"
# Expected exit 2, complete=false, tools=null, inference_started=false.
```

Both attempts remain in the shared journal. Repeating either request must refuse
`ATTEMPT_EXISTS`; do not erase a failed attempt or retry it with a fresh budget.
`candidate-config.toml` is inert, and config-report.json lists every unknown key.
No auth.json or secret is created. The config generator can additionally be run
as `node scripts/replay/config.ts A /absolute/bound/bridge-launcher <64-hex-container-id> <fresh-config-directory> [documentation-json]`.
Documentation JSON is strict: `version`, `exec_help`, `assignments` (each exact
`assignment` and a local-documentation `excerpt`), `disabled_surfaces` and
`provenance=lead_reviewed_local_documentation`. The generator only checks mapping
coverage, not authenticity/semantics of an operator attestation. Test_fixture is
used by unit tests and can never enable the blocked live route.

## Host acceptance after the contract work (still UNVERIFIED)

Do not remove liveBlockers or label them passed based on this runbook. After the
owners supply the missing code and actual documentation, update the composition
port with reviewed host evidence and freeze the protocol/config/role/image hashes.
Then run the real commands through the supervisor, with no fallback API billing.
The founder's existing personal authentication must never be copied. A separate
low-privilege account/login is a founder action, not an AI task.

Exact non-inference inspection commands for the disposable environment:

```sh
docker --context colima-aab-probe context inspect colima-aab-probe
# AAB_REPLAY_CONTAINER is the supervisor's exact full ID, never a user-picked role.
docker --context colima-aab-probe inspect --format '{{json .Mounts}}' "$AAB_REPLAY_CONTAINER"
docker --context colima-aab-probe inspect --format '{{json .HostConfig}}' "$AAB_REPLAY_CONTAINER"
docker --context colima-aab-probe stats --no-stream "$AAB_REPLAY_CONTAINER"
```

Use the actual digest-pinned role bundle and reviewed runtime dependency tree;
record exact source reachability, image/config/CLI binary SHA256, VM sharing
configuration, sanitized inspect output (never Env), startup/restart/RSS/OOM.
Run `deploy/lead-probes.txt` 3–6 against the actual role, with dummy-only canaries
and its clean repair pair. Verify all built-in tools are absent from complete
trusted instrumentation, then the exact 5/6/10 expected A/B/C schemas using
`node scripts/runtime/verify-inventory.ts A|B|C <trusted-capture-file>` (invoke once
per arm, not with the literal `A|B|C`). Preserve the raw instrument hash. If no
complete capture is available, inventory remains UNVERIFIED and L5 requires the
lead's frozen amendment; no compliant replay claim follows.

Break the actual required launcher and observe zero inference/task/sign/broadcast,
restore it and observe real initialization and permitted repair. Test an unknown
strict config key and restore it. Exercise wall kill, call M03+1, restart/reconnect,
second distinct consult and mainnet denial with intact broker reconciliation.
Run all three injection directions. Rehearsals/primary C signing follow the
current ledger and lead's amended protocol; no payment or signing is implemented
by this worker. Preserve all requested attempts, refusals, non-use, token overruns,
unknowns, aborted cleanup and incomplete triples. No hard 8000-token guarantee,
containerized-Codex claim, historical n, prevention, paid superiority or demand
claim is supported by these tests.

## Evidence and deviations

- Authority: task brief (missing task graph section); M02/M11 isolation, M03 caps,
  M10 all-attempt grading, E23 and L5 explicit limits. No normative docs edited.
- Conservative deviation: real command invocation stops before inference rather
  than relying on unverified config semantics or a nonexistent gateway transport.
- Dry runs use public synthetic T8 fixtures with ephemeral independent processes;
  they are not Docker isolation/model acceptance evidence.
- `RunEvidence` remains synthetic; live metadata is a local `RuntimeEvidence`
  adapter in owned paths. No shared contract was widened.
- No new committed cryptographic vectors or fixture data. Per-run config and
  help hashes are recorded in reports; T8 journal supplies its existing hash
  chain. Temporary stub fixtures are deleted by tests; no key material exists.
- Unobserved guards: actual executable launcher deployment/reconnect, real Docker
  isolation/resource semantics, required-MCP pre-inference abort in Codex,
  disabled surfaces, complete inventory, subscription route/effective model,
  CLI event schema, hard token enforcement, gateway/C broker IPC, inspect-action
  export and live grading. All remain UNVERIFIED/BLOCKED as appropriate.

## Worker verification / regression boundary

Baseline revision: `9492a6ef50ad66e5035161985747990d6bb2c153`.
The full suite has a sandbox infrastructure failure in the pre-existing
`test/seller/listener-abort.test.ts:19`: binding `127.0.0.1` fails with `EPERM`.
This was separately reproduced from a pristine `git archive HEAD` in OS temp,
with only a symlink to the existing dependency tree: 1 test, 0 pass, 1 fail,
exit 1, identical EPERM. The seller files are untouched. Two existing Unix-socket
tests separately report UNVERIFIED skips for the same sandbox restriction.

**Additional owner request:** `test/seller/listener-abort.test.ts`, `serve`/test
harness: owner may add a narrowly scoped sandbox-EPERM skip with the same mandatory
host mode as T7, or run the unchanged test on the real host. Do not suppress its
actual bad/clean assertion failures. This worker cannot repair host bind permission
or modify seller-owned files. Required host command:

```sh
node --test test/seller/listener-abort.test.ts
AAB_REQUIRE_SOCKET_TEST=1 node --test test/mcp/bridge.test.ts test/acceptance/isolation/injections.test.ts test/acceptance/isolation/roles.test.ts
npm test
```

Expected on host: no EPERM, both disconnect/completion controls observed, all
mandatory socket tests run (no skips), and full suite zero failures. Current
sandbox failure is **not** counted as green and no live runtime claim follows.

Exact undocumented candidate assignments at this revision (each is BLOCKED):

```text
model
model_reasoning_effort
web_search
skills.enabled
hooks.enabled
features.shell_tool
features.unified_exec
features.apps
features.plugins
features.browser_use
features.browser_use_external
features.computer_use
features.code_mode_host
features.multi_agent
features.multi_agent_v2
features.memories
features.chronicle
features.view_image
features.skill_search
features.skill_mcp_dependency_install
features.remote_plugin
features.workspace_dependencies
mcp_servers.aab.command
mcp_servers.aab.args
mcp_servers.aab.required
mcp_servers.aab.enabled_tools
```

Candidate exec flags requiring exact-version local documentation:
`--strict-config`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`,
`--sandbox`, `--skip-git-repo-check`, `--cd`, `--model`, `--json`, and the existing
T7 `-c` assignment mechanism. The generator checks the long flags' coverage;
actual `-c` parsing/override precedence must additionally be established by the
lead's strict-config positive/negative probe. Disabling semantics for built-ins,
features, plugins, skills, hooks, rules and project config are separate unknowns.
Neither `rollout_budget` nor `token_budget` is emitted or claimed enforced.

Final worker verification on the above revision plus owned uncommitted files:

- `npm run typecheck`: exit 0.
- `npm run check:boundaries`: exit 0; 377 imports/exports and buyer/seller-worker
  reachability PASS.
- `node --test test/replay/guards.test.ts test/replay/runtime.test.ts`: exit 0;
  46 tests, 46 pass, 0 fail, 0 skipped, 0 cancelled (29,844.911333 ms).
- `npm test`: exit 1; 882 tests, 879 pass, 1 fail, 2 skipped, 0 cancelled
  (39,548.797708 ms). The one failure and its pristine-HEAD reproduction are
  documented above; both skips explicitly require host Unix sockets.
- No tracked files outside owned paths changed; no commit created.
