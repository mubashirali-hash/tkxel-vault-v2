# ADR-018: Cross-Vault Link Policy and Graph Integrity

## Status
Accepted (Epic 6 Chunk 6.3)

## Date
2026-09-17

## Context
tkxel Vault combines an Enterprise Context Hub (Markdown Knowledge Graph with bidirectional `[[wiki-links]]`) and a Zero-Read Locked Skills Store.
When pages are moved between vaults, or across security boundaries (Open vs. Locked vaults), link graph relationships present significant security, privacy, and integrity challenges:
1. **Cross-Vault Information Disclosure:** If a link in Vault A resolves to a page in Vault B, querying the graph, backlinks, or context in Vault A could expose the existence, title, ID, or content of notes in Vault B.
2. **Zero-Read Invariant for Locked Vaults (Invariant 1 & Invariant 2):** Locked vaults permit zero raw content inspection and zero graph metadata disclosure. Exposing link relationships or backlink counts from a locked vault to an open vault constitutes a confidential metadata leak.
3. **Markdown Text Immutability:** Page versions represent an append-only, cryptographically signed/encrypted record of author intent. When a page moves across vaults, re-encrypting its version ciphertext with the destination vault's DEK is required, but rewriting the verbatim Markdown body (e.g. modifying wiki-link syntax) corrupts author history and invalidates integrity hashes.
4. **Naming Collisions & Ambiguity:** If a page moved into a destination vault shares a title or alias with an existing destination page, link resolution becomes ambiguous.

---

## Decision

### 1. Resolved Links Strictly Vault-Local (Absolute Invariant)
- **Same-Vault Enclosure:** Any link record with `resolved = true` and a non-null `to_page_id` MUST satisfy:
  $$\text{from\_page.vault\_id} = \text{to\_page.vault\_id}$$
- No resolved edge may span across different vaults under any circumstance.
- Database queries across all surfaces (REST API `GET /api/vaults/:vaultId/links`, MCP Gateway `get_links`, MCP `get_page` backlinks, Context Assembler `getContext`) must defensively join both `from_page_id` and `to_page_id` to `pages.vault_id = :vaultId` with `resolved = true`.

### 2. Ghost Links for Unresolved or Cross-Vault Targets
- When a page contains a wiki-link `[[Target]]` whose target does not exist, exists in another vault, or matches multiple candidate pages (ambiguity) within the current vault:
  - The link is stored as an **unresolved ghost link**: `to_page_id = null`, `resolved = false`.
  - The original `raw_target` and `link_type` are preserved.
  - Ghost links allow the UI to render ghost nodes (visualized as dashed placeholders in graph view) without granting access or leaking cross-vault data.

### 3. Atomic Page Movement & Link Reconciliation Lifecycle
When `movePage` moves a page $P$ from $\text{Vault}_{\text{source}}$ to $\text{Vault}_{\text{dest}}$:

#### A. Title & Alias Collision Fail-Closed
- Before executing any state change or cryptographic re-encryption, the destination vault is checked for pages sharing any normalized (case-insensitive) title or alias with $P$.
- If a collision exists, the operation aborts and throws `VaultValidationError` (mapped to HTTP 400), returning a generic validation error without disclosing confidential destination metadata.

#### B. Open $\to$ Open Movement
1. **Outgoing Links from $P$:**
   - Cleared from `links` table.
   - Re-parsed from $P$'s latest plaintext content and re-resolved strictly against pages in $\text{Vault}_{\text{dest}}$.
   - Unique match $\implies$ `to_page_id = target.id, resolved = true`.
   - Missing or ambiguous ($\ge 2$ matches) $\implies$ ghost link (`to_page_id = null, resolved = false`).
