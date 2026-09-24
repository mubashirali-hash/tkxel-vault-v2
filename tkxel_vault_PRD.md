# Product Requirements Document (PRD)

# tkxel Vault: Enterprise Context Hub & Locked Skills Store

| Metadata | Details |
| :--- | :--- |
| **Document Version** | 1.0 (Ready for Executive Review) |
| **Document Status** | Approved for Execution |
| **Product Target Date** | Q4 2026 (Phase 1 MVP) |
| **Product Sponsor** | CEO / Executive Leadership |
| **Product Manager** | Product & Engineering Team (tkxel) |
| **Technical Reference** | [tkxel_vault_SRS.md](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) |

---

## 1. Executive Summary & Vision

### 1.1 Executive Summary
Modern consulting and engineering delivery at tkxel relies heavily on Large Language Models (specifically Anthropic Claude). While teams generate valuable domain knowledge, client notes, architecture patterns, and custom prompt workflows, this intellectual property (IP) is currently fragmented across isolated chats, personal downloads, and unorganized Google Drive folders. Furthermore, senior practice leads author proprietary delivery frameworks, proposal generators, and pricing models that they want junior or cross-functional staff to **utilize** through Claude, but **cannot safely distribute** due to risks of IP leakage, inadvertent sharing, or unmonitored export.

**tkxel Vault** solves both challenges in a unified, enterprise-grade platform combining:
1. **An Open Context Hub:** A hosted, encrypted, bi-directionally linked markdown repository (similar to an enterprise Obsidian or GBrain) that serves as tkxel’s living institutional memory, seamlessly accessible to Claude during everyday work.
2. **A Locked Skills Store:** A novel zero-read execution runtime allowing staff to execute high-value proprietary skills and ask domain questions via Claude.ai without ever exposing, downloading, or reading the underlying prompts, scripts, or reference files.

### 1.2 Vision Statement
> *"To establish tkxel Vault as the single source of institutional intelligence and secured execution for all AI-augmented delivery, making our company context instantly actionable for every consultant while guaranteeing zero leakage of our most valuable intellectual property."*

---

## 2. Problem Statement & Strategic Opportunity

### 2.1 Current State & Pain Points

```
[ Current Dispersed Reality ]
+-------------------+     +---------------------+     +--------------------+
| Individual Claude |     | Google Drive / Docs |     | Local Obsidian / MD|
| Chats (Siloed)    |     | (Unlinked, Stale)   |     | (Single-user only) |
+-------------------+     +---------------------+     +--------------------+
         |                           |                          |
         v                           v                          v
  Context Loss               Stale Documentation          No Secure Sharing
  Repeated Prompts           No Graph Discovery           No Access Governance
```

1. **Context Fragmentation & Knowledge Amnesia:**
   Valuable research, client historical background, and architecture decisions documented in markdown remain trapped on individual workstations or scattered across chats. When a new consultant joins an account, they start from zero context.
2. **The "Share vs. Protect" IP Paradox:**
   tkxel’s most valuable assets—bespoke delivery methodologies, estimation rubrics, and automated audit prompts—cannot be safely distributed. Existing solutions (like raw Claude Project instructions or shared git repositories) give full read-and-export permissions to whoever can run them.
3. **Friction in Tooling Adoption:**
   Consultants resist adopting new proprietary portals or complex web interfaces. If an enterprise knowledge tool requires leaving Claude.ai, adoption plunges.

### 2.2 Desired Future State (The Opportunity)

```
[ tkxel Vault Unified Architecture ]
+-----------------------------------------------------------------------------+
|                                tkxel Vault                                  |
|                                                                             |
|   +-----------------------+                    +------------------------+   |
|   |   Open Vaults         |                    |   Locked Vaults        |   |
|   |   (Context Hub)       |                    |   (Protected IP Store) |   |
|   |                       |                    |                        |   |
|   | • Linked Markdown     |                    | • Proprietary Skills   |   |
|   | • Bi-directional Graph|                    | • Pricing & Playbooks  |   |
|   | • Hybrid Search / RAG |                    | • Fixed Input Schemas  |   |
|   +-----------+-----------+                    +------------+-----------+   |
|               |                                             |               |
|               |  Read & Search Context                      |  Execute Only |
|               +----------------------+----------------------+               |
|                                      |                                      |
|                                      v                                      |
|                        [ Remote MCP Gateway ]                               |
|                  (OAuth 2.1 + PKCE / tkxel SSO)                             |
+--------------------------------------+--------------------------------------+
                                       |
                                       v
                     +-----------------------------------+
                     | Claude.ai (Web / Desktop / Mobile)|
                     |    Single Org Connector           |
                     +-----------------------------------+
```

