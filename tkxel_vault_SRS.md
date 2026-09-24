# Software Requirements Specification (SRS)

# tkxel Vault: Context Hub and Locked Skills Store

| Attribute | Details |
| :--- | :--- |
| **Version** | 0.3 (Draft) |
| **Date** | 8 September 2026 |
| **Author** | Waiz Zeeshan |
| **Status** | For CEO Review |

---

> ### Stakeholder Requirements & Origin
> *"What will it take to create a tkxel locked MD editor and cloud store? I will tell you what I mean. Maybe already out there. Use case: Claude / LLMs produce markdown that:"*
> 1. **WYSIWYG Editing:** A WYSIWYG Markdown editor that preserves clean Markdown and YAML front matter.
> 2. **Context Hub:** A linked company Context Hub where Markdown pages connect through `[[wiki-links]]`, tags, backlinks, search, and a graph view.
> 3. **Encryption & Security:** Encryption for all stored content.
> 4. **Org-Wide Secured Sharing:** Organization-wide sharing using vaults, while keeping protected content secure and non-exportable outside the application.
> 5. **Claude Integration:** Secure use from Claude through a remote MCP connector.
> 6. **Two Distinct Vault Modes:**
>    - **Open Vault:** Authorized Readers can search and read Markdown through the web app and Claude.
>    - **Locked Vault:** Consumers can use skills and receive controlled answers through Claude, but cannot read, browse, list, download, or export underlying source files.
> 7. **Access Governance:** Per-vault isolation, role-based access control, corporate SSO, rapid access revocation, audit logging, and no disclosure of unauthorized resource existence.
> 8. **Import Fidelity:** Import support for Markdown, ZIP archives, and Obsidian vault exports while preserving front matter, tags, formatting, and internal links.
> 9. **Isolated Skill Execution:** Locked skills must execute in an isolated environment and use strict declared input schemas.
> 10. **MCP Protocol Standard:** Claude integration must use MCP over Streamable HTTP with OAuth 2.1 PKCE and dynamic, role-based tool availability.

---

## 1. Introduction

### 1.1 Purpose
This document defines what tkxel Vault must do, how it must behave, and what it explicitly does not promise. It serves as the authoritative reference for engineering, architecture, security review, and acceptance testing.

### 1.2 Scope
tkxel Vault is an internal enterprise knowledge and execution platform with two primary operating functions:

1. **Context Hub:** A centralized system where Markdown produced by Claude, by vault owners, or by staff lives as connected pages, forming an interactive, searchable company brain that Claude can draw on via remote retrieval tools.
2. **Locked Store:** A protected repository to share skills, business playbooks, and reference knowledge downstream so staff can execute them through Claude without being able to edit, list, open, download, or export the underlying source files.

