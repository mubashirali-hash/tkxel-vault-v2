import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownChunker } from '../dist/search/chunker.js';
import { HybridSearchEngine } from '../dist/search/hybrid.js';

/**
 * Deterministic local embedding generator (1536d) for offline / test execution.
 * Projects text tokens into normalized 1536-dimensional vector space.
 */
export function generateTestEmbedding(text, dim = 1536) {
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().match(/\w+/g) || [];
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) % dim;
    }
    vec[Math.abs(hash)] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

test('Hybrid RAG E2E: Markdown chunking and 1536d embedding generation', () => {
  const chunker = new MarkdownChunker({ maxChunkTokens: 100, overlapTokens: 20 });
  const sampleDoc = `---
title: Cryptographic Invariants
tags: [security, encryption]
---

# Architecture Security
The tkxel Vault relies on AES-256-GCM envelope encryption per vault.
Unwrapped data encryption keys (DEKs) are strictly kept in volatile RAM.

## Zero-Plaintext Storage
Every version written to disk is encrypted before persistence.
Plaintext content never hits the database or search index directly.

## Dynamic Tool Palette
Model Context Protocol dynamically computes authorized tools for Claude.`;

  const chunks = chunker.chunk(sampleDoc);
  assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);

  // Test embedding generation for each chunk
  for (const chunk of chunks) {
    assert.ok(chunk.content.length > 0);
    const embedding = generateTestEmbedding(chunk.content);
    assert.equal(embedding.length, 1536);
    // Verify L2 normalized
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(magnitude - 1.0) < 1e-4);
  }
});

test('Hybrid RAG E2E: Reciprocal Rank Fusion ranks semantic matches with distinct keywords', () => {
  const engine = new HybridSearchEngine(60);

  // BM25 results from keyword match
  const bm25Results = [
    { id: 'chunk_2', score: 0.95 }, // keyword hit
    { id: 'chunk_1', score: 0.60 },
  ];

  // Vector semantic search results
  const vectorResults = [
    { id: 'chunk_1', score: 0.98 }, // semantic hit
    { id: 'chunk_3', score: 0.85 },
  ];

  const fused = engine.fuseResults(bm25Results, vectorResults);
  assert.equal(fused.length, 3);
  // chunk_1 appears in both lists, so RRF gives it highest combined rank
  assert.equal(fused[0].id, 'chunk_1');
  assert.ok(fused[0].score > fused[1].score);
});

test('Hybrid RAG E2E: Context bundling packs 1-hop graph neighborhood within token budget', () => {
  const engine = new HybridSearchEngine();

  const bundle = engine.assembleContextBundle({
    targetPage: {
      id: 'p_main',
      title: 'KMS Key Management',
      content: 'Manages AWS KMS master keys and envelope wrapping for vault DEKs.',
      tags: ['security', 'kms'],
    },
    outboundPages: [
      {
        pageId: 'p_dest',
        title: 'AES-256-GCM Cryptography',
        content: 'Galois/Counter Mode provides authenticated encryption with 128-bit authentication tags.',
      },
    ],
    backlinkPages: [
      {
        pageId: 'p_ref',
        title: 'Audit Logging Invariants',
        content: 'All decryption and tool actions produce immutable audit entries.',
      },
    ],
    maxTokens: 2000,
  });

  assert.ok(bundle.assembledMarkdown.includes('Context Hub: KMS Key Management'));
  assert.ok(bundle.assembledMarkdown.includes('AES-256-GCM Cryptography'));
  assert.ok(bundle.assembledMarkdown.includes('Audit Logging Invariants'));
  assert.ok(bundle.totalTokenEstimate > 0 && bundle.totalTokenEstimate <= 2000);
});
