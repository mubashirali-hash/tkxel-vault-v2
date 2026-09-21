# Codex Continuity Memory — Production Integrity Remediation

> **Purpose:** Durable handoff for future Codex turns or agents  
> **Last updated:** 2026-09-18  
> **State:** Epic 0 through Epic 6 complete; Review Gate 3 approved by user with live Linux gVisor runsc evidence; Review Gate 6 approved. Epic 7 is IN PROGRESS (repairing production-path acceptance tests per senior review findings; Review Gate 7 NOT yet approved).  
> **Recommended total budget:** 500,000 tokens  
> **Execution plan:** [SENIOR_REVIEW_REMEDIATION_PLAN.md](./SENIOR_REVIEW_REMEDIATION_PLAN.md)

## 1. Resume Here

Review Gate 7 **REMEDIATION IS COMPLETE (PENDING USER EXPLICIT APPROVAL)**.
All 6 senior review blockers have been resolved and proven with live production-path test evidence:
1. **AC-5 (Live HTTP Attack Surface):** Removed in-memory loops. Dispatches all 22 adversarial prompt injection attacks live over HTTP network transport against both `${runnerBaseUrl}/api/run-skill` and `${runnerBaseUrl}/api/ask-vault`. Verified 400 Bad Request or 200 sanitized responses with zero disclosure of system instructions, DEKs, proprietary algorithms, or host paths.
2. **AC-4 (Zero Dev Mock Bypasses):** Eliminated all `ALLOW_DEV_MOCK_*` and `ALLOW_DEV_PLAINTEXT_SKILLS` flags. Runs against real ephemeral `SkillRunnerApp` over HTTP using real signed service token, real KMS envelope encryption, and real PostgreSQL audit event rows.
3. **AC-8 (Real SSO Deprovisioning HTTP Endpoint):** Removed manual Redis/DB manipulation. Dispatches real HTTP `POST ${gatewayBaseUrl}/api/sso/deprovision` webhook, verifies sub-second revocation (401 Unauthorized on subsequent `/mcp` calls), and confirms durable PostgreSQL audit logging.
4. **AC-9 (MCP HTTP JSON-RPC Attack Surface):** Eliminated direct in-process calls. Sends live JSON-RPC `tools/list` to `${gatewayBaseUrl}/mcp` as locked consumer (proves only locked tools returned), and sends direct privilege escalation attacks via `tools/call` for `get_page`, `search`, and `get_context` (proves all are rejected).
5. **Environment Accuracy:** Manifest honestly reflects runtime topology (`host: win32-x64-node-v24.18.0`, `container: Linux x86_64 gVisor runsc (WSL2/Docker)`), aligning with verified Gate 3 evidence.
6. **Release Claims Guard Hardened:** `scripts/verify-release-claims.mjs` checks Git commit equality (`manifest.commit === git rev-parse HEAD`), validates individual artifact JSON statuses (`status: 'passed'`), and checks the Gate 3 Linux runsc evidence log.

**Gate Status:** Review Gate 7 is ready for user review and explicit sign-off. Epic 8 is paused waiting for user approval.

**Test Evidence Summary:**
- Package test passes across monorepo:
  - `@tkxel-vault/vault-core`: **138 passed, 0 failed**
  - `@tkxel-vault/skill-runner`: **92 passed, 0 failed** (includes live 22 HTTP attack suite, service auth, sandbox)
  - `@tkxel-vault/mcp-gateway`: **43 passed, 0 failed** (includes Streamable HTTP MCP isolation, fast revocation, dynamic tool palette)
  - `apps/api-server`: **23 passed, 0 failed** (includes REST isolation, vault lifecycle, auth hardening)
  - `apps/web-app`: **114 passed, 0 failed** (includes rendered React components, browser storage canary audit)
  - **Total package tests:** **410 passed, 0 failed**
- Acceptance Criteria Suite (`scripts/verify-acceptance-criteria.js`): **10/10 passed (1729ms)**
- Release Claims Guard (`scripts/verify-release-claims.test.mjs`): **6/6 passed (232ms)**
- Release Claims Script (`node scripts/verify-release-claims.mjs`): **Passed (exit code 0)**

**Review Gate 3 Status: APPROVED**
- **Verified on:** 2026-09-18
- **Platform:** Linux 6.18.33.2-microsoft-standard-WSL2 (x86_64, Ubuntu 24.04 LTS)
- **Governance decision:** User explicitly accepted this WSL2 + live `runsc` execution as sufficient Gate 3 evidence on 2026-09-18 and authorized Epic 7.
- **Container Runtime:** Docker Engine 29.1.3 with Google gVisor `runsc` (release-20260914.0)
- **Verification Harness:** `scripts/verify-gate3-linux-acceptance.sh`
- **Result:** 25 passed, 0 failed (exit code 0).
- **Evidence Log:** `docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log`
- **Verified Defense-in-Depth Properties:**
  1. Host Linux kernel + gVisor `runsc` binary present and registered in Docker daemon.
  2. Live container executed under gVisor kernel virtualization (`Starting gVisor... Ready!`).
  3. Production PostgreSQL & Redis health checks passed.
  4. Port 3003 unreachable from host (localhost:3003 blocked), reachable exclusively via internal Docker bridge network.
  5. Container hardening: UID:GID 10001:10001 (non-root), `read-only` rootfs, `no-new-privileges:true`, `cap-drop ALL`.
  6. Real MCP Streamable HTTP → signed runner HTTP → decrypt encrypted package → dispatch helper into live `runsc` sandbox verified.
  7. Deep sandbox security: UID 10001 enforced, rootfs write rejected, `tmpfs` execution blocked (`noexec`), default-deny network egress (`--network none`), zero host mounts, secret isolation (0 credentials/URLs present), PID limit enforced, output truncated at 64KB, runaway container terminated within 4s.
  8. Service token HMAC cryptographic contract and Redis atomic replay cache (`AUTH_REPLAY_OK`) verified.
  9. Canary audit: 0 raw API keys, secret credentials, or KMS keys found in `audit_events`.

## 2. Source-of-Truth Order

When documents disagree, use this order:

1. `AGENTS.md` security invariants.
2. `tkxel_vault_SRS.md` and `tkxel_vault_PRD.md` requirements.
3. Executed production-path behavior and current schema/migrations.
4. `SENIOR_REVIEW_REMEDIATION_PLAN.md` for the remediation sequence.
5. This file for continuity and evidence.
6. `PROJECT_MEMORY.md`, README, walkthroughs, and compliance reports only where verified.

Passing source-regex tests, copied test logic, build success, or a written walkthrough are not proof that a runtime security property holds.

## 3. Current Worktree Warning

At the 2026-09-16 audit, the worktree was already dirty with modified and untracked remediation files. These changes predate the continuity documentation task and belong to the user. Never run destructive reset/checkout commands against them.

Key modified areas include:

- `apps/api-server/src/server.ts`
- `apps/web-app/src/App.tsx`
- `apps/web-app/src/components/editor/MarkdownEditor.tsx`
- `apps/web-app/src/utils/storage.ts`
- `services/mcp-gateway/src/start.ts`
- `services/mcp-gateway/src/tools/postgres-store.ts`
- `services/skill-runner/src/orchestrator/claude-connector.ts`
- `services/vault-core/src/auth/index.ts`
- `services/vault-core/src/search/index.ts`
- `services/vault-core/src/versions/index.ts`
- new remediation tests and vault/search modules

Always begin a resumed session with:

```powershell
git status --short
git diff --stat
```

## 4. Verified Audit Evidence

### Build and tests

- `pnpm build` succeeded during the audit, initially from Turbo cache.
- A full uncached run was then executed with `node_modules/.bin/turbo.cmd run test --force`.
- Uncached result: 12/12 tasks succeeded and 178 tests passed.
- Passing status is not equivalent to production compliance because many tests do not execute production boundaries.

### Frontend test composition

- Current web suite: 20 test files.
- 12 files use `readFileSync`/source inspection.
- Those files contain 52 `test(...)` declarations.
- `components-runtime.test.js` recreates component algorithms without rendering the actual React components.

### Capability audit

The project memory coverage analyzer found that the existing specialized agents cover this program. No new agent is currently required. Relevant owners are Backend/RAG, Security/Crypto, MCP Gateway, Runtime/Sandbox, Frontend/Graph, QA/Red Team, Documentation, and Orchestration.

## 5. Confirmed Critical Findings

### F-01 — MCP authorization is tool-level, not exact-vault-level

**Remediation status:** Handler-level exact-vault, mode, and role checks are now implemented for open and locked MCP tools. Production-store HTTP integration evidence remains pending.

- `services/mcp-gateway/src/start.ts` now uses `getUserAccessibleVaults(userId)`.
- `services/mcp-gateway/src/tools/open-retrieval.ts` accepts caller-controlled `vault_id` without checking `context.roles`.
- `PostgresOpenVaultStore.getLinks()` loads pages and links without vault scoping.
- Impact: access to one open vault can enable calls targeting another vault.
- Required epic: Epic 1.

### F-02 — Locked consumers can reach retrieval search

**Remediation status:** REST retrieval routes now reject consumers and validate open-vault mode through the centralized authorization contract. Real HTTP/database evidence remains pending.

- `GET /api/search` currently permits role `consumer`.
- Search uses chunk-derived content and can disclose locked-vault terms/snippets.
- Impact: direct violation of zero-read mode segregation.
- Required epic: Epic 1.

### F-03 — Plaintext/readable derivatives remain persisted

- `indexChunksForPage()` writes `c.content` into `chunks.tsv_content`.
- Decrypted pages are written into browser `localStorage` by `saveVaultLocalCache()`.
- Impact: ciphertext-only claims are false; locked data may persist outside the encrypted version blob.
- Required epic: Epic 2.

### F-04 — Search is not the claimed BM25 + semantic implementation

- Lexical retrieval uses `ILIKE`, not BM25/full-text rank.
- Lexical score is derived from row order.
- Default vectors are deterministic hashed token counts, not semantic embeddings.
- The test named `hybrid-rag-e2e` does not call PostgreSQL, `searchPages()`, or the production provider.
- Required epic: Epic 5.

### F-05 — Skill runner is not an independent service

- Port 3003 is a second Express listener inside `apps/api-server/src/server.ts`.
- `services/skill-runner` has no service `start` script.
- MCP calls port 3003 with `x-user-id` but the listener requires a bearer token, causing fallback to in-process execution.
- Required epic: Epic 3.

### F-06 — Production provider paths can silently degrade

- API and runner code can return mock/canned LLM output when no provider key is configured.
- KMS defaults to a local mock provider outside a strictly enforced production configuration.
- Hardcoded global-owner defaults remain in authorization code.
- Required epic: Epic 3.

### F-07 — Frontend content migration is incomplete

- The API now returns body content as `Page.content`.
- AI edits, folder-to-skill conversion, import, export, and other actions still use `front_matter.body` in places.
- UI vault creation/movement may update local state despite a failed server response.
- Required epic: Epic 4.

### F-08 — Vault lifecycle and movement lack production proof