With tkxel Vault:
- **Instant Institutional Context:** Claude automatically queries the Vault when asked questions like *"What is our architecture standard for Client X?"*, retrieving synthesized answers with linked citations.
- **Protected Execution:** Consultants can run `/case_study` or `/pricing_estimator` inside Claude without having access to inspect or leak the internal logic.
- **Native Experience:** Zero context-switching. The entire system surfaces via an Anthropic Remote Model Context Protocol (MCP) connector inside Claude.ai.

---

## 3. Product Goals & Success Metrics (KPIs)

### 3.1 Primary Business Objectives
- **Accelerate Delivery Velocity:** Cut consultant onboarding and research time by 40% across key accounts.
- **Protect Core Enterprise IP:** Enable 100% centralized, audited control over proprietary delivery skills with zero source exfiltration.
- **Drive Effortless AI Adoption:** Eliminate tool-switching friction by embedding the Vault directly into the Claude.ai desktop, web, and mobile clients.

### 3.2 Key Performance Indicators (KPIs)

| Metric | Baseline | Target (90 Days Post-Launch) | Verification Source |
| :--- | :--- | :--- | :--- |
| **Weekly Active Users (WAU)** | 0 | > 75% of delivery & consulting staff | MCP Gateway Auth Logs |
| **Open Vault Query Latency** | N/A | p95 < 500ms for retrieval across 10,000 pages | Gateway Telemetry |
| **Locked Skill Execution Overhead** | N/A | p95 < 2s (excluding Claude API processing) | Skill Runner Metrics |
| **IP Exfiltration Incidents** | N/A | **Zero (0)** unauthorized exposures of locked assets | Security Audit & Pen Tests |
| **Knowledge Graph Connectivity** | 0 | > 85% of vault pages linked to >= 2 other pages | Vault Knowledge Graph Index |
| **Authoring Productivity** | ~30 mins | < 5 minutes to publish and distribute a locked skill | Admin App User Studies |

---

## 4. User Personas & Stakeholder Mapping

### Persona 1: Sarah — Practice Lead / Vault Owner (SME)
- **Role:** VP of Technology / Practice Director.
- **Needs:** Needs a centralized place to capture team best practices, client historical decisions, and standardized estimation skills. Wants team members to use her skills without giving away raw prompt files or internal spreadsheets.
- **Pain Points:** "If I post our estimation logic or prompt templates in a shared repo, it gets copied, altered, or walked out the door."
- **Key Capabilities:** Full CRUD, key management, role assignment, audit log inspection, vault mode toggle (Open vs. Locked), export privileges.

### Persona 2: Alex — Senior Consultant / Content Editor
- **Role:** Solution Architect / Senior Tech Lead.
- **Needs:** Writes architecture decision records (ADRs), client discovery briefs, and project notes. Wants Obsidian-style bi-directional linking (`[[page]]`) and Markdown support without managing local sync configs.
- **Pain Points:** "Maintaining documentation across Google Docs and Notion is tedious; search is terrible and links break constantly."
- **Key Capabilities:** Draft pages, link pages, append timeline updates, test drafts before publication. (Cannot publish or share vaults).

### Persona 3: David — Delivery Consultant / Engineer (Consumer & Reader)
- **Role:** Full-stack Developer / Junior Consultant.
- **Needs:** Needs fast, authoritative answers while chatting with Claude.ai during client sprint work. Needs to run standardized code-review or test-generation skills.
- **Pain Points:** "I don't know where previous team members left their documentation, and searching Slack is useless."
- **Key Capabilities:** In Open Vaults: Search and load page context through Claude. In Locked Vaults: Run authorized skills (`run_skill`) and query locked vaults (`ask_vault`) with zero setup.

### Persona 4: Marcus — Information Security & Compliance Officer
- **Role:** Chief Information Security Officer (CISO) / IT Admin.
- **Needs:** Complete data isolation, zero-trust credentialing via corporate SSO (Google Workspace / Entra ID), encryption at rest and in transit, and immutable audit logs.
- **Pain Points:** "AI tools frequently bypass data governance. We cannot have unencrypted IP sitting in multi-tenant cloud storage."
- **Key Capabilities:** SSO group mapping, access revocation (< 60s), KMS key rotation oversight, break-glass security logging.

