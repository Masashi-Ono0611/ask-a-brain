// Local mock Responses endpoint: records the exact request body (incl. tools) Codex would send to a model.
const http = require('node:http'), fs = require('node:fs');
const out = process.argv[2];
let n = 0;
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    fs.appendFileSync(out, JSON.stringify({ n: ++n, method: req.method, url: req.url, headers: Object.keys(req.headers), body }) + '\n');
    if (req.method === 'POST' && req.url.includes('responses')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const id = 'resp_mock_' + n;
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
      ev('response.created', { response: { id } });
      ev('response.output_item.done', { item: { type: 'message', role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'ok' }] } });
      ev('response.completed', { response: { id, usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } });
      res.end();
    } else { res.writeHead(404); res.end(); }
  });
}).listen(Number(process.argv[3]), '127.0.0.1');
