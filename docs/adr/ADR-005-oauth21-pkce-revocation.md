# ADR-005: OAuth 2.1 PKCE Authentication & Redis-Backed Sub-60s Revocation

## Status
Accepted

## Context
tkxel Vault operates as an enterprise context hub holding proprietary intellectual property and sensitive corporate knowledge. To comply with requirements `FR-54`, `FR-55`, `FR-61`, and `FR-91`:
1. All requests from Claude custom connectors and web users must authenticate via corporate SSO (Google Workspace or Microsoft Entra ID).
2. The authentication flow must employ **OAuth 2.1 with PKCE (Proof Key for Code Exchange)** to eliminate static client secrets and prevent authorization code interception.
3. The platform must guarantee a **sub-60-second access revocation SLA** (`FR-54`): if an employee's access is removed or their account is suspended, all ongoing and future sessions across Claude and the web app must terminate within 60 seconds.
4. Corporate deprovisioning webhooks (`FR-55`) must immediately invalidate all cached grants and active tokens.

## Decision
We implement a dual-layer authentication and token validation architecture:
1. **OIDC/OAuth 2.1 Token Validation:**
   - Every incoming HTTP request carries an `Authorization: Bearer <jwt>` header.
   - The token is cryptographically validated (signature, expiration, audience, issuer).
   - Identity claims (`sub`, `email`, `groups`) are resolved to map user permissions to vaults.
2. **Redis-Backed Fast Revocation Cache:**
   - Stateless JWT expiration alone is insufficient to meet the <60s revocation requirement.
   - We maintain an in-memory Redis revocation set indexed by `revoked_tokens:{jti}` and `revoked_users:{userId}` with timestamps.
   - On every request, the MCP gateway verifies that neither the token JTI nor the user ID is blacklisted in Redis.
   - Cache lookup is $O(1)$ and executes in <2ms.
3. **Instant Deprovisioning Hook:**
   - An authenticated webhook endpoint (`/api/sso/deprovision`) adds the terminated user to the Redis revocation index with a TTL equal to the maximum token lifetime, immediately dropping all active connections.

## Consequences
- **Positive:** Strictly guarantees <60-second access revocation SLA required by enterprise security standards.
- **Positive:** Zero vulnerability to authorization code interception due to mandatory PKCE.
- **Positive:** High performance: cryptographic validation happens in-memory with sub-2ms Redis check.
- **Negative:** Adds dependency on Redis for distributed revocation state (backed by local Redis container in dev and AWS ElastiCache / Azure Redis in production).