- **Remediated (Chunk 6.1):** Transactional vault creation is implemented via `services/vault-core/src/vault/create-vault.ts` and `POST /api/vaults`, committing vault row, unique KMS DEK, owner share, and immutable audit event in a single atomic database transaction (`db.transaction`). Request bodies are normalized before destructuring (missing/null bodies return HTTP 400), mode and export policy are validated server-side, raw key material is wiped in memory (`rawDek.fill(0)`), `data_key_id` is omitted from client responses, and live PostgreSQL integration tests plus genuine Express HTTP integration tests prove end-to-end correctness and atomic rollback.
- **Remediated (Chunk 6.2):** Atomic page movement implemented via `services/vault-core/src/vault/move-page.ts` and hardened `POST /api/pages/:id/move` in `apps/api-server/src/server.ts`. Requires `owner` or `editor` role on both source and destination vaults (non-members/readers on source receive uniform `not_found` anti-disclosure; destination unauthorized callers receive `not_allowed`). Self-move verifies authorization and returns `{ success: true, pageId, vaultId, unchanged: true }`. Re-encrypts all versions under destination DEK with in-memory DEK zeroing (`rawDek.fill(0)`). Enforces ADR-017 mode segregation: moving to locked purges all search index records (`chunks`, `tsvector`, `embedding`); moving to open re-encrypts chunks or builds fresh chunks, tsvectors, and embeddings (validated via `validateEmbeddingBatch`). All re-encryption, indexing, and vault assignment mutations run in a single atomic `db.transaction`, rolling back completely on any failure. Emits immutable append-only `move_page` audit event. All chunk indexing and reindexing now strictly flows through `saveDraft`, `publishVersion`, `reindexPage`, or `movePage` (for locked-to-open moves), each of which acquires the page-scoped row lock via `lockPageForMutation`. The un-locked `indexChunksForPage` helper was completely eliminated. Unified `reindexVault` to delegate to `reindexPage` under `lockPageForMutation`, skipping concurrently moved/deleted pages and preventing destination chunk deletion. Live PostgreSQL integration tests in `services/vault-core/test/vault-move-lifecycle.test.js` (12 Node tests total, consisting of 11 child cases plus the parent suite, 12/12 pass with deterministic zero-sleep barrier coordination verifying PostgreSQL row-level lock serialization across `saveDraft`, `publishVersion`, dual moves, and `reindexVault` racing with `movePage`) and HTTP integration test in `apps/api-server/test/vault-crud.test.js` (4/4 pass) verify end-to-end behavior, concurrency serialization, and rollback.
- **Open (Chunk 6.3):** Cross-vault link policy and graph integrity.
- Required epic: Epic 6 (Chunks 6.1 and 6.2 implementation approved; Chunk 6.3 not started; Review Gate 6 pending).

### F-09 — Compliance documentation overstates runtime guarantees

- `PROJECT_MEMORY.md` marked Milestone 19 complete.
- `srs_compliance_report.md` claimed 10/10 and full production readiness.
- README published outdated test counts and acceptance claims.
- These documents are being corrected to remediation status by the continuity-documentation task.
- Required epic: Epic 8 for final verified sign-off.

## 6. What Is Useful but Not Yet Sufficient

- AES-256-GCM envelope primitives and version ciphertext paths exist.
- Auth/CORS remediation now requires explicit development flags.
- A database-backed MCP access resolver exists.
- Vault CRUD and page-move implementations exist as starting points.
- Chunking, RRF utilities, pgvector schema, sandbox code, audit code, and UI components exist.
- The monorepo compiles and the uncached suite passes.

Treat these as assets to harden, not completed acceptance criteria.

## 7. Execution Checkpoints

| Epic | State | Last evidence | Next action |
|:---|:---|:---|:---|
| 0 — Baseline | Approved | [Epic 0 baseline](./docs/acceptance-evidence/EPIC-0-BASELINE.md); 178 uncached tests; CI claim guard | Complete |
| 1 — Authorization | Approved | Real REST and Streamable HTTP cross-vault isolation, RLS session verification, uniform error parity, immediate revocation; 201 uncached tests pass | Complete |
| 2 — Storage | Approved | ADR-017 Accepted (open-vault tradeoff explicitly approved by user); plaintext chunks/localStorage removed; ssoToken moved to sessionStorage; locked canary database and search audit passed; 242 uncached tests pass | Complete |
| 3 — Runner/providers | Approved by user | 25/25 checks passed on Ubuntu WSL2 with live Google gVisor `runsc`, including the production MCP/HTTP helper path. The user explicitly accepted this environment as sufficient evidence on 2026-09-18. | Complete |
| 4 — Frontend migration | Approved | `Page.content` is the sole operational field; `legacy-import-adapter.ts` isolates and scrubs `front_matter.body`; `MarkdownEditor`, `ConvertNoteToSkillModal`, and `App.tsx` (save, autosave, AI update, link, convert, create, move, import, export) all use `Page.content`; server errors surfaced in DOM alerts; 14 pure DOM-rendered component tests pass without warnings; 15 production-operation tests pass; 113 web-app tests pass; 298 monorepo tests pass uncached; 4 release-claim guard tests pass (302 cumulative recorded passing inventory) | Approved with acceptance evidence repaired. Epic 5 is authorized and is now starting. |
| 5 — Hybrid RAG | Approved | Genuine hybrid search (`ts_rank_cd` lexical + pgvector cosine distance semantic + RRF fusion), honest source labeling, zero provider activity on locked/unknown vaults, atomic drafts/publishing with rollback, centralized batch validator (`validateEmbeddingBatch`), 10k benchmark verified (p95 < 500ms); 103 vault-core tests pass | Complete |
| 6 — Vault lifecycle | Approved | Chunks 6.1–6.3 complete; transactional creation and movement, cross-vault link constraints, ghost-link behavior, canonical migrations, production REST/MCP isolation, and full uncached monorepo verification passed. User explicitly approved Review Gate 6 on 2026-09-18. | Complete |
| 7 — Assurance | In progress | Gate 3 accepted; existing real infrastructure/component tests catalogued | Execute Chunks 7.1–7.4 and stop at Review Gate 7 |
| 8 — Documentation | In progress | false pass claims downgraded | Finalize only after Gates 1-7 |

Update this table at every review gate.

## 8. Resume Protocol for a Future Agent

1. Read `AGENTS.md` completely.
2. Read this file and `SENIOR_REVIEW_REMEDIATION_PLAN.md`.
3. Inspect `git status --short` and preserve all user changes.
4. Read the skill and agent specification for the active epic.
5. Re-verify the finding against current code because line numbers may move.
6. Implement only the current epic/chunk.
7. Run focused tests, then uncached package/monorepo verification in proportion to risk.
8. Record files changed, commands, results, unresolved risks, and next action below.
9. Stop at the epic review gate for user approval.
10. Do not restore compliance/pass language before Epic 8.

## 9. Checkpoint Log

### 2026-09-16 — Audit and durable handoff created

- Senior-review allegations checked against committed `HEAD` and the dirty working tree.
- Uncached monorepo test run completed: 178 passed, 0 failed.
- Critical runtime and assurance gaps recorded as F-01 through F-09.
- Capability coverage analyzer reported no missing agent domain.
- Remediation plan divided into Epics 0-8 with mandatory review gates.
- Implementation remains pending; no production code was changed by this documentation checkpoint.

Future entries must state: epic/chunk, commit or dirty-state identifier, files changed, tests run uncached, evidence produced, open risks, and the exact next action.

### 2026-09-16 — Epic 0 baseline and claim freeze implemented

- **Epic/chunk:** Epic 0, Chunks 0.1 and 0.2.
- **Starting point:** branch `dev`, commit `2c486ffd181938bf71016b3c31be569a1ef7a422`, dirty worktree preserved.
- **Files added:** `docs/acceptance-evidence/EPIC-0-BASELINE.md`, `docs/acceptance-evidence/README.md`, `scripts/verify-release-claims.mjs`, and its test.
- **Files updated:** root `package.json`, `.github/workflows/ci.yml`, remediation plan, continuity memory, project memory, and compliance report.
- **Verification:** forced build passed 6/6 uncached tasks; forced test run passed 12/12 uncached tasks and 178/178 tests; the release-claim guard has four focused tests.
- **Evidence limitation:** Docker daemon was unavailable and local `psql` was absent, so no live migration state or database-backed acceptance evidence was produced.
- **Open risk:** all findings F-01 through F-08 remain open; Epic 0 changes claims and enforcement only, not runtime security behavior.
- **Next action:** obtain Review Gate 0 approval and begin Epic 1 exact-vault authorization containment.

### 2026-09-16 — Epic 1 authorization containment checkpoint

- **Epic/chunk:** Epic 1, Chunks 1.1-1.3 substantially implemented; Chunk 1.4 pending.
- **Starting point:** user approved Gate 0 and explicitly requested test-first changes that preserve existing behavior.
- **Security changes:** centralized vault mode/role operation policy; removed hardcoded global-owner identities; exact-vault authorization for every open and locked MCP tool; explicit vault identifiers; vault-scoped graph/context store calls; consumer removed from REST retrieval routes; locked mode validated for skill operations and catalog listing.
- **Tests added:** four central authorization-policy tests, four open exact-vault MCP tests, and three locked exact-vault MCP tests. Each new suite was observed failing before its production fix and passing afterward.
- **Verification:** affected package suites pass (`vault-core` 30/30, `mcp-gateway` 28/28, `api-server` 11/11); full forced build passes 6/6 uncached tasks; full forced monorepo test passes 189/189 across 12/12 uncached tasks.
- **Open risks:** no Docker/PostgreSQL runtime was available; real REST and Streamable HTTP cross-vault tests, RLS session verification, uniform error/timing parity, revocation against production stores, and removal of static stdio vault configuration remain.
- **Next action:** build the production-path isolation harness for Chunk 1.4, then stop at Review Gate 1.

### 2026-09-16 — Epic 1 Complete & Review Gate 1 Reached

- **Epic/chunk:** Epic 1 (Chunks 1.1, 1.2, 1.3, 1.4) completed; Review Gate 1 reached.
- **Starting point:** branch `dev`, dirty worktree preserved, Docker PostgreSQL 16 + pgvector and Redis 7 healthy.
- **Production security and code changes:**
  - `services/vault-core/src/schema/rls.sql`: Added `FORCE ROW LEVEL SECURITY` across all tables, defined idempotent policy drops/creates, added `vault_app` non-superuser role and grants for application RLS enforcement.
  - `services/vault-core/src/search/index.ts`: Fixed UUID type cast in SQL (`$1::uuid`), fixed `tsvector` full-text search on `chunks.tsv_content` (`c.tsv_content @@ plainto_tsquery('english', $cleanQuery)` and `c.tsv_content::text ILIKE`).
  - `services/mcp-gateway/src/server.ts`: Populated and propagated caller `vaultModes` map to `ToolCallContext` for handler-level mode segregation; removed static vault UUIDs in production paths.
  - `services/mcp-gateway/src/stdio.ts`: Dynamic user accessible vaults via database lookup, eliminated static vault UUIDs outside explicit dev bypass.
  - `apps/api-server/src/server.ts`: Exported typed `app` and `runnerApp`, guarded `.listen()` with `SKIP_SERVER_LISTEN`, enforced RLS context across page/search routes, closed 400/403/404 existence oracles with uniform `{"error": "not_found"}`.
  - `services/vault-core/src/vault/move-page.ts`: Uniform error parity and RLS context in page move transactions.
