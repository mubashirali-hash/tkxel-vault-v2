# ADR-003: Key Management Service (KMS) Adapter and AES-256-GCM Envelope Encryption

## Status
Accepted

## Date
2026-09-08

## Context
In accordance with [tkxel_vault_SRS.md](../../tkxel_vault_SRS.md) Invariant 2 and NFR-01 to NFR-05:
- All page bodies, skill code, and locked chunks must be encrypted at rest with **AES-256-GCM**.
- Each vault must possess a unique Data Encryption Key (DEK).
- Vault DEKs are wrapped using Master Keys managed in Cloud KMS (AWS KMS or Azure Key Vault).
- Plaintext keys must never be written to persistent disk or emitted in logs.

## Decision
1. **Envelope Architecture:**
   - On vault creation, a cryptographically secure 256-bit random DEK is generated using Node `crypto.randomBytes(32)`.
   - The DEK is encrypted (wrapped) via Cloud KMS using an authenticated key-wrapping mechanism.
   - The wrapped ciphertext (`data_key_id` / encrypted key blob) is stored in the database `Vault` record.
2. **KMS Provider Abstraction:**
   - Define a generic `KmsProvider` interface (`wrapKey`, `unwrapKey`).
   - Implement `AwsKmsProvider`, `AzureKeyVaultProvider`, and a local development `MockKmsProvider` (using a master seed key) to facilitate local testing and offline CI/CD verification without requiring live cloud credentials.
   - The Azure adapter uses Key Vault's `wrapkey` and `unwrapkey` REST operations with `RSA-OAEP-256`. Production Azure configuration requires `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_KEY_NAME`, and a short-lived `AZURE_KEY_VAULT_BEARER_TOKEN` supplied by the deployment workload identity; these values must not be logged or stored in the database.
3. **Volatile Key Lifetime:**
   - DEKs are unwrapped strictly in process memory (RAM) when performing cryptographic operations and immediately garbage-collected; keys are never persisted to disk.

## Consequences
- Guaranteed compliance with AES-256-GCM cryptographic zero-trust invariants.
- Decouples vault storage from specific cloud vendors (AWS vs. Azure vs. local mock).
