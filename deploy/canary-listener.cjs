// Synthetic lead-only listener on an isolated documentation subnet. No bodies,
// headers, tokens or client identifiers are logged. Never expose to host ports.
const http = require('node:http');
for (const port of [18081, 18082]) {
  let connections = 0;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('AAB_SYNTHETIC_LISTENER\n');
  });
  server.on('connection', () => { connections++; console.log(JSON.stringify({ port, connections })); });
  server.listen(port, '0.0.0.0');
}
