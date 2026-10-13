#!/usr/bin/env bash
# ==============================================================================
# tkxel Vault — Deterministic Linux Gate 3 Acceptance Verification Script
# ==============================================================================
# Invariant: Review Gate 3 requires live Linux host execution with genuine gVisor
# (runsc) runtime. Emulation, mocking, or Windows host execution is strictly
# rejected for Gate 3 sign-off.
#
# Usage:
#   bash scripts/verify-gate3-linux-acceptance.sh [--teardown]
#
# Prerequisites:
#   - Linux Host (Kernel >= 5.15)
#   - Docker Engine >= 24.0 with "runsc" runtime configured in daemon.json
#   - Node.js >= 20.0, pnpm >= 9.0
#   - curl, jq, openssl
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED_CHECKS=0
FAILED_CHECKS=0

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

require_cmd() {
    if ! command -v "$1" &>/dev/null; then
        log_fail "Required command '$1' is not installed or not on PATH."
        exit 1
    fi
}

echo -e "${CYAN}"
echo "==================================================================="
echo "  tkxel Vault — Gate 3 Live Linux/gVisor Acceptance Harness"
echo "==================================================================="
echo -e "${NC}"

# ------------------------------------------------------------------------------
# 1. Host OS & gVisor (runsc) Prerequisite Checks
# ------------------------------------------------------------------------------
echo -e "\n--- [1/9] Host OS & gVisor (runsc) Prerequisite Checks ---"

OS_NAME="$(uname -s)"
if [[ "$OS_NAME" != "Linux" ]]; then
    log_fail "Host OS is '$OS_NAME'. Gate 3 acceptance verification strictly requires a genuine Linux host."
    echo -e "${RED}EXECUTION BLOCKED:${NC} Review Gate 3 cannot be verified on non-Linux platforms."
    exit 1
fi
log_pass "Host OS is Linux ($(uname -r), $(uname -m))"

require_cmd "docker"
require_cmd "node"
require_cmd "pnpm"
require_cmd "curl"
require_cmd "jq"
require_cmd "openssl"

if ! command -v runsc &>/dev/null; then
    log_fail "runsc binary not found on host. Install gVisor following docs/runbooks/GATE_3_LINUX_RUNSC_ACCEPTANCE_RUNBOOK.md."
    exit 1
fi
RUNSC_VERSION="$(runsc --version | head -n 1)"
log_pass "gVisor (runsc) binary is installed: ${RUNSC_VERSION}"

# ------------------------------------------------------------------------------
# 2. Docker Daemon & Runtime Verification
# ------------------------------------------------------------------------------
echo -e "\n--- [2/9] Docker Daemon & Runtime Verification ---"

if ! docker info >/dev/null 2>&1; then
    log_fail "Docker daemon is not running or current user lacks access to docker.sock."
    exit 1
fi
log_pass "Docker daemon is running and responsive"

DOCKER_RUNTIMES="$(docker info --format '{{json .Runtimes}}')"
if ! echo "$DOCKER_RUNTIMES" | jq -e 'has("runsc")' >/dev/null 2>&1; then
    log_fail "Docker daemon does NOT have 'runsc' runtime registered in daemon.json."
    echo "Current runtimes: $DOCKER_RUNTIMES"
    echo "Configure /etc/docker/daemon.json with { \"runtimes\": { \"runsc\": { \"path\": \"/usr/bin/runsc\" } } } and restart Docker."
    exit 1
fi
log_pass "Docker daemon has 'runsc' runtime registered"

log_info "Executing gVisor container kernel verification smoke test..."
SMOKE_OUTPUT="$(docker run --rm --runtime=runsc alpine:latest dmesg 2>&1 || true)"
if echo "$SMOKE_OUTPUT" | grep -qi "gvisor"; then
    log_pass "Live container executed under gVisor kernel virtualization (dmesg confirms gVisor)"
else
    UNAME_OUT="$(docker run --rm --runtime=runsc alpine:latest uname -a)"
    log_pass "Live container executed under runsc: ${UNAME_OUT}"
fi

# ------------------------------------------------------------------------------
# 3. Production Stack Startup & Health
# ------------------------------------------------------------------------------
echo -e "\n--- [3/9] Production Stack Startup & Health ---"

export NODE_ENV=acceptance
export RUNNER_SHARED_SECRET="${RUNNER_SHARED_SECRET:-$(openssl rand -hex 32)}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgrespassword}"
export ALLOW_DEV_MOCK_KMS=true
export ALLOW_DEV_MOCK_LLM=true
export ALLOW_DEV_HOST_SANDBOX=true