---

## 5. Core Product Concepts & Mental Model

```
+-----------------------------------------------------------------------+
| tkxel Organization                                                    |
|                                                                       |
|   +---------------------------------------------------------------+   |
|   | Vault: "Fintech Practice" (Mode: OPEN)                        |   |
|   | Key: KMS Wrapped AES-256-GCM                                  |   |
|   | Roles: Sarah (Owner), Alex (Editor), Delivery Team (Readers)  |   |
|   |                                                               |   |
|   |  [ Page: Acme Corp ] <----[[links]]----> [ Page: Tech Stack ] |   |
|   |  - YAML Front Matter                      - Architecture Spec |   |
|   |  - Body Markdown                          - Timeline Entries  |   |
|   +---------------------------------------------------------------+   |
|                                                                       |
|   +---------------------------------------------------------------+   |
|   | Vault: "Delivery IP & Playbooks" (Mode: LOCKED)               |   |
|   | Key: Isolated KMS Wrapped AES-256-GCM                         |   |
|   | Roles: Sarah (Owner), All Staff (Consumers)                   |   |
|   |                                                               |   |
|   |  [ Skill: case_study ]          [ Skill: proposal_estimator ] |   |
|   |  - SKILL.md (Protected)         - tool.json (Strict Schema)   |   |
|   |  - Reference Data (Zero Read)   - In-memory execution only    |   |
|   +---------------------------------------------------------------+   |
+-----------------------------------------------------------------------+
```

### 5.1 Open Vault (Context Hub)
- **Objective:** Democratize company knowledge.
- **Access Rule:** Readers can search, inspect full text, follow backlinks, and inspect graphs via both the Admin Web App and Claude.ai.
- **Claude Tooling:** Exposes `search`, `get_page`, `get_links`, and `get_context`.

### 5.2 Locked Vault (Protected IP Store)
- **Objective:** Maximum utility, zero visibility.
- **Access Rule:** Staff are assigned the **Consumer** role. Consumers **cannot** view, list files, search raw text, download blobs, or browse the vault.
- **Claude Tooling:** Exposes only `list_skills`, `run_skill`, and `ask_vault`.
- **Execution Guarantee:** Skill definitions and context are decrypted purely in ephemeral RAM within the secure server runner, executed against the Claude API, and discarded immediately.

### 5.3 Entity Hierarchy
1. **Organization:** Root enterprise tenant bounded by SSO.
2. **Vault:** Autonomous security domain with its own KMS data key, mode, and ACL.
3. **Page / Skill:** Atomic content items. Every item resides in exactly one vault.
4. **Version:** Immutable snapshot. Only Owners can publish; Readers/Consumers only ever see published snapshots.

---

## 6. End-to-End User Journeys

### Journey 1: Authoring & Linking Context (The Knowledge Architect)
```mermaid
sequenceDiagram
    autonumber
    actor Owner as Sarah (Owner)
    participant UI as Vault Admin Web App
    participant Svc as Vault Service
    participant DB as Postgres + pgvector
    
    Owner->>UI: Create new page: "Client Apex"
    UI-->>Owner: Open WYSIWYG Editor (Milkdown/Tiptap)
    Owner->>UI: Type text & insert "[[Apex Security Standards]]"
    UI->>Svc: Autocomplete link search
    Svc-->>UI: Return existing & unresolved link suggestions
    Owner->>UI: Save Draft
    Svc->>DB: Store encrypted draft version (AES-256-GCM)
    Owner->>UI: Click "Publish"
    Svc->>DB: Promote to immutable Published version
    Svc->>DB: Generate embeddings & index chunks (<= 30s)
    UI-->>Owner: Updated Vault Graph reflects new connected nodes
```

### Journey 2: Authoring & Distributing a Locked Skill (The IP Creator)
```mermaid
sequenceDiagram
    autonumber
    actor Owner as Sarah (Owner)
    participant UI as Vault Admin Web App
    participant Runner as Skill Validator & Runner
    participant DB as Encrypted Vault Store
    
    Owner->>UI: Upload "pricing_model" folder (SKILL.md, tool.json, templates)
    UI->>Runner: Validate SKILL.md front matter & tool.json schema
    Runner-->>UI: Validation Passed (Strict inputs: client_tier, scope_hours)
    Owner->>UI: Set Vault Mode = "LOCKED" & Share with "All Staff" as Consumer
    Owner->>UI: Click "Publish"
    UI->>DB: Store encrypted skill payload
    Note over DB,Runner: Skill is now executable organization-wide with ZERO source readability
```