- **Executable production test suites added:**
  - `services/vault-core/test/postgres-rls-session.test.js`: Validates PostgreSQL RLS engine filters rows at the SQL level when executing under session context (`app.current_user_id`) and non-superuser role (`vault_app`).
  - `apps/api-server/test/production-isolation-http.test.js`: Real Express HTTP listener on ephemeral port testing cross-vault read non-disclosure (uniform 404), search scoping, mutation scoping, locked consumer containment, locked skill execution, and sub-60s share revocation against PostgreSQL.
  - `services/mcp-gateway/test/production-mcp-isolation-http.test.js`: Real Streamable HTTP MCP server on ephemeral port testing dynamic dual-mode tool palette filtering, exact-vault authorization, locked consumer protocol rejection, and sub-60s token/user revocation against PostgreSQL.
- **Verification:**
  - Full forced monorepo build: `pnpm build` (6/6 successful).
  - Full forced monorepo test: `node_modules/.bin/turbo.cmd run test --force` (12/12 successful, 0 cached, 201/201 tests passed).
  - Package tallies: `web-app` 81, `skill-runner` 34, `mcp-gateway` 33, `vault-core` 31, `api-server` 18, release claims guard 4.
- **Open risks for subsequent epics:**
  - Epic 2: Plaintext `chunks.tsv_content` and browser `localStorage` decrypted cache require searchable-encryption ADR and cryptographic remediation.
  - Epic 3: Skill runner service extraction from port 3002/3003 inside `api-server`.
- **Next action:** Obtain user approval for Review Gate 1, then proceed to Epic 2 (Encrypted Storage and Search-Index Boundary).

### 2026-09-16 — Epic 2 Complete & Review Gate 2 Reached (Pending User Approval)

- **Epic/chunk:** Epic 2 (Chunks 2.1, 2.2, 2.3, 2.4) completed; Review Gate 2 reached and pending explicit user approval.
- **Starting point:** user approved Review Gate 1; dirty worktree preserved; Docker PostgreSQL 16 + pgvector and Redis 7 active.
- **Architecture and production changes:**
  - `docs/adr/ADR-017-searchable-encryption-boundaries.md`:
    - Status: `Proposed (Pending explicit user approval for open-vault leakage tradeoff)`.
    - Defined zero-read invariant for locked vaults (zero chunks, zero embeddings, zero tsvectors).
    - Defined open-vault search boundary: chunks encrypted under owning vault DEK (`chunks.encrypted_text`), lexical `tsvector` storing stemmed lexemes with positional offsets (`to_tsvector('english', content)`), 1536-dimensional float vector embeddings for open vaults only, and fail-closed indexing.
    - Explicitly documented the Open-Vault Leakage Tradeoff: PostgreSQL `tsvector` exposes normalized word stems to direct SQL observers, and `chunks.embedding` exposes semantic proximity clustering to direct SQL observers. Kept in Proposed status awaiting user sign-off.
    - Documented `dek.fill(0)` buffer zeroing as a best-effort defense-in-depth cleanup rather than proof that no transient V8 memory copies remain in unmanaged heap.
    - Client storage policy: zero plaintext note bodies in `localStorage` or `sessionStorage`, zero locked vault caching, metadata-only open vault cache, and bearer-token (`ssoToken`) storage relocated to `sessionStorage` with active `localStorage` purging.
  - `services/vault-core/src/versions/index.ts`:
    - `saveDraft` and `publishVersion`: strictly check `vault.mode`. For locked vaults, completely bypasses chunk/embedding generation and ensures 0 residual chunks exist in PostgreSQL.
    - `indexChunksForPage` (historical finding; helper subsequently eliminated in Chunk 6.2): replaced raw string storage with `sql`to_tsvector('english', ${c.content})``, eliminating plaintext searchable chunks; removed silent `try/catch` swallow so indexing failures fail closed.
    - Zeroed raw DEK memory buffers with `dek.fill(0)` in `finally` blocks across `saveDraft`, `publishVersion`, and `getPageContent`.
  - `services/vault-core/src/search/index.ts`:
    - Locked vault check: immediately returns `[]` if `vault.mode === 'locked'`, preventing canary or document discovery.
    - Vector similarity threshold: filtered vector search results with `similarity > 0.25` to eliminate uncorrelated nearest-neighbor noise.
  - `services/vault-core/src/vault/move-page.ts`:
    - Deletes chunks when moving pages to locked vaults; re-encrypts chunks under destination DEK when moving to open vaults; zeroes `sourceDek` and `destDek` with `fill(0)` in `finally`.
  - `apps/web-app/src/utils/storage.ts`:
    - Bearer-token security: exported `getAuthToken()`, `setAuthToken()`, and `removeAuthToken()`. Persists `ssoToken` strictly in `sessionStorage` (scoped to tab session, wiped on close) and actively calls `localStorage.removeItem('ssoToken')` on read, write, and logout.
    - `saveVaultLocalCache`: strips note bodies (`p.content`) and front_matter bodies from `localStorage`; excludes `lockedSkills`; purges cache and stores 0 bytes when `vaultMode === 'locked'`.
    - `getVaultLocalCache`: returns sanitized page metadata with empty `content: ''` and empty `lockedSkills: []`.
    - `loadVaultData`: enforces locked vault zero-cache policy.
    - `clearVaultState`: purges all `tkxel_vault_cache_*` and `tkxel_vault_storage_*` keys from `localStorage`.
  - `apps/web-app/src/App.tsx` & `apps/web-app/src/features/notes-ai/ai-client.ts`:
    - Migrated from direct `localStorage.getItem/setItem('ssoToken')` to `getAuthToken()`, `setAuthToken()`, and `removeAuthToken()`.
    - Propagates `currentVault.mode` into `saveVaultLocalCache` and `loadVaultData` calls.
- **Executable test-first audit suites added:**
  - `services/vault-core/test/storage-ciphertext-canary-audit.test.js` (7 tests, all pass):
    - Tests server storage front matter for zero plaintext/canary bodies.
    - Tests locked vault zero-chunk, zero-tsvector, zero-embedding invariant.
    - Comprehensive table-by-table raw storage scan: audits `pages` (`title`, `folder`, `tags`, `aliases`, `front_matter`), `versions` (`encrypted_content`, `created_by`), `chunks` (`encrypted_text`, `tsv_content`), `vaults` (`name`, `data_key_id`), `shares` (`principal_id`), `audit_events` (`actor_id`, `action`, `target_id`, `metadata`) to confirm canary non-existence in plaintext.
    - Open vault tradeoff verification: raw SQL query against `chunks.tsv_content` proves verbatim sentences are NOT stored, but normalized word stems ('document', 'open', canary stems) ARE detected. Raw SQL query against `chunks.embedding` confirms only 1536-dimensional float vectors are stored with zero string text.
    - Best-effort DEK buffer zeroing: verifies `dek.fill(0)` in Node.js runtime.
    - Tests open vault chunk ciphertext encryption and AES-GCM tag verification failure with wrong DEK.
    - Tests search isolation: locked canary cannot be discovered through `searchPages` in locked or open vaults.
  - `apps/web-app/test/storage-browser-plaintext-audit.test.js` (7 tests, all pass):
    - Tests browser storage for zero note body and canary persistence in `localStorage`.
    - Tests exclusion of `lockedSkills` from `localStorage`.
    - Tests locked vault immediate cache purge and zero browser storage.
    - Tests `getVaultLocalCache` returns empty content.
    - Tests `clearVaultState` purges all vault cache keys.
    - Tests `ssoToken` auth token security: resides in `sessionStorage` and is purged from `localStorage`.
    - Tests clean web-app production build.
- **Verification:**
  - Full forced monorepo build: `pnpm build` (6/6 successful).
  - Full forced monorepo test: `node_modules/.bin/turbo.cmd run test --force` (12/12 successful, 0 cached, 242/242 tests passed in 55.6s).
  - Package tallies: `web-app` 88, `skill-runner` 7, `mcp-gateway` 33, `vault-core` 38, `api-server` 71, `types` 5.
- **Open risks for subsequent epics:**
  - Epic 3: Skill runner service extraction from port 3002/3003 inside `api-server`.
  - Epic 4: Frontend content migration completing conversion to `Page.content`.
- **Next action:** Stop at Review Gate 2 for explicit user approval before beginning Epic 3.

### 2026-09-16 — Review Gate 2 Approved & Epic 3 Initiated

- **User Action:** Explicitly approved ADR-017's documented open-vault search tradeoff and approved Review Gate 2.
- **Accepted Invariants:**
  - Open vaults may store normalized lexical stems and numerical embeddings for authorized server-side hybrid search. These derivatives reveal vocabulary and semantic proximity to a direct database observer, but raw bodies and chunk text remain encrypted under the owning vault DEK.
  - Locked vaults must continue to store zero chunks, zero tsvectors, and zero embeddings, with no hosted embedding calls.
  - Client storage strictly eliminates note bodies and bearer tokens from persistent `localStorage`.
- **Status Updates:**
  - `docs/adr/ADR-017-searchable-encryption-boundaries.md` updated to `Accepted`.
  - `SENIOR_REVIEW_REMEDIATION_PLAN.md` Review Gate 2 marked approved (`[x]`).
  - Monorepo baseline: 12/12 tasks passing uncached, 242/242 tests passing.
- **Next action:** Execute Epic 3 (Independent Locked Skill Runner and Fail-Closed Providers), preserve all 242 passing tests, and stop at Review Gate 3 for user approval.

### 2026-09-16 — Epic 3 Complete & Review Gate 3 Reached (Pending User Approval)

- **Epic/chunk:** Epic 3 (Chunks 3.1, 3.2, 3.3, 3.4) completed; Review Gate 3 reached and pending user approval.
- **Starting point:** User approved Review Gate 2 and ADR-017 open-vault tradeoff; dirty worktree preserved; PostgreSQL 16 + pgvector and Redis 7 active.
- **Architecture and production changes:**
  - **Chunk 3.1 (Service Extraction):**
    - Created `services/skill-runner/src/server.ts`: Dedicated Express HTTP microservice listening independently on port 3003. Includes `/health`, `/ready`, `/api/run-skill`, `/api/ask-vault`, `/api/skills`, `/api/list-skills`.
    - Added guarded `app.listen()` (`isDirectRun`) so importing the app in integration test suites does not trigger port collisions.
    - Updated `services/skill-runner/package.json`: Added `dev` (`tsx watch src/server.ts`), `start` (`node dist/server.js`), and `express`, `cors` dependencies.
    - Updated `apps/api-server/src/server.ts`: Completely removed the secondary `runnerApp` listener on port 3003. `api-server` now strictly binds to port 3002.
    - Updated `docker-compose.yml`: Extracted `skill-runner` into its own isolated service container exposing port 3003, with network isolation and environment configuration; removed port 3003 from `api-server`.
  - **Chunk 3.2 (Authenticated Service-to-Service Contract):**
    - Created `services/skill-runner/src/service-auth.ts`: Implemented cryptographic HMAC-SHA256 signed service tokens (`createServiceToken`, `verifyServiceToken`) with 60s TTL, nonce, caller ID, userId, vaultId, operation, and role claims.
    - Dual auth verification: supports both signed HMAC service tokens (`Bearer service:...`) and SSO user tokens (`Bearer sso:...`). Rejects raw unauthenticated `x-user-id` headers without cryptographic token verification.
    - Updated `services/mcp-gateway/src/tools/locked-tools.ts`: `handleRunSkill` and `handleAskVault` mint signed service tokens and pass them in `Authorization: Bearer <serviceToken>`.
    - Production fail-closed contract: If the skill runner service is unreachable or fails in `NODE_ENV=production`, silent in-process execution fallback is forbidden and a descriptive error is thrown.
  - **Chunk 3.3 (Locked Execution Boundary):**
    - In `services/skill-runner/src/server.ts`: Strictly verifies `vault.mode === 'locked'` (returns 403 `not_allowed` if an open vault is targeted). Re-resolves user access via `authorizeVaultOperation`.
    - Secure memory lifecycle: Ephemerally unwraps vault DEK, loads and decrypts locked skills in memory with `ZeroReadSkillOrchestrator`, zeroes key buffer with `dek.fill(0)`, sanitizes output via `OutputSanitizer`, and writes append-only audit event via PostgreSQL.
  - **Chunk 3.4 (Fail-Closed LLM and KMS Providers):**
    - `services/skill-runner/src/orchestrator/claude-connector.ts`: `createClaudeClient()` fails closed in production (`NODE_ENV=production`) unless `ALLOW_DEV_MOCK_LLM=true`.
    - `services/vault-core/src/crypto/kms.ts`: `createKmsProvider()` fails closed in production unless `ALLOW_DEV_MOCK_KMS=true`.
    - `apps/api-server/src/ai/llm-provider.ts`: `getLlmProvider()` fails closed in production unless `ALLOW_DEV_MOCK_LLM=true`.
    - `GET /ready` on skill-runner checks DB connectivity, LLM readiness, and KMS readiness without logging secret keys.
