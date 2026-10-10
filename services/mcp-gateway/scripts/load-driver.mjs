/**
 * Virtual users for load-test-gateway.mjs. Runs in a worker thread and reports latency samples.
 */
import http from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';

const { port, tokens, pageIds, vaultId, USERS, REQUESTS_PER_USER, THINK_MS, VARIED, PAGES, queries, topics } = workerData;

const queryFor = (n) =>
  !VARIED ? queries[n % queries.length] : n % 2 === 0 ? `acct${(n * 131) % PAGES} uniq${(n * 131) % PAGES}` : topics[n % 20];

const agent = new http.Agent({ keepAlive: true, maxSockets: USERS });
function callTool(token, name, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const started = performance.now();
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', agent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = performance.now() - started;
          let ok = res.statusCode === 200;
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            ok = ok && !json.error && !json.result?.isError;
          } catch {
            ok = false;
          }
          resolve({ ms, ok });
        });
      }
    );
    req.on('error', () => resolve({ ms: performance.now() - started, ok: false }));
    req.end(body);
  });
}

const samples = { search: [], get_page: [] };
let failures = 0;
await Promise.all(
  tokens.map(async (token, u) => {
    // Stagger arrivals so users with think time do not all fire on the same tick
    if (THINK_MS > 0) await new Promise((resolve) => setTimeout(resolve, Math.random() * THINK_MS));
    for (let r = 0; r < REQUESTS_PER_USER; r++) {
      if (THINK_MS > 0 && r > 0) await new Promise((resolve) => setTimeout(resolve, THINK_MS));
      const useSearch = (u + r) % 10 < 6; // 60% search, 40% get_page
      const result = useSearch
        ? await callTool(token, 'search', { query: queryFor(u * 31 + r), vault_id: vaultId, limit: 10 })
        : await callTool(token, 'get_page', { page_id: pageIds[(u * 97 + r * 13) % pageIds.length], vault_id: vaultId });
      if (!result.ok) failures++;
      samples[useSearch ? 'search' : 'get_page'].push(result.ms);
    }
  })
);
agent.destroy();
parentPort.postMessage({ samples, failures });
