---
name: tkxel-vault-security-crypto
description: >-
  Implement and audit the security, cryptography, and access governance architecture of
  tkxel Vault. Covers AES-256-GCM envelope encryption per vault, AWS KMS / Azure Key Vault
  integration, corporate SSO (OIDC/OAuth 2.1), rapid access revocation (<60s), and immutable
  audit trails. Use whenever working on encryption, authentication, authorization, or audit logging.
---

# tkxel Vault: Security, Cryptography & Governance Skill

This skill guides the implementation of the **Security, Cryptography & Access Governance Subsystems** as defined in the [SRS](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) ([NFR-01 to NFR-09, FR-50 to FR-56, FR-80 to FR-84]) and [PRD](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **Envelope Encryption (`NFR-01` to `NFR-05`)**:
   - Encrypt all document contents and skill blobs at rest using **AES-256-GCM**.
   - **Vault Data Key Isolation:** Generate a unique Data Encryption Key (DEK) for each vault.
   - **Master Key Wrapping:** Wrap vault DEKs using a master Key Encryption Key (KEK) managed in **AWS KMS** or **Azure Key Vault**.
   - **Zero Disk Persistence:** Unwrapped data keys must reside strictly in volatile RAM and **never** be written to persistent storage, swap space, or log files (`NFR-04`).
   - Annual KEK rotation in KMS; support on-demand DEK re-encryption (`NFR-05`).

2. **Locked Vault Chunk & Search Index Security (`NFR-02`)**:
   - For locked vaults, embeddings and search chunks must be encrypted under that vault's specific DEK.
   - For open vaults, chunks may use a shared cluster data key.

3. **SSO Identity & Group Role Mapping (`FR-50` to `FR-55`)**:
   - Integrate with corporate SSO via OpenID Connect (OIDC) / OAuth 2.1 (Google Workspace or Microsoft Entra ID).
   - Zero local username/password databases (`FR-50`).
   - Group mapping: Map corporate SSO groups (e.g., `fintech-delivery@tkxel.com`) to specific Vault roles (`Editor`, `Reader`, `Consumer`).
   - **Rapid Revocation (`FR-54`, `FR-55`):** Implement token revocation checks via distributed cache (Redis) ensuring access cuts take effect across all active MCP sessions within **< 60 seconds**.

4. **Immutable Audit Logging (`FR-80` to `FR-84`, `NFR-32`)**:
   - Append-only `AuditEvent` log retaining records for 2 years:
     * Tool execution: `user_id`, `tool_name`, `vault_id`, `target_id`, `timestamp`, `input_bytes`, `output_bytes`, `status`.
     * Admin actions: `create_vault`, `set_mode`, `share`, `revoke`, `publish`, `export`, `delete`.
   - Owners can inspect, filter, and export audit trails via CSV in the Admin App.

5. **Security Scanning on Skill Uploads (`NFR-07`)**:
   - Automated static analysis and AST checks on uploaded `SKILL.md` and script bundles prior to publishing:
     * Detect outbound socket / network calls.
     * Flag prompt injection patterns attempting to leak system instructions.
     * Enforce strict `tool.json` parameter schema definition.

## Cryptographic Envelope Pattern

```
                       +-------------------+
                       | Cloud KMS / HSM   |
                       | (Master KEK)      |
                       +---------+---------+
                                 |
                     GenerateDataKey / Decrypt
                                 |
                                 v
+-------------------------------------------------------------+
|                      Vault Memory Space                     |
|                                                             |
|   Encrypted DEK  -----> [ Decrypt with KMS ] -----> Raw DEK |
|                                                      |      |
|                                                      v      |
|   Plaintext Payload ----> [ AES-256-GCM Encrypt ] -> Cipher |
|   (Markdown / Skill)                                        |
+-------------------------------------------------------------+
```