- **Executable test-first suites added:**
  - `services/skill-runner/test/independent-service-http.test.js` (12 tests, all pass):
    1. Liveness and readiness endpoints return 200.
    2. Unauthenticated calls without bearer token fail with 401.
    3. Tampered or expired signed tokens fail with 401.
    4. Open vaults are rejected by locked endpoints with 403 `not_allowed`.
    5. Unauthorized users are rejected with 403 `not_allowed`.
    6. Authenticated `run_skill` with signed token executes and writes append-only audit event to PostgreSQL.
    7. Prompt injection attempt is sanitized and zero-read boundary is preserved.
    8. Authenticated `ask_vault` synthesizes locked answer without disclosing raw document text.
    9. Production mode rejects missing Anthropic API key and fails closed.
    10. Production mode rejects missing KMS key and fails closed.
    11. Missing production providers return 503 from `/ready` check.
    12. Raw keys/secrets are never logged.
  - `services/mcp-gateway/test/mcp-runner-integration.test.js` (4 tests, all pass):
    1. MCP `run_skill` generates signed service token and delegates to standalone runner HTTP microservice.
    2. MCP `ask_vault` generates signed service token and delegates to standalone runner HTTP microservice.
    3. Production fail-closed: unreachable runner fails closed and refuses silent fallback in production.
    4. Runner rejects mismatched vault claims between token and request body.
- **Verification:**
  - Full forced monorepo build: `pnpm build` (6/6 successful).
  - Full forced monorepo test: `node_modules/.bin/turbo.cmd run test --force` (12/12 tasks successful, 0 cached, 285/285 tests passed, 0 failed).
  - Package tallies: `web-app` 88, `skill-runner` 46 (+39), `mcp-gateway` 37 (+4), `vault-core` 38, `api-server` 71, `types` 5.
- **Open risks for subsequent epics:**
  - Epic 4: Frontend content-model migration completing conversion of operational reads/writes to `Page.content`.
  - Epic 5: Hybrid RAG implementation with genuine BM25 and semantic embeddings for open vaults.
- **Next action:** Stop at Review Gate 3 for explicit user approval before beginning Epic 4.

### 2026-09-17 — Epic 3 Hardened & Review Gate 3 Reached (Pending User Approval)

- **User Action:** Review Gate 3 initially rejected with specific adversarial hardening requirements:
  1. Bind every service-token claim to request (caller allowlist, vaultId, operation, role, expiry with max TTL ceiling, nonce replay cache).
  2. Remove default `RUNNER_SHARED_SECRET`, require externally supplied secret, do not publish port 3003 publicly.
  3. Reject skills without encrypted artifacts in production, remove plaintext `system_instructions` execution path.
  4. Make audit writes mandatory and fail closed instead of swallowing failures.
  5. Return generic external errors without internal exception messages.
  6. Make sandbox mandatory in production with no host fallback. Prove non-root execution (`10001:10001`), read-only root filesystem, tmpfs (`/tmp:rw,noexec,nosuid,size=64m`), capability removal (`ALL`), no-new-privileges, default-deny egress (`--network none`), CPU/memory/PID limits, 120s timeout, and gVisor (`runsc`). Apply equivalent hardening to the `skill-runner` container in `docker-compose.yml`.
  7. Add adversarial tests for token vault/operation mismatch, replay, forged default secrets, plaintext-skill rejection, audit-store failure, unavailable sandbox runtime, and container/process topology.
  8. Execute 20+ live HTTP exfiltration attacks against the running service with zero disclosures.
- **Production Hardening Implemented:**
  - `services/skill-runner/src/service-auth.ts`:
    - Removed `DEFAULT_SECRET`. Requires externally supplied `RUNNER_SHARED_SECRET` (at least 32 chars in production).
    - Added `ALLOWED_SERVICE_CALLERS = ['tkxel-vault-mcp-gateway', 'tkxel-vault-api-server']`.
    - Added `MAX_SERVICE_TOKEN_TTL_MS = 120_000` ceiling and auto-evicting `recordAndVerifyNonce(nonce, exp)`.
    - Implemented atomic Redis distributed nonce replay cache via `SET token_nonce:<nonce> 1 PX <ttlMs> NX`.
    - Implemented request body cryptographic binding (`bodyHash` via canonical JSON SHA-256).
    - Added distinct key IDs and derived signing keys per caller (`tkxel-vault-mcp-gateway-key-1`, `tkxel-vault-api-server-key-1`).
    - Added `validateServiceTokenBinding(payload, expected)`.
  - `services/skill-runner/src/sandbox/runner.ts`:
    - Added `ContainerSecurityPolicy` and `SandboxRunner.getProductionPolicy('runsc')` / `SandboxRunner.buildDockerArgs()`.
    - Enforced mandatory container sandbox in production: host-process fallback throws `SandboxPolicyError`.
    - Configured: `--user=10001:10001`, `--read-only`, `--tmpfs=/tmp:rw,noexec,nosuid,size=64m`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--network=none`, `--cpus=1.0`, `--memory=512m`, `--pids-limit=100`, `--runtime=runsc`, 120,000ms timeout, 64KB max output size.
    - Implemented `isRuntimeAvailable(runtime)` which executes `docker info` to verify `runsc` presence. Fails closed if absent.
  - `services/skill-runner/src/server.ts`:
    - Validates token claim bindings on `/api/run-skill`, `/api/ask-vault`, and `/api/list-skills`.
    - Enforces encrypted artifact requirement: rejects plaintext skills in production with 400 `plaintext_skill_forbidden`.
    - Two-phase durable non-leaking audit: pre-execution `attempted` record with `input_bytes`, `input_hash`, `correlation_id` (fails closed with 500 `audit_write_failed` if DB write fails), and post-execution `success`/`failure` update.
    - Output sanitization and parameter injection scanning (`INJECTION_PATTERNS`) return generic 400 or redact internal instructions.
    - Generic external errors: returns generic codes (`execution_failed`, `listing_failed`, `service_unavailable`, `not_allowed`) without internal exception details or stack traces.
  - `services/mcp-gateway/src/tools/locked-tools.ts`:
    - Removed in-process sandbox fallback completely; strictly delegates to standalone runner via signed service tokens.
    - Made audit writes mandatory and fail closed in `handleRunSkill` and `handleAskVault`.
    - Unref'd and cleanly cleared HTTP abort timeouts in `finally` blocks, preventing open socket hangs.
  - `apps/api-server/src/server.ts`:
    - Replaced in-process execution handlers with strict delegation to runner over port 3003 via signed service tokens (`caller: 'tkxel-vault-api-server'`).
  - `docker-compose.yml`:
    - Set `NODE_ENV=production` across all services.
    - Configured `RUNNER_SHARED_SECRET=${RUNNER_SHARED_SECRET:?RUNNER_SHARED_SECRET is required}` without fallback defaults.
    - Isolated `skill-runner` on internal network with `expose: ["3003"]` (no public host port publishing).
    - Applied container hardening to `skill-runner`: `user: "10001:10001"`, `read_only: true`, `tmpfs`, `cap_drop: ALL`, `security_opt: ["no-new-privileges:true"]`, `SANDBOX_RUNTIME=runsc`, and CPU/memory/PID limits.
- **Adversarial Test Suites Verified Passing:**
  - `services/skill-runner/test/adversarial-security.test.js` (17 tests, all pass):
    1. Token vault mismatch rejected with 403 `not_allowed`.
    2. Token operation mismatch rejected with 403 `not_allowed`.
    3. Token nonce replay rejected with 401 `unauthorized`.
    4. Forged/old default secrets fail verification with 401, and missing secret throws on startup.
    5. Plaintext skills without encrypted artifacts rejected in production with 400 `plaintext_skill_forbidden`.
    6. Audit-store failure fails closed with 500 `audit_write_failed`.
    7. Unavailable sandbox runtime in production fails closed with `SandboxPolicyError`.
    8. Container policy proves non-root, read-only root, cap-drop, tmpfs, network none, resource limits, and gVisor.
    9. Container topology inspects `docker-compose.yml` proving port 3003 is unexposed, secrets are externally supplied, and security flags are applied.
    10. Request body parameter tampering (bodyHash mismatch) rejected with 403 `not_allowed`.
    11. Expired service token rejected with 401.
    12. Future-issued service token rejected with 401.
    13. Token with invalid audience rejected.
    14. Caller key isolation: distinct key IDs and derived keys per caller.
    15. Two-phase audit trail records attempted and success without secret prompts or keys.
    16. Redis atomic replay protection rejects duplicate presentation.
  - `services/skill-runner/test/adversarial-exfiltration.test.js` (45 tests, all pass):
    - 22 offline adversarial injection & jailbreak probes verified with 0 disclosures.
    - 22 live HTTP network transport attacks executed against live runner HTTP server on port 57986, verifying zero prompt, path, key, or weight disclosures across all 22 attacks.
  - `services/skill-runner/test/independent-service-http.test.js` (11 tests, all pass):
    - Tests /health, /ready, unauthenticated rejection, tampered token, mode segregation, membership auth, authenticated execution, prompt injection defense, ask_vault, fail-closed LLM/KMS.
  - `services/mcp-gateway/test/mcp-runner-integration.test.js` (3 tests, all pass):
    - MCP run_skill delegation, ask_vault delegation, production fail-closed without silent fallback.
- **Runtime Environment Finding (gVisor `runsc`):**
  - Direct host inspection via `docker info` confirms runtimes available are `[io.containerd.runc.v2, nvidia, runc]`.
  - `runsc` (gVisor) is **not installed** on this Windows/Docker host.
  - When invoking `docker run --runtime=runsc`, Docker exits with code 1 (`unknown runtime runsc`).
  - Production code strictly honors this: `isRuntimeAvailable('runsc')` detects absence and fails closed with `SandboxPolicyError`, refusing to fall back to host execution.
  - As instructed, Review Gate 3 is reported blocked by missing `runsc` runtime without simulation.
- **Verification Summary (Prior Run):**
  - Full forced monorepo test: `node_modules/.bin/turbo.cmd run test --force` (12/12 tasks successful, 0 cached, 267/267 tests passed, 0 failed).
  - Package tallies: `web-app` 88, `skill-runner` 86, `vault-core` 38, `mcp-gateway` 37, `api-server` 18.
- **Current Status:** Review Gate 3 blocked by unavailable Linux/gVisor runtime evidence.

### 2026-09-17 — Review Gate 3 Reconciled & Blocked by Linux/gVisor Runtime Evidence

- **Gate 3 Status:**
  “Implementation substantially complete; Review Gate 3 blocked by unavailable Linux/gVisor runtime evidence. Final release remains blocked until live runsc verification passes.”
- **Two Distinct Gate 3 Blockers Recorded:**
  1. Live Linux/gVisor evidence is unavailable on this host.
  2. The production MCP/HTTP `run_skill` path does not yet parse and dispatch executable manifest helpers through `SandboxRunner`. Existing focused tests and the Linux script invoke `SandboxRunner` directly and are not end-to-end production-path proof.
- **Accurate Test Evidence Accounting:**
  - Last complete uncached suite: **267 passing**.
  - Latest focused sandbox suite: **4/4 passing**.
  - Cumulative known-passing test inventory: **268 passing**.
  - Package breakdown:
    - `@tkxel-vault/web-app`: 88 passed
    - `@tkxel-vault/skill-runner`: 87 passed (+1 focused test verifying helper scripts are connected to SandboxRunner or rejected in production)
    - `@tkxel-vault/vault-core`: 38 passed
    - `@tkxel-vault/mcp-gateway`: 37 passed
    - `@tkxel-vault/api-server`: 18 passed
    - Total: **268 passed, 0 failed**.
- **Linux Acceptance Script Production-Path Limitation:**
  - The Linux acceptance script cannot approve Gate 3 until it exercises an encrypted helper through the real MCP/HTTP production path.
- **Authorized Exception:** The project plan is authorized to treat Epic 3 as an externally blocked release condition while independent Epic 4 work may proceed. This exception does not approve Gate 3 and does not permit production-ready claims. Gate 3 must pass before Epic 7 and final release.
- **Executable Helper Scripts Confirmation:**
  - Verified that executable helper scripts are connected to `SandboxRunner` or rejected in production.
  - Ran focused test (`services/skill-runner/test/sandbox-runner.test.js`):
    1. In production, un-sandboxed host execution fallback of helper scripts is strictly forbidden (`SandboxPolicyError: Host process execution fallback is forbidden`).
    2. In production, container execution without live `runsc` gVisor runtime is rejected fail-closed (`SandboxPolicyError: Configured sandbox runtime 'runsc' is unavailable in Docker daemon. Helper execution is unsupported and blocked in production mode.`).
    3. In authorized dev/test environment (`ALLOW_DEV_HOST_SANDBOX=true`), helper scripts run connected to `SandboxRunner` with environment sanitization and resource/timeout bounds.
    - All 4 tests in `sandbox-runner.test.js` pass.
- **Deterministic Linux Acceptance Artifacts Created:**
  - Script: [`scripts/verify-gate3-linux-acceptance.sh`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/scripts/verify-gate3-linux-acceptance.sh) containing 9 deterministic verification phases.
  - Runbook: [`docs/runbooks/GATE_3_LINUX_RUNSC_ACCEPTANCE_RUNBOOK.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/docs/runbooks/GATE_3_LINUX_RUNSC_ACCEPTANCE_RUNBOOK.md).
