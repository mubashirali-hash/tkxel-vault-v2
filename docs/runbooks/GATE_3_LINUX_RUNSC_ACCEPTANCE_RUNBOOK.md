# Gate 3 Linux/gVisor (runsc) Acceptance Runbook

> **Target Gate:** Review Gate 3 (Independent Locked Skill Runner & Container Sandboxing)  
> **Status:** **VERIFIED & APPROVED BY USER** (Executed live on Ubuntu WSL2, Linux 6.18.33.2-microsoft-standard-WSL2, with gVisor `runsc` release-20260914.0; all 25/25 checks passed. The user explicitly accepted this environment as sufficient evidence on 2026-09-18.)  
> **Script:** [`scripts/verify-gate3-linux-acceptance.sh`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/scripts/verify-gate3-linux-acceptance.sh)  
> **Evidence Log:** [`docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log)  
> **Authority:** [`AGENTS.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/AGENTS.md), [`tkxel_vault_SRS.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/tkxel_vault_SRS.md) (FR-70, FR-73, FR-74, NFR-20)

---

## 1. Overview & Blocking Condition

Review Gate 3 requires live runtime evidence that locked skills and helper scripts execute exclusively inside an isolated container sandbox backed by **gVisor (`runsc`)** with defense-in-depth isolation parameters.

### Current Test Evidence Accounting
- **Last complete uncached monorepo evidence:** 12/12 tasks passed at Review Gate 6; this was recorded before the helper-dispatch remediation.
- **Current focused helper evidence:** 14 manifest/orchestrator/sandbox tests, 13 independent runner HTTP test events, and 5 MCP integration test events pass.
- **Affected packages:** Final complete skill-runner suite reports 93 dot-reporter events with 0 failures; skill-runner and MCP gateway builds and complete package suites pass with exit status 0.
- **Resolved evidence limitation:** Earlier Windows-only results did not prove live gVisor behavior. The recorded WSL2 run executed containers under live registered `runsc`; the user explicitly accepted that evidence for this gate.

### Resolved Blocker and Completed Prerequisite
1. **Resolved by explicit user decision:** A dedicated Linux VM/CI runner remained the preferred independent environment, but the user accepted the successful Ubuntu WSL2 + live gVisor run as sufficient Gate 3 evidence on 2026-09-18.
2. **Completed prerequisite — production-path helper dispatch:** The production MCP/HTTP `run_skill` path now parses versioned encrypted skill packages and dispatches validated helper entrypoints through `SandboxRunner`. Focused Windows evidence proves the full HTTP path with development host execution, but Gate 3 still requires this same path to pass under live Linux/gVisor `runsc`.

> [!CRITICAL]
> **Production-Path Requirement:** The Linux acceptance script exercises an encrypted helper through the real MCP Streamable HTTP and signed runner HTTP path. Direct `SandboxRunner` tests alone do not provide end-to-end production-path proof.

### Original Development-Host Limitation
1. **gVisor Architecture:** gVisor (`runsc`) virtualizes the Linux kernel syscall interface (using `ptrace` or KVM) and cannot run natively on Windows or macOS kernels.
2. **Strict Invariant (No Mocking / No Emulation):** As mandated by [`AGENTS.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/AGENTS.md) and project rules:
   > *"Passing source-regex tests, copied test logic, build success, or a written walkthrough are not proof that a runtime security property holds. Do not attempt to install, simulate, or emulate runsc on Windows hosts."*
3. **Fail-Closed Code Protection:** `SandboxRunner.isRuntimeAvailable('runsc')` inspects the Docker daemon runtimes. When `runsc` is absent, execution fails closed with `SandboxPolicyError`, refusing silent host-process fallback.
4. **Sign-off Decision:** The script passed with registered live `runsc` on Ubuntu WSL2. The user explicitly accepted this evidence and approved Gate 3.

---

## 2. Linux Host Prerequisites & Installation Guide

To execute the Gate 3 acceptance verification, provision a dedicated Linux VM or CI runner (Ubuntu 22.04 LTS / 24.04 LTS or Debian 12 recommended).

### 2.1 Hardware & Kernel Requirements
- **OS:** Linux x86_64 or aarch64 (Kernel ≥ 5.15)
- **Virtualization:** Nested virtualization enabled (VT-x / AMD-V) if running in a cloud VM (AWS `c5.metal` or standard instances with KVM support)
- **Docker Engine:** Version ≥ 24.0
- **Node.js:** Version ≥ 20.0
- **pnpm:** Version ≥ 9.0

### 2.2 Installing gVisor (`runsc`) on Ubuntu / Debian

Run the following commands on the Linux host:

