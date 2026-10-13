# ADR-002: Selection of Database Access Layer and Defense-in-Depth Isolation (Drizzle ORM + PostgreSQL RLS)

## Status
Accepted

## Date
2026-09-08

## Context
tkxel Vault requires a relational data layer adhering to [tkxel_vault_SRS.md](../../tkxel_vault_SRS.md) Section 6, supporting:
1. PostgreSQL 16 relational integrity (`Vault`, `Page`, `Version`, `Link`, `TimelineEntry`, `Chunk`, `Skill`, `Share`, `AuditEvent`).
2. Native vector operations via `pgvector` (`vector(1536)`).
3. Full-text search tsvector columns and GIN indices.
4. Defense-in-depth isolation: server-side query filtering combined with PostgreSQL Row-Level Security (RLS) to enforce per-vault boundaries at the engine layer.

## Decision
Adopt **Drizzle ORM** with native `node-postgres` (`pg`):
- **Type Safety & Zero Runtime Bloat:** Drizzle provides compile-time TypeScript type generation without heavy binary runtimes or background daemon dependencies.
- **SQL & RLS Control:** Offers transparent SQL generation that maps 1-to-1 with PostgreSQL primitives, making it straightforward to define RLS policies, custom extension types (`vector`), and transactional rename cascades.
- **Migrations:** Emits standard, inspectable SQL migration scripts for CI/CD and production environments.

## Consequences
- Clean, auditable SQL schemas with zero opaque abstraction layers.
- Full compatibility with PostgreSQL Row-Level Security (RLS) policies.