- **Next Action:** Proceed with independent Epic 4 (Complete Frontend Content-Model Migration) under the authorized exception.

### 2026-09-17 — Epic 4 Acceptance Evidence Repaired & Review Gate 4 Reached (Awaiting User Approval)

- **Epic/chunk:** Epic 4 Acceptance Evidence Repaired (Review Gate 4 stopped awaiting explicit user approval).
- **Starting point:** Authorized dependency exception; branch `dev`; dirty worktree preserved; Gate 3 remains blocked by unavailable Linux/gVisor runtime evidence and production-path helper dispatch.
- **Accepted Guidance & Constraints:**
  - `Page.content` migration preserved without rewrite.
  - Every test that copied or simulated `App.tsx` or `MarkdownEditor` logic was removed or reclassified. Source-inspection checks are explicitly not counted as rendered component acceptance tests.
  - Operational behaviors extracted from `App.tsx` into standalone production modules in `apps/web-app/src/operations/`:
    - `vault-actions.ts`: `createVaultApi`, `movePageApi` (production API wrappers with HTTP status verification and auth headers)
    - `page-save-actions.ts`: `applyPageSave` (state transform, OCC timestamps, wiki-link refactoring across pages, and front_matter.body scrubbing), `savePageContentApi`
    - `ai-content-transforms.ts`: `applyAiContentTransform` (replace, append, insert on `Page.content` with scrubbed front_matter.body)
    - `wiki-link-actions.ts`: `insertWikiLink` (appends `[[target]]` to `Page.content`), `resolveOutgoingLinks`
    - `import-pipeline.ts`: `processImportPages` (adapts legacy pages, indexes internal wiki-links)
    - `export-packaging.ts`: `buildExportZipPackage`, `serializePageToMarkdown`, `createSafeExportFilename`
    - `index.ts`: Barrel exports
  - `App.tsx` refactored to delegate directly to these production operations modules.
  - `MarkdownEditor.tsx` bug fix: save failure previously set `savedFeedback = true` and `isDirty = false` in `finally`, incorrectly indicating saved state on failure. Fixed by setting `syncError = true`, keeping `isDirty = true`, suppressing `savedFeedback`, setting `data-state="error"` and rendering `<AlertTriangle /> Save failed`.
  - `components-runtime.test.js`: Removed simulation classes (`WikiLinkPickerRuntime`, `resolveEditorBody` simulation), retaining 6 pure graph geometry and relational math tests.
- **Dedicated Production-Module Unit Test Suite (`apps/web-app/test/operations-modules.test.js`):**
  - 15 unit tests importing directly from production modules in `src/operations/index.js` and `src/utils/legacy-import-adapter.js`.
- **Pure DOM-Rendered React Component Suite (`apps/web-app/test/rendered-components.test.js`):**
  - 14 tests mounted via React 18 `createRoot` and `act` in `jsdom` with ESM loader hook:
    1. `MarkdownEditor`: initial load renders title and body strictly from `Page.content`
    2. `MarkdownEditor`: switching the `page` prop updates the editor content
    3. `MarkdownEditor`: autosave/publish success displays saved indicator (`data-state="saved"`, "Draft saved")
    4. `MarkdownEditor`: failed save does not display a saved/success state and surfaces error indicator (`data-state="error"`, "Save failed")
    5. `CreateVaultModal`: surfaces server error in DOM alert and keeps modal open
    6. `CreateVaultModal`: on server success calls onClose and resets inputs
    7. `MoveToVaultModal`: surfaces server error in DOM and does not close modal
    8. `MoveToVaultModal`: on server success calls onClose
    9. `ConvertNoteToSkillModal`: populates system instructions strictly from `Page.content`
    10. `ConvertNoteToSkillModal`: prioritizes `Page.content` even if legacy `front_matter.body` exists
    11. `ConvertNoteToSkillModal`: dispatches converted skill payload with instructions from `Page.content`
    12. `ImporterModal`: renders and triggers onImportComplete calling production import pipeline
    13. `ExportModal`: renders and triggers onConfirmExport calling production export packaging
    14. `AppShell`: vault switching preserves note content across vaults without body loss
- **Honest Test Categorization (113 tests in `@tkxel-vault/web-app`):**
  - **Rendered component tests:** 14 tests (`rendered-components.test.js` mounting components via React DOM).
  - **Production-module unit tests:** 22 tests (15 in `operations-modules.test.js`, 7 in `storage-browser-plaintext-audit.test.js`).
  - **Relational / graph logic tests:** 6 tests (`components-runtime.test.js`).
  - **Source-inspection checks:** 52 tests (lint-style AST/regex checks across design/accessibility baselines, reported separately).
  - **Other behavioral/feature unit tests:** 19 tests across autosave, graph data, folder organization, MCP connect config, and notes AI client.
- **Verification Evidence:**
  - `pnpm --filter @tkxel-vault/web-app typecheck`: 0 errors.
  - `pnpm --filter @tkxel-vault/web-app test`: 113 passed, 0 failed.
  - `pnpm build`: 6/6 successful across monorepo.
  - `node_modules/.bin/turbo.cmd run test --force`: Complete uncached monorepo suite: 298 passed, 0 failed (12/12 tasks successful, 0 cached):
    - `@tkxel-vault/types`: 5 passed
    - `@tkxel-vault/vault-core`: 38 passed
    - `@tkxel-vault/skill-runner`: 87 passed
    - `@tkxel-vault/api-server`: 18 passed
    - `@tkxel-vault/mcp-gateway`: 37 passed
    - `@tkxel-vault/web-app`: 113 passed
  - Release-claim guard suite: 4 passed.
  - Total cumulative known-passing inventory: **302 passed, 0 failed**.
- **Gate 3 Status:** Remains strictly **BLOCKED** by (1) unavailable Linux/gVisor runtime evidence, and (2) missing production-path helper dispatch. (Gate 3 not touched).
- **Next Action:** Review Gate 4 approved; proceed to Epic 5.

### 2026-09-17 — Gate 4 Corrections Verified & Review Gate 4 Approved; Epic 5 Authorized and Starting

- **Gate 4 Corrections Completed & Verified:**
  1. **Importer Rendered Test Repaired:** In `apps/web-app/test/rendered-components.test.js`, eliminated simulated result shortcut. Test now mounts the real `ImporterModal`, dispatches genuine drag-and-drop file upload with in-memory Markdown containing legacy `front_matter.body`, clicks the rendered "Import to Vault" button, triggers `onImportComplete`, processes through production `processImportPages`, and verifies content migration to `Page.content` and removal of `front_matter.body`.
  2. **AppShell Test Claim Corrected:** Restricted test scope to proving real vault-switch interaction (`AppShell: vault switcher interaction triggers onSelectVault callback and updates current vault display`) without checking unmanaged external state objects.
  3. **React Test Warnings Eliminated:** Added test lifecycle cleanup (`afterEach` with `root.unmount()`, DOM clearing, storage reset), initialized storage defaults for AI and autosave, drained microtasks on initial TipTap renders, and properly awaited feedback timers inside `act(...)`. All 14 tests in `rendered-components.test.js` now execute completely warning-free.
  4. **Documentation Reconciled:** Synchronized all figures across tables and summaries. Authoritative results: 14 rendered component tests, 15 production-operation tests, 113 web-app tests, 298 uncached monorepo tests from last recorded complete run, 4 release-claim guard tests, 302 cumulative recorded passing inventory.
- **Gate 4 Formal Status:**
  “Approved with acceptance evidence repaired. Epic 5 is authorized and is now starting.”
- **Gate 3 Status Preserved (Strictly BLOCKED):**
  1. Missing live Linux/gVisor `runsc` evidence.
  2. Missing production-path helper dispatch through the real MCP/HTTP `run_skill` path.
- **Verification Evidence (Pre-Epic 5 Sequence):**
  1. `apps/web-app/test/rendered-components.test.js`: 14/14 passed, 0 warnings.
  2. `apps/web-app/test/operations-modules.test.js`: 15/15 passed.
  3. `pnpm --filter @tkxel-vault/web-app test`: 113/113 passed.
  4. `pnpm --filter @tkxel-vault/web-app build`: 0 errors (built in 48.66s).
  5. `node scripts/verify-release-claims.test.mjs`: 4/4 passed.
- **Epic 5 Initiated:** Smallest safe first task identified and started.