```bash
# 1. Add gVisor official APT repository and signing key
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null

# 2. Install runsc package
sudo apt-get update && sudo apt-get install -y runsc

# 3. Register runsc with Docker daemon
sudo runsc install

# 4. Restart Docker daemon
sudo systemctl restart docker

# 5. Verify Docker detects runsc
docker info --format '{{json .Runtimes}}' | jq .
```

Expected output includes:
```json
{
  "runsc": {
    "path": "/usr/bin/runsc"
  }
}
```

### 2.3 Smoke Test gVisor Execution

```bash
docker run --rm --runtime=runsc alpine:latest dmesg
```
The output must display gVisor initialization banners (e.g. `Starting gVisor...`).

---

## 3. Acceptance Verification Suite Specification

The acceptance script [`scripts/verify-gate3-linux-acceptance.sh`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/scripts/verify-gate3-linux-acceptance.sh) deterministically evaluates 9 sequential phases:

| Phase | Category | Verification Checks | Pass Criteria |
| :--- | :--- | :--- | :--- |
| **1** | **Prerequisites** | `uname -s == Linux`, `runsc` on PATH, CLI utilities present | Linux kernel detected, `runsc` version verified |
| **2** | **Docker Runtime** | `docker info` contains `"runsc"`, smoke test | Live container boots under `runsc` |
| **3** | **Stack Startup** | `docker compose up -d` postgres, redis, skill-runner | Postgres `pg_isready` healthy, Redis `PONG` healthy |
| **4** | **Port & Process Isolation** | Port 3003 exposed internally only, never on host; runner must be live on the bridge | `curl localhost:3003` fails; internal runner connection succeeds as a mandatory check; `user: 10001:10001`, `read_only: true`, `cap_drop: ALL` |
| **5** | **Encrypted Helper Execution** | Authenticated MCP Streamable HTTP `tools/call` → signed runner HTTP → PostgreSQL authorization → KMS unwrap → encrypted package parse → `SandboxRunner` with `--runtime=runsc` | Output matches computed result; success audit records helper dispatch; helper source is streamed over stdin; zero persistent plaintext traces |
| **6** | **Sandbox Deep Security** | 9 boundary tests: Non-root UID, read-only rootfs, tmpfs noexec, default-deny network egress, host mount absence, secret environment sanitization, PID bomb limit, 64KB output truncation, hard timeout termination | All 9 attack vectors strictly contained |
| **7** | **Auth & Replay Defense** | Signed HMAC-SHA256 tokens, claim binding (vaultId, operation, bodyHash), atomic Redis nonce replay cache | Valid tokens succeed; replayed nonce rejected with 401; tampered body rejected with 403 |
| **8** | **Audit Canary Scan** | Scan PostgreSQL `audit_events` and Docker logs | Zero plaintext API keys, secrets, or DEKs in logs or audit metadata |
| **9** | **Cleanup & Summary** | Teardown fixtures, compute pass/fail totals | Exit code 0 if and only if all checks pass |

---

## 4. Execution Step-by-Step

Clone or sync the repository on the prepared Linux host and execute:

```bash
# 1. Ensure build artifacts are fresh
pnpm install
pnpm build

# 2. Make script executable
chmod +x scripts/verify-gate3-linux-acceptance.sh

# 3. Run deterministic Gate 3 acceptance verification
bash scripts/verify-gate3-linux-acceptance.sh

# 4. (Optional) Run with automatic container teardown after tests
bash scripts/verify-gate3-linux-acceptance.sh --teardown
```

---

## 5. Interpreting Results & Unblocking Review Gate 3

### Passing Run
When executed on a verified Linux system with `runsc`:
- The script prints `[PASS]` for all 9 phases.
- The summary reports `0 failed checks`.
- An execution log artifact `docs/acceptance-evidence/GATE-3-LINUX-RUNSC-EVIDENCE.log` should be captured and committed.
- **Action:** Mark Review Gate 3 approved in [`bug_report.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/bug_report.md) and update [`CODEX_MEMORY.md`](file:///c:/Users/mubashir.ali/Desktop/Github%20Pull%20Request/tkxel-vault-v2/CODEX_MEMORY.md).

### Failing Run
If any check fails:
- The script exits with non-zero code and highlights the specific vulnerability or configuration failure in red `[FAIL]`.
- Review Gate 3 remains strictly **BLOCKED**.
- Do not attempt to override with simulated results.

---

## 6. Superseded Project Governance Exception

Per program direction:
1. **Historical Epic 3 Exception:** Epic 3 was previously classified as implementation substantially complete while Gate 3 awaited runtime evidence.
2. **Superseding decision:** On 2026-09-18, after a 25/25 WSL2 + live gVisor run, the user approved Gate 3 and authorized Epic 7.
3. **Remaining release rule:** This approval does not approve Review Gate 7 or final Review Gate 8. Production-ready claims remain prohibited until those gates pass.