### Journey 3: Everyday In-Chat Execution via Claude.ai (The Consultant)
```mermaid
sequenceDiagram
    autonumber
    actor Staff as David (Consultant)
    participant Claude as Claude.ai Interface
    participant MCP as tkxel MCP Gateway
    participant Runner as Locked Skill Runner
    participant LLM as Claude API (Backend)
    
    Staff->>Claude: "Generate a case study for Apex based on our delivered metrics"
    Claude->>MCP: Call list_skills (Authorized as David via OAuth 2.1)
    MCP-->>Claude: Return [{name: "case_study", description: "Produce one-pager"}]
    Claude->>MCP: Call run_skill("case_study", {client: "Apex", results: "..."})
    MCP->>Runner: Decrypt SKILL.md into ephemeral memory
    Runner->>LLM: Invoke Messages API (SKILL.md as System Context + Inputs)
    LLM-->>Runner: Return generated case study markdown
    Runner-->>MCP: Send formatted output (Discard decrypted prompt from RAM)
    MCP-->>Claude: Return output markdown
    Claude-->>Staff: Render polished case study in chat
    Note over Staff,Claude: David cannot inspect the underlying prompt, system rules, or formulas!
```

### Journey 4: Security Inspection & Access Revocation (The Security Admin)
1. Staff member leaves the organization.
2. Google Workspace / Entra ID disables the user account.
3. Vault Gateway rejects caller tokens within **< 60 seconds**.
4. In the Admin App, the Owner reviews the immutable audit log, exporting CSV records of all tool calls and data changes for compliance review.

---

## 7. Functional Requirements & Scope (MoSCoW Prioritization)

### 7.1 Knowledge Engine & WYSIWYG Workspace

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :---: | :---: |
| **PRD-FEAT-01** | **WYSIWYG Markdown Editor:** Real-time editing reading/writing clean markdown with YAML front matter, headers, callouts, tables, and code formatting. | **Must Have** | Phase 1 |
| **PRD-FEAT-02** | **Interactive Link Autocomplete:** Typing `[[` triggers instant fuzzy search over existing page titles and aliases. | **Must Have** | Phase 1 |
| **PRD-FEAT-03** | **Structured Page Categorization:** Predefined and custom page types (`client`, `person`, `project`, `decision`, `meeting`, `note`) with configurable front matter. | **Must Have** | Phase 1 |
| **PRD-FEAT-04** | **Append-Only Timeline:** Structured timeline section in page metadata where chronological milestones can be added without altering the master document body. | **Should Have**| Phase 2 |
| **PRD-FEAT-05** | **Multi-Format Bulk Ingestion:** Import markdown files, zip archives, and existing Obsidian vault folders, preserving internal links and front matter. | **Must Have** | Phase 1 |
| **PRD-FEAT-06** | **One-Click Daily Notes:** Instant creation/retrieval of daily meeting/scratch pages. | **Could Have** | Phase 2 |

### 7.2 Graph Navigation & Relationships

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :--- | :---: |
| **PRD-FEAT-10** | **Bi-Directional Backlink Panel:** Every page renders real-time incoming and outgoing references. | **Must Have** | Phase 1 |
| **PRD-FEAT-11** | **Ghost Link Handling:** Unresolved `[[links]]` are highlighted and can be instantiated into new pages with 1 click. | **Must Have** | Phase 1 |
| **PRD-FEAT-12** | **Automated Refactoring on Rename:** Renaming any page dynamically updates all references across the entire vault. | **Must Have** | Phase 1 |
| **PRD-FEAT-13** | **Interactive 2D Knowledge Graph:** Force-directed visual graph of the vault, colored by entity type and filterable by tags. | **Should Have**| Phase 2 |
| **PRD-FEAT-14** | **Local Neighborhood Graph:** 2-hop visual graph focused on the currently opened page. | **Should Have**| Phase 2 |