Both functions share the same underlying storage engine, cryptographic foundation, and Model Context Protocol (MCP) gateway. What differs is the vault mode (see [Section 2.3](#23-vault-modes)) and the corresponding server-enforced tool palettes.

The platform comprises four core components:
1. **Vault Admin App:** Web application for writing, linking, uploading, versioning, publishing, and managing content, featuring an interactive 2D graph view.
2. **Vault Service:** Encrypted storage engine, knowledge graph index, hybrid search engine, access control layer, versioning system, append-only audit log, and isolated skill execution runtime.
3. **MCP Gateway:** Remote MCP server that Claude.ai connects to, exposing retrieval tools for open vaults and use-only execution tools for locked vaults.
4. **Claude.ai Integration:** Organization-level custom connector enabling staff to connect via corporate Single Sign-On (SSO).

### 1.3 Definitions

| Term | Meaning |
| :--- | :--- |
| **Owner** | User holding full administrative lifecycle control over a vault (creation, membership, publishing, mode configuration, audit inspection). For Open Vaults, Owners may export content under full audit logging; for Locked Vaults, export is strictly prohibited for all users, including Owners. |
| **Editor** | User permitted to draft, edit, and manage content in assigned vaults through controlled administrative workflows in the web app. Cannot publish, share, or export. |
| **Reader** | User authorized to read, search, and browse an Open Vault through Claude and the admin web application. |
| **Consumer** | Zero-read user authorized to execute skills and query locked vaults through Claude. Consumers have no direct source access, file names, paths, directory listings, raw Markdown, or unauthorized metadata. |
| **Page** | A Markdown document in the vault containing a title, type, front matter metadata, body content, wiki-links, tags, and an optional timeline. |
| **Link** | A wiki-style `[[page]]` reference connecting one page to another. Backlinks represent the reverse relationship. |
| **Skill** | An executable package containing a `SKILL.md` instruction file, a declared `tool.json` parameter schema, and optional scripts or reference templates. |
| **Vault** | An isolated collection of pages and skills governed by a dedicated encryption key, operational mode (Open vs. Locked), and explicit sharing permissions. |
| **Mode** | Operational state of a vault: **Open** (readable and searchable) or **Locked** (use-only execution). Configured per vault by its Owner. |
| **Tool** | An executable JSON-RPC function exposed to Claude by the MCP gateway. |
| **KMS** | Key Management Service (AWS KMS or Azure Key Vault) managing master encryption keys used for envelope encryption. |

### 1.4 References
- Anthropic, *Custom connectors using remote MCP*
- Anthropic, *Skills for enterprise*
- *Model Context Protocol Specification*, version 2025-11-25 (Streamable HTTP)
- OAuth 2.1 with PKCE Standard (RFC 7636 / RFC 6749bis)

---

## 2. Overall Description

### 2.1 Product Perspective
In modern AI-assisted organizations, knowledge generated by LLMs and humans ends up fragmented across personal chats, local drives, and static document stores. 

- **Obsidian** provides excellent local Markdown authoring, wiki-linking, and visual graph navigation, and Obsidian Sync offers remote synchronization encryption; however, local vault contents are stored as readable files on users' devices, meaning Obsidian cannot enforce the locked, use-without-read content model required for proprietary IP. Obsidian is supported strictly as an import source and UX reference, not a platform dependency.
- **Off-the-shelf knowledge repositories** lack the required combined architecture of a high-performance Open Context Hub and a zero-read, encrypted Locked Skills Store.

tkxel Vault provides a unified, custom-built enterprise platform: an interactive Markdown Context Hub with an in-house zero-read Locked Skills Store, protected by envelope encryption and server-enforced access controls without third-party platform dependencies.

### 2.2 User Classes

| Class | Authorized Actions | Scope & Restrictions |
| :--- | :--- | :--- |
| **Owner** | Full vault lifecycle: create, link, publish, share, revoke, toggle mode, inspect audit logs. | Open Vaults: Can export content (fully audited).<br>Locked Vaults: Export is strictly prohibited. |
| **Editor** | Create, draft, and edit pages and skills in assigned vaults via controlled admin web app workflows. | Cannot publish, share, change mode, or export. |
| **Reader** | Read, search, and browse accessible Open Vaults via admin web app and Claude retrieval tools. | Open Vaults only. Cannot edit, publish, or export. |
| **Consumer** | Execute skills (`run_skill`) and submit questions (`ask_vault`) against assigned Locked Vaults via Claude. | Zero-read access: No direct file browsing, paths, directory listings, raw Markdown, or export capability. |
| **System Admin** | Infrastructure provisioning, service monitoring, KMS key rotation. | Zero content access; cannot read vault data, bypass access controls, or export locked vaults. |

### 2.3 Vault Modes

| Capability / Attribute | Open Vault | Locked Vault |
| :--- | :--- | :--- |
| **Primary Purpose** | Collaborative context hub, team knowledge base | Protected IP, proprietary delivery skills, confidential playbooks |
| **Claude Capabilities** | Full retrieval: `search`, `get_page`, `get_links`, `get_context`, `add_note` | Controlled execution only: `list_skills`, `run_skill`, `ask_vault` |
| **Web App Interface** | Full read, search, navigation, and graph view for Readers & above | Controlled administrative workflows for Owners & Editors only. Consumers have zero web app access. |
| **Direct Source Access** | Readable by authorized Readers, Editors, and Owners | **Zero-Read for Consumers:** No access to raw Markdown, filenames, directory structures, or code. |
| **Editing & Management** | Owner and assigned Editors | Owner and assigned Editors (via controlled admin workflows) |
| **Export Privileges** | **Owner only** (produces audited ZIP export) | **Strictly Forbidden:** Never permitted for any role, including Owners and System Administrators. |
| **Authorization Check** | Enforced server-side per request | Enforced server-side per request |
| **Typical Content** | Client wiki pages, meeting notes, ADRs, engineering specs | Proprietary prompt skills, pricing calculators, delivery templates |

*Invariant: Every page and skill belongs to exactly one vault. Moving an item between vaults immediately alters its operational mode and tool exposure.*

### 2.4 Operating Environment
- **Cloud Infrastructure:** Vault Service and MCP Gateway deployed in a tkxel-controlled cloud VPC (AWS or Azure).
- **Data Layer:** PostgreSQL 16 with `pgvector` for relational metadata, bidirectional link graphs, full-text tsvector indices, and dense vector embeddings.
- **Object / Blob Storage:** Encrypted blob storage for raw page versions and skill asset bundles.
- **Client Interfaces:** Vault Admin Web Application for modern desktop browsers (Chrome, Edge, Safari, Firefox).
- **Consumer Interface:** Claude.ai Team and Enterprise on web, desktop, and mobile via custom remote MCP connector.
- **Identity Provider:** Corporate SSO via Google Workspace or Microsoft Entra ID (OIDC / OAuth 2.1 PKCE).

### 2.5 Assumptions
- tkxel maintains an active Claude Team or Enterprise subscription.
- Staff access Claude using corporate `@tkxel` SSO identities.
- Vault Owners accept that locked skills execute with strict, pre-declared parameter schemas (`tool.json`) to prevent arbitrary system prompt overrides.
- Vault Owners acknowledge that content in Open Vaults is intentionally readable by any user granted the Reader role.

### 2.6 Constraints
- Content sent to Claude during tool execution is processed by Anthropic’s API infrastructure for inference.
- Client-side MCP connection behavior is governed by the Anthropic Claude custom connector implementation.
- Semantic vector search requires embedding generation: Open Vaults may utilize hosted embedding models; Locked Vaults use localized/self-hosted embedding pipelines or fallback to keyword indices to minimize external token transit.

### 2.7 Out of Scope for v1
- Real-time collaborative multi-cursor document editing.
- Offline desktop client with local database replication.
- Native mobile admin application (responsive web only; Claude mobile app handles Consumer interactions).
- Non-Claude LLM integrations.
- Automated background scrapers from Slack, email, or calendars (additions occur manually or via Claude tool writebacks).

---

## 3. Functional Requirements

### 3.1 Pages and Editing

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-01** | WYSIWYG editor reading and writing clean Markdown with YAML front matter preservation. | **M** |
| **FR-02** | Support for standard formatting: headings, lists, tables, code blocks, callouts, and vault-hosted images. | **M** |
| **FR-03** | Typing `[[` triggers an interactive page picker; links resolve dynamically by page title or alias. | **M** |
| **FR-04** | Configurable page types (`note`, `person`, `client`, `project`, `decision`, `meeting`, `skill`, `other`). | **M** |
| **FR-05** | Support for user-defined tags (`#tag`) and arbitrary YAML front matter metadata fields. | **M** |
| **FR-06** | Append-only timeline section for dated log entries; editing page body does not mutate historical log entries. | **S** |
| **FR-07** | Ingest Markdown via direct paste, single-file upload, ZIP archives, or Obsidian vault exports (preserving front matter, tags, formatting, and internal wiki-links). | **M** |
| **FR-08** | One-click Daily Note creation and retrieval in a designated open vault. | **C** |
| **FR-09** | Reusable templates per page type (e.g., initiating a new client page populates the client structure). | **S** |

### 3.2 Links, Graph, and Navigation

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-10** | Every page displays resolved outgoing links and incoming backlinks. | **M** |
| **FR-11** | Unresolved links (`[[ghost]]`) are visually highlighted and can be instantiated as new pages with one click. | **M** |
| **FR-12** | Renaming a page executes an atomic transaction updating all referencing links across the vault. | **M** |
| **FR-13** | Interactive 2D knowledge graph: pages as nodes, links as edges, colored by type and filterable by tag/vault. | **S** |
| **FR-14** | Local graph view displaying the active page and its two-hop neighborhood. | **S** |
| **FR-15** | Support for typed relationship links (e.g., `works_at`, `decided_in`, `blocked_by`); untyped links remain fully supported. | **C** |
| **FR-16** | Cross-vault links resolve only when the user holds read access to both vaults; otherwise marked unavailable without leaking metadata. | **M** |

### 3.3 Search and Retrieval

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-20** | Full-text keyword search across accessible vaults with filters for type, tag, vault, and date range. | **M** |
| **FR-21** | Semantic vector search fused with keyword search via Reciprocal Rank Fusion (RRF). | **S** |
| **FR-22** | Search index updates within 30 seconds of a page being saved or published. | **M** |
| **FR-23** | Search queries enforce server-side ACLs; never return titles, snippets, or contents from unauthorized vaults or locked vaults. | **M** |
| **FR-24** | On-demand index re-indexing triggerable by the vault owner. | **S** |

### 3.4 Skills Management

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-30** | Upload skills as ZIP archives or folder structures; validate `SKILL.md` front matter and `tool.json` prior to ingestion. | **M** |
| **FR-31** | Skill documentation and companion files are editable by Owners/Editors in the standard vault Markdown editor. | **M** |
| **FR-32** | Skills in locked vaults must declare strict input parameters in `tool.json` before publishing; execution adheres strictly to declared schemas. | **M** |
| **FR-33** | Skills published in Open Vaults can be read directly by Claude, operating as standard readable reference skills. | **S** |

### 3.5 Versioning and Publishing

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-40** | Every save generates a draft version; every publish operation creates an immutable published snapshot. | **M** |
| **FR-41** | Only Owners may publish content; Editors are restricted to authoring and saving drafts. | **M** |
| **FR-42** | Version history with side-by-side diff visualization and rollback capability to any published version. | **M** |
| **FR-43** | Readers and Consumers receive strictly the latest published version; drafts are never exposed to retrieval tools. | **M** |
| **FR-44** | Unpublishing an item takes effect immediately, revoking access for Readers and Consumers across all interfaces. | **M** |

### 3.6 Access Control, Governance, and Export Policy

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-50** | Mandatory authentication via tkxel corporate SSO (Google Workspace or Microsoft Entra ID); zero local accounts or passwords. | **M** |
| **FR-51** | Owner sets vault mode (Open vs. Locked); changing mode dynamically updates exposed tool palettes on the subsequent session. | **M** |
| **FR-52** | Share vaults with individuals, SSO groups, or org-wide with explicit roles (Editor, Reader, Consumer). | **M** |
| **FR-53** | Locked vaults do not support a Reader role; Consumers receive use-only access via Claude without direct file inspection. Owners and authorized Editors manage locked content through controlled administrative workflows in the web app, with all checks enforced server-side. | **M** |
| **FR-54** | Access revocation propagates and takes effect across active MCP sessions and web sessions within 60 seconds. | **M** |
| **FR-55** | Deprovisioning an account in corporate SSO immediately terminates all active vault operations and MCP tokens. | **M** |
| **FR-56** | **Export Policy Enforcement:**<br>• **Open Vaults:** Export is restricted to Owners, generates a complete audit event, and produces a ZIP archive of clean Markdown files with front matter and links intact.<br>• **Locked Vaults:** Export is strictly forbidden for all roles (including Owners and System Administrators); the system shall provide no export API, UI action, or batch extraction mechanism for locked vault content. | **M** |

### 3.7 Model Context Protocol (MCP) Gateway

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-60** | Remote Gateway implements the Anthropic MCP specification (version 2025-11-25) over Streamable HTTP and integrates as a Claude custom connector. | **M** |
| **FR-61** | Sessions authenticate via OAuth 2.1 with PKCE against corporate SSO; every tool invocation carries verified caller identity. | **M** |
| **FR-62** | Tool catalog is dynamically computed per request based on active caller claims and vault permissions. | **M** |
| **FR-63** | Open Vault retrieval tools: `search`, `get_page`, `get_links`, and `get_context`. | **M** |
| **FR-64** | Locked Vault execution tools: `list_skills`, `run_skill`, and `ask_vault`. Consumers receive synthesized responses without raw file trees or source code. | **M** |
| **FR-65** | Server-side authorization checks enforced per tool invocation for every request; zero leakage of unauthorized vault data. | **M** |
| **FR-66** | Writeback tool `add_note` allows authorized Editors to append timeline entries or write drafts to `/inbox` via Claude. | **S** |
| **FR-67** | Per-user rate limiting (default: 60 locked calls/hr, 300 retrieval calls/hr), configurable per vault by the Owner. | **M** |
| **FR-68** | Access denial responses do not disclose whether a requested page, skill, or vault exists (returns generic `not_allowed` or `not_found`). | **M** |

### 3.8 Skill Runner (Locked Vaults)

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-70** | Locked skill content is decrypted in ephemeral memory per request and discarded immediately after inference completion. | **M** |
| **FR-71** | Execution orchestrator invokes the Claude API directly with skill instructions as system prompt and validated user inputs as message content. | **M** |
| **FR-72** | Returns generated output only; prevents direct source access to verbatim `SKILL.md`, templates, or reference source files through tested product interfaces. | **M** |
| **FR-73** | Execution scripts and sandboxes run in an isolated environment with zero outbound network access and strict resource boundaries. | **S** |
| **FR-74** | Execution timeout enforced at 120 seconds per request; aborted tasks clean up in-memory buffers immediately. | **M** |

### 3.9 Audit and Monitoring

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-80** | Log all tool invocations: caller identity, tool name, vault ID, target ID, timestamp, request/response byte size, and completion status. | **M** |
| **FR-81** | Log all administrative actions: create, edit, publish, share, revoke, mode toggle, Open Vault exports, delete, and any denied export attempts on Locked Vaults. | **M** |
| **FR-82** | Owners can inspect, filter, and export audit trails to CSV within the admin web application. | **M** |
| **FR-83** | Automated security alerts triggered when a user exceeds 3x normal hourly volume or encounters repeated authorization denials. | **S** |
| **FR-84** | Audit logs are stored in an append-only, immutable table and retained for a minimum of 2 years. | **M** |

### 3.10 Claude.ai Integration

| ID | Requirement | Priority |
| :--- | :--- | :---: |
| **FR-90** | Organization administrator registers the gateway once as a custom connector in Claude organization settings. | **M** |
| **FR-91** | Individual staff members connect via single sign-on OAuth flow with zero local desktop configuration. | **M** |
| **FR-92** | Operates uniformly across Claude.ai web, desktop, and mobile clients. | **M** |
| **FR-93** | Tool descriptions are optimized for natural autonomous invocation by Claude when users ask context-seeking questions. | **S** |

---

## 4. Non-Functional Requirements

### 4.1 Security

| ID | Requirement |
| :--- | :--- |
| **NFR-01** | Content encrypted at rest using AES-256-GCM. Exactly one unique data key per vault, wrapped by a KMS master key. |
| **NFR-02** | Search indices and embeddings for locked vaults are segregated and encrypted under the specific vault data key. |
| **NFR-03** | Mandatory TLS 1.2+ encryption for all data in transit across web, API, and MCP channels. |
| **NFR-04** | Plaintext encryption keys are held in volatile process memory only; never written to persistent disk or emitted in logs. |
| **NFR-05** | KMS master keys rotated annually; vault data keys support on-demand re-keying and crypto-shredding. |
| **NFR-06** | System administrators cannot access plaintext vault content during standard operations; break-glass procedures require dual authorization. System administrators are strictly prohibited from exporting locked vaults. |
| **NFR-07** | Uploaded skills are scanned for malicious scripts, unauthorized network calls, and prompt injection patterns prior to publication. |
| **NFR-08** | Third-party penetration testing required prior to production launch and conducted annually thereafter. |
| **NFR-09** | All secrets and API credentials managed through a centralized cloud secrets manager. |

### 4.2 Performance

| ID | Requirement |
| :--- | :--- |
| **NFR-10** | `search` and `get_page` respond in under 500 ms at p95 across vaults containing 10,000 pages. |
| **NFR-11** | Knowledge graph view renders a 2,000-node vault in under 3 seconds at 60 fps (Canvas / WebGL). |
| **NFR-12** | Gateway and runner overhead on `run_skill` (excluding external Claude API inference) under 2 seconds at p95. |
| **NFR-13** | System supports 200 concurrent active users without degradation of p95 latency targets. |
| **NFR-14** | Database and index architecture scales to 100,000 pages across all vaults without structural redesign. |

### 4.3 Availability and Recovery

| ID | Requirement |
| :--- | :--- |
| **NFR-20** | 99.5% monthly service availability target for the remote MCP gateway and storage APIs. |
| **NFR-21** | Daily automated encrypted database backups retained for 30 days; quarterly recovery drills conducted. |
| **NFR-22** | Recovery Point Objective (RPO) = 24 hours; Recovery Time Objective (RTO) = 4 hours. |

### 4.4 Privacy and Compliance

| ID | Requirement |
| :--- | :--- |
| **NFR-30** | User inputs to `run_skill` and queries to `ask_vault` are not retained beyond transient inference execution and audit metadata. |
| **NFR-31** | All cloud infrastructure and data storage reside within a designated geographical region. |
| **NFR-32** | Provide audit trails, key rotation logs, and access review capabilities aligned with SOC 2 compliance readiness. |

### 4.5 Usability

| ID | Requirement |
| :--- | :--- |
| **NFR-40** | Owners can create a linked page and have it discoverable via search and graph within 2 minutes. |
| **NFR-41** | Owners can publish a locked skill end-to-end in under 5 minutes without engineering assistance. |
| **NFR-42** | Zero training required for Readers and Consumers; interactions occur naturally via standard Claude prompts. |

---

## 5. External Interfaces & Tool Specifications

### 5.1 Retrieval Tools (Open Vaults)

#### `search`
- **Description:** Search accessible open vaults using hybrid keyword and semantic scoring.
- **Input Parameters:**
  ```json
  {
    "query": "string (required)",
    "vaults": ["string (optional)"],
    "types": ["string (optional)"],
    "tags": ["string (optional)"],
    "limit": "integer (optional, default: 10)"
  }
  ```
- **Output:** Array of `{ page_id, title, vault, type, snippet, score }`.
- **Authorization Scope:** Open vaults where caller has Reader role or above.

#### `get_page`
- **Description:** Retrieve full Markdown content, metadata, and link associations for a specific page.
- **Input Parameters:**
  ```json
  {
    "page_id": "string (required)"
  }
  ```
- **Output:** `{ title, type, front_matter, body_markdown, links_out, backlinks, timeline }`.

#### `get_links`
- **Description:** Fetch local relationship graph surrounding a specific page.
- **Input Parameters:**
  ```json
  {
    "page_id": "string (required)",
    "depth": "integer (optional, 1 or 2, default: 1)"
  }
  ```
- **Output:** `{ nodes: [{ id, title, type }], edges: [{ from, to, type }] }`.

#### `get_context`
- **Description:** Primary context aggregation tool for Claude conversations; assembles top search hits and 1-hop link context within a token budget.
- **Input Parameters:**
  ```json
  {
    "query": "string (required)",
    "max_tokens": "integer (optional, default: 4000)"
  }
  ```
- **Output:** `{ pages: [{ title, body_markdown }] }`.

#### `add_note` *(Editor Role Only)*
- **Description:** Append a dated timeline entry to an existing page or write a draft page to `/inbox`.
- **Input Parameters:**
  ```json
  {
    "page_id": "string (optional)",
    "title": "string (optional)",
    "entry": "string (required)"
  }
  ```
- **Output:** `{ page_id, version }`.

---

### 5.2 Locked Tools (Locked Vaults)

#### `list_skills`
- **Description:** List available executable skills in accessible locked vaults without exposing file structures, paths, or source code.
- **Input Parameters:** None.
- **Output:** Array of `{ name, description }`.

#### `run_skill`
- **Description:** Execute a protected skill by injecting system context into an isolated Claude API invocation with declared inputs.
- **Input Parameters:**
  ```json
  {
    "skill": "string (required)",
    "inputs": "object (required, matching skill tool.json schema)"
  }
  ```
- **Output:** `{ result: "string", format: "markdown" | "text" }`.
- **Error Codes:** `not_allowed`, `invalid_input`, `rate_limited`, `timeout`.

#### `ask_vault`
- **Description:** Ask a domain question against a locked repository to obtain a synthesized response without accessing raw text or browsing files.
- **Input Parameters:**
  ```json
  {
    "vault": "string (required)",
    "question": "string (required)"
  }
  ```
- **Output:** `{ answer: "string" }` (capped at 1,500 characters).
- **Error Codes:** `not_allowed`, `rate_limited`.

---

### 5.3 Skill Schema Definition (`tool.json`)

Every skill uploaded to a locked vault must include a valid `tool.json` declaring its parameter signature:

```json
{
  "name": "case_study",
  "description": "Produce a tkxel case study one-pager from client results",
  "inputs": {
    "client": {
      "type": "string",
      "required": true,
      "description": "Name of the client organization"
    },
    "results": {
      "type": "string",
      "required": true,
      "description": "Quantified project deliverables and business impact"
    },
    "quote": {
      "type": "string",
      "required": false,
      "description": "Optional client endorsement quote"
    }
  }
}
```

---

### 5.4 Standard Page Format

Vault pages are stored as clean Markdown documents with YAML front matter and optional append-only timeline sections:

```markdown
---
title: Acme Corp
type: client
tags: [fintech, enterprise]
owner: "[[Sara Khan]]"
status: active
---

Compiled summary of what we currently know about Acme Corp. Updated as account facts change.

## Architecture Highlights
- Core clearing platform deployed on AWS.
- Uses event-driven messaging pattern documented in [[Payment Architecture Reference]].

## Timeline
- 2026-09-02: Kickoff call held, see [[Acme discovery notes]].
- 2026-08-20: Commercial proposal sent, reference [[Acme proposal v2]].
```

---

### 5.5 Supporting System Interfaces
- **Identity (SSO):** OpenID Connect (OIDC) with corporate group claims mapping to vault roles.
- **KMS Service:** AWS KMS or Azure Key Vault utilizing envelope encryption workflows.
- **Claude Messages API:** Direct integration via Anthropic SDK from the locked skill runner using secrets-managed API keys.
- **Embedding Pipeline:** Hosted embedding API for open vault indexing; self-hosted local model or keyword pipeline for locked vault indexing.

---

## 6. Conceptual Data Model

| Entity | Primary Key | Key Attributes |
| :--- | :--- | :--- |
| **Vault** | `id` | `name`, `mode` (open \| locked), `owner_id`, `data_key_id`, `export_policy` (allowed_for_owner \| strictly_forbidden), `created_at` |
| **Page** | `id` | `vault_id`, `type`, `title`, `aliases`, `tags`, `front_matter`, `current_version_id` |
| **Version** | `id` | `page_id`, `number`, `status` (draft \| published), `encrypted_blob`, `created_by`, `created_at` |
| **Link** | `id` | `from_page_id`, `to_page_id`, `link_type`, `resolved` (boolean) |
| **TimelineEntry** | `id` | `page_id`, `date`, `entry_text`, `created_by`, `created_at` |
| **Chunk** | `id` | `page_id`, `version_id`, `position`, `encrypted_text`, `embedding` |
| **Skill** | `id` | `vault_id`, `name`, `tool_schema`, `current_version_id` |
| **Share** | `id` | `vault_id`, `principal_id`, `role` (editor \| reader \| consumer), `granted_by`, `granted_at`, `revoked_at` |
| **AuditEvent** | `id` | `actor_id`, `action`, `target_id`, `timestamp`, `metadata` |

---

## 7. Architecture & Implementation Strategy

### 7.1 Final Architecture Decision: Custom Secure tkxel Vault Platform

**Decision:** Adopt a **custom-built, secure tkxel Vault platform** developed and owned entirely by tkxel.

- **Obsidian Role:** Obsidian is supported solely as an **import format** (ingesting Markdown, YAML front matter, tags, formatting, and internal wiki-links) and as **UX inspiration** for Markdown editing, backlinks, and graph navigation. Obsidian is **not** a production platform dependency. Obsidian Sync can encrypt remote synchronization, but local vault contents remain readable on users’ physical devices; therefore, it cannot enforce the required locked, use-without-read content model.
- **Exclusion of GBrain:** The production architecture has **zero dependency on GBrain**. The system shall not use, fork, install, evaluate, or depend on GBrain. The Open Context Hub is built independently as a native tkxel service.
- **tkxel-Owned Services:** All security-sensitive and core components are custom-built and controlled by tkxel:
  - Vault isolation and multi-tenant boundary enforcement.
  - AES-256-GCM envelope encryption and Cloud KMS integration.
  - Server-side authorization checks enforced on every request.
  - Immutable audit logging.
  - Remote Model Context Protocol (MCP) Gateway over Streamable HTTP with OAuth 2.1 PKCE.
  - Ephemeral locked skill execution runner with isolated sandboxing and anti-exfiltration safeguards.
  - Complete Open Context Hub storage, link graph indexing, and hybrid search engine.

---

### 7.2 Evaluation of Market Solutions

| Requirement | Obsidian (Desktop / Sync) | Off-the-Shelf Repositories | Custom tkxel Vault Platform |
| :--- | :--- | :--- | :--- |
| **Non-Exportable Zero-Read Store** *(Run skills without exposing source code/prompts)* | **Incompatible:** Obsidian Sync encrypts remote transport, but local vault files are stored in readable format on users' devices. Cannot enforce locked, use-without-read execution. | **Incompatible:** Standard knowledge management tools lack ephemeral, zero-read execution sandboxes. | **Native:** Ephemeral container sandboxes execute skills in RAM with immediate key disposal and zero direct source access. |
| **Multi-Tenant Vault Isolation** *(Zero cross-vault discovery or leakage)* | **Unsupported:** Personal/desktop architecture with no server-enforced multi-tenant isolation boundaries. | **Inadequate:** Lacks granular per-vault isolation with cryptographic separation and generic error suppression. | **Native:** Server-side authorization on every request, defense-in-depth data isolation, and per-vault cryptographic segregation. |
| **Envelope Encryption with Cloud KMS** *(AES-256-GCM unique per vault)* | **Unsupported:** Local storage or proprietary sync encryption; lacks enterprise Cloud KMS integration. | **Unsupported:** Standard database storage without per-vault KMS envelope encryption. | **Native:** AES-256-GCM envelope encryption with master keys in AWS KMS or Azure Key Vault. |
| **Remote MCP Gateway for Claude.ai** *(Streamable HTTP 2025-11-25 + Corporate SSO)* | **Unsupported:** Relies on local desktop plugins; cannot act as an organization-level remote connector for Claude.ai. | **Unsupported:** Lacks native Streamable HTTP MCP server with dynamic role-based tool catalogs. | **Native:** Full Anthropic Streamable HTTP protocol with corporate OIDC identity provider integration. |
| **Sub-60s Dynamic Access Revocation** | **Impossible:** Users retain downloaded local files on their physical hardware. | **Unsupported:** Lacks real-time token revocation and active session termination. | **Native:** Centralized Redis token blacklist enforcing session invalidation within 60 seconds. |
| **Strict Export Policy Enforcement** | **Unsupported:** All local vault files can be copied, exported, or transferred freely. | **Unsupported:** Lacks role-gated export controls and locked vault export prohibitions. | **Native:** Open Vault export restricted to Owners (audited); Locked Vault export strictly forbidden for all roles. |

---

### 7.3 Component Implementation Strategy

| Architectural Layer | Implementation Approach | Strategic Rationale |
| :--- | :--- | :--- |
| **Hub Layer** *(Pages, links, graph, search, MCP retrieval)* | **Build In-House (tkxel-Owned)** | Custom-built Open Context Hub providing native Markdown handling, PostgreSQL + `pgvector` hybrid search, link graph indexing, and MCP retrieval without external framework dependencies. |
| **Markdown Editor** | **Adopt Established Headless WYSIWYG** *(Subject to ADR)* | Adopt an established headless WYSIWYG editor (e.g., Tiptap or Milkdown, confirmed via ADR) to deliver rich slash commands, wiki-link pickers, and clean Markdown serialization. |
| **Locked Mode & Security Runtime** | **Build In-House (tkxel-Owned)** | Proprietary zero-read execution layer. Built and controlled entirely by tkxel to guarantee cryptographic isolation and anti-exfiltration boundaries. |
| **MCP Gateway & Authorization** | **Build In-House (tkxel-Owned)** | Custom security gateway enforcing per-call role-based tool palettes, OAuth 2.1 PKCE validation, and rapid access revocation for both Open and Locked tools. |

---

## 8. Known Limitations & Explicit Non-Promises

*Documented plainly to manage stakeholder expectations:*
1. **Open Vaults are Inherently Readable:** Anyone granted Reader access can view, read, and copy the raw Markdown text via the web app or Claude.
2. **Generated Outputs are Visible:** While locked vault source files cannot be read, outputs generated by `run_skill` and `ask_vault` are visible to the user and can be copied.
3. **Potential Reconstruction via Probing:** Repeated or sequential questions submitted to `ask_vault` may allow a determined user to partially reconstruct domain knowledge over time. Rate limiting, character caps, and anomaly detection reduce risk and slow extraction, but cannot mathematically eliminate it.
4. **Third-Party Processing Boundary:** Data processed by Claude passes through Anthropic’s API infrastructure for inference. Encryption at rest secures tkxel storage, not Claude's inference compute.
5. **No Screen Capture Prevention:** The system cannot prevent users from capturing screenshots or photos of generated outputs.
6. **Rigid Skill Signatures in Locked Mode:** Locked skills must execute through predetermined `tool.json` parameter schemas, forfeiting the free-form prompt flexibility available in open vaults.
7. **External Connector Dependency:** System availability and interaction latency rely partially on Anthropic’s Claude client implementation.
8. **Anti-Exfiltration Scope:** The system **prevents direct source access through tested product interfaces** (API, UI, MCP). It does not claim absolute or mathematical zero exfiltration against all theoretical side-channel or inference-based knowledge reconstruction attacks.
9. **Permanent Locked Vault Non-Exportability:** By architectural invariant, Locked Vaults provide no export functionality to any user or administrator; this is a non-negotiable platform constraint designed to protect enterprise IP.

---

## 9. Acceptance Criteria & Definition of Done

Prior to production sign-off, the following 10 acceptance criteria must be satisfied:

1. **Context Retrieval Flow:** An Owner creates 3 linked pages; within 2 minutes a Reader asks Claude *"What do we know about Client X?"* and receives a synthesized answer correctly citing those pages.
2. **Link Refactoring Integrity:** Renaming a page dynamically updates its references across all other pages, backlinks, and graph views without broken links.
3. **Bulk Vault Migration:** Importing an Obsidian vault export of 500 pages successfully preserves all Markdown formatting, front matter, tags, and internal wiki-links.
4. **Locked Skill Execution:** An Owner publishes a locked skill; within 5 minutes a Consumer executes it through Claude and receives a valid formatted result without exposing underlying source files.
5. **Prompt Exfiltration Defense:** A Consumer asks Claude across 20 varied adversarial phrasings to print, display, or download locked skill source files (`SKILL.md`, templates); the platform prevents direct source access through tested product interfaces, resulting in refusals without leaking content.
6. **Strict Multi-Tenant Isolation:** Server-side enforcement guarantees that a Reader with access only to Vault A cannot discover titles, snippets, or contents of Vault B through any tool call or search query.
7. **Rapid Revocation Enforcement:** When an Owner revokes a user's access, all subsequent MCP tool calls by that user are denied within 60 seconds and logged as security events.
8. **Automated SSO Deprovisioning:** Deactivating a user account in corporate SSO terminates all vault operations and active MCP sessions immediately.
9. **Penetration Test Verification:** External security review confirms zero privilege escalation pathways from consumer tokens to locked file bodies or unauthorized vaults.
10. **Zero-Plaintext Storage Audit & Export Validation:**
    - A raw database dump and object storage inspection contains strictly ciphertext for page bodies, skill files, and locked chunks.
    - An Open Vault Owner can successfully export an audited ZIP archive of their open vault.
    - Any export attempt against a Locked Vault (via UI, API, or administrative script) is strictly rejected with no export mechanism available.
