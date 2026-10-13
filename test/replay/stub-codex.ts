/** TEST ONLY: scripted stub inference with real stdio MCP request/response IO. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { FileJournal } from '../../src/eval/index.ts';
import { relay, Lines } from '../../scripts/replay/bridge.ts';
import type { FrozenRun } from '../../src/wire/contracts.ts';
import { M03 } from '../../src/wire/index.ts';
const directory = process.argv[2]!;
const { mode, spec } = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { mode: string; spec: FrozenRun };
const prompt: Buffer[] = []; for await (const chunk of process.stdin) prompt.push(Buffer.from(chunk));
writeFileSync(join(directory, 'prompt.txt'), Buffer.concat(prompt));
appendFileSync(join(directory, 'inference.log'), 'inference\n');
if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else if (mode === 'invalid_usage') console.log('{"type":"turn.completed","usage":{"input_tokens":1,"input_tokens":2}}');
else if (mode === 'exit') process.exitCode = 3;
else {
  if (mode !== 'noop') {
    const attemptDirectory = join(directory, 'attempt');
    const journal = new FileJournal(join(attemptDirectory, 'bridge.jsonl'));
    const input = new PassThrough(), output = new PassThrough();
    let callId = 2; const evidence: string[] = [];
    const operations = [
      { name: 'apply_fixture_fix', arguments: { fixture_id: spec.fixture_id, fix_id: 'repair' } },
      { name: 'check_leftovers', arguments: { fixture_id: spec.fixture_id } },
      { name: 'verify_fixture', arguments: { fixture_id: spec.fixture_id } },
      { name: 'finish_with_evidence', arguments: { fixture_id: spec.fixture_id, evidence_ids: evidence } },
    ];
    const send = () => {
      const operation = operations.shift();
      if (!operation) { input.end(); return; }
      input.write(JSON.stringify({ jsonrpc: '2.0', id: callId++, method: 'tools/call', params: operation }) + '\n');
    };
    const lines = new Lines(M03.citationFetchTotalMax.value * 1024, (bytes) => {
      const response = JSON.parse(bytes.toString('utf8')) as { id: number; result: { content?: { text: string }[] } };
      if (response.id === 1) input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      else {
        const data = JSON.parse(response.result.content![0]!.text).data as { evidence_id: string; operation: string };
        if (['check_leftovers', 'verify_fixture'].includes(data.operation)) evidence.push(data.evidence_id);
      }
      send();
    });
    output.on('data', (bytes: Buffer) => lines.push(bytes));
    const running = relay({ id: 'a'.repeat(64), arm: spec.arm, run: spec.run_id, journal,
      docker: { executable: process.execPath, prefix: [fileURLToPath(new URL('./fake-docker.ts', import.meta.url)), directory] },
      env: { PATH: '/usr/bin:/bin', HOME: directory }, cwd: directory, input, output });
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stub', version: '1' } } }) + '\n');
    const exit = await running; journal.close();
    if (exit.code !== 0) process.exitCode = 4;
  }
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: mode === 'overbudget' ? M03.replayBuyerTokensMax.value : 2, output_tokens: 1, cached_input_tokens: 0 } }));
}