2. **Inbound Source Links (pointing to $P$ from $\text{Vault}_{\text{source}}$):**
   - Because $P$ has left $\text{Vault}_{\text{source}}$, source links can no longer point to $P$.
   - For each link, $\text{Vault}_{\text{source}}$ is checked for an alternative page uniquely matching `raw_target`.
   - If a unique alternative exists $\implies$ re-point `to_page_id = alternative.id, resolved = true`.
   - Otherwise $\implies$ convert to ghost link (`to_page_id = null, resolved = false`).
3. **Existing Unresolved Destination Links:**
   - Any unresolved ghost links in $\text{Vault}_{\text{dest}}$ matching $P$'s title or aliases become resolved (`to_page_id = P.id, resolved = true`).

#### C. Open $\to$ Locked Movement
1. **Zero Graph Metadata:** All outgoing link rows for $P$ are permanently deleted. Locked vaults maintain zero link graph rows.
2. **Inbound Source Links:** Re-resolve to alternative source page or convert to ghost links. Zero trace of $P$'s destination or new state is leaked.

#### D. Transactional Invariant & Rollback
- Page version re-encryption, chunk index lifecycle, page record updates, link reconciliation, and audit event emission execute inside a single atomic PostgreSQL transaction (`db.transaction`).
- Defensive verification queries assert zero cross-vault resolved links and zero locked-vault links before transaction commit.
- Any error triggers a complete rollback to the source vault state.

### 4. Structural Database Enforcement & Authoritative Indexer Hardening
- **Deferred Constraint Triggers (`services/vault-core/src/schema/link-invariants.sql` / `link-invariants.ts`):**
  - `trg_links_enforce_invariants`: Runs at commit (`DEFERRABLE INITIALLY DEFERRED`) to reject any `resolved = true` link with `to_page_id IS NULL`, links originating from locked vaults, or cross-vault links (`from_page.vault_id != to_page.vault_id`).
  - `trg_pages_enforce_link_invariants`: Rejects page `vault_id` updates that would leave cross-vault links or links originating from locked vaults.
  - `trg_vaults_enforce_link_invariants`: Rejects vault `mode = 'locked'` updates when outgoing links exist.
  - `trg_links_before_update_fn`: Automatic BEFORE UPDATE trigger converting links to unresolved ghost links (`resolved = false`) when target pages are deleted (`ON DELETE SET NULL`).
- **Table CHECK Constraint:**
  - `links_resolved_has_target`: Enforces `(NOT resolved) OR (to_page_id IS NOT NULL)` at row level.
- **Authoritative Indexer Hardening (`LinkGraphIndexer`):**
  - `updateLinksForPage` and `resolveIncomingGhostLinks` execute inside transactions under row lock (`lockPageForMutation`).
  - Authoritative vault ID, titles, aliases, and modes are derived directly from the locked PostgreSQL row; caller-supplied vault IDs are treated only as assertions (mismatch throws generic `not_found`).
  - Ghost links are resolved strictly where `pages.vault_id = authoritativeVaultId`. Foreign targets never become `to_page_id`.
- **Pre-Mutation Collision Check:**
  - Collision preflight runs before KMS DEK unwrap (`kms.unwrapKey`), ciphertext re-encryption, or database mutations, throwing generic `VaultValidationError` without disclosing destination page metadata. Zero mutation to versions, chunks, pages, links, or audit events.

---

## Consequences

### Positive
- **Guaranteed Isolation:** Cross-vault leakage via graph edges, backlinks, or context expansion is structurally impossible.
- **Markdown Fidelity:** Markdown content remains byte-for-byte identical; links dynamically re-bind based on vault context.
- **Zero-Read Protection:** Locked vaults remain completely opaque with zero link metadata.
- **Resilient Navigation:** Broken or cross-vault references cleanly degrade to ghost links and automatically revive if matching notes are created or moved into the vault.

### Negative / Trade-offs
- Wiki-links between notes in separate vaults do not create clickable cross-vault traversals; they remain ghost links. Users who require unified graphs must place related notes within the same vault or use explicit workspace references.