### 2026-09-17 — Epic 5 Chunk 5.1 Complete: PostgreSQL Full-Text Lexical Ranking & Search Invariants Verified

- **Scope Completed:** Epic 5 Chunk 5.1 (PostgreSQL full-text lexical ranking via `ts_rank_cd`, safe `websearch_to_tsquery` parsing, title/tag boosting, deterministic tie-breaking, safe metadata-only snippets, and live PostgreSQL integration test suite).
- **Scope Explicitly Deferred:** Chunk 5.2 (Semantic Embeddings) remains unstarted. Review Gate 5 remains unapproved (pending).
- **Gate 3 Status Preserved:** Remains strictly **BLOCKED** by (1) unavailable Linux/gVisor `runsc` runtime evidence, and (2) missing production-path helper dispatch through the real MCP/HTTP `run_skill` path.
- **Production Search Implementation (`services/vault-core/src/search/index.ts` & `hybrid.ts`):**
  1. **Accurate Terminology & Ranking Function:** Lexical search uses native PostgreSQL `tsvector`/`tsquery` cover-density ranking via `ts_rank_cd(c.tsv_content, q.query_parsed)`. It is accurately named and never referred to as BM25 in code comments, types, or logs.
  2. **Safe Query Parsing:** Uses `websearch_to_tsquery('english', query)` to safely parse standard user input including quoted phrases (`"exact phrase"` via adjacency `<->`), boolean `OR` (`|`), and exclusions (`-term` via `& !'term'`). Punctuation is stripped safely without SQL errors, avoiding string concatenation or raw `to_tsquery` vulnerabilities.
  3. **Documented Weights & Boosts:**
     - Content match: `ts_rank_cd(c.tsv_content, q.query_parsed)` base density score.
     - Title match boost: `+0.50` if title matches `q.query_parsed` or fallback `ILIKE`.
     - Tag match boost: `+0.20` if `tags` matches `q.query_parsed` or fallback `ILIKE`.
     - Arbitrary `1 / (idx + 1)` score fallbacks eliminated; real `rank_score` preserved directly when vector results are 0.
  4. **Deterministic Ordering:** SQL query strictly orders by `rank_score DESC, p.id ASC, COALESCE(c.position, 0) ASC, COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) ASC`.
  5. **Real Metadata Preservation:** Returned items map real database `p.type` and `p.tags` from row results without hardcoding `'note'` or `[]`.
  6. **Snippet Safety (ADR-017):** In-memory DEK is not loaded during search; raw `tsv_content` stemmed lexemes (such as `'canari':1 'open':2`) are never exposed. Snippet is strictly returned as empty string (`snippet: ''`), acting as a safe metadata-only result.
  7. **Strict Vault Isolation & Fail-Closed Guardrails:** Every query enforces `WHERE p.vault_id = ${vaultId}::uuid`. Input `vaultId` is validated against a strict UUID regex to prevent database syntax errors on malformed input. Locked vaults (`mode === 'locked'`), unknown/nonexistent vaults, and empty/whitespace queries return empty arrays `[]` immediately without disclosing document existence.
- **Embedding Provider Status (Honest Representation):**
  - Current code shows `searchPages` and `versions/index.ts` call `getEmbeddingProvider()`.
  - In `services/vault-core/src/search/embedding-provider.ts`, when `OPENAI_API_KEY` is not provided, the factory returns `LocalDeterministicEmbeddingProvider`.
  - Therefore, the deterministic provider remains reachable as a production fallback; semantic embedding behavior is **not production-ready**.
  - Chunk 5.2 must remove or fail-close that fallback and implement the genuine provider boundary.
  - In the lexical integration test suite, `OPENAI_API_KEY` is temporarily cleared from `process.env` during test execution and restored in `finally`, ensuring no hosted API was called.
- **Database-Backed Integration Test Suite (`services/vault-core/test/postgres-lexical-ranking.test.js`):**
  - Connects to the active Docker Compose PostgreSQL service (`pgvector/pgvector:pg16` on `localhost:5432`).
  - Seeds isolated Open Vault 1, Open Vault 2, and Locked Vault with versions and tsvector chunk rows.
  - Tests and proves all 13 acceptance criteria:
    1. *Criterion 1:* Higher term density yields strictly higher `ts_rank_cd` lexical score.
    2. *Criterion 2 (Repaired):* Title-boost comparative test with identical content control page (`pageTitleControlId`). Both pages are returned; title-matched page appears first; score delta is approximately `+0.50` (`Math.abs(delta - 0.50) < 0.05`).
    3. *Criterion 3 (Repaired):* Tag-boost comparative test with identical content non-tagged control page (`pageTagControlId`). Both pages are returned; tag-matched page appears first; score delta is approximately `+0.20` (`Math.abs(delta - 0.20) < 0.05`).
    4. *Criterion 4:* Quoted phrase (`"distributed consensus"`) enforces strict token adjacency via `<->`.
    5. *Criterion 5:* User punctuation handled safely without SQL syntax errors.
    6. *Criterion 6:* Safe support for `OR` operators and `-term` exclusions.
    7. *Criterion 7 (Accurately Reported):* Deterministic tie-breaking behaviorally tests `page_id ASC`. Chunk-position and chunk-ID ordering are encoded in production SQL (`c.position ASC, c.id ASC`), but are not externally observable in page-level response due to page deduplication (`seenPages.has(item.pageId)`). No chunk-level behavioral proof is claimed.
    8. *Criterion 8:* Real database page `type` and `tags` are preserved without hardcoding.
    9. *Criterion 9:* Cross-vault isolation strictly excludes pages from other vaults.
    10. *Criterion 10:* Locked vaults return `[]` with zero document disclosure.
    11. *Criterion 11:* Unknown UUID or malformed vault ID returns `[]` without error.
    12. *Criterion 12:* Empty or whitespace query returns `[]` immediately.
    13. *Criterion 13:* Safe metadata-only snippets: `snippet` is empty string and never leaks `tsvector` lexemes.
  - Teardown safety: Database rows are deleted in `finally`; any cleanup error throws and fails the test.
  - Result: **14/14 tests pass** (duration ~13.3s).
- **Authoritative Test Accounting:**
  - `@tkxel-vault/types`: 5 passed (historical)
  - `@tkxel-vault/vault-core`: 91 passed (verified newly: 14 lexical ranking, 7 ciphertext canary audit, 6 unit hybrid search, 25 versioning/crypto/auth/schema, 10 boundary tests, 12 reliability tests, 8 isolation tests, 9 semantic retrieval/lifecycle tests)
  - `@tkxel-vault/skill-runner`: 87 passed (historical)
  - `@tkxel-vault/mcp-gateway`: 37 passed (verified newly with explicit test-provider config)
  - `@tkxel-vault/api-server`: 18 passed (verified newly with explicit test-provider config)
  - `@tkxel-vault/web-app`: 113 passed (historical)
  - Monorepo package tests: **351 passed, 0 failed**.
  - Release-claim guard tests: **4 passed** (`scripts/verify-release-claims.test.mjs`).
  - Cumulative known-passing test inventory: **355 passed, 0 failed**.

---

### Epic 5 Completion Checkpoint & Review Gate 5 Verification (2026-09-17)

- **Scope Completed:** All Epic 5 chunks (Chunk 5.1, Chunk 5.2A, Chunk 5.2B, Chunk 5.2C, Chunk 5.3, Chunk 5.4) fully implemented and verified.
- **Review Gate 5 Status:** **APPROVED**.
- **Review Gate 4 Status:** **APPROVED** (retained).
- **Review Gate 3 Status:** **BLOCKED** by:
  1. Unavailable Linux/gVisor `runsc` runtime evidence on this host.
  2. Missing production-path helper dispatch through the real MCP/HTTP `run_skill` path.
- **Hosted API Confirmation:** ZERO hosted or outbound API calls were made during implementation or verification. All tests ran locally against local Docker PostgreSQL/pgvector and injected/stubbed in-memory fixtures.
- **Provider-Selection Rules (Chunk 5.2A):**
  1. Production with no provider configured fails closed (`EmbeddingConfigurationError`).
  2. Production with `EMBEDDING_PROVIDER=deterministic` is strictly rejected and throws `EmbeddingConfigurationError`.
  3. Production OpenAI configuration requires a non-empty `OPENAI_API_KEY`; empty or whitespace keys fail closed.
  4. Unknown provider names fail closed.
  5. Deterministic provider is permitted ONLY when explicitly configured as `deterministic` AND runtime is an authorized test environment (`NODE_ENV=test`).
  6. Provider is never implicitly selected from API key presence or absence.
  7. API keys and secrets are never logged or included in thrown error messages or serialized JSON.
  8. Vector dimension is strictly preserved as 1536.
- **Timeout, Retry, Batching & Validation (Chunk 5.2B & 5.2C):**
  1. Explicit request timeout (`DEFAULT_TIMEOUT_MS = 5000` or configurable) safely aborts hanging requests via `AbortController`.
  2. Bounded retries for explicitly retryable failures only (HTTP 429, 500, 502, 503, 504, network errors, timeouts).
  3. Non-retryable failures (400, 401, 403, 404, malformed response, dimension mismatch) fail closed immediately without retries.
  4. Bounded exponential backoff with configurable `delayFn` enables fast, delay-free unit testing.
  5. Maximum batch size (`DEFAULT_MAX_BATCH_SIZE = 100` or configurable) preserves 1:1 input ordering across batches.
  6. Empty input array returns `[]` with zero network calls.
  7. Strict response-shape validation: validates `data` array, item count match, sequential indices, and finite numerical values (`Number.isFinite`).
  8. Vector dimension validation: enforces exact 1536 dimension per vector.
  9. Never silently substitutes deterministic vectors on provider failure.
- **Zero-Provider Activity on Locked & Unknown Vaults:**
  1. Locked vault search returns `[]` with zero provider construction or calls.
  2. Locked vault `saveDraft` and `publishVersion` write encrypted version blobs and delete chunks with zero provider calls.
  3. Locked vault `reindexPage` and `reindexVault` return `skipped_locked` with zero provider calls.
  4. Unknown vault search returns `[]` with zero provider calls.
  5. Unknown vault reindexing throws `not_found` with zero provider calls.
  6. Vault existence and mode checks are strictly executed prior to any provider activity.
- **Semantic Retrieval & Hybrid Search (Chunk 5.3):**
  1. Dense vector search uses PostgreSQL pgvector cosine distance (`1 - (c.embedding <=> vector::vector)`) filtered by relevance threshold (>0.25).
  2. Lexical search preserves cover-density ranking (`ts_rank_cd`), title boost (+0.50), tag boost (+0.20), safe query parsing, and deterministic tie-breaking.
  3. Hybrid mode combines lexical and vector candidate rankings using Reciprocal Rank Fusion (RRF, k=60).
  4. Search results are honestly labeled with their source (`hybrid`, `lexical`, or `vector`): results present only in lexical rankings are labeled `lexical`, only in vector rankings are labeled `vector`, and present in both rankings are labeled `hybrid`.
  5. If semantic search fails or provider is unconfigured in hybrid mode, it gracefully degrades to lexical results with `source: 'lexical'`, never mislabeling them as `hybrid`.
  6. Pure `semantic` mode fails closed and never falls back to lexical.
