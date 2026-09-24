# ADR-006: Zero-Read Ephemeral Sandboxing & In-Memory Claude Orchestration

## Status
Accepted

## Context
Locked vaults protect proprietary company IP, specialized skills, and confidential prompt instructions (`FR-70` to `FR-74`). Consumers must be allowed to execute skills (`run_skill`) and query locked repositories (`ask_vault`) without ever reading the raw markdown, instructions, prompts, file trees, or internal directory structures.

Key technical requirements:
1. **Zero-Read In-Memory Decryption:** Decryption of `SKILL.md` and references must take place strictly in volatile RAM using the vault DEK. Plaintext must never be persisted to disk or logged.
2. **Ephemeral Process & Container Sandboxing:** Skills containing helper scripts (Python/Bash) must execute in short-lived isolated environments with:
   - Default-deny outbound network egress (`FR-73`).
   - Minimal read-only filesystem with ephemeral memory mounts.
   - Non-root execution.
   - Strict 120-second execution timeout (`FR-74`).
   - Immediate container/process teardown upon completion.
3. **Claude Messages API Orchestration:** The server orchestrates the Anthropic Claude Messages API using server-managed credentials, passing the decrypted `SKILL.md` as the system prompt and validated user inputs as the user message.
4. **Anti-Exfiltration Output Sanitization:** System must sanitize model outputs to prevent prompt leakage, source file disclosure, or directory enumerations.

## Decision
1. We implement `services/skill-runner` to manage skill validation, ephemeral sandboxing, and Claude API orchestration.
2. Skill payloads are decrypted strictly into ephemeral Node `Buffer` instances and overwritten/zeroed (`buf.fill(0)`) immediately after constructing the Claude API request payload.
3. Helper scripts execute inside isolated ephemeral processes or containers (gVisor/Docker in production, secure child processes in local dev) with resource constraints (CPU, memory, 120s timeout) and no outbound network egress.
4. We implement an output sanitization filter that inspects generated output against known system prompt signatures and system paths before returning to the consumer.

## Consequences
- **Positive:** Guarantees zero-read security invariants for proprietary intellectual property.
- **Positive:** Hard 120-second timeout and default-deny egress prevent unauthorized network exfiltration.
- **Negative:** Ephemeral container initialization adds small execution latency (<2.0s p95 target).
