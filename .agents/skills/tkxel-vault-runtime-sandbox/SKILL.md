---
name: tkxel-vault-runtime-sandbox
description: >-
  Implement and operate the zero-read locked skill runner, containerized execution sandboxes,
  Claude API message orchestrator, and cloud infrastructure deployment for tkxel Vault.
  Covers ephemeral in-memory execution, network isolation (gVisor/Docker), execution timeouts,
  and production scaling. Use whenever working on the skill runner, container sandboxing, or DevOps.
---

# tkxel Vault: Secure Runtime, Sandboxing & DevOps Skill

This skill guides the implementation of the **Locked Skill Execution Runtime & Cloud Infrastructure** as defined in the [SRS](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) ([FR-70 to FR-74, NFR-12, NFR-20 to NFR-22]) and [PRD](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **Zero-Read Skill Execution Runtime (`FR-70` to `FR-72`)**:
   - In-memory ephemeral decryption: When `run_skill` or `ask_vault` is called:
     1. Retrieve the encrypted skill blob from storage.
     2. Decrypt `SKILL.md` and reference templates strictly in RAM using the vault DEK.
     3. Invoke the Anthropic Claude Messages API, passing `SKILL.md` as the **system prompt** and user input arguments as the **user message**.
     4. Collect the generated response.
     5. Zero-out and garbage-collect decrypted buffers immediately (`FR-70`).
     6. Return generated markdown output only. **Never return raw source files or verbatim prompts** (`FR-72`).

2. **Containerized Script Sandboxing (`FR-73`)**:
   - If a skill contains helper scripts (Python/Bash), execute them inside an isolated sandbox:
     * **Network Isolation:** `--network none` (strictly no outbound internet access).
     * **Filesystem Isolation:** Read-only root filesystem with ephemeral, in-memory `tmpfs` mounts.
     * **Kernel Security:** Use **gVisor (`runsc`)** or **Firecracker MicroVMs** to prevent host breakout.
     * **Enforced Timeout:** 120 seconds hard timeout per request (`FR-74`).

3. **Performance & Overhead Benchmarks (`NFR-12`)**:
   - Total runner overhead (gateway validation + decryption + memory setup), excluding Anthropic API latency, must remain **< 2.0 seconds at p95** (`NFR-12`).

4. **Cloud Infrastructure & Production Operations (`NFR-20` to `NFR-22`)**:
   - Maintain 99.5% monthly availability target (`NFR-20`).
   - Automated daily encrypted backups retained for 30 days (`NFR-21`).
   - RPO = 24 hours, RTO = 4 hours (`NFR-22`).
   - Deployment architecture via Terraform / AWS CDK:
     * Compute: Containerized services on AWS ECS Fargate or Azure Container Apps.
     * Database: Amazon Aurora PostgreSQL with `pgvector` or Azure Database for PostgreSQL Flexible Server.
     * Secrets & KMS: AWS Secrets Manager & AWS KMS (or Azure equivalents).

## Skill Runner Lifecycle Diagram

```
MCP Gateway (`run_skill` request)
          |
          v
+--------------------------------------------------------------+
|                   Locked Skill Runner                        |
|                                                              |
| 1. Decrypt AES-256-GCM Blob into Volatile RAM                |
|    - Load SKILL.md & tool.json                               |
|                                                              |
| 2. Input Validation                                          |
|    - Enforce parameter types against tool.json               |
|                                                              |
| 3. Invoke Claude Messages API                                |
|    - System Context: SKILL.md instructions + guidelines      |
|    - User Message: JSON stringified user parameters          |
|                                                              |
| 4. Clean-up & Ephemeral Zeroing                              |
|    - Erase decrypted skill plaintext from RAM                |
|                                                              |
| 5. Output Sanitization                                       |
|    - Ensure no prompt leakage                                |
|    - Return generated markdown                               |
+--------------------------------------------------------------+
          |
          v
MCP Gateway -> Claude.ai Client
```
