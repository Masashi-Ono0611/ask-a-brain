/** Declarative freeze, not permission to launch a model or spend. Lead pins all
 * null runtime bindings before outcomes and freezes any conformance amendment. */
import { readFileSync } from 'node:fs';
import { bytesHash } from '../../../src/wire/index.ts';
import { M03 } from '../../../src/wire/constants.ts';
import { armOrder, toolsForArm } from '../../../src/eval/index.ts';
export const approvedOrder = Object.freeze(['I1', 'I2', 'I4', 'I5', 'I6', 'I8'] as const);
export function protocol() {
  return {
    v: 1, study_id: 'aab_approved_six_v1', status: 'FIXTURE_PROTOCOL_FROZEN_RUNTIME_BLOCKED',
    artifact_manifest_sha256: bytesHash(readFileSync(new URL('./manifest.json', import.meta.url))),
    incident_order: approvedOrder, primary_ids: approvedOrder, repeat_rounds: 0, primary_runs_per_arm: 1,
    all_attempts_count: true, selective_retries: false, fresh_context_and_storage_per_arm: true,
    arms: (['A', 'B', 'C'] as const).map((arm) => ({ arm, tools: toolsForArm(arm),
      knowledge: arm === 'A' ? 'shared task only' : arm === 'B' ? 'exact approved full corpus and answer map; free' : 'only approved answer spans through permitted consult',
      budgets: { wall_ms: M03.replayWallTimeMax.value * 60_000, buyer_tokens: M03.replayBuyerTokensMax.value,
        task_and_mcp_calls: M03.replayCallsMax.value, devnet_purchases: arm === 'C' ? M03.replayPaidArmPurchasesMax.value : 0 },
    })),
    rotation: approvedOrder.map((fixture_id, index) => ({ fixture_id, order: armOrder(index) })),
    model: { name: 'LEAD_PIN_AFTER_PROBE', effective_name: null, config_sha256: null, cli_sha256: null, auth: 'ChatGPT_subscription', api_billing_authorized: false },
    runtime_bindings: { code_revision: null, tool_schema_sha256: null, question_policy_sha256: null, corpus_sha256: null, answer_map_sha256: null },
    token_enforcement: 'UNVERIFIED', paid_arm: { network: 'devnet', gate1_required: true, live_paid_completion: 'UNVERIFIED', simulated_excluded_from_live_paid: true },
    denominators: { primary_cases: approvedOrder.length, planned_per_arm: approvedOrder.length, planned_attempts: approvedOrder.length * 3,
      ac_pairs: approvedOrder.length, bc_pairs: approvedOrder.length, historical_target: 10, target_shortfall: 10 - approvedOrder.length,
      observed_historical_triples: 0, observed_live_paid_triples: 0, unrun_in_original_order: approvedOrder,
      retain: ['unrun', 'incomplete', 'unknown', 'refusal', 'non_use', 'failure', 'budget_exhaustion', 'critical_regression', 'failed_delivery'],
      paired_cells: ['both_pass', 'both_fail', 'improvement', 'regression', 'unknown'] },
    time_fields: ['wall_ms_including_wallet_and_finality', 'human_active_ms_or_null', 'model_ms_or_null', 'chain_ms_or_null'],
    expense_fields: ['buyer_tokens_or_null', 'model_expense_usd_or_null', 'rpc_expense_usd_or_null', 'hosting_expense_usd_or_null', 'test_principal_atomic_or_null', 'network_fee_lamports_or_null'],
    buyer_mount_allowlist: ['one fixtures/eval/approved/public/I*.json snapshot'],
    buyer_access: 'five named task tools; read_checklist only for B; market tools only for C; no repository mount',
    seller_knowledge_allowlist: ['approved lesson pages', 'approved question-to-span map'],
    protected_only: ['.local/eval/rubrics/**', 'fixtures/eval/approved/adapter.ts', 'fixtures/eval/approved/*.test.ts', 'other-arm observations'],
    limitations: ['Retrospective toy reconstruction; scripted tests are not model replay.', 'Primary designation retained exactly; substantial resolution overlap requires lead reporting.',
      'I4 and I6 have no approved transition explicitly causing their critical flags.', 'T8 static synthetic parser needs the local adapter for these fixtures.',
      'Model pin, runtime isolation, token enforcement, question/map bindings and live consult acceptance remain blocked until observed.'],
  };
}