### 7.3 Search, Discovery & RAG Context Assembly

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :--- | :---: |
| **PRD-FEAT-20** | **Hybrid Search Engine:** Fused BM25 full-text keyword search and pgvector semantic embeddings across accessible open vaults. | **Must Have** | Phase 1 |
| **PRD-FEAT-21** | **Strict Search Boundary Isolation:** Search queries physically filter by user ACLs at the database layer; zero snippet or title leakage from unauthorized vaults. | **Must Have** | Phase 1 |
| **PRD-FEAT-22** | **Automated Near-Real-Time Indexing:** New saves/publications reflected in search indices within **<= 30 seconds**. | **Must Have** | Phase 1 |
| **PRD-FEAT-23** | **Context Assembly Tool (`get_context`):** Smart MCP retrieval packing top search hits and 1-hop related pages up to a defined token budget for Claude. | **Must Have** | Phase 1 |

### 7.4 Locked Skills Store & Runtime

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :--- | :---: |
| **PRD-FEAT-30** | **Skill Package Ingestion & Schema Validation:** Upload skills as folders/zips; validates `SKILL.md` and enforces `tool.json` parameter schema. | **Must Have** | Phase 1 |
| **PRD-FEAT-31** | **Zero-Read Execution Engine:** In-memory ephemeral decryption of skill context during Claude API execution; zero persistent plaintext storage. | **Must Have** | Phase 1 |
| **PRD-FEAT-32** | **Synthesized Locked Vault Q&A (`ask_vault`):** Allows consumers to query locked repositories for concise answers (<= 1500 chars) without raw excerpt access. | **Must Have** | Phase 1 |
| **PRD-FEAT-33** | **Anti-Exfiltration Prompt Hardening:** Pre-execution sanitization rejecting requests attempting to print, repeat, or summarize system prompts or tool scripts. | **Must Have** | Phase 1 |

### 7.5 Remote MCP Gateway & Claude.ai Integration

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :--- | :---: |
| **PRD-FEAT-40** | **Streamable HTTP Remote MCP Gateway:** Fully compliant with MCP specification (2025-11-25) as a native Claude custom connector. | **Must Have** | Phase 1 |
| **PRD-FEAT-41** | **Dynamic Tool Exposure:** Caller's tool palette is computed per call from active permissions (`search`/`get_page` for Readers; `run_skill`/`ask_vault` for Consumers). | **Must Have** | Phase 1 |
| **PRD-FEAT-42** | **Claude In-Chat Writeback (`add_note`):** Allows authorized editors to dictate notes or timeline items directly through Claude conversations into an `/inbox`. | **Should Have**| Phase 2 |
| **PRD-FEAT-43** | **Per-User Rate Limiting:** Enforce limits (default: 60 locked calls/hr, 300 retrieval calls/hr) with circuit breakers for abuse patterns. | **Must Have** | Phase 1 |

### 7.6 Governance, Security & Audit

| Req ID | Feature Description | Priority | Phase |
| :--- | :--- | :--- | :---: |
| **PRD-FEAT-50** | **Enterprise SSO & OAuth 2.1 PKCE:** Strict authentication against corporate identity (Google Workspace / Entra ID); zero local passwords. | **Must Have** | Phase 1 |
| **PRD-FEAT-51** | **Envelope Encryption at Rest:** AES-256-GCM encryption with unique data keys per vault, wrapped by cloud KMS master keys. | **Must Have** | Phase 1 |
| **PRD-FEAT-52** | **Immutable Audit Trail:** Append-only logging of every tool call, admin action, permission change, and export, retained for 2 years. | **Must Have** | Phase 1 |
| **PRD-FEAT-53** | **Rapid Revocation Enforcement:** Account suspensions or role updates propagate to active MCP sessions within **< 60 seconds**. | **Must Have** | Phase 1 |
| **PRD-FEAT-54** | **Anomaly Detection & Spike Alerts:** Automatic alerts when a user exceeds 3x their baseline query volume or triggers repeated rate limit denials. | **Should Have**| Phase 2 |

---

## 8. Non-Functional Requirements & Performance Guardrails

```
+-------------------------------------------------------------------------+
|                  Non-Functional Engineering Targets                     |
|                                                                         |
|  [ Availability ]      [ Latency ]           [ Scalability ]            |
|  • 99.5% Gateway Uptime • search/get_page     • 100k Total Pages        |
|  • Daily Encrypted Bckp   < 500ms (p95)       • 200 Concurrent Users    |
|  • RPO: 24h, RTO: 4h   • runner < 2s (p95)    • Zero degradation        |
+-------------------------------------------------------------------------+
```

