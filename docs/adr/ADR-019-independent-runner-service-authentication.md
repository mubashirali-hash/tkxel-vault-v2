# ADR-019: Independent Skill Runner Trust Boundary and Service Authentication

## Status

Accepted for implementation; production-provider evidence pending.

## Date

2026-09-21

## Context

Locked-vault execution must not inherit trust merely because a request reached the MCP gateway or API server. The skill runner is a separate service and must authenticate its caller, bind the request to its intended vault and operation, reject replays across replicas, and make its own authorization decision before it decrypts or executes a skill.

## Decision

1. `services/skill-runner` is an independently deployed boundary. In production it executes helpers only through the configured sandbox runtime; it does not silently fall back to an in-process host executor.
2. The MCP gateway and API server call the runner with a short-lived HMAC-SHA-256 service token. The token has an approved caller, a caller-specific key identifier, audience `tkxel-vault-skill-runner`, user, vault, operation, issued-at time, expiry, nonce, optional role, and canonical request-body hash.
3. Tokens have a 60-second default lifetime and a 120-second maximum. The runner uses timing-safe signature comparison, validates the caller/key/audience/expiry/request binding, and records the nonce atomically in Redis. Redis is mandatory in production; inability to use it fails the request closed.
4. A verified token is necessary but not sufficient. The runner re-authorizes the user and vault operation with the server-side authorization service before loading encrypted artifacts or unwrapping a DEK.
5. The shared root secret and optional caller-specific overrides are supplied only by the deployment secret manager. They are never committed, persisted in the database, or written to audit records.

## Consequences

- Compromise of a gateway request alone does not create a reusable runner credential: claims are request-bound, short-lived, and single-use.
- Cross-vault substitution, operation substitution, stale credentials, unapproved callers, and replay attempts are rejected before execution.
- Production deployment must provide Redis and a strong externally managed runner secret. The current local acceptance evidence verifies the protocol using explicitly labelled test doubles; it is not evidence for a real hosted provider.

