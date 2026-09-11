# tkxel Vault: Project Agent Guidelines & System Invariants

This document defines the architectural rules, security invariants, and persona delegation protocols for all AI agents working on the **tkxel Vault** codebase.

---

## 1. Project Overview & References
- **Domain:** Enterprise Context Hub (Markdown Knowledge Graph) & Zero-Read Locked Skills Store.
- **Authoritative Specifications:**
  - Technical Requirements: [tkxel_vault_SRS.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md)
  - Product Vision & Roadmaps: [tkxel_vault_PRD.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md)

---

## 2. Core Architectural Invariants (Non-Negotiable)

### Invariant 1: Vault Isolation & Mode Segregation
- Every page and skill belongs to **exactly one vault**.
- **Open Vaults:** Readable and searchable by assigned Readers. Exposes retrieval tools (`search`, `get_page`, `get_links`, `get_context`, `add_note`).
- **Locked Vaults:** Zero-read protection. Consumers can only run skills (`run_skill`) and ask high-level questions (`ask_vault`). Never expose raw markdown, file listings, or directory structures.
- **Denial Messages:** Always return generic `not_allowed` or `not_found` errors without disclosing whether a requested resource exists.

### Invariant 2: Cryptographic Zero-Trust
- All content encrypted at rest with **AES-256-GCM**.
- Exactly **one unique data encryption key per vault**, wrapped by AWS KMS or Azure Key Vault master keys.
- Encryption keys must **never** be written to persistent disk or emitted in logs.
- In-memory decryption only for locked skill execution, immediately discarded after execution.

### Invariant 3: Model Context Protocol (MCP) Standard Compliance
- Remote MCP Gateway must strictly adhere to the Anthropic MCP specification (version 2025-11-25) using **Streamable HTTP**.
- Dynamic tool filtering: The tool catalog returned to Claude must be computed dynamically per call based on active SSO OAuth 2.1 PKCE claims.

---

## 3. Specialized Agent Directory

When performing specific tasks in this repository, consult and follow the corresponding specialized skill and agent specification:

| Role | Domain / Focus Area | Skill Location | Agent Specification |
| :--- | :--- | :--- | :--- |
| **Orchestrator & Master Planner** | Work Breakdown, Multi-Agent Sequencing, PRD Roadmaps, Invariants | `.agents/skills/tkxel-vault-orchestration-planner/` | `.agents/agents/orchestrator_planner_agent.md` |
| **Documentation & Scribe Lead** | ADRs, SRS/PRD Sync, API Specs, Data Dictionaries, User Runbooks | `.agents/skills/tkxel-vault-documentation/` | `.agents/agents/docs_technical_writer_agent.md` |
| **Frontend Lead** | WYSIWYG Editor, `[[link]]` Pickers, D3/Cytoscape Knowledge Graph | `.agents/skills/tkxel-vault-frontend-graph/` | `.agents/agents/frontend_graph_agent.md` |
| **Backend & RAG Lead**| PostgreSQL + `pgvector`, GBrain Fork, BM25 Hybrid Search, Context RAG | `.agents/skills/tkxel-vault-backend-rag/` | `.agents/agents/backend_rag_agent.md` |
| **MCP Gateway Lead** | Remote MCP Server (HTTP Streamable), Claude Custom Connector, OAuth 2.1 | `.agents/skills/tkxel-vault-mcp-gateway/` | `.agents/agents/mcp_gateway_agent.md` |
| **Security & Crypto Lead**| AES-256-GCM Envelope Encryption, Cloud KMS, OIDC SSO, Audit Logs | `.agents/skills/tkxel-vault-security-crypto/` | `.agents/agents/security_crypto_agent.md` |
| **Runtime & DevOps Lead** | Zero-Read Skill Runner, Container Sandboxing, Rate Limiting, CI/CD | `.agents/skills/tkxel-vault-runtime-sandbox/` | `.agents/agents/runtime_sandbox_agent.md` |
| **Red Team & QA Lead** | Adversarial Prompt Injection Defense, Zero-Exfiltration Pen Testing | `.agents/skills/tkxel-vault-qa-redteam/` | `.agents/agents/qa_redteam_agent.md` |
| **Project Memory & Gap Advisor** | Living Project Ledger, Agent Gap Analysis, Auto-Suggestion Engine | `.agents/skills/tkxel-vault-memory-advisor/` | `PROJECT_MEMORY.md` |

---

## 4. Coding & Implementation Guidelines
1. **Never mock security boundaries:** All access checks must be executed server-side per request, never trusting client-side claims.
2. **Preserve Markdown fidelity:** Markdown parsers must retain YAML front matter, tags, and wiki-links (`[[page]]`) without stripping or mangling syntax.
3. **Audit everything:** Every state-modifying action and tool call must produce an append-only audit event.

---

## 5. Dynamic Project Memory & Automatic Agent Suggestion Protocol

To prevent architectural drift and ensure that all emerging technical domains are owned by domain specialists, tkxel Vault utilizes a **living project memory** and **agent gap detection protocol**:

1. **Living Ledger ([PROJECT_MEMORY.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/PROJECT_MEMORY.md)):**
   - Maintained by all agents and orchestrated by the Master Planner.
   - Records current milestone progress, architecture decisions, active agent rosters, and system invariants.
2. **Continuous Gap Detection:**
   - Whenever an upcoming task, backlog item, or PR introduces domains outside the existing agent charters (e.g., Cloud SRE / Kubernetes, Compliance & Privacy Audits, Desktop/Mobile Clients, ETL/Data Migration, Billing Telemetry), the system proactively suggests chartering a new specialized agent.
   - Automated evaluation can be executed via:
     ```powershell
     python .agents/scripts/check_agent_coverage.py --query "<task description>"
     ```
3. **Automatic Suggestion Format:**
   When suggesting a new agent, provide the user with:
   - **Agent Name & Role:** e.g., `cloud_sre_agent.md` (Cloud Infrastructure & SRE Lead).
   - **Reason for Suggestion:** Domain gap or milestone trigger.
   - **Proposed Specification & Skill:** Draft markdown file paths and skill definitions.
