# ADR-009: Production Hardening, Disaster Recovery & Key Rotation Operations

## Status
Accepted

## Context
tkxel Vault operates as the enterprise knowledge repository and proprietary zero-read skills execution platform. To satisfy enterprise security standards and the operational requirements set forth in the SRS, the platform requires formal operational procedures for:
1. Cryptographic key rotation drills (Cloud KMS KEK & per-vault DEK).
2. Database disaster recovery and point-in-time recovery guaranteeing RPO ≤ 24 hours and RTO ≤ 4 hours.
3. Rapid identity revocation drills validating the <60s revocation SLA across corporate SSO and Redis blacklists.
4. Continuous anti-exfiltration telemetry and anomalous probing detection.

## Decision
1. **Envelope Key Rotation Lifecycle:**
   - **Key Encryption Keys (KEK):** Master keys in Cloud KMS (AWS KMS / Azure Key Vault) are configured with automated annual key rotation.
   - **Data Encryption Keys (DEK):** Per-vault unique DEKs are re-wrapped under new KEK versions upon rotation. A zero-downtime background re-encryption worker can be triggered via administrative runbook to re-encrypt page and chunk payloads under newly generated DEKs.
2. **Disaster Recovery (RPO ≤ 24h, RTO ≤ 4h):**
   - **Continuous WAL Archiving & Daily Base Backups:** PostgreSQL continuous WAL archiving (e.g., via `pgBackRest` or `wal-g` to S3/Blob Storage) combined with daily physical snapshot backups.
   - **Failover Automation:** Read replicas configured across distinct availability zones with automated health probing.
3. **Identity Revocation & Session Severing (<60s SLA):**
   - Redis token revocation blacklist keyed by `revocation:token:<jti>` and `revocation:user:<sub_id>` with TTL matching the remaining JWT lifespan.
   - Gateway instances consult local in-memory cache with sub-second Redis cluster sync.
4. **Adversarial Telemetry & Anomaly Guardrails:**
   - Prometheus and structured audit logs emit metrics for high-frequency `run_skill` and `ask_vault` queries, rate-limit rejections (`rate_limit_exceeded`), and prompt sanitization triggers.
   - Anomaly alerts notify security operations when consecutive suspicious prompts exceed 5 events within 10 minutes.

## Consequences
- Guarantees compliance with enterprise RPO 24h / RTO 4h objectives.
- Ensures cryptographic keys can be rotated without downtime or data corruption.
- Provides audited operational procedures for incident response and compliance verification.
