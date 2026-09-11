# ADR-001: Adoption of Custom-Built Secure tkxel Vault Platform and Exclusion of External Platform Dependencies

## Status
Accepted

## Date
2026-09-08

## Context
tkxel Vault requires a unified internal platform serving two distinct modes:
1. **Open Context Hub:** A collaborative, linked Markdown knowledge base where pages connect via wiki-links, tags, backlinks, and hybrid search.
2. **Locked Skills Store:** A zero-read protected vault where proprietary skills and confidential business playbooks can be executed by Claude without exposing underlying source code, prompt instructions, filenames, or directory structures.

Stakeholders asked whether existing tools (specifically Obsidian and GBrain) could be adopted as production platforms.

## Decision
1. **Custom Platform Development:** tkxel will build and own the complete tkxel Vault platform independently.
2. **Obsidian Exclusion:** Obsidian shall **not** be used as a production platform dependency. Obsidian Sync encrypts remote synchronization, but local files reside in readable format on users' physical devices, making zero-read enforcement and export prevention impossible. Obsidian is supported exclusively as an import format and UX reference.
3. **GBrain Exclusion:** The platform shall **not** use, fork, install, evaluate, or depend on GBrain. All Open Context Hub capabilities (Markdown handling, PostgreSQL + `pgvector` hybrid search, link graph indexing, and MCP retrieval) will be engineered natively by tkxel.
4. **tkxel Security Boundary:** All security-sensitive components—including vault isolation, AES-256-GCM envelope encryption with Cloud KMS, server-side authorization on every request, immutable audit logging, Streamable HTTP MCP gateway with OAuth 2.1 PKCE, and ephemeral container sandboxing—are custom-built and controlled by tkxel.

## Consequences
- **Positive:** Full ownership and control over data confidentiality, zero-read execution guarantees, and audit compliance. No technical debt from external prototypes.
- **Negative:** Requires independent engineering of the Open Context Hub storage and search pipelines (mitigated by clean PostgreSQL 16 + `pgvector` primitives).
