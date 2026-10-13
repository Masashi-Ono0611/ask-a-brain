import { z } from 'zod';
import { resolve } from 'node:path';
import { hostMcpCommand } from './mcp-host.ts';
import type { Arm } from './host-surface.ts';
export const pinSchema = z.object({ model: z.string().min(1).refine((s) => !s.includes('LEAD_PIN')), effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']) }).strict();
export type Pin = z.infer<typeof pinSchema>;
export function hostArgs(root: string, cwd: string, arm: Arm, socket: string, pin: Pin, mockUrl?: string): string[] {
  pinSchema.parse(pin);
  const mcp = hostMcpCommand(root, arm, socket);
  const q = JSON.stringify;
  const args = ['exec', '--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '-s', 'read-only',
    '--skip-git-repo-check', '--cd', resolve(cwd), '--model', pin.model, '--json',
    '--disable', 'shell_tool', '--disable', 'goals', '--disable', 'sleep_tool',
    '-c', `model_reasoning_effort=${q(pin.effort)}`,
    '-c', `mcp_servers.replay={command=${q(mcp.command)},args=${q(mcp.args)},required=true,startup_timeout_sec=20,default_tools_approval_mode="approve"}`];
  if (mockUrl) {
    const url = new URL(mockUrl);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.pathname !== '/v1' || url.search || url.hash || url.username || url.password) throw new Error('MOCK_ORIGIN_DENIED');
    args.push('-c', 'model_provider="mock"', '-c', `model_providers.mock={name="mock",base_url=${q(mockUrl)},env_key="MOCK_KEY",wire_api="responses"}`);
  }
  return [...args, '-'];
}
