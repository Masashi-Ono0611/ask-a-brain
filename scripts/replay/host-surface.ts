import { z } from 'zod';
import { inventory, validateInput } from '../../src/mcp/index.ts';
export type Arm = 'A' | 'B' | 'C';
export const armSchema = z.enum(['A', 'B', 'C']);
export const questionInput = z.object({ question_id: z.string().regex(/^[A-Za-z0-9_-]+$/) }).strict();
export function hostTools(arm: Arm) {
  const tools = inventory('A');
  if (arm !== 'A') tools.push({ name: arm === 'B' ? 'read_checklist' : 'consult',
    description: arm === 'B' ? 'Free approved full lesson corpus and exact selection index.' : 'SIMULATED consultation via seller extraction. No payment, signature or live-paid completion.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { question_id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' } }, required: ['question_id'] } });
  return tools;
}
export function admitCall(arm: Arm, tool: string, input: unknown): unknown {
  if (!hostTools(arm).some((t) => t.name === tool)) throw new Error('TOOL_DENIED');
  return tool === 'consult' || tool === 'read_checklist' ? questionInput.parse(input) : validateInput(tool, input);
}
export const residualTop = Object.freeze(['functions.exec', 'functions.wait', 'functions.request_user_input', 'functions.request_user_input_async',
  'collaboration.spawn_agent', 'collaboration.send_message', 'collaboration.wait_agent', 'collaboration.interrupt_agent', 'collaboration.list_agents', 'collaboration.followup_task']);
export const residualNested = Object.freeze(['apply_patch', 'view_image', 'clock__curr_time', 'list_mcp_resource_templates', 'list_mcp_resources', 'read_mcp_resource']);