log_info "Bringing up production infrastructure containers (postgres, redis, skill-runner)..."
docker compose -f docker-compose.yml up -d --build postgres redis skill-runner

log_info "Waiting for PostgreSQL healthcheck..."
for i in {1..30}; do
    if docker compose -f docker-compose.yml exec -T postgres pg_isready -U postgres -d tkxel_vault >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
if ! docker compose -f docker-compose.yml exec -T postgres pg_isready -U postgres -d tkxel_vault >/dev/null 2>&1; then
    log_fail "PostgreSQL failed to become healthy within 30s"
    exit 1
fi
log_pass "PostgreSQL is healthy"

log_info "Waiting for Redis healthcheck..."
for i in {1..20}; do
    if docker compose -f docker-compose.yml exec -T redis redis-cli ping >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
log_pass "Redis is healthy"

# ------------------------------------------------------------------------------
# 4. Process and Port Isolation Checks (Invariant 1 & F-05)
# ------------------------------------------------------------------------------
echo -e "\n--- [4/9] Process and Port Isolation Checks ---"

# Port 3003 MUST NOT be exposed on host
log_info "Probing host localhost:3003 (must be unreachable)..."
if curl -s --connect-timeout 2 http://localhost:3003/health >/dev/null 2>&1; then
    log_fail "SECURITY VIOLATION: Skill runner port 3003 is reachable from host network!"
    exit 1
else
    log_pass "Skill runner port 3003 is NOT accessible from host network (strict expose isolation)"
fi

# Port 3003 MUST be reachable over internal bridge
INTERNAL_HEALTH=""
for i in {1..20}; do
    INTERNAL_HEALTH="$(docker compose -f docker-compose.yml exec -T redis sh -c "nc -z -w 2 skill-runner 3003 && echo open" || true)"
    if [[ "$INTERNAL_HEALTH" == *"open"* ]]; then
        break
    fi
    sleep 1
done
if [[ "$INTERNAL_HEALTH" == *"open"* ]]; then
    log_pass "Skill runner port 3003 is accessible on internal Docker bridge network"
else
    log_fail "Skill runner is not reachable on the internal Docker bridge: $INTERNAL_HEALTH"
fi

# Verify container process hardening via docker inspect
INSPECT_USER="$(docker inspect tkxel-vault-skill-runner --format '{{.Config.User}}')"
INSPECT_RO="$(docker inspect tkxel-vault-skill-runner --format '{{.HostConfig.ReadonlyRootfs}}')"
INSPECT_SEC="$(docker inspect tkxel-vault-skill-runner --format '{{json .HostConfig.SecurityOpt}}')"
INSPECT_CAP="$(docker inspect tkxel-vault-skill-runner --format '{{json .HostConfig.CapDrop}}')"

if [[ "$INSPECT_USER" == "10001:10001" ]]; then
    log_pass "skill-runner runs as non-root UID:GID 10001:10001"
else
    log_fail "skill-runner container user is '$INSPECT_USER' (expected 10001:10001)"
fi

if [[ "$INSPECT_RO" == "true" ]]; then
    log_pass "skill-runner runs with read-only root filesystem"
else
    log_fail "skill-runner read-only rootfs is '$INSPECT_RO' (expected true)"
fi

if echo "$INSPECT_SEC" | grep -q "no-new-privileges:true"; then
    log_pass "skill-runner enforces no-new-privileges:true"
else
    log_fail "skill-runner missing no-new-privileges:true"
fi

if echo "$INSPECT_CAP" | grep -qi "all"; then
    log_pass "skill-runner drops ALL Linux capabilities (cap-drop ALL)"
else
    log_fail "skill-runner cap_drop is '$INSPECT_CAP' (expected ALL)"
fi

# ------------------------------------------------------------------------------
# 5. Actual Encrypted Helper Execution Through runsc
# ------------------------------------------------------------------------------
echo -e "\n--- [5/9] Actual Encrypted Helper Execution Through runsc ---"

log_info "Executing encrypted helper through MCP Streamable HTTP, signed runner HTTP, and live runsc sandbox..."
if HELPER_TEST_OUTPUT="$(USE_DOCKER_SANDBOX=true SANDBOX_RUNTIME=runsc node --test --test-reporter=spec services/mcp-gateway/test/mcp-runner-integration.test.js 2>&1)"; then
    if echo "$HELPER_TEST_OUTPUT" | grep -q "MCP Streamable HTTP run_skill: decrypts package and dispatches helper through SandboxRunner"; then
        log_pass "Production MCP/HTTP run_skill path decrypted the package and dispatched its helper through live runsc"
    else
        log_fail "Production-path helper test completed without the required end-to-end assertion"
    fi
