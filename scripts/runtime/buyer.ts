/** Minimal buyer entrypoint. No env-derived URL, key, DB, config or plugin path. */
import { createBrokerClient, inventory, serveRestrictedMcp, StrictStdioTransport } from '../../src/mcp/index.ts';
import type { Arm } from '../../src/mcp/index.ts';
const arm = process.argv[2];
if (arm !== 'A' && arm !== 'B' && arm !== 'C') throw new Error('ARM_REQUIRED');
if (process.argv[3] === '--inventory') console.log(JSON.stringify(inventory(arm as Arm)));
else {
  if (process.argv.length !== 3) throw new Error('UNEXPECTED_ARGUMENT');
  await serveRestrictedMcp(createBrokerClient('/run/aab/gateway.sock'), new StrictStdioTransport(process.stdin, process.stdout), arm);
}
