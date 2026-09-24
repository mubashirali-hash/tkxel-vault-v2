# ADR-017: Searchable Encryption Boundaries and Multi-Tier Content Protection

## Status
Accepted (Explicitly approved by user on 2026-09-16)

## Date
2026-09-16

## Context
Following the security audit and senior review (F-03), tkxel Vault must reconcile cryptographic zero-trust storage invariants with database-level search capabilities across dual-mode vaults:
1. **The Conflict:** Full-text search (`tsvector`) and vector similarity (`pgvector`) in PostgreSQL require unencrypted mathematical representations or stemmed lexemes in database memory/indexes. Storing raw readable text derivatives in database columns (such as `chunks.tsv_content` containing raw sentences) or in browser `localStorage` contradicts ciphertext-only claims.
2. **Locked Vaults:** Under Invariant 1 (Mode Segregation) and Invariant 2 (Cryptographic Zero-Trust), locked vaults operate under strict Zero-Read protection. Consumers can only run sandboxed skills (`run_skill`) or ask executive questions (`ask_vault`). They never execute open search or retrieval.
3. **Open Vaults:** Open vaults are collaborative knowledge graphs where assigned readers and editors search notes via BM25 lexical ranking and semantic embeddings.
4. **Third-Party Exposure:** Calling external or hosted embedding APIs with locked content violates confidential data residency.

---

## The Open-Vault Leakage Tradeoff (Explicitly Approved)

The architecture establishes an explicit trade-off between database-native hybrid search efficiency and cryptographic leakage for **open vaults**:

1. **Lexical Leakage (`chunks.tsv_content`):**
   - In open vaults, PostgreSQL full-text search requires `tsvector` representations.
   - **What is leaked:** Storing `to_tsvector('english', chunk_text)` exposes normalized word stems/lexemes and their relative word positions (e.g., `'architectur':1 'encrypt':4 'secur':2`) to anyone with direct SQL read access to the PostgreSQL `chunks` table or database backups.
   - **What is protected:** Verbatim sentence structures, phrasing, punctuation, formatting, and non-stemmed syntax are not stored in `tsv_content`. Raw chunk text remains encrypted with AES-256-GCM in `chunks.encrypted_text`.
2. **Semantic Leakage (`chunks.embedding`):**
   - Dense vector retrieval requires 1536-dimensional floating point vectors in `chunks.embedding`.
   - **What is leaked:** A database observer can measure semantic proximity between documents or infer topic categories using cosine similarity against reference embeddings.
   - **What is protected:** High-dimensional embeddings cannot be directly inverted into the exact source text, and locked vault content is strictly forbidden from embedding generation.
3. **Alternative Considered (Fully Encrypted Client-Side / Oblivious Search):**
   - Completely encrypting search indexes (e.g., Blind Indexing, ORAM, or client-side homomorphic search) would eliminate database-level lexeme exposure, but introduces major latency penalties, eliminates PostgreSQL `pgvector` acceleration, and breaks server-side hybrid Reciprocal Rank Fusion (RRF).
4. **Explicit Approval Record:**
   - On 2026-09-16, the user explicitly approved this open-vault search tradeoff. Open vaults may store normalized lexical stems and numerical embeddings for authorized server-side hybrid search. These derivatives reveal vocabulary and semantic proximity to a direct database observer, but raw bodies and chunk text remain encrypted under the owning vault's DEK.
   - Locked vaults must continue to store **zero chunks, zero tsvectors, and zero embeddings**, with no hosted embedding calls.

---

## Decision

### 1. Locked Vault Indexing Prohibition (Absolute Invariant)
- **Zero Chunks, Zero Embeddings, Zero Tsvectors:** Locked vault pages and versions are encrypted at rest with AES-256-GCM into `versions.encrypted_content`. They are **never** decomposed into chunks, indexed into the `chunks` table, stemmed into `tsvector`, or converted into vector embeddings.
- **Prohibition on Hosted Embeddings:** Hosted embedding APIs must never receive locked-vault content. Skill execution and `ask_vault` decrypt encrypted blobs in-memory inside the ephemeral sandbox runner only.
- **Zero Raw Residue:** In raw PostgreSQL storage, inspecting tables (`vaults`, `pages`, `versions`, `chunks`, `links`, `skills`, `shares`, `audit_events`) for a locked vault reveals zero plaintext markdown content, zero canaries, and zero search artifacts.

### 2. Open Vault Indexing & Searchable Boundary
- **Encrypted Chunk Persistence:** In the `chunks` table, `chunks.encrypted_text` stores the chunk text encrypted under the owning vault's unique AES-256-GCM DEK.
- **Lexical Index:** `chunks.tsv_content` is restricted strictly to PostgreSQL `tsvector` representations (stemmed word lexemes with positional offsets) generated during publishing for open vaults. It never stores raw readable markdown or human-readable sentences.
- **Semantic Embeddings:** Embeddings (`chunks.embedding`) are generated solely for open vaults using an approved open-vault provider.
- **Fail-Closed Indexing:** In `publishVersion`, chunk indexing is mandatory for open vaults. If indexing fails, the publish operation fails closed and rolls back; it does not silently succeed with a partial or missing search index.
- **Best-Effort DEK Memory Hygiene:** When unwrapping DEKs in memory for cryptographic operations, `dek.fill(0)` is executed in a `finally` block.
  > [!NOTE]
  > Calling `dek.fill(0)` is a **best-effort defense-in-depth sanitization** of the primary allocated buffer. Because Node.js and the V8 runtime may create transient string or buffer copies during execution or garbage collection compaction, `dek.fill(0)` does not constitute a mathematical guarantee that zero transient memory copies remain in unmanaged process memory.

### 3. Client-Side Browser Storage & Token Security Policy
- **Prohibition on Plaintext Body Persistence:** The web application must never write decrypted `Page.content` or markdown bodies to `localStorage` or `sessionStorage`.
- **Zero Locked Vault Caching:** Locked vault metadata, skills, or answers must never be persisted to browser storage.
- **Metadata-Only Open Cache:** Local caching for offline sidebar responsiveness in open vaults is restricted to non-confidential structural metadata (`id`, `title`, `folder`, `tags`, `updated_at`).
- **Production Bearer-Token Storage:** Bearer tokens (`ssoToken`) must not reside in persistent `localStorage` in production. Production authentication tokens must be stored in session-scoped storage (`sessionStorage`) or in-memory React state, ensuring that tokens cannot linger in persistent offline browser storage across sessions.
- **Scrubbing Legacy Caches:** The client application clears legacy cache keys (`tkxel_vault_storage_v1`, `tkxel_vault_cache_*` containing body content) on startup.

---

## Consequences
- Guarantees that locked vaults have zero plaintext, chunk, or index exposure in the database or client storage.
- Reconciles PostgreSQL full-text and pgvector hybrid search for open vaults while ensuring all chunk text is encrypted under the owning vault's DEK.
- Open-vault lexical terms and semantic embeddings are stored in PostgreSQL indexes, which leaks word stems and semantic proximity to direct database observers; this tradeoff is explicit and documented.
- Eliminates client-side DevTools exposure of decrypted notes and long-lived tokens in browser `localStorage`.
