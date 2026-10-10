/**
 * Opt-in load test for the MCP gateway (NFR-10, NFR-13).
 *
 * Boots the real gateway HTTP server against PostgreSQL, seeds an isolated open vault with real
 * encrypted pages, then drives it with concurrent virtual users over HTTP (auth, per-request access
 * resolution, rate limiting, audit and the tool handlers are all in the path).
 *
 * Usage (from services/mcp-gateway, after `pnpm build`):
 *   NODE_ENV=test node scripts/load-test-gateway.mjs
 * Environment:
 *   LOAD_PAGES (10000)  LOAD_USERS (200)  LOAD_REQUESTS_PER_USER (5)
 *   LOAD_THINK_MS (0)   Pause between one user's requests. 0 = every user fires continuously (worst case).
 *   SEARCH_CANDIDATE_INDEX=1  Measure the opt-in index-backed keyword search instead of the default.
 *   LOAD_CORPUS (repeated)  'repeated' = 10 documents repeated, so every query matches at least 10% of the
 *                           vault (worst case for search). 'varied' = every page has its own words, and half
 *                           the queries are specific and half broad.
 *
 * Search runs in lexical-only mode unless an embedding provider is configured, and the KMS is the test
 * mock, so the figures exclude embedding-API and cloud-KMS latency. Everything created is removed.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core';
import { eq, sql } from 'drizzle-orm';
import { McpGatewayServer } from '../dist/server.js';
import { OAuthValidator, InMemoryRevocationStore } from '../dist/auth/oauth.js';
import { PostgresOpenVaultStore } from '../dist/tools/postgres-store.js';
import { SlidingWindowRateLimiter } from '../dist/rate-limiting/index.js';

const PAGES = Number(process.env.LOAD_PAGES || 10000);
const USERS = Number(process.env.LOAD_USERS || 200);
const REQUESTS_PER_USER = Number(process.env.LOAD_REQUESTS_PER_USER || 5);
const THINK_MS = Number(process.env.LOAD_THINK_MS || 0);
const VARIED = process.env.LOAD_CORPUS === 'varied';
const topics = ['billing', 'onboarding', 'kubernetes', 'pricing', 'hiring', 'incident', 'roadmap', 'security', 'analytics', 'compliance',
  'migration', 'latency', 'contract', 'renewal', 'workshop', 'forecast', 'retention', 'gateway', 'sandbox', 'embedding'];
const BATCH = 500;
const TARGET_P95_MS = 500;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run a load test with NODE_ENV=production.');
  process.exit(1);
}

const corpus = [
  'PostgreSQL query execution plans indexing and vector distance operators for high throughput retrieval.',
  'Distributed consensus algorithms Raft and Paxos ensure strict serializability across quorum replicas.',
  'Envelope encryption with AES-256-GCM and cloud KMS prevents unauthorized plaintext exposure at rest.',
  'Kubernetes container orchestration service mesh and ingress routing with envoy sidecars.',
  'Continuous integration delivery pipelines automated verification and regression prevention gates.',
  'Model context protocol streaming transport tool registry dynamic permissions and RBAC enforcement.',
  'Machine learning feature stores embeddings inference optimization and GPU tensor acceleration.',
  'Full-text search ranking algorithms BM25 inverse document frequency and token normalization.',
  'Microservices reliability circuit breaking graceful degradation exponential backoff and bulkhead isolation.',
  'Zero-trust network architecture mutual TLS identity verification and ephemeral credential leasing.',
];
const queries = [
  'database indexing optimization', 'consensus algorithms raft', 'encryption KMS security', 'kubernetes service mesh',
  'continuous integration pipelines', 'model context protocol', 'machine learning inference', 'ranking algorithms',
  'microservices fault tolerance', 'zero trust credentials',
];

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

const queryFor = (n) =>
  !VARIED ? queries[n % queries.length] : n % 2 === 0 ? `acct${(n * 131) % PAGES} uniq${(n * 131) % PAGES}` : topics[n % 20];

const agent = new http.Agent({ keepAlive: true, maxSockets: USERS });
function callTool(port, token, name, args) {
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

const vaultId = crypto.randomUUID();
const owner = 'loadtest.owner@tkxel-vault.local';
const kms = new MockKmsProvider();
const dek = EnvelopeEncryption.generateDek();
const pageIds = [];
let server;

try {
  console.log(`=== MCP gateway load test: ${PAGES} pages, ${USERS} concurrent users x ${REQUESTS_PER_USER} requests, think time ${THINK_MS} ms, corpus ${VARIED ? 'varied' : 'repeated'} ===`);
  await db.insert(schema.vaults).values({
    id: vaultId, name: 'Load Test Vault', mode: 'open', owner_id: owner,
    data_key_id: await kms.wrapKey(dek), export_policy: 'allowed_for_owner',
  });

  const seedStart = Date.now();
  for (let i = 0; i < PAGES; i += BATCH) {
    const pageRows = [];
    const versionRows = [];
    const chunkRows = [];
    for (let j = 0; j < BATCH && i + j < PAGES; j++) {
      const index = i + j;
      const pageId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const text = VARIED
        ? `# Load Document ${index}\n\nNotes on ${topics[index % 20]} and ${topics[(index * 7 + 3) % 20]} for account acct${index} reviewed in session uniq${index}.`
        : `# Load Document ${index}\n\n${corpus[index % corpus.length]}`;
      pageIds.push(pageId);
      pageRows.push({ id: pageId, vault_id: vaultId, type: 'note', title: `Load Document ${index}`, tags: ['load'], aliases: [], front_matter: {}, current_version_id: versionId });
      versionRows.push({ id: versionId, page_id: pageId, number: 1, status: 'published', encrypted_blob: EnvelopeEncryption.encrypt(text, dek), created_by: owner });
      chunkRows.push({ page_id: pageId, version_id: versionId, position: 0, encrypted_text: EnvelopeEncryption.encrypt(text, dek), tsv_content: sql`to_tsvector('english', ${text})`, embedding: null });
    }
    await db.insert(schema.pages).values(pageRows);
    await db.insert(schema.versions).values(versionRows);
    await db.insert(schema.chunks).values(chunkRows);
  }
  console.log(`Seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s.`);
  // Refresh planner statistics after the bulk load, as autovacuum does continuously on a live system.
  // Set LOAD_SKIP_ANALYZE=1 to measure the state immediately after a bulk import instead.
  if (process.env.LOAD_SKIP_ANALYZE !== '1') {
    for (const table of ['pages', 'versions', 'chunks']) await db.execute(sql.raw(`ANALYZE ${table}`));
  }

  const oauth = new OAuthValidator(crypto.randomBytes(32).toString('hex'), new InMemoryRevocationStore());
  server = new McpGatewayServer({
    port: 0,
    oauthValidator: oauth,
    vaultStore: new PostgresOpenVaultStore(),
    accessResolver: async () => [{ vaultId, mode: 'open', role: 'reader' }],
    rateLimiter: new SlidingWindowRateLimiter({ open: { maxRequests: 1_000_000, windowMs: 3_600_000 } }),
    vaultNameResolver: async () => new Map([[vaultId, 'Load Test Vault']]),
  });
  const port = await server.listen(0);
  const tokens = Array.from({ length: USERS }, (_, u) => oauth.createToken({ userId: `load.user.${u}@tkxel.com`, email: `load.user.${u}@tkxel.com` }));

  // Warm-up
  await callTool(port, tokens[0], 'search', { query: queries[0], vault_id: vaultId });
  await callTool(port, tokens[0], 'get_page', { page_id: pageIds[0], vault_id: vaultId });

  const samples = { search: [], get_page: [] };
  let failures = 0;
  const wallStart = performance.now();
  await Promise.all(
    tokens.map(async (token, u) => {
      // Stagger arrivals so users with think time do not all fire on the same tick
      if (THINK_MS > 0) await new Promise((resolve) => setTimeout(resolve, Math.random() * THINK_MS));
      for (let r = 0; r < REQUESTS_PER_USER; r++) {
        if (THINK_MS > 0 && r > 0) await new Promise((resolve) => setTimeout(resolve, THINK_MS));
        const useSearch = (u + r) % 10 < 6; // 60% search, 40% get_page
        const result = useSearch
          ? await callTool(port, token, 'search', { query: queryFor(u * 31 + r), vault_id: vaultId, limit: 10 })
          : await callTool(port, token, 'get_page', { page_id: pageIds[(u * 97 + r * 13) % pageIds.length], vault_id: vaultId });
        if (!result.ok) failures++;
        samples[useSearch ? 'search' : 'get_page'].push(result.ms);
      }
    })
  );
  const wallSeconds = (performance.now() - wallStart) / 1000;
  const total = samples.search.length + samples.get_page.length;

  console.log('\n| Tool     | Requests | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |');
  console.log('|:---------|:--------:|:--------:|:--------:|:--------:|:--------:|');
  let pass = failures === 0;
  for (const tool of ['search', 'get_page']) {
    const s = percentiles(samples[tool]);
    pass = pass && s.p95 < TARGET_P95_MS;
    console.log(`| ${tool.padEnd(8)} | ${String(s.count).padStart(8)} | ${s.p50.toFixed(1).padStart(8)} | ${s.p95.toFixed(1).padStart(8)} | ${s.p99.toFixed(1).padStart(8)} | ${s.max.toFixed(1).padStart(8)} |`);
  }
  console.log(`\nThroughput: ${(total / wallSeconds).toFixed(0)} requests/s over ${wallSeconds.toFixed(1)}s; failures: ${failures}`);
  console.log(`Target p95 < ${TARGET_P95_MS} ms with ${USERS} concurrent users: ${pass ? 'PASS' : 'FAIL'}`);
  process.exitCode = pass ? 0 : 1;
} finally {
  if (server) await server.close().catch(() => {});
  agent.destroy();
  try {
    await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultId)); // cascades pages, versions, chunks
    console.log('Cleanup completed.');
  } catch (err) {
    console.error('Cleanup failed; remove vault manually:', vaultId, err?.message);
  }
  await pool.end();
}
