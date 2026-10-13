---
name: tkxel-vault-orchestration-planner
description: >-
  Plan, orchestrate, and coordinate cross-functional engineering initiatives across the tkxel Vault
  ecosystem. Formulate execution blueprints, sequence dependencies between specialized agents, enforce
  architectural invariants, and track delivery across PRD milestones. Use whenever starting complex tasks,
  architectural refactors, or cross-agent initiatives.
---

# tkxel Vault: Orchestration & Master Planning Skill

This skill guides the **Lead Technical Orchestrator** in breaking down, sequencing, and executing features across the specialized agent directory for tkxel Vault as defined in [tkxel_vault_SRS.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) and [tkxel_vault_PRD.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **Master Work Breakdown & Sequencing**:
   - Decompose user goals into discrete work streams aligned with the specialized agent matrix:
     - `backend_rag_agent`: Schemas, vector indexes, hybrid search, RAG context packing.
     - `security_crypto_agent`: KMS key wrapping, AES-256-GCM envelope encryption, SSO OAuth claims, audit trails.
     - `mcp_gateway_agent`: Remote MCP streamable HTTP endpoints, dynamic tool catalogs, Claude connector.
     - `runtime_sandbox_agent`: Zero-read skill runner, container sandboxing, timeout enforcement.
     - `frontend_graph_agent`: Tiptap/Milkdown WYSIWYG, link autocompletion, D3/Cytoscape 2D knowledge graph.
     - `docs_technical_writer_agent`: Living documentation, ADRs, schema reference, user guides.
     - `qa_redteam_agent`: Adversarial prompt injection testing, zero-exfiltration validation, automated regression suites.

2. **Dependency & Critical Path Mapping**:
   - Establish dependency topology:
     ```mermaid
     graph TD
         A[Security & KMS Key Envelope] --> B[Backend Storage & Schemas]
         B --> C[MCP Gateway & Remote Tools]
         B --> D[Frontend WYSIWYG & Graph]
         C --> E[Runtime Sandbox & Locked Runner]
         E --> F[QA Red Team Pen Testing]
         D --> F
         F --> G[Documentation & Scribe Sync]
     ```
   - Never dispatch UI or MCP tool consumers before backend database schemas and security boundaries are validated.

3. **Phase Gating & Milestone Control**:
   - Track progress strictly against PRD milestone criteria:
     - **Milestone 1 (MVP):** Markdown editor with `[[link]]`, SQLite/PostgreSQL storage, basic open vault search, local/remote MCP server with core tools (`search`, `get_page`, `get_context`).
     - **Milestone 2 (Zero-Read Skills & Locked Vaults):** AES-256-GCM encryption, Cloud KMS integration, locked vault isolation, `run_skill` runner, OIDC SSO with OAuth 2.1 PKCE.
     - **Milestone 3 (Enterprise Hardening):** D3/Cytoscape interactive graph, timeline versioning, multi-turn skill conversation, audit event log streaming, rate limiting.

4. **Continuous Invariant Auditing**:
   - **Vault Isolation:** Validate that locked vaults never expose raw markdown or directory structures to callers.
   - **Zero-Trust Encryption:** Confirm that plaintext keys never hit disk or application logs.
   - **Protocol Compliance:** Ensure remote MCP strictly adheres to Anthropic MCP 2025-11-25 Streamable HTTP.

5. **Agent Capability Gap Detection**:
   - When a requested initiative cannot be safely or cleanly delivered by current agent personas, trigger the **Memory Advisor** to register and propose a new specialized agent.
