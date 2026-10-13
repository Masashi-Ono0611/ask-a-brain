/** Host-only candidate configuration. Documentation is input evidence, never
 * inferred from permissive CLI parsing or from a model's description. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { bytesHash, M03, strictJson } from '../../src/wire/index.ts';
import { namesForArm } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
const pinSchema = z.object({ cli_version: z.literal('0.160.0'), requested_model: z.string().min(1), reasoning_effort: z.string().min(1),
  authentication: z.literal('chatgpt_subscription_only'), status: z.string(), disabled_features: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)),
  required_observations: z.array(z.string()), note: z.string() }).strict();
export const readPin = () => pinSchema.parse(strictJson(readFileSync(new URL('../../config/runtime/codex.json', import.meta.url))));
export type Pin = ReturnType<typeof readPin>;
/** Lead-reviewed extracts from local --help/config documentation for this exact
 * binary. A key being mentioned is NOT proof it has the required semantics.
 * No supplied documentation is shipped with the worker. Tests use explicit fakes. */
const documentationSchema = z.object({ version: z.literal('codex-cli 0.160.0'), exec_help: z.string(),
  assignments: z.array(z.object({ assignment: z.string(), excerpt: z.string().min(1) }).strict()),
  disabled_surfaces: z.array(z.enum(['builtins', 'features', 'plugins', 'skills', 'hooks', 'rules', 'project_config'])),
  provenance: z.enum(['lead_reviewed_local_documentation', 'test_fixture']) }).strict();
export type Documentation = z.infer<typeof documentationSchema>;
export const parseDocumentation = (bytes: Uint8Array): Documentation => documentationSchema.parse(strictJson(bytes));
export function candidateConfig(arm: Arm, launcher: string, container: string, pin = readPin()) {
  if (!['A', 'B', 'C'].includes(arm) || !/^\/[a-zA-Z0-9_./-]+$/.test(launcher) || !/^[a-f0-9]{64}$/.test(container)) throw new Error('CONFIG_TARGET_DENIED');
  const values: Record<string, unknown> = {
    model: pin.requested_model, model_reasoning_effort: pin.reasoning_effort, web_search: 'disabled',
    // Candidate keys only. Unknown keys must BLOCK, never be silently omitted.
    'skills.enabled': false, 'hooks.enabled': false,
  };
  for (const feature of pin.disabled_features) values[`features.${feature}`] = false;
  Object.assign(values, { 'mcp_servers.aab.command': launcher, 'mcp_servers.aab.args': [container, arm],
    'mcp_servers.aab.required': true, 'mcp_servers.aab.enabled_tools': namesForArm(arm) });
  const assignments = Object.entries(values).map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
  const flags = ['--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', '--skip-git-repo-check', '--cd', '--model', '--json'];
  return { arm, values, assignments, flags, toml: assignments.join('\n') + '\n',
    limits: { wall_ms: M03.replayWallTimeMax.value * 60_000, calls: M03.replayCallsMax.value, tokens_observed_max: M03.replayBuyerTokensMax.value },
    rollout_budget: { candidates: ['rollout_budget', 'token_budget'], status: 'UNVERIFIED', emitted: false } };
}
export type Candidate = ReturnType<typeof candidateConfig>;
export function auditConfig(candidate: Candidate, documentation?: Documentation) {
  const blocked: string[] = [];
  for (const assignment of candidate.assignments) if (!documentation?.assignments.some((d) => d.assignment === assignment && d.excerpt.includes(assignment.split(' = ')[0]!))) blocked.push(`UNKNOWN_CONFIG_KEY_OR_VALUE:${assignment.split(' = ')[0]}`);
  for (const flag of candidate.flags) if (!documentation?.exec_help.includes(flag)) blocked.push(`UNKNOWN_FLAG:${flag}`);
  for (const surface of ['builtins', 'features', 'plugins', 'skills', 'hooks', 'rules', 'project_config'] as const)
    if (!documentation?.disabled_surfaces.includes(surface)) blocked.push(`DISABLE_SEMANTICS_UNVERIFIED:${surface}`);
  return { status: blocked.length ? 'BLOCKED' : 'DOCUMENTED_ONLY', blocked, config_sha256: bytesHash(Buffer.from(candidate.toml)),
    inventory: 'UNVERIFIED', token_enforcement: 'UNVERIFIED', authentication: 'UNVERIFIED', effective_model: 'UNVERIFIED' };
}
/** Requires a fresh child directory, creates no authentication material. */
export function writeConfig(directory: string, candidate: Candidate, documentation?: Documentation) {
  mkdirSync(directory, { mode: 0o700 });
  const report = auditConfig(candidate, documentation);
  writeFileSync(join(directory, 'candidate-config.toml'), candidate.toml, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'config-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // A blocked candidate is deliberately never written as active config.toml.
  if (!report.blocked.length) writeFileSync(join(directory, 'config.toml'), candidate.toml, { flag: 'wx', mode: 0o600 });
  return report;
}
export function codexArgv(candidate: Candidate, cwd: string, pin = readPin()): string[] {
  // Passing exact overrides as well as CODEX_HOME avoids relying on ambiguous
  // ignore-user-config semantics. Local documentation must verify both routes.
  return ['exec', '--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--cd', cwd, '--model', pin.requested_model, '--json',
    ...candidate.assignments.flatMap((a) => ['-c', a]), '-'];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arm, launcher, container, directory, documentationPath, ...extra] = process.argv.slice(2);
  if (!arm || !launcher || !container || !directory || extra.length) throw new Error('ARM_LAUNCHER_CONTAINER_FRESH_DIRECTORY_REQUIRED');
  const report = writeConfig(directory, candidateConfig(arm as Arm, launcher, container), documentationPath ? parseDocumentation(readFileSync(documentationPath)) : undefined);
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.blocked.length ? 2 : 0;
}
