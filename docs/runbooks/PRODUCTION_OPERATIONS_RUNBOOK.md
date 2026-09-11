# tkxel Vault: Production Operations & Runbooks

This runbook defines the standard operating procedures, disaster recovery protocols, key rotation drills, and security incident response playbooks for **tkxel Vault**.

---

## 1. Cryptographic Key Management & Rotation Drills

### 1.1 Cloud KMS Master Key (KEK) Rotation
tkxel Vault utilizes envelope encryption with AES-256-GCM. The master Key Encryption Key (KEK) is managed by Cloud KMS (AWS KMS or Azure Key Vault).

- **Automated Rotation Policy:** Annual rotation enabled via KMS provider.
- **Manual Emergency Rotation Procedure:**
  1. Generate a new KMS key alias version:
     ```bash
     aws kms update-alias --alias-name alias/tkxel-vault-master --target-key-id <new-key-arn>
     ```
  2. The vault service automatically encrypts new DEK payloads with the new key version. Existing wrapped DEKs remain decryptable by KMS via their historical key ARN.

### 1.2 Vault Data Encryption Key (DEK) Re-Wrapping & Re-Encryption
To rotate the per-vault unique DEK:
1. Trigger the administrative DEK rotation script:
   ```bash
   pnpm run ops:rotate-vault-dek --vault-id <vault-id> --re-encrypt-payloads
   ```
2. The worker generates a new 256-bit DEK, fetches current ciphertext records in batches of 100, decrypts them in RAM using the old DEK, re-encrypts using the new DEK, writes the records back in a transaction, and records an `audit_key_rotated` event.
3. The old DEK in-memory buffer is zeroed out (`buffer.fill(0)`).

---

## 2. Disaster Recovery & Backup Runbook

### 2.1 Recovery Objectives
- **Recovery Point Objective (RPO):** ≤ 24 hours (maximum allowable data loss).
- **Recovery Time Objective (RTO):** ≤ 4 hours (maximum allowable downtime).

### 2.2 Backup Architecture
- **Continuous WAL Archiving:** PostgreSQL WAL logs streamed to durable cloud object storage (AWS S3 / Azure Blob Storage) with server-side encryption.
- **Daily Physical Base Backups:** Full database snapshot taken every 24 hours at 01:00 UTC with 30-day retention.
- **Redis State:** Ephemeral session and rate-limit cache. In disaster scenarios, Redis starts empty and rebuilds active tokens from incoming valid JWT claims.

### 2.3 Point-In-Time-Recovery (PITR) Drill
1. Provision a new PostgreSQL container/instance:
   ```bash
   docker compose -f docker-compose.yml up -d postgres
   ```
2. Restore latest base backup:
   ```bash
   pgbackrest --stanza=tkxel_vault --type=time "--target=2026-09-08 12:00:00" restore
   ```
3. Verify relational and vector integrity:
   ```bash
   pnpm turbo run test
   ```
4. Verify RLS policies and table checksums match pre-incident state.

---

## 3. Rapid Identity Revocation & SSO Deprovisioning Drill (<60s SLA)

### 3.1 Immediate User Revocation via API / Admin UI
When a user is offboarded or a token is compromised:
1. Execute immediate revocation call:
   ```bash
   curl -X POST https://vault.tkxel.com/api/v1/auth/revoke \
     -H "Authorization: Bearer <admin-token>" \
     -d '{"user_id": "usr_compromised_42", "reason": "Immediate employee offboarding"}'
   ```
2. Gateway writes revocation key to Redis:
   `SET revocation:user:usr_compromised_42 1 EX 86400`
3. All MCP Gateway instances reject tool invocations from this user within <60 seconds.
4. An append-only audit event `user_revoked` is emitted to the audit log.

### 3.2 Automated SSO Deprovisioning Webhook
- When corporate identity provider (Google Workspace / Microsoft Entra ID) deactivates a staff account, a webhook hits `/webhooks/sso-deprovision`.
- The gateway verifies the cryptographic webhook signature, flushes cached permissions, and sever active Streamable HTTP connections.

---

## 4. Adversarial Probing & Anti-Exfiltration Alerting

### 4.1 Threat Detection Indicators
- **High-Frequency Locked Tool Invocations:** > 20 requests per minute from a single consumer token.
- **Sanitization Redaction Triggered:** Output sanitizer detects attempted prompt or file path leakage (`output_sanitized` metric incremented).
- **Rate Limit Exceeded:** Multiple consecutive 429 rejections indicate brute-force attempts.

### 4.2 Security Incident Response Playbook
1. **Automated Quota Suspension:** If anomalous probing triggers 5+ sanitization redacts in 10 minutes, the account is automatically throttled for 1 hour.
2. **Security Operations Notification:** Webhook event sent to `#secops-alerts` with caller identity, IP, query hash, and timestamp.
3. **Audit Inspection:** Review full query timeline in the Audit Viewer Dashboard (`/audit`).
