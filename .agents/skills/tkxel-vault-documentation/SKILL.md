---
name: tkxel-vault-documentation
description: >-
  Author and maintain comprehensive documentation for tkxel Vault, including living architecture decision
  records (ADRs), API references, MCP schema documentation, database data dictionaries, developer runbooks,
  and end-user guides. Use whenever updating docs, syncing SRS/PRD changes, or recording design decisions.
---

# tkxel Vault: Technical Documentation & Architecture Scribe Skill

This skill guides the authoring and maintenance of all technical and product documentation for **tkxel Vault**, preserving fidelity with [tkxel_vault_SRS.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) and [tkxel_vault_PRD.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **Architecture Decision Records (ADRs)**:
   - Create and maintain ADRs in `docs/adr/` using the standard Nygard format:
     - `ADR-001: Selection of PostgreSQL + pgvector for Hybrid Search`
     - `ADR-002: AES-256-GCM Envelope Encryption per Vault with KMS`
     - `ADR-003: Anthropic MCP 2025-11-25 Streamable HTTP as Primary Remote Gateway`
     - `ADR-004: In-Memory Zero-Read Sandboxing for Locked Skills`
   - Structure: Context, Decision, Status (Proposed / Accepted / Superseded), Consequences.

2. **API & Protocol Specifications**:
   - Maintain full documentation for Remote MCP tools:
     - `search(query, vault_id, limit)`
     - `get_page(vault_id, title)`
     - `get_context(query, vault_ids, max_tokens)`
     - `run_skill(skill_id, user_prompt, inputs)`
     - `ask_vault(vault_id, question)`
     - `add_note(vault_id, title, content, tags)`
   - Document JSON-RPC error codes, OAuth 2.1 PKCE authorization handshakes, and token expiration handling.

3. **Data Dictionary & Schema Documentation**:
   - Maintain the database entity documentation for `Vault`, `Page`, `Version`, `Link`, `TimelineEntry`, `Chunk`, `Skill`, `Share`, `AuditEvent`.
   - Document encryption boundaries: which fields are ciphertext (`BYTEA`), which are hashed/indexed (`tsvector`, `vector(1536)`), and which remain plaintext metadata.

4. **Developer & Operator Runbooks**:
   - Local development setup (Docker compose for PostgreSQL + pgvector, mock KMS, OIDC emulator).
   - Deployment runbooks (AWS ECS / Kubernetes, TLS termination, KMS IAM role bindings).
   - Disaster recovery, key rotation, and audit log backup procedures.

5. **Markdown Wiki & End-User Guides**:
   - Author clear guides for knowledge workers:
     - How to write notes with `[[bidirectional-links]]` and tags `#tag`.
     - How to configure an Open Vault vs. a Locked Skill Vault.
     - How to connect Claude.ai custom connector to the remote MCP Gateway.