### 8.1 Performance Benchmarks
- **Search & Retrieval:** `search` and `get_page` must execute in **< 500 ms at p95** across an index of 10,000 pages.
- **Skill Execution Overhead:** Combined gateway authorization and runner overhead must be **< 2.0 seconds at p95** (excluding Anthropic API response time).
- **Graph Visualizer:** Full 2,000-node graph rendering in **< 3 seconds** on standard desktop browsers.

### 8.2 Security & Zero-Trust Architecture
- **Zero Raw Key Storage:** Data keys are unwrapped in-memory and never written to disk or logged.
- **Strict Error Masking:** When an unauthorized or non-existent resource is queried, the gateway returns a uniform `not_allowed` or `not_found` error without revealing whether the resource exists.
- **Air-Gapped Skill Sandbox:** Scripts bundled in skills execute in an isolated container without outbound internet access.

### 8.3 Compliance & Privacy
- **Zero Input Retention for Locked Calls:** User inputs passed to `run_skill` and `ask_vault` are kept strictly in ephemeral memory for the duration of the request and omitted from persistent storage (only metadata/token counts logged).
- **Audit Defense:** Structured logs provide complete traceability for SOC 2 Type II controls.

---

## 9. Product Phasing & Roadmap

```mermaid
gantt
    title tkxel Vault Product Delivery Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: MVP Core
    Core Storage & AES Encryption        :active, p1_1, 2026-10-01, 3w
    Admin Web App & WYSIWYG Editor      :active, p1_2, 2026-10-15, 3w
    Remote MCP Gateway (OAuth 2.1)       :p1_3, 2026-11-01, 3w
    Locked Skill Runner & Security Scans :p1_4, 2026-11-15, 3w
    Pilot Release & Penetration Test     :p1_5, 2026-12-05, 2w
    section Phase 2: Enhanced Hub
    Visual Graph & Local Graph Explorer  :p2_1, 2027-01-05, 3w
    Claude Writeback (`add_note`)        :p2_2, 2027-01-20, 2w
    Timeline Mode & Daily Notes          :p2_3, 2027-02-01, 2w
    Anomaly Alerts & Usage Analytics     :p2_4, 2027-02-15, 2w
    section Phase 3: Enterprise Scale
    Self-Hosted Embeddings for Locked    :p3_1, 2027-03-01, 4w
    Multi-Organization Cross-Federation  :p3_2, 2027-03-25, 4w
```

### Phase 1: MVP Release (v1.0) — Target: Q4 2026
*Focus: End-to-End Secure Context Retrieval & Locked Skill Execution.*
- Vault Admin Web App (desktop browser) with Markdown editor, front matter, and `[[link]]` auto-complete.
- Open Vault storage, hybrid search (BM25 + pgvector), and bidirectional backlink computation.
- Locked Vault skill ingestion, `tool.json` validation, and ephemeral runner.
- Remote MCP Gateway integrated with Claude.ai via single org connector.
- SSO integration (OIDC/OAuth 2.1 PKCE) and envelope encryption.
- Core audit logging (CSV export) and role management.

### Phase 2: Enhanced Collaboration & Writeback (v1.5) — Target: Q1 2027
*Focus: Interactive Navigation & In-Chat Workflow Integration.*
- Full 2D knowledge graph view with filtering by tag, type, and cluster.
- Local 2-hop graph explorer.
- In-chat writeback (`add_note`) allowing Claude to capture meeting notes and timeline updates into an inbox.
- Automated anomaly detection alerts (Slack/Email notifications for unusual query spikes).
- Daily note workflow with one-click creation.

### Phase 3: Advanced Intelligence & Scaling (v2.0) — Target: Q2 2027
*Focus: Self-Hosted AI Infrastructure & Enterprise Ecosystem Expansion.*
- Self-hosted local embedding pipelines for locked vaults (ensuring zero data transmission to external embedding APIs).
- Automated link suggestions powered by background semantic clustering.
- Mobile-optimized Admin view.

---

## 10. User Experience & Interface Design Principles

1. **"Zero New Tooling" for Staff:**
   90% of consultants will never open the Admin Web App. Their interface is the Claude.ai conversation they already use every day. Tools must be self-describing so Claude triggers them intuitively without users typing explicit commands.
