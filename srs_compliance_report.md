# SRS Compliance & Production Readiness Report

**Project:** tkxel Vault

**Reference:** `tkxel_vault_SRS.md`

**Audit date:** 2026-09-21

**Overall status:** **Remediation required — production sign-off withdrawn**

Baseline evidence: [Epic 0 Baseline](./docs/acceptance-evidence/EPIC-0-BASELINE.md). Release manifest: [Release Evidence](./docs/acceptance-evidence/release-evidence.json). Live Linux Acceptance: [Gate 3 Linux runsc Evidence](./docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log).

## Evidence Policy

A passing build, source-inspection test, copied-logic test, or implementation walkthrough is not sufficient compliance evidence. A criterion may be marked `Pass` only when an uncached test exercises the relevant production implementation and boundary: HTTP/MCP authorization, PostgreSQL/pgvector, browser persistence, KMS/runner topology, or rendered UI as applicable.

## Current Acceptance Matrix

| ID | Acceptance criterion | Current status | Evidence and remaining work |
|:---|:---|:---|:---|
| **1** | Context retrieval through hybrid RAG and linked pages | **Pass** | Live PostgreSQL context assembly across linked pages with citation ranking verified in [ac-1-context-retrieval.json](./docs/acceptance-evidence/ac-1-context-retrieval.json). |
| **2** | Link refactoring integrity | **Pass** | Live link refactoring verified against PostgreSQL deferred constraint triggers and invariants in [ac-2-link-refactoring.json](./docs/acceptance-evidence/ac-2-link-refactoring.json). |
| **3** | Bulk vault migration fidelity | **Pass** | Multi-file vault import with YAML front-matter preservation and database encryption verified in [ac-3-bulk-vault-migration.json](./docs/acceptance-evidence/ac-3-bulk-vault-migration.json). |
| **4** | Locked skill execution without source exposure | **Pass** | Zero-read locked skill orchestration over HTTP with DEK unwrap, in-memory execution, and audit log verified in [ac-4-locked-skill-execution.json](./docs/acceptance-evidence/ac-4-locked-skill-execution.json) and live gVisor Linux log [GATE-3-LINUX-RUNSC-EVIDENCE.log](./docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log). |
| **5** | Prompt exfiltration defense | **Pass** | 22 live adversarial prompt injection attacks executed over HTTP against locked endpoints and neutralized without information disclosure verified in [ac-5-prompt-exfiltration-defense.json](./docs/acceptance-evidence/ac-5-prompt-exfiltration-defense.json). |
| **6** | Strict multi-tenant isolation | **Pass** | Multi-tenant database RLS and authorization boundaries reject foreign vault queries verified in [ac-6-multitenant-isolation.json](./docs/acceptance-evidence/ac-6-multitenant-isolation.json). |
| **7** | Revocation enforcement under 60 seconds | **Pass** | Atomic Redis revocation enforced in sub-second duration (<60s SLA) verified in [ac-7-rapid-revocation.json](./docs/acceptance-evidence/ac-7-rapid-revocation.json). |
| **8** | Automated SSO deprovisioning | **Pass** | Live HTTP SSO deprovisioning webhook terminates active sessions with instant 401 rejection and PostgreSQL audit event verified in [ac-8-sso-deprovisioning.json](./docs/acceptance-evidence/ac-8-sso-deprovisioning.json). |
| **9** | Zero privilege-escalation pathways | **Pass** | Live MCP HTTP penetration test proves dynamic tool filtering and rejects raw markdown retrieval escalation attacks verified in [ac-9-penetration-testing.json](./docs/acceptance-evidence/ac-9-penetration-testing.json). |
| **10** | Ciphertext-only storage and export enforcement | **Remediation required** | The canary and export-policy evidence remains valuable for pages, versions, chunks, and locked exports in [ac-10-zero-plaintext-storage.json](./docs/acceptance-evidence/ac-10-zero-plaintext-storage.json). However, the legacy `timeline_entries.entry_text` column stores timeline body text unencrypted and must be migrated before this criterion or production approval can be claimed. See the [data dictionary](./docs/DATA_DICTIONARY.md). |

## Verified Useful Foundations

- The monorepo builds.
- The latest uncached 2026-09-21 run passed 12/12 tasks.
- AES-256-GCM envelope primitives and encrypted version paths exist.
- Explicit flags now gate the development auth token and permissive development CORS.
- A database-backed access resolver, vault CRUD/move scaffolding, chunking, pgvector schema, RRF utility, audit service, UI, and sandbox utilities exist.

These are remediation assets, not proof of full compliance.

## Remediation Authority

- Detailed work: [bug_report.md](./bug_report.md)
- Durable handoff: [CODEX_MEMORY.md](./CODEX_MEMORY.md)
- Living milestone registry: [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)

## Production Sign-Off Rule

Do not restore `fully compliant`, `production-ready`, or `10/10 pass` language until Epics 0-8 have passed their review gates, production-path evidence is attached to every criterion, the legacy timeline plaintext field is remediated, no critical/high security finding remains open, and the user explicitly approves release.
