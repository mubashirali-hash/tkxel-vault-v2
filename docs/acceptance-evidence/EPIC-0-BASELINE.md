# Epic 0 Baseline Evidence

> Captured: 2026-09-16T16:44:52+05:00  
> Branch: `dev`  
> Commit: `2c486ffd181938bf71016b3c31be569a1ef7a422`  
> Worktree: Dirty before Epic 0; all pre-existing changes preserved

## Purpose

This is the reproducible starting point for the senior-review remediation program. A passing build or unit test is recorded as engineering evidence only. It is not proof of production isolation, ciphertext-only storage, independent sandboxing, or SRS acceptance.

## Toolchain

| Tool | Observed version/state |
|:---|:---|
| Node.js | `v24.18.0` |
| pnpm | `11.22.0` |
| Turbo | `2.10.12` |
| Docker CLI | `29.6.2` |
| Docker Compose | `v5.3.1` |
| Docker daemon | Unavailable during capture; named pipe was not running |
| Local `psql` CLI | Not installed |

The repository CI targets Node.js 22. The local baseline used Node.js 24, so CI remains the compatibility authority for Node.js 22.

## Worktree Preservation

At capture time, the repository contained pre-existing modified and untracked implementation work across API, web, MCP, runner, vault-core, and test files. No reset, checkout, clean, or deletion was performed. The authoritative dirty-file inventory remains available from `git status --short` and is summarized in `CODEX_MEMORY.md`.

## Schema and Migration State

- Tracked schema bootstrap: `scripts/init-db.sql`.
- Tracked Drizzle migration: `services/vault-core/drizzle/0000_tearful_mercury.sql`.
- Drizzle journal contains one entry: `0000_tearful_mercury`.
- PostgreSQL and Redis containers were not running, so the applied database migration state could not be queried.
- This is an environment limitation and an open evidence gap. No claim is made that a live database matches the tracked migration.

## Uncached Build

Command: `node_modules\.bin\turbo.cmd run build --force`

Result: **6/6 tasks passed, 0 cached**, in approximately 1 minute 25 seconds.

Warnings:

- Vite reported that `KnowledgeGraph.tsx` is both statically and dynamically imported.
- Vite reported several output chunks over 500 kB.
- The restricted execution sandbox initially blocked esbuild process creation with `spawn EPERM`; an approved unrestricted rerun passed. This is an execution-environment warning, not a product test failure.

## Uncached Test Run

Command: `node_modules\.bin\turbo.cmd run test --force`

Result: **12/12 tasks passed, 0 cached; 178 tests passed, 0 failed**.

| Workspace | Passing tests |
|:---|---:|
| `@tkxel-vault/types` | 5 |
| `@tkxel-vault/vault-core` | 26 |
| `@tkxel-vault/skill-runner` | 34 |
| `@tkxel-vault/api-server` | 11 |
| `@tkxel-vault/mcp-gateway` | 21 |
| `@tkxel-vault/web-app` | 81 |
| **Total** | **178** |

As with the build, the restricted sandbox initially blocked Node test-worker creation with `spawn EPERM`; the approved unrestricted rerun produced the result above.

## Test Taxonomy

The 178 executed tests are classified by their primary evidence level:

| Primary category | Tests | Acceptance value |
|:---|---:|:---|
| Source-inspection/lint-style web tests | 52 | Verifies source strings and structural conventions; not runtime UI evidence |
| Copied/simulated component logic | 10 | Exercises recreated algorithms; does not render production React components |
| Unit and in-memory module tests | 115 | Useful functional regression evidence; does not establish deployed boundaries or raw-storage behavior |
| In-process HTTP integration | 1 | Exercises the MCP server protocol in-process; does not use production identity, PostgreSQL, or deployment topology |
| Real PostgreSQL/pgvector integration | 0 | Missing |
| Rendered React component tests | 0 | Missing |
| Browser end-to-end tests | 0 | Missing |
| Deployed multi-service security tests | 0 | Missing |
| Raw database/browser ciphertext canary audits | 0 | Missing |

The excluded file `apps/api-server/src/test_isolation.test.ts` is outside the package test glob and contains a commented HTTP request, so it contributes no executed acceptance evidence.

## Claims Freeze

- Repository status remains **Remediation required**.
- Historical “fully compliant,” “10/10,” or production-ready language is not current evidence.
- CI now runs `scripts/verify-release-claims.mjs`.
- If the compliance report's explicit overall status claims production approval, the guard requires a `docs/acceptance-evidence/release-evidence.json` manifest with AC-1 through AC-10 marked passed and linked to existing, non-unit evidence files.
- Mock, source-inspection, and unit evidence kinds cannot independently satisfy the production-approval guard.

## Baseline Conclusion

The repository compiles and its current unit-oriented suite passes, but production approval remains blocked. Epic 1 must address exact-vault authorization and locked-vault disclosure before other feature work proceeds.