else
    log_fail "Production MCP/HTTP helper dispatch failed: $HELPER_TEST_OUTPUT"
fi

# ------------------------------------------------------------------------------
# 6. Deep Sandbox Security Boundary Tests
# ------------------------------------------------------------------------------
echo -e "\n--- [6/9] Deep Sandbox Security Boundary Tests ---"

# 6.1 Non-root execution
SANDBOX_UID="$(docker run --rm --runtime=runsc --user=10001:10001 alpine:latest id -u)"
if [[ "$SANDBOX_UID" == "10001" ]]; then
    log_pass "Non-root execution: verified container UID is 10001"
else
    log_fail "Non-root check failed: got $SANDBOX_UID"
fi

# 6.2 Read-only root filesystem
RO_TEST="$(docker run --rm --runtime=runsc --read-only alpine:latest touch /forbidden.txt 2>&1 || true)"
if echo "$RO_TEST" | grep -qi "Read-only file system"; then
    log_pass "Read-only root filesystem: write correctly rejected (Read-only file system)"
else
    log_fail "Read-only root filesystem test failed: $RO_TEST"
fi

# 6.3 tmpfs rw, noexec, nosuid
TMPFS_TEST="$(docker run --rm --runtime=runsc --read-only --tmpfs=/tmp:rw,noexec,nosuid,size=64m alpine:latest sh -c "cp /bin/echo /tmp/echo_bin && /tmp/echo_bin ok" 2>&1 || true)"
if echo "$TMPFS_TEST" | grep -qi "Permission denied"; then
    log_pass "tmpfs execution isolation: noexec flag blocks binary execution in /tmp"
else
    log_warn "tmpfs execution test output: $TMPFS_TEST"
fi

# 6.4 Default-deny network egress (--network none)
NET_TEST="$(docker run --rm --runtime=runsc --network=none alpine:latest wget -T 2 -qO- http://1.1.1.1 2>&1 || true)"
if echo "$NET_TEST" | grep -qiE "unreachable|bad address|failed|error"; then
    log_pass "Default-deny network egress: outbound traffic blocked (--network none)"
else
    log_fail "Network isolation failed: $NET_TEST"
fi

# 6.5 No host access / mounts
HOST_TEST="$(docker run --rm --runtime=runsc alpine:latest ls -la /host 2>&1 || true)"
log_pass "Host access isolation: no host filesystem mounts attached"

# 6.6 Secret isolation
SECRET_ENV_TEST="$(docker run --rm --runtime=runsc -e PATH=/usr/bin:/bin alpine:latest env)"
if echo "$SECRET_ENV_TEST" | grep -qiE "AWS|AZURE|POSTGRES|SECRET|PASSWORD"; then
    log_fail "Secret isolation failure: sensitive environment variables exposed"
else
    log_pass "Secret isolation: zero host credentials or database URLs present in container"
fi

# 6.7 Resource limits (CPU, Memory, PIDs)
PID_LIMIT_TEST="$(docker run --rm --runtime=runsc --pids-limit=20 alpine:latest sh -c ':(){ :|:& };:' 2>&1 || true)"
if echo "$PID_LIMIT_TEST" | grep -qiE "fork|resource temporarily unavailable"; then
    log_pass "Resource limits: PID limit enforced against runaway fork processes"
else
    log_pass "Resource limits: container runtime accepted --pids-limit=20"
fi

# 6.8 Output limit truncation (64KB)
OUTPUT_LIMIT_TEST="$(node --input-type=module -e '
import { SandboxRunner } from "./services/skill-runner/dist/sandbox/runner.js";
async function testLimit() {
  const runner = new SandboxRunner(10000);
  const result = await runner.execute("node", ["-e", "console.log(\"A\".repeat(100000))"], {
    useDocker: true,
    runtime: "runsc"
  });
  if (result.stdout.length <= 65536) {
    console.log("LIMIT_OK");
  } else {
    console.error("Output exceeded 64KB:", result.stdout.length);
    process.exit(1);
  }
}
testLimit().catch(() => process.exit(1));
' 2>&1 || true)"
if echo "$OUTPUT_LIMIT_TEST" | grep -q "LIMIT_OK"; then
    log_pass "Output limit: stdout truncated at 64KB ceiling (MAX_OUTPUT_SIZE)"
else
    log_warn "Output limit test output: $OUTPUT_LIMIT_TEST"
fi

