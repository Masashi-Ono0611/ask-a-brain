import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { M03, canonicalBytes, payloadHash } from '../wire/index.ts';
import { inventory, namesForArm, validateInput } from './protocol.ts';
import type { Arm, RuntimePort } from './protocol.ts';
/** Only the narrow IPC client is injected into the buyer; never a broker instance. */
export async function serveRestrictedMcp(port: RuntimePort, transport: Transport, arm: Arm): Promise<Server> {
  const tools = inventory(arm), names = namesForArm(arm); let calls = 0;
  const server = new Server({ name: 'ask-a-brain', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (++calls > M03.replayCallsMax.value) throw new Error('BUDGET_EXHAUSTED');
      if (!names.includes(request.params.name as typeof names[number])) throw new Error('TOOL_DENIED');
      const input = validateInput(request.params.name, request.params.arguments);
      const result = await port.call(request.params.name, input);
      // JSON text only: no resource links, images, executable content or prompts.
      return { content: [{ type: 'text', text: Buffer.from(canonicalBytes({ untrusted_content: true, data: result })).toString('utf8') }] };
    } catch { return { isError: true, content: [{ type: 'text', text: 'REQUEST_DENIED' }] }; }
  });
  await server.connect(transport); return server;
}
export function inventoryHash(arm: Arm) { return payloadHash(inventory(arm)); }
