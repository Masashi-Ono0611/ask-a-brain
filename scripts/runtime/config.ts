/** Generates explicit argv and deployment flags; never runs Codex/Docker.
 * No launch until lead resolves native token enforcement and auth isolation. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M03, payloadHash, strictJson } from '../../src/wire/index.ts';
import { inventoryHash, namesForArm } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
const root = new URL('../../', import.meta.url);
export function launchPlan(arm: Arm) {
  const pin = strictJson(readFileSync(new URL('config/runtime/codex.json', root))) as { cli_version: string; requested_model: string; reasoning_effort: string; disabled_features: string[] };
  const overrides: Record<string, unknown> = { model_reasoning_effort: pin.reasoning_effort, web_search: 'disabled' };
  for (const name of pin.disabled_features) overrides[`features.${name}`] = false;
  // env -i removes auth variables from the MCP child. It does NOT prove denial
  // of auth files; host must place the bridge in the separate buyer_mcp role.
  overrides['mcp_servers.aab.command'] = '/run/aab/bridge-launcher';
  overrides['mcp_servers.aab.args'] = [arm];
  overrides['mcp_servers.aab.required'] = true;
  overrides['mcp_servers.aab.enabled_tools'] = namesForArm(arm);
  const argv = ['exec', '--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', '/task', '--model', pin.requested_model, '--json'];
  for (const [key, value] of Object.entries(overrides)) argv.push('-c', `${key}=${JSON.stringify(value)}`);
  argv.push('-');
  return { status: 'BLOCKED' as const, reason: 'NATIVE_TOKEN_CAP_AND_HOST_MODEL_ACCEPTANCE_REQUIRED', cli_version: pin.cli_version, argv,
    inherited_environment: false, required_environment: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/run/codex-manager', CODEX_HOME: '/run/codex-manager/config' },
    config_sha256: payloadHash(overrides), tools_sha256: inventoryHash(arm), limits: { wall_ms: M03.replayWallTimeMax.value * 60_000, tokens: M03.replayBuyerTokensMax.value, calls: M03.replayCallsMax.value, purchases: arm === 'C' ? M03.replayPaidArmPurchasesMax.value : 0 },
    unresolved: ['Verified launcher for isolated MCP role (no Docker socket in Codex)', 'Native token limit setting and observed enforcement', 'Subscription-only authentication and actual complete capability inventory'] };
}
export function containerFlags(role: 'buyer_mcp' | 'seller_worker', image: string): string[] {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('DIGEST_PIN_REQUIRED');
  if (role !== 'buyer_mcp' && role !== 'seller_worker') throw new Error('ROLE_DENIED');
  return ['run', '--pull=never', '--rm', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=65532:65532', '--pids-limit=64', '--cpus=1',
    `--memory=${M03.workerMemoryMax.value}g`, `--memory-swap=${M03.workerMemoryMax.value}g`, '--tmpfs=/tmp:rw,noexec,nosuid,nodev', '--workdir=/task', image];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--container-flags') console.log(JSON.stringify(containerFlags(process.argv[3] as 'buyer_mcp' | 'seller_worker', process.argv[4] ?? '')));
  else { const arm = process.argv[2]; if (!['A', 'B', 'C'].includes(arm ?? '')) throw new Error('ARM_REQUIRED'); console.log(JSON.stringify(launchPlan(arm as Arm), null, 2)); }
}