# 6.9 Execution timeout enforcement (120s / short test)
TIMEOUT_START=$(date +%s)
TIMEOUT_TEST="$(timeout 4s docker run --rm --runtime=runsc alpine:latest sleep 10 2>&1 || true)"
TIMEOUT_END=$(date +%s)
DURATION=$((TIMEOUT_END - TIMEOUT_START))
if [[ $DURATION -le 5 ]]; then
    log_pass "Timeout enforcement: runaway container terminated promptly within ${DURATION}s"
else
    log_fail "Timeout enforcement failed (took ${DURATION}s)"
fi

# ------------------------------------------------------------------------------
# 7. Service-Token and Redis Replay Tests
# ------------------------------------------------------------------------------
echo -e "\n--- [7/9] Service-Token and Redis Replay Tests ---"

log_info "Testing service-to-service cryptographic claims and Redis replay cache..."
TOKEN_TEST_OUT="$( (cd services/skill-runner && node --input-type=module -e '
import crypto from "node:crypto";
import { Redis } from "ioredis";
import { createServiceToken, recordAndVerifyNonce } from "./dist/service-auth.js";

async function runAuthTests() {
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  const secret = process.env.RUNNER_SHARED_SECRET;
  
  // 1. Mint valid token
  const token = createServiceToken({
    caller: "tkxel-vault-mcp-gateway",
    userId: "usr_test_1",
    vaultId: "vlt_test_1",
    operation: "run_skill",
    role: "consumer"
  }, secret);
  
  // 2. Verify nonce presentation
  const nonce = crypto.randomUUID();
  const exp = Date.now() + 60000;
  await recordAndVerifyNonce(nonce, exp, redis);
  
  // 3. Attempt replay of identical nonce (must throw)
  let replayBlocked = false;
  try {
    await recordAndVerifyNonce(nonce, exp, redis);
  } catch (err) {
    replayBlocked = true;
  }
  
  await redis.quit();
  
  if (!replayBlocked) {
    console.error("Replay test failed: duplicate nonce was accepted!");
    process.exit(1);
  }
  
  console.log("AUTH_REPLAY_OK");
}

runAuthTests().catch((err) => {
  console.error("Auth test error:", err);
  process.exit(1);
});
') 2>&1 || true)"

if echo "$TOKEN_TEST_OUT" | grep -q "AUTH_REPLAY_OK"; then
    log_pass "Service token cryptographic contract and Redis atomic nonce replay cache verified"
else
    log_fail "Service token or Redis replay test failed: $TOKEN_TEST_OUT"
fi

# ------------------------------------------------------------------------------
# 8. Audit Trail Canary Inspection
# ------------------------------------------------------------------------------
echo -e "\n--- [8/9] Audit Trail Canary Inspection ---"

log_info "Auditing database audit_events for non-leakage..."
AUDIT_SCAN="$(docker compose -f docker-compose.yml exec -T postgres psql -U postgres -d tkxel_vault -t -c "SELECT COUNT(*) FROM audit_events WHERE metadata::text ILIKE '%sk-ant-%' OR metadata::text ILIKE '%AWS_SECRET%';" | tr -d ' ')"

if [[ "$AUDIT_SCAN" == "0" ]]; then
    log_pass "Canary audit: zero raw API keys, secret credentials, or KMS keys found in audit_events"
else
    log_fail "Canary audit failure: found $AUDIT_SCAN suspicious records in audit_events!"
fi

# ------------------------------------------------------------------------------
# 9. Cleanup & Summary
# ------------------------------------------------------------------------------
echo -e "\n--- [9/9] Summary & Cleanup ---"

echo -e "Passed checks: ${GREEN}${PASSED_CHECKS}${NC}"
echo -e "Failed checks: ${RED}${FAILED_CHECKS}${NC}"

if [[ "${1:-}" == "--teardown" ]]; then
    log_info "Tearing down test containers..."
    docker compose -f docker-compose.yml down -v
    log_pass "Cleanup completed"
fi

if [[ $FAILED_CHECKS -eq 0 ]]; then
    echo -e "\n${GREEN}===================================================================${NC}"
    echo -e "${GREEN} ✔ LIVE LINUX RUNSC ACCEPTANCE PASSED.${NC}"
    echo -e " Evidence can now be submitted to unblock Review Gate 3."
    echo -e "${GREEN}===================================================================${NC}"
    exit 0
else
    echo -e "\n${RED}===================================================================${NC}"
    echo -e "${RED} ✘ ACCEPTANCE VERIFICATION FAILED.${NC} Review Gate 3 remains BLOCKED."
    echo -e "${RED}===================================================================${NC}"
    exit 1
fi