- **Deletion, Reindexing, and Lifecycle Semantics (Chunk 5.4):**
  1. `deletePage` atomically removes chunks, links, versions, and the page row, guaranteeing zero orphaned embeddings.
  2. `reindexPage` generates and validates all embeddings before database mutation, preventing partial semantic state on failure.
  3. Reindexing is idempotent: multiple runs produce identical chunk counts with zero duplicate vectors.
  4. Updating content via `saveDraft` replaces old chunks and purges obsolete lexemes.
  5. Centralized runtime validator (`validateEmbeddingBatch`) rejects batch count mismatch, missing vectors, dimensions other than 1536, and non-numeric/NaN/infinite values before any DB mutation in `saveDraft`, `publishVersion`, and `reindexPage` (with the legacy `indexChunksForPage` helper eliminated).
- **Package Tests, Benchmark & Monorepo Status:**
  - `@tkxel-vault/vault-core`: 97/97 tests pass (including unit and database regression tests for centralized validator and source labeling); package build (`tsc`) succeeds with 0 errors.
  - Opt-in 10,000-Page Performance Benchmark (`node scripts/benchmark-10k.js`):
    - Lexical p95: 103.14ms (target < 500ms, PASS)
    - Semantic p95: 152.40ms (target < 500ms, PASS)
    - Hybrid p95: 212.13ms (target < 500ms, PASS)
    - Automated cascading cleanup verified.
  - Monorepo package test suite breakdown: 357 passing tests across all 6 packages (113 web-app, 97 vault-core, 87 skill-runner, 37 mcp-gateway, 18 api-server, 5 types).
  - Cumulative test count (357 monorepo package tests + 4 release-claim guard tests): **361 passing**.
  - Release-claim guard (`node scripts/verify-release-claims.test.mjs` && `node scripts/verify-release-claims.mjs`): 4/4 tests pass.

---

### Epic 6 Chunk 6.1 Completion: Transactional Vault Creation & Invariant Enforcement (2026-09-17)

- **Scope Completed:** Epic 6 Chunk 6.1 (Transactional Vault Creation, Server-Side Validation, Key Uniqueness, Key Material Zeroing, and Client Response Anti-Disclosure).
- **Scope Explicitly Deferred:** Chunk 6.2 (Atomic Page Movement) and Chunk 6.3 (Cross-Vault Link Policy). Review Gate 6 remains pending.
- **Gate 3 Status Preserved:** Remains strictly **BLOCKED** by (1) unavailable Linux/gVisor runtime evidence, and (2) missing production-path helper dispatch through the real MCP/HTTP `run_skill` path.
- **Implementation Highlights:**
  1. **Transactional Core (`services/vault-core/src/vault/create-vault.ts`):**
     - Single atomic `db.transaction`: sets RLS session context (`set_config('app.current_user_id', ...)`), inserts `schema.vaults`, automatically inserts owner grant in `schema.shares`, and appends immutable `create_vault` event in `schema.auditEvents`.
     - Full rollback verification: failure during share or audit emission cleanly rolls back, leaving zero orphaned vault, share, or audit rows.
  2. **Cryptographic Zero-Trust (Invariant 2):**
     - Generates 32-byte DEK via `EnvelopeEncryption.generateDek()`, wraps it via KMS (`wrapKey`), and wipes the raw DEK in memory (`rawDek.fill(0)`) in a `finally` block.
     - Each vault receives an independently generated, unique KMS-wrapped DEK.
     - `createVault` return result omits `data_key_id` by default to prevent leaking wrapped KMS ciphertext to browser clients.
  3. **Server-Side Validation:**
     - Strict validation of name (1..255 trimmed non-empty characters), mode (`'open' | 'locked'`), and export policy (`strictly_forbidden` enforced for locked vaults, `allowed_for_owner` default for open vaults; conflicting policies throw `VaultValidationError`).
  4. **API Hardening & Integration (`apps/api-server/src/server.ts`):**
     - Refactored `POST /api/vaults` to normalize and validate request bodies before destructuring (`!req.body || typeof req.body !== 'object' || Array.isArray(req.body)` returns HTTP 400).
     - Delegates directly to production `createVault`, returning HTTP 201 with clean client model (no `data_key_id`) and mapping `VaultValidationError` to HTTP 400.
  5. **Verification & Test Accounting:**
     - `services/vault-core/test/vault-creation-lifecycle.test.js`: 6/6 tests pass (duration ~1.0s) covering PostgreSQL atomic creation, rollback on failure, key uniqueness, and validation.
     - `apps/api-server/test/vault-crud.test.js`: 3/3 tests pass, including production-function unit test, user listing, and genuine HTTP integration test (`POST /api/vaults` against Express app on ephemeral port confirming HTTP 201, `data_key_id` omission, owner identity, database verification in PostgreSQL, and HTTP 400 validation on invalid mode, conflicting policy, and missing/null bodies).
     - `@tkxel-vault/vault-core`: 103/103 tests pass; package build (`tsc`) succeeds with 0 errors.
     - `@tkxel-vault/api-server`: 19/19 tests pass; package build (`tsc`) succeeds with 0 errors.
     - Monorepo package test suite breakdown: **364 passing tests** across all 6 packages (113 web-app, 103 vault-core, 87 skill-runner, 37 mcp-gateway, 19 api-server, 5 types).
     - Cumulative known-passing test inventory: **368 passing** (364 monorepo package tests + 4 release-claim guard tests).
     - Release-claim guard (`node scripts/verify-release-claims.test.mjs` && `node scripts/verify-release-claims.mjs`): 4/4 tests pass; compliance report remains in remediation state.
- **Review Gate 6 Status:** Pending (awaiting Chunk 6.3). Chunks 6.1 and 6.2 are approved and Chunk 6.3 is authorized.

---

### Epic 6 Chunk 6.2 Completion: Atomic Page Movement, Shared Page-Mutation Locking & Concurrency Race Invariants (2026-09-17)

- **Scope Completed:** Epic 6 Chunk 6.2 (Shared Page-Mutation Locking Contract across all 5 mutating operations, Post-Lock DEK and Optimistic Concurrency Resolution, Clean Production API without `_injectFailureStep`, Injected Database/Transaction Fault Seams for Post-Mutation Rollback, Deterministic Live PostgreSQL Concurrency Races with Controllable Barriers, Multi-Version & Multi-Chunk Cryptographic Re-Encryption across distinct KMS DEKs, Mode-Aware Index Segregation per ADR-017, Authorization & Uniform Anti-Disclosure, and API Route 500 Hardening).
- **Scope Explicitly Deferred:** Chunk 6.3 (Cross-Vault Link Policy). Review Gate 6 remains pending.
- **Gate 3 Status Preserved:** Remains strictly **BLOCKED** by (1) unavailable Linux/gVisor runtime evidence, and (2) missing production-path helper dispatch through the real MCP/HTTP `run_skill` path.
- **Implementation Highlights:**
  1. **Shared Page-Mutation Locking Contract (`services/vault-core/src/storage/page-lock.ts`):**
     - Implemented `lockPageForMutation(tx, pageId, options?: { expectedVaultId?: string })` acquiring a page-scoped row-level exclusive lock (`pages FOR UPDATE`) inside a database transaction before any authoritative reads or mutations.
     - Fail closed: Throws an explicit error if the database adapter cannot provide required row-level locking (`typeof query.for !== 'function'`), never silently skipping security locks.
     - Unified across all 5 page-mutating operations:
       1. `movePage` (`services/vault-core/src/vault/move-page.ts`)
       2. `saveDraft` (`services/vault-core/src/versions/index.ts`)
       3. `publishVersion` (`services/vault-core/src/versions/index.ts`)
       4. `reindexPage` (`services/vault-core/src/search/lifecycle.ts`)
       5. `deletePage` (`services/vault-core/src/search/lifecycle.ts`)
  2. **Post-Lock Optimistic Concurrency & DEK Resolution:**
     - `saveDraft`: acquires `lockPageForMutation(tx, pageId)` first, rechecks `expectedUpdatedAt` after acquiring the lock, resolves vault identity and unwraps the authoritative DEK after locking. Encrypts draft and generates/validates embeddings under the active lock. Page update uses compound predicate `where(and(eq(pages.id, pageId), eq(pages.vault_id, lockedPage.vault_id)))`.
     - `publishVersion`: acquires `lockPageForMutation(tx, pageId)` first, resolves vault and unwraps DEK after locking, updates draft to published, and updates `pages` with compound predicate `where(and(eq(pages.id, pageId), eq(pages.vault_id, lockedPage.vault_id)))`.
     - `deletePage` & `reindexPage`: wrap all mutations inside `db.transaction`, acquire `lockPageForMutation(tx, pageId, { expectedVaultId: vaultId })`, and fail closed on row lock unavailability.
  3. **Production API Hardening & Fault Seams:**
     - Removed `_injectFailureStep` from production `MovePageOptions` API.
     - Production code has zero test-only flags.
     - Rollback tests in `services/vault-core/test/vault-move-lifecycle.test.js` use genuine database/transaction proxy fault seams where real PostgreSQL updates/inserts execute in the transaction before an injected database error triggers a full PostgreSQL `ROLLBACK`.
  4. **Multi-Version & Multi-Chunk Cryptographic Re-Encryption:**
     - Unwraps source DEK and destination DEK using pluggable `KmsProvider`.
     - Decrypts every version and chunk under `sourceDek` and re-encrypts under `destDek`.
     - Post-move assertion proves source DEK fails to decrypt (`EnvelopeEncryption.decryptToString` throws), while destination DEK decrypts recovered plaintext.
     - Raw in-memory DEK buffers are zeroed (`rawDek.fill(0)`) in `finally`.
  5. **Mode-Aware Search Index Lifecycle (ADR-017):**
     - Moving to locked destination: strictly enforces zero-read protection by deleting all chunk, tsvector, and embedding records (`db.delete(chunks).where(eq(chunks.page_id, pageId))`).
     - Moving to open destination:
       - If moved from open: re-encrypts existing chunk ciphertext under `destDek`.
       - If moved from locked (where 0 chunks existed): chunks latest plaintext via `MarkdownChunker`, generates and validates 1536-dim embeddings via `validateEmbeddingBatch`, and inserts encrypted chunks with tsvectors into `chunks` under `destDek`.
  6. **Deterministic Concurrency Race Invariants (Controllable Barriers):**
     - Implemented 4 live PostgreSQL concurrency tests with deterministic `createBarrier()` coordination and query builder proxy interception:
       1. **Concurrent `saveDraft` and `movePage`:** `saveDraft` holds page lock; `movePage` blocks in PostgreSQL lock manager; `saveDraft` finishes; `movePage` unblocks, sees updated draft, and re-encrypts all versions/chunks to destination DEK.
       2. **Concurrent `publishVersion` and `movePage`:** `publishVersion` holds page lock; `movePage` blocks; `publishVersion` commits published status; `movePage` unblocks and re-encrypts published version and chunks to destination DEK.
       3. **Two concurrent moves of the same page:** Move 1 holds page lock; Move 2 blocks; Move 1 moves page from Source to Open Dst; Move 2 unblocks, reconfirms page in Open Dst, moves page to Locked Dst, and purges all chunks per ADR-017.
       4. **Concurrent `reindexVault` and `movePage`:** `reindexVault` enumerates pages in locked source vault; `movePage` moves page to open destination generating chunks under destination DEK; `reindexVault` resumes, calls `reindexPage` which acquires `lockPageForMutation`, sees page no longer belongs to source vault (`expectedVaultId` mismatch throws `'not_found'`), and skips the stale page without deleting destination open-vault chunks.
     - Verified after every race:
       - Page belongs to exactly one vault.
       - Every version and chunk decrypts ONLY with that final vault's DEK, while previous DEKs fail.
       - Locked destinations have zero chunks; open destinations have valid chunks and search indexes.
       - Audit events describe only committed transitions.
  7. **API Route Hardening (`apps/api-server/src/server.ts`):**
     - `POST /api/pages/:id/move` normalizes and validates request bodies (returns HTTP 400 for null, missing, or non-object bodies).
     - Checks non-empty `destination_vault_id` and maps errors (`VaultValidationError` -> 400, `not_found` -> 404, `not_allowed` -> 403).
     - Unexpected internal errors are logged server-side and return strictly `{ "error": "Internal Server Error" }` for HTTP 500, never leaking KMS, SQL, or decryption error messages.
   8. **Verification & Test Accounting:**
      - `services/vault-core/test/vault-move-lifecycle.test.js`: 12 Node tests total (11 child cases plus the parent suite, 12/12 pass) against live Docker PostgreSQL/pgvector (duration ~11.8s) covering all 7 lifecycle/rollback invariants plus all 4 deterministic concurrency races.
      - `apps/api-server/test/vault-crud.test.js`: 4/4 tests pass, including genuine HTTP integration test for `POST /api/pages/:id/move` against Express app verifying body validation (HTTP 400), anti-disclosure rejection (HTTP 404), successful move (HTTP 200), and internal error sanitization (HTTP 500 strictly returning generic `{ error: "Internal Server Error" }`).
       - Current `@tkxel-vault/vault-core` result at Chunk 6.2 completion: **115 passed, 0 failed**; package build (`tsc`) succeeds with 0 errors.
       - `@tkxel-vault/api-server`: 20/20 tests pass; package build (`tsc`) succeeds with 0 errors.
       - Last complete monorepo run: **376 passed** before the latest Vault Core test was added (breakdown from last complete run: 113 web-app, 114 vault-core, 87 skill-runner, 37 mcp-gateway, 20 api-server, 5 types). Note: do not calculate or claim a new monorepo total because the complete monorepo suite was not rerun for this focused chunk completion.
       - Current release-claim guard: **4 passed** (`scripts/verify-release-claims.test.mjs` and `scripts/verify-release-claims.mjs`); compliance report remains in remediation state.
