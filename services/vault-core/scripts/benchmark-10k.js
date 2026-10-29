/**
 * Opt-In 10,000-Page Performance Benchmark for tkxel Vault
 * Measures p50, p95, p99 latencies for Lexical, Semantic, and Hybrid RAG retrieval
 * against the live PostgreSQL/pgvector database.
 * Target: p95 latency < 500ms.
 * Guarantees zero residual data through strict transactional/cascading cleanup.
 */

import crypto from 'node:crypto';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { searchPages } from '../dist/search/index.js';
import { EMBEDDING_DIMENSION } from '../dist/search/embedding-provider.js';

const TOTAL_PAGES = 10000;
const BATCH_SIZE = 500;
const BENCHMARK_QUERIES_PER_MODE = 20;

function calculatePercentiles(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p90 = sorted[Math.floor(sorted.length * 0.90)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { min, mean, p50, p90, p95, p99, max };
}

async function runBenchmark() {
  console.log('=== tkxel Vault 10,000-Page Search Performance Benchmark ===');
  console.log(`Configured pages: ${TOTAL_PAGES}, Batch size: ${BATCH_SIZE}`);

  const benchmarkVaultId = crypto.randomUUID();
  const ownerId = 'benchmark.10k@tkxel-vault.local';
  const dummyDek = Buffer.alloc(32, 7);
  let cleanupError = null;

  // Pre-generate 10 normalized 1536-dimensional vectors
  const sampleVectors = Array.from({ length: 10 }, (_, seed) => {
    const vec = new Array(EMBEDDING_DIMENSION).fill(0.0001);
    vec[(seed * 113) % EMBEDDING_DIMENSION] = 1.0;
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return vec.map((v) => v / norm);
  });

  const sampleCorpus = [
    'PostgreSQL query execution plans indexing and vector distance operators for high throughput retrieval.',
    'Distributed consensus algorithms Raft and Paxos ensure strict serializability across quorum replicas.',
    'Envelope encryption with AES-256-GCM and cloud KMS prevents unauthorized plaintext exposure at rest.',
    'Kubernetes container orchestration service mesh and ingress routing with envoy sidecars.',
    'Continuous integration delivery pipelines automated verification and regression prevention gates.',
    'Model context protocol streaming transport tool registry dynamic permissions and RBAC enforcement.',
    'Machine learning feature stores embeddings inference optimization and GPU tensor acceleration.',
    'Full-text search ranking algorithms BM25 ts_rank_cd inverse document frequency and token normalization.',
    'Microservices reliability circuit breaking graceful degradation exponential backoff and bulkhead isolation.',
    'Zero-trust network architecture mutual TLS identity verification and ephemeral credential leasing.'
  ];

  const benchmarkProvider = {
    name: 'benchmark-provider',
    dimension: EMBEDDING_DIMENSION,
    async generateEmbedding(text) {
      const hash = (text || '').split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 10, 0);
      return sampleVectors[Math.abs(hash)];
    },
    async generateEmbeddings(texts) {
      return Promise.all(texts.map((t) => this.generateEmbedding(t)));
    },
  };

  const seedStartTime = Date.now();

  try {
    console.log('\n[1/4] Creating isolated benchmark vault...');
    await db.insert(schema.vaults).values({
      id: benchmarkVaultId,
      name: 'Benchmark 10K Performance Vault',
      mode: 'open',
      owner_id: ownerId,
      data_key_id: dummyDek,
      export_policy: 'strictly_forbidden',
      created_at: new Date(),
    });

    console.log(`[2/4] Seeding ${TOTAL_PAGES} pages with versions and 1536d chunks...`);
    for (let i = 0; i < TOTAL_PAGES; i += BATCH_SIZE) {
      const pageRows = [];
      const versionRows = [];
      const chunkRows = [];

      for (let j = 0; j < BATCH_SIZE && i + j < TOTAL_PAGES; j++) {
        const index = i + j;
        const pageId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        const corpusIndex = index % sampleCorpus.length;
        const text = `Document ${index}: ${sampleCorpus[corpusIndex]}`;
        const vec = sampleVectors[corpusIndex];

        pageRows.push({
          id: pageId,
          vault_id: benchmarkVaultId,
          type: 'note',
          title: `Benchmark Document ${index}`,
          tags: ['benchmark', `corpus-${corpusIndex}`],
          current_version_id: versionId,
          created_at: new Date(),
          updated_at: new Date(),
        });

        versionRows.push({
          id: versionId,
          page_id: pageId,
          number: 1,
          status: 'published',
          encrypted_blob: Buffer.from(`cipher-${index}`),
          created_by: ownerId,
          created_at: new Date(),
        });

        chunkRows.push({
          id: crypto.randomUUID(),
          page_id: pageId,
          version_id: versionId,
          position: 0,
          encrypted_text: Buffer.from(`chunk-cipher-${index}`),
          tsv_content: sql`to_tsvector('english', ${text})`,
          embedding: vec,
        });
      }

      await db.insert(schema.pages).values(pageRows);
      await db.insert(schema.versions).values(versionRows);
      await db.insert(schema.chunks).values(chunkRows);

      if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= TOTAL_PAGES) {
        process.stdout.write(`  ... seeded ${Math.min(i + BATCH_SIZE, TOTAL_PAGES)} / ${TOTAL_PAGES} pages\n`);
      }
    }

    const seedDuration = ((Date.now() - seedStartTime) / 1000).toFixed(2);
    console.log(`Seeding complete in ${seedDuration}s.`);

    console.log('\n[3/4] Warming up search indices...');
    for (let w = 0; w < 5; w++) {
      await searchPages(benchmarkVaultId, 'database indexing', 10, {
        mode: 'hybrid',
        provider: benchmarkProvider,
      });
    }

    console.log('\n[4/4] Executing latency benchmarks across retrieval modes...');
    const queries = [
      'database indexing optimization',
      'consensus algorithms raft',
      'encryption KMS security',
      'kubernetes service mesh',
      'continuous integration pipelines',
      'model context protocol streaming',
      'machine learning inference acceleration',
      'ranking algorithms tsvector',
      'microservices fault tolerance',
      'zero trust ephemeral credentials',
    ];

    // 1. Lexical Benchmark
    const lexicalLatencies = [];
    for (let q = 0; q < BENCHMARK_QUERIES_PER_MODE; q++) {
      const query = queries[q % queries.length];
      const start = performance.now();
      const results = await searchPages(benchmarkVaultId, query, 10, { mode: 'lexical' });
      const elapsed = performance.now() - start;
      lexicalLatencies.push(elapsed);
    }
    const lexicalStats = calculatePercentiles(lexicalLatencies);

    // 2. Semantic Benchmark
    const semanticLatencies = [];
    for (let q = 0; q < BENCHMARK_QUERIES_PER_MODE; q++) {
      const query = queries[q % queries.length];
      const start = performance.now();
      const results = await searchPages(benchmarkVaultId, query, 10, {
        mode: 'semantic',
        provider: benchmarkProvider,
      });
      const elapsed = performance.now() - start;
      semanticLatencies.push(elapsed);
    }
    const semanticStats = calculatePercentiles(semanticLatencies);

    // 3. Hybrid RAG Benchmark
    const hybridLatencies = [];
    for (let q = 0; q < BENCHMARK_QUERIES_PER_MODE; q++) {
      const query = queries[q % queries.length];
      const start = performance.now();
      const results = await searchPages(benchmarkVaultId, query, 10, {
        mode: 'hybrid',
        provider: benchmarkProvider,
      });
      const elapsed = performance.now() - start;
      hybridLatencies.push(elapsed);
    }
    const hybridStats = calculatePercentiles(hybridLatencies);

    console.log('\n================== BENCHMARK RESULTS (10,000 Pages) ==================');
    console.log('| Mode     | Samples | Min (ms) | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) |');
    console.log('|:---------|:-------:|:--------:|:---------:|:--------:|:--------:|:--------:|:--------:|');
    console.log(`| Lexical  |   ${BENCHMARK_QUERIES_PER_MODE}    |   ${lexicalStats.min.toFixed(1).padStart(4)}   |   ${lexicalStats.mean.toFixed(1).padStart(5)}   |  ${lexicalStats.p50.toFixed(1).padStart(5)}   |  ${lexicalStats.p95.toFixed(1).padStart(5)}   |  ${lexicalStats.p99.toFixed(1).padStart(5)}   |  ${lexicalStats.max.toFixed(1).padStart(5)}   |`);
    console.log(`| Semantic |   ${BENCHMARK_QUERIES_PER_MODE}    |   ${semanticStats.min.toFixed(1).padStart(4)}   |   ${semanticStats.mean.toFixed(1).padStart(5)}   |  ${semanticStats.p50.toFixed(1).padStart(5)}   |  ${semanticStats.p95.toFixed(1).padStart(5)}   |  ${semanticStats.p99.toFixed(1).padStart(5)}   |  ${semanticStats.max.toFixed(1).padStart(5)}   |`);
    console.log(`| Hybrid   |   ${BENCHMARK_QUERIES_PER_MODE}    |   ${hybridStats.min.toFixed(1).padStart(4)}   |   ${hybridStats.mean.toFixed(1).padStart(5)}   |  ${hybridStats.p50.toFixed(1).padStart(5)}   |  ${hybridStats.p95.toFixed(1).padStart(5)}   |  ${hybridStats.p99.toFixed(1).padStart(5)}   |  ${hybridStats.max.toFixed(1).padStart(5)}   |`);
    console.log('======================================================================');

    console.log(`\nCriteria Check:`);
    console.log(`- Lexical p95:  ${lexicalStats.p95.toFixed(2)}ms (target < 500ms): ${lexicalStats.p95 < 500 ? 'PASS' : 'FAIL'}`);
    console.log(`- Semantic p95: ${semanticStats.p95.toFixed(2)}ms (target < 500ms): ${semanticStats.p95 < 500 ? 'PASS' : 'FAIL'}`);
    console.log(`- Hybrid p95:   ${hybridStats.p95.toFixed(2)}ms (target < 500ms): ${hybridStats.p95 < 500 ? 'PASS' : 'FAIL'}`);

    if (hybridStats.p95 >= 500 || semanticStats.p95 >= 500 || lexicalStats.p95 >= 500) {
      throw new Error(`Latency benchmark threshold exceeded: target p95 < 500ms`);
    }

  } catch (err) {
    console.error('Benchmark execution error:', err);
    throw err;
  } finally {
    console.log('\n[Cleanup] Purging 10,000 benchmark records and vault...');
    try {
      // Cascading delete through vault deletion
      await db.delete(schema.vaults).where(eq(schema.vaults.id, benchmarkVaultId));
      console.log('Cleanup completed successfully.');
    } catch (err) {
      cleanupError = err;
      console.error('CRITICAL: Benchmark cleanup failed:', err);
    }
  }

  if (cleanupError) {
    throw new Error(`Benchmark cleanup failed: ${cleanupError.message}`);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
