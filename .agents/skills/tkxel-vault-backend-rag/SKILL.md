 ---
name: tkxel-vault-backend-rag
description: >-
  Implement and optimize the tkxel Vault backend storage service, PostgreSQL with pgvector,
  GBrain fork adaptation, bidirectional link graph indexing, hybrid search (BM25 + semantic),
  and smart context assembly (get_context). Use whenever working on database schemas, vector
  embeddings, indexing pipelines, or RAG retrieval logic.
---

# tkxel Vault: Backend, Knowledge Graph & RAG Skill

This skill guides the implementation of the **Vault Backend Service & Retrieval Engine** as defined in the [SRS](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) ([FR-20 to FR-24, Section 6]) and [PRD](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **GBrain Fork & Adaptation (`Section 7`)**:
   - Fork and adapt the MIT-licensed **GBrain** repository (`github.com/garrytan/gbrain`).
   - Retain its core markdown-as-source-of-truth storage and PostgreSQL data layer.
   - Extend with: multi-tenant vault boundaries, per-vault encryption, SSO role validation, locked vault segregation, and audit logging.

2. **Data Model & PostgreSQL + pgvector (`Section 6`)**:
   - Implement relational tables: `Vault`, `Page`, `Version`, `Link`, `TimelineEntry`, `Chunk`, `Skill`, `Share`, `AuditEvent`.
   - Configure `pgvector` extension for storing 768/1536-dimensional embeddings for page chunks.
   - Build indexing for full-text search using PostgreSQL `tsvector` / GIN indices (BM25 or PostgreSQL native ts_rank).

3. **Hybrid Search Pipeline (`FR-20` to `FR-23`, `NFR-10`)**:
   - Combine lexical BM25 scores with dense cosine similarity vector scores via Reciprocal Rank Fusion (RRF).
   - Enforce database-level ACL filtering: **Never** return chunks or snippets from vaults where the caller lacks read permissions (`FR-23`).
   - Performance benchmark: Total query response under 500 ms at p95 across 10,000 pages (`NFR-10`).
   - Ensure near-real-time index updates within **30 seconds** of page save or publication (`FR-22`).

4. **Smart Context Assembly Tool (`get_context`) (`Section 5.1`)**:
   - Implement greedy or relevance-ranked context packing:
     1. Retrieve top $K$ chunks from hybrid search.
     2. Expand 1-hop graph neighbors using the `Link` table.
     3. Deduplicate pages and assemble clean Markdown bodies.
     4. Enforce strict `max_tokens` limits (default: 4,000 tokens) using token counters (e.g., `tiktoken` or Claude tokenizer).

5. **Link Graph Engine (`FR-10` to `FR-12`, `FR-16`)**:
   - On page save/publish: Parse all `[[target_page]]` tokens via AST or regex.
   - Update `Link` records (`from_page_id`, `to_page_id`, `resolved`).
   - When a page is renamed, execute transactional updates across all markdown files referencing the old title.

## Database Schema (PostgreSQL DDL Reference)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE vaults (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    mode VARCHAR(32) NOT NULL CHECK (mode IN ('open', 'locked')),
    owner_id VARCHAR(255) NOT NULL,
    data_key_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL DEFAULT 'note',
    title VARCHAR(255) NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    front_matter JSONB DEFAULT '{}',
    current_version_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version_id UUID NOT NULL,
    position INT NOT NULL,
    encrypted_text BYTEA NOT NULL,
    tsv_content TSVECTOR,
    embedding VECTOR(1536)
);
CREATE INDEX idx_chunks_tsv ON chunks USING GIN(tsv_content);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```