- **Review Gate 6 Status at Chunk 6.2:** Pending (awaiting Chunk 6.3). Chunk 6.2 implementation is approved.

---

### Epic 6 Chunk 6.3 Completion & Review Gate 6 Reached: Cross-Vault Link Policy, Ghost Links & Graph Integrity (2026-09-18)

- **Scope Completed:** Epic 6 Chunk 6.3 (Strict Vault-Local Link Boundary, Ghost Links for Unresolved/Cross-Vault Targets, Atomic Move Reconciliation inside Transaction, Same-Title/Alias Collision Pre-Check & Fail-Closed Abort, Zero-Read Locked Outbound Link Purging, Inbound Alternative Re-Resolution, Destination Ghost Link Resolution, SQL Boundary Invariant Verification, Boundary Hardening across REST, Import, MCP, and ContextAssembler, and ADR-018 Documentation).
- **Review Gate 6 Status:** Explicitly approved by the user on 2026-09-18. Epic 7 remains blocked by unavailable Linux/gVisor evidence for Review Gate 3.
- **Architectural Decision Record (ADR-018):**
  - Path: `docs/adr/ADR-018-cross-vault-link-policy.md`.
  - Core Rule: Every resolved link must have `from_page.vault_id == to_page.vault_id`. No cross-vault resolved link may ever exist in storage or query results.
  - Ghost Links: Wiki-links pointing to pages outside the owning vault or nonexistent pages are stored with `to_page_id = null` and `resolved = false`. Raw Markdown text in version blobs is never rewritten (`[[Link]]` preserved byte-for-byte).
  - Mode Policy: Moving to locked vault purges all outgoing links from `links` table. Moving to open vault parses latest published version content and reconciles links against destination pages.
- **Implementation Highlights:**
  1. **LinkGraphIndexer Upgrade (`services/vault-core/src/markdown/indexer.ts`):**
     - Upgraded class methods to accept optional transaction handle `tx` to execute atomically inside caller's transaction.
     - `updateLinksForPage(vaultId, pageId, content, tx?)`: fetches candidate target pages in `vaultId`; uniquely matching targets resolve (`resolved = true, to_page_id = target.id`); ambiguous matches (multiple pages sharing title/alias) or absent targets store as ghost links (`resolved = false, to_page_id = null`). If vault is locked, purges all outgoing links.
     - `resolveIncomingGhostLinks(vaultId, targetPageId, title, aliases, tx?)`: finds existing ghost links in `vaultId` whose `link_text` matches `title` or `aliases` and resolves them (`to_page_id = targetPageId, resolved = true`).
     - `reconcileLinksOnPageMove(params)`:
       - Step 1: Pre-mutation collision check: searches destination vault for existing pages with matching title or aliases. If collision found, throws `VaultValidationError` aborting the transaction before mutations.
       - Step 2: Inbound source links: finds all links pointing to moved page. If an alternative page with matching title/alias exists in source vault, re-resolves to it; otherwise converts link to ghost link (`to_page_id = null, resolved = false`).
       - Step 3: Outbound links: if destination is locked, deletes all outgoing links; if destination is open, parses latest published Markdown and resolves links against destination vault pages.
       - Step 4: Destination ghost links: resolves existing unresolved ghost links in destination vault matching moved page's title/aliases to the moved page.
       - Step 5: Post-reconciliation verification: runs SQL invariant query asserting 0 cross-vault links and 0 outgoing links for locked vaults.
  2. **Atomic Integration in `movePage` (`services/vault-core/src/vault/move-page.ts`):**
     - Invoked `LinkGraphIndexer.reconcileLinksOnPageMove` inside the existing transaction `tx` after page update and chunk re-indexing, but before audit emission.
     - Failure during link reconciliation rolls back all mutations (page vault assignment, re-encrypted versions, re-encrypted chunks).
  3. **Read Boundary Hardening:**
     - `GET /api/vaults/:vaultId/links` (`apps/api-server/src/server.ts`): inner-joins both `from_page_id` and `to_page_id` to `pages` in `vaultId` with `resolved = true`.
     - `POST /api/vaults/:vaultId/import` (`apps/api-server/src/server.ts`): verifies both `from_page_id` and `to_page_id` belong to `vaultId`; non-local `to_page_id` converts to ghost link.
     - MCP `getLinks` & `getPage` backlinks (`services/mcp-gateway/src/tools/postgres-store.ts`): inner-joins both endpoints to `pages` in `vaultId` with `resolved = true`.
     - `ContextAssembler.getContext` (`services/vault-core/src/search/getContext.ts`): filters outbound and backlinks to `resolved = true` and `pages.vault_id = vaultId`.
  4. **Test Harness Teardown Optimization & Hang Elimination:**
     - Diagnosed root cause of long test execution: pg `Pool` default `idleTimeoutMillis: 10000` held client connections open for 10 seconds after test completion, and `apps/api-server/test/production-isolation-http.test.js` had lingering client sockets and active Redis connection.
     - Configured `idleTimeoutMillis: process.env.NODE_ENV === 'test' ? 1000 : 10000` in `services/vault-core/src/db.ts` and exported `pool`.
     - Refactored `apps/api-server/test/production-isolation-http.test.js` to use `agent: false` in `apiRequest`, close tracked server sockets, quit Redis client, and end `pool` in `finally`, reducing execution time from hanging/10s+ to 2.4s.
- **Verification & Test Accounting:**
  - `services/vault-core/test/cross-vault-links.test.js`: 14 Node tests total (1 parent suite + 13 child cases, 14/14 pass against live PostgreSQL in ~850ms) covering:
    1. Outbound links re-resolve to matching destination pages when moving between open vaults.
    2. Outbound links become ghost links when target is absent in destination vault.
    3. Inbound source links convert to ghost links when target page moves out.
    4. Inbound source links re-resolve to alternative source page matching title/alias.
    5. Unresolved destination ghost links become resolved when matching page arrives.
    6. Moving to locked vault purges outgoing links and search chunks.
    7. Moving to locked vault converts inbound source links to ghost links.
    8. Link graph queries strictly enforce vault boundary and resolved state.
    9. Title collision in destination vault aborts move and rolls back.
    10. Alias collision in destination vault aborts move and rolls back.
    11. Injected failure during link reconciliation rolls back all mutations.
    12. Markdown content round-trip: raw Markdown content is preserved byte-for-byte.
    13. ContextAssembler expands links strictly within the specified vault.
  - `services/vault-core/test/vault-move-lifecycle.test.js`: 12/12 pass (zero regression in move lifecycle or concurrency races).
  - Current `@tkxel-vault/vault-core` result: **129 passed, 0 failed**; package build (`tsc`) succeeds with 0 errors.
  - Current `@tkxel-vault/api-server` result: **20 passed, 0 failed**; package build (`tsc`) succeeds with 0 errors.
  - Current `@tkxel-vault/mcp-gateway` result: **37 passed, 0 failed**; package build (`tsc`) succeeds with 0 errors.
  - Release-claim guard (`scripts/verify-release-claims.test.mjs` & `scripts/verify-release-claims.mjs`): **4 passed**; compliance report remains in remediation state.
- **Review Gate 6 Status:** Approved by the user on 2026-09-18. Do NOT start Epic 7 until Gate 3 passes.

---

### Review Gate 3 Production-Path Helper Dispatch Remediation (2026-09-18)

- **Scope completed:** The missing executable-helper dispatch is now wired through the real MCP Streamable HTTP and signed skill-runner HTTP path.
- **Encrypted package contract:** Added `tkxel-skill-package/v1`, containing protected `SKILL.md`, validated `tool.json`, and package-relative files. Legacy prompt-only encrypted `SKILL.md` payloads remain compatible.
- **Validation:** Runtime allowlist, safe entrypoint paths, package/tool/manifest name binding, parameter schemas, argument limits, missing source rejection, and a 1 MiB helper source ceiling are enforced before execution.
- **Zero-persistence dispatch:** Helper source plus serialized request input are streamed to the interpreter over stdin. Neither appears in process arguments or persistent files. The decrypted byte buffer and vault DEK continue to be overwritten after use.
- **Sandbox policy:** Production helper execution is container-only and uses the existing non-root, read-only, no-new-privileges, capability-drop, no-network, CPU/memory/PID, timeout, and gVisor fail-closed controls.
- **Audit:** Successful runner audit events record only `helper_executed` and the allowlisted runtime; they do not record source, filenames, user input, helper output, or keys.
- **Acceptance harness:** Linux Gate 3 phase 5 now runs `mcp-runner-integration.test.js` with `USE_DOCKER_SANDBOX=true` and `SANDBOX_RUNTIME=runsc`, proving MCP HTTP → signed runner HTTP → PostgreSQL authorization → KMS unwrap → encrypted package parse → sandbox helper → sanitized response.
- **Focused verification:** 14 tests pass across manifest, orchestrator, and sandbox coverage; 13 independent runner HTTP test events pass; and the focused MCP integration produced 5 passing test events. The final complete skill-runner suite produced 93 dot-reporter events with 0 failures. MCP gateway build and complete suite pass with exit status 0.
- **Remaining blocker:** Review Gate 3 is still **BLOCKED** until `scripts/verify-gate3-linux-acceptance.sh` succeeds on genuine Linux with registered `runsc`. Epic 7 has not started.
