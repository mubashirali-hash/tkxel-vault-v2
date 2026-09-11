import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownChunker } from '../dist/search/chunker.js';
import { HybridSearchEngine } from '../dist/search/hybrid.js';

test('Markdown Chunker: segments documents preserving headers and sliding overlap', () => {
  const chunker = new MarkdownChunker({ maxWordsPerChunk: 10, overlapWords: 3 });
  const markdown = `
# Introduction
The quick brown fox jumps over the lazy dog repeatedly until the sentence is very long.

# Architecture
Next section detailing microservices and distributed database caching mechanisms.
`;

  const chunks = chunker.chunk(markdown);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].content.includes('## Introduction'));
  assert.ok(chunks[chunks.length - 1].content.includes('## Architecture'));
});

test('Hybrid Search: Reciprocal Rank Fusion fuses BM25 and Vector rankings', () => {
  const engine = new HybridSearchEngine(60);

  const bm25Results = [
    { id: 'doc_1', pageId: 'pg_1', title: 'Doc One', content: 'content 1', score: 10.5, source: 'bm25' },
    { id: 'doc_2', pageId: 'pg_2', title: 'Doc Two', content: 'content 2', score: 8.2, source: 'bm25' },
  ];

  const vectorResults = [
    { id: 'doc_2', pageId: 'pg_2', title: 'Doc Two', content: 'content 2', score: 0.95, source: 'vector' },
    { id: 'doc_3', pageId: 'pg_3', title: 'Doc Three', content: 'content 3', score: 0.88, source: 'vector' },
  ];

  const fused = engine.fuseResults(bm25Results, vectorResults, 5);

  // doc_2 appeared in both top ranks -> should rank first in RRF!
  assert.equal(fused[0].id, 'doc_2');
  assert.equal(fused[0].source, 'hybrid');
  assert.ok(fused[0].score > fused[1].score);
});

test('Context Aggregator: assembles 1-hop neighborhood into Markdown prompt bundle', () => {
  const engine = new HybridSearchEngine();

  const bundle = engine.assembleContextBundle({
    targetPage: {
      id: 'pg_core',
      title: 'Core Engine',
      content: 'Core logic coordinates modules.',
      tags: ['system', 'backend'],
    },
    outboundPages: [
      { pageId: 'pg_db', title: 'Database Schema', content: 'Postgres schema details.' },
    ],
    backlinkPages: [
      { pageId: 'pg_api', title: 'API Gateway', content: 'Calls core engine.' },
    ],
  });

  assert.ok(bundle.assembledMarkdown.includes('# Context Hub: Core Engine'));
  assert.ok(bundle.assembledMarkdown.includes('**Tags:** #system #backend'));
  assert.ok(bundle.assembledMarkdown.includes('[[Database Schema]]'));
  assert.ok(bundle.assembledMarkdown.includes('[[API Gateway]]'));
  assert.ok(bundle.totalTokenEstimate > 0);
});
