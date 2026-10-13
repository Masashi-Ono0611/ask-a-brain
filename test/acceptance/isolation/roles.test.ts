import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M03 } from '../../../src/wire/index.ts';
import { checkRole } from '../../../scripts/runtime/reachability.ts';
import { launchPlan, containerFlags } from '../../../scripts/runtime/config.ts';
import { namesForArm } from '../../../src/mcp/index.ts';
import { toolsForArm } from '../../../src/eval/index.ts';
test('actual buyer and worker transitive role inventories exclude protected implementation', () => {
  const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  for (const role of ['buyer', 'seller-worker'] as const) {
    const files = checkRole(root, role); assert.ok(files.length > 0);
    assert.ok(files.every((file) => !/^src\/(broker|chain|common|eval)\//.test(file)));
    assert.ok(!files.includes('src/seller/controller.ts'));
  }
});
test('role graph guards reject transitive barrel, dynamic code, filesystem and symlinks; restored graph passes', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aab-role-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/runtime'), { recursive: true }); mkdirSync(join(root, 'src/mcp'), { recursive: true });
  const entry = join(root, 'scripts/runtime/buyer.ts'), barrel = join(root, 'src/mcp/index.ts');
  writeFileSync(entry, "import '../../src/mcp/index.ts';"); writeFileSync(barrel, 'export const clean = true;');
  const clean = () => assert.equal(checkRole(root, 'buyer').length, 2); clean();
  for (const source of ["export * from '../broker/index.ts';", "import 'node:fs';", "import(process.env.SOURCE);", "require('node:fs');", "new Function('return 1')();"]) {
    writeFileSync(barrel, source); assert.throws(() => checkRole(root, 'buyer'), /ROLE_/);
    writeFileSync(barrel, 'export const clean = true;'); clean();
  }
  writeFileSync(entry, "import type { X } from '../../src/broker/index.ts'; import '../../src/mcp/index.ts';"); clean();
  rmSync(barrel); symlinkSync(entry, barrel); assert.throws(() => checkRole(root, 'buyer'), /SYMLINK/);
  rmSync(barrel); writeFileSync(barrel, 'export const clean = true;'); clean();
});
test('runtime launch stays blocked; all arms match T8, required MCP and explicit disables are emitted', () => {
  for (const arm of ['A', 'B', 'C'] as const) {
    assert.deepEqual(namesForArm(arm), toolsForArm(arm));
    const plan = launchPlan(arm); assert.equal(plan.status, 'BLOCKED'); assert.equal(plan.inherited_environment, false);
    assert.ok(plan.argv.includes('--strict-config')); assert.ok(plan.argv.includes('--ignore-user-config')); assert.ok(plan.argv.includes('--ignore-rules'));
    assert.ok(plan.argv.includes('mcp_servers.aab.required=true'));
    for (const feature of ['shell_tool', 'plugins', 'apps', 'unified_exec', 'browser_use', 'memories', 'multi_agent']) assert.ok(plan.argv.includes(`features.${feature}=false`));
    assert.equal(plan.limits.tokens, M03.replayBuyerTokensMax.value); assert.equal(plan.limits.calls, M03.replayCallsMax.value);
    assert.ok(!plan.argv.some((arg) => /dangerously|--max-tokens/.test(arg)));
  }
});
test('deployment denies mutable image tags; digest-pinned flags disable network and privileges', () => {
  assert.throws(() => containerFlags('buyer_mcp', 'node:latest'), /DIGEST_PIN/);
  const flags = containerFlags('seller_worker', `local/aab@sha256:${'0'.repeat(64)}`);
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', `--memory=${M03.workerMemoryMax.value}g`]) assert.ok(flags.includes(flag));
});

test('complete observed inventory rejects extra/missing tools, altered schemas and model self-report; exact control passes', async () => {
  const { verifyInventory } = await import('../../../scripts/runtime/verify-inventory.ts');
  const { inventory } = await import('../../../src/mcp/index.ts');
  const { canonicalBytes } = await import('../../../src/wire/index.ts');
  for (const arm of ['A', 'B', 'C'] as const) {
    const capture = { complete: true, source: 'trusted_runtime_instrumentation', tools: inventory(arm).map(({ name, inputSchema }) => ({ name: `mcp__aab__${name}`, inputSchema })) };
    for (const bad of [
      { ...capture, complete: false }, { ...capture, source: 'model_says_so' }, { ...capture, tools: capture.tools.slice(1) },
      { ...capture, tools: [...capture.tools, { name: 'exec', inputSchema: {} }] },
      { ...capture, tools: capture.tools.map((tool) => ({ ...tool, inputSchema: {} })) },
    ]) {
      assert.throws(() => verifyInventory(arm, canonicalBytes(bad)));
      assert.equal(verifyInventory(arm, canonicalBytes(capture)).result, 'INVENTORY_MATCH_ONLY');
    }
  }
});
