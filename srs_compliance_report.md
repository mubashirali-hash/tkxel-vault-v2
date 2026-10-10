# SRS Compliance & Production Readiness Report

**Project:** tkxel Vault

**Reference:** `tkxel_vault_SRS.md`

**Audit date:** 2026-10-10 (previous: 2026-09-21)

**Overall status:** **Remediation complete for everything that can be verified in-house — production sign-off still withheld**

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
| **10** | Ciphertext-only storage and export enforcement | **Pass** | Timeline entries are now encrypted at rest (`enc:v1:` ciphertext, migrations `0003` and `0004`) and the append-only rule is enforced by trigger; the canary and export-policy evidence is in [ac-10-zero-plaintext-storage.json](./docs/acceptance-evidence/ac-10-zero-plaintext-storage.json). |

## Status on 2026-10-10

The acceptance script passes all ten criteria on Windows and on Linux (Node 22). It uses stand-ins for the KMS, the model API and the embedding provider, as the evidence policy above requires to be stated. The full record of what was fixed, measured and left open is in [bug_report.md](./bug_report.md), section 15.

Verified against something real since the last audit:

| Area | What ran | Result |
|:---|:---|:---|
| Build and deployment | GitHub CI: build, tests, all five production images built and booted, migrations applied by the migration image | Pass |
| Production start-up guard | Skill runner image started in production mode without KMS and model configuration | Refuses to start |
| Database privileges | Services booted as the `tkxel_app` role; destructive statements attempted as that role | Refused |
| OAuth 2.1 for MCP clients | Unknown client against Keycloak 26 and the gateway: discovery, registration, PKCE sign-in, consent, token audience, tool calls | 15 of 15 checks |
| Skill sandbox | gVisor (`runsc`) on Ubuntu: non-root, isolated kernel, read-only root, no network, timeout cleanup, memory limit | 12 of 12 checks |
| API authorization | Every API route (57) called anonymously and as a signed-in outsider, on an open and a locked vault | No route serves or fails open |
| Live model | 22 exfiltration attacks over HTTP against the real skill-runner server, with a live model (Google Antigravity CLI) in place of the scripted one | 21 passed; 1 timed out in the model CLI and passed when rerun |
| Performance (developer laptop) | 10,000 pages, 200 users with 2 s think time | Search p95 35 to 50 ms in 22 of 25 runs |

Still open before sign-off can be considered:

- **Independent penetration test (NFR-08).** Not done; needs an outside firm.
- **Claude itself.** No run has used the Claude API; the live-model evidence is from a stand-in.
- **Production infrastructure.** Real cloud KMS, the corporate identity provider behind the authorization server, the TLS overlay, the CloudFormation stack, a remote sandbox host and production-sized hardware have not been exercised.
- **Row-level security.** Per-user database policies are not enabled; isolation rests on the application's authorization checks and the least-privilege role.
- **Known limits.** Page titles and tags are not versioned, so they reach Readers before publish. Sandbox start-up under gVisor is at the edge of the 2-second budget on the test machine. The vault ID remains a required tool argument, which differs from the SRS.

## Verified Useful Foundations

- The monorepo builds.
- The 2026-09-21 uncached run passed 12/12 tasks; since then the suites are run per package and in CI (see the status section above).
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