2. **Distraction-Free Markdown Authoring:**
   The Admin app editor should feel as responsive and lightweight as Obsidian or Notion, supporting keyboard-driven slash commands (`/`), markdown shortcuts, and fluid link insertion.
3. **Transparent Permission States:**
   When a user views the graph or reads pages, links pointing to unauthorized vaults are cleanly badged as `(Unavailable - Restricted)`, avoiding confusion while safeguarding the underlying data.
4. **Instant Feedback on Skill Validation:**
   When an Owner uploads a skill zip, the system immediately presents an interactive preview of the detected `tool.json` schema and SKILL instructions with green validation checks.

---

## 11. Go-to-Market (GTM), Rollout & Adoption Plan

### 11.1 Pilot Launch (Beta)
- **Target Group:** 2 High-Velocity Practices (Fintech & Cloud/Architecture Practices) + Executive Office (~40 users).
- **Duration:** 3 weeks.
- **Goals:** Validate Claude retrieval accuracy, test 5 locked practice skills, refine rate-limit thresholds.

### 11.2 Migration & Onboarding Strategy
- **Obsidian & Drive Ingestion Kit:** Provide a 1-click import tool allowing practice leads to drop their current folders of markdown notes directly into an Open Vault.
- **Skill Template Starter Packs:** Pre-populate 5 standard tkxel delivery skills (e.g., Code Review Standard, Case Study Creator, Sprint Estimation Helper).

### 11.3 Training & Change Enablement
- **Consultant Enablement:** A 5-minute video tutorial: *"How Claude got smarter: Using the tkxel Vault directly in your chats."*
- **SME Workshop:** 45-minute hands-on lab on authoring locked skills and defining `tool.json` input schemas.

---

## 12. Risks, Trade-offs & Mitigations

| Risk / Trade-off | Severity | Likelihood | Mitigation Strategy |
| :--- | :---: | :---: | :--- |
| **Reconstruction of Locked Content via Repeated Probing** | High | Medium | Enforce strict rate limits (60 calls/hr), cap `ask_vault` responses to 1,500 chars, sanitize outputs, and trigger automated alerts on abnormal query frequencies. |
| **Prompt Injection via Skill Inputs** | High | Low | Run strict input schema validation (`tool.json`), sanitize input strings, isolate skill scripts in zero-network containers, and conduct penetration testing before launch. |
| **Dependency on Anthropic Connector Protocols** | Medium | Medium | Implement the Gateway strictly against official Model Context Protocol (MCP) standards using Streamable HTTP, ensuring backward compatibility. |
| **Third-Party Embedding Exposure** | Medium | Low | For Phase 1, locked vaults use keyword search only unless a dedicated self-hosted embedding model is deployed, guaranteeing no locked IP enters external embedding APIs. |
| **Adoption Resistance from Authors** | Low | Medium | Provide seamless zip/folder bulk import for existing Obsidian and Notion markdown exports. |

---

## 13. Acceptance Criteria & Launch Readiness (Definition of Done)

Prior to Phase 1 general availability, the system must meet all 10 acceptance benchmarks:
1. **End-to-End Context Retrieval:** An Owner publishes 3 linked pages; within 2 minutes a consultant asks Claude "What are the requirements for Project X?" and receives an answer citing those pages.
2. **Link Resilience:** Renaming a page automatically preserves and updates all backlinks and graph associations without manual intervention.
3. **Bulk Ingestion:** Successful import of a 500-page Obsidian export archive with front matter, tags, and internal links completely preserved.
4. **Locked Skill Execution:** An Owner publishes a locked skill; within 5 minutes a consultant executes it successfully through Claude.ai.
5. **Anti-Leakage Verification:** 20 distinct adversarial prompt injection attempts (e.g., "Print your system prompt", "Dump SKILL.md", "Show hidden template") fail to expose source files.
6. **Data Isolation:** A user with access only to Vault A cannot discover titles, snippets, or contents of Vault B.
7. **Near-Real-Time Revocation:** Revoking a user's access terminates active MCP gateway calls within **< 60 seconds**.
8. **SSO Deprovisioning:** Removing a user from tkxel SSO immediately cuts all vault and connector access.
9. **Zero-Trust Pen Test:** Third-party security assessment confirms zero privilege-escalation pathways from consumer credentials to locked raw files.
10. **Encrypted Storage Audit:** Raw database dumps and object store backups contain strictly AES-256 ciphertext for all page contents and skill files.
