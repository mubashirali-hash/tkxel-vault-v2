#!/usr/bin/env bash
# Full local rehearsal on Linux (WSL or any Docker host). It repeats what the CI pipeline checked,
# on a throwaway database inside its own network, so nothing outside the rehearsal is touched:
#
#   1. install, lint, typecheck, build, migrate, release-claim guard, the full test suite (Node 22)
#   2. build every production image; create the least-privilege role; migrate as the schema owner;
#      prove the application role cannot alter the schema or the audit trail; prove production mode
#      refuses to start without an approved KMS and model key; boot the services and check health
#      and that they run unprivileged
#   3. OAuth 2.1 end to end: Keycloak as the authorization server, the MCP gateway as resource server
#   4. the gVisor sandbox check for the skill runner (when the runsc runtime is installed)
#
# Usage:  scripts/rehearsal-linux.sh <source-tarball-or-directory> [stage ...]
#         stages: tests images oauth sandbox   (default: all)
# Results: one PASS/FAIL line per step in $WORK/summary.txt, full output in $WORK/logs/.
set -u

SOURCE="${1:?give the source tarball or directory}"
shift || true
STAGES="${*:-tests images oauth sandbox}"
WORK="${REHEARSAL_HOME:-$HOME/tkxel-rehearsal}"
SRC="$WORK/src"
LOGS="$WORK/logs"
SUMMARY="$WORK/summary.txt"
POD="tkreh-net"
NODE_IMAGE="node:22-bookworm-slim"
PG_IMAGE="pgvector/pgvector:pg16"
PNPM_VERSION="11.22.0"

mkdir -p "$WORK" "$LOGS"
: > "$SUMMARY"
# One-run secrets; never printed
DB_PASSWORD="reh-$(openssl rand -hex 16)"
APP_PASSWORD="app-$(openssl rand -hex 16)"
RUNNER_SECRET="$(openssl rand -hex 32)"
WEBHOOK_SECRET="$(openssl rand -hex 24)"
HMAC_SECRET="$(openssl rand -hex 24)"
KC_ADMIN_PASSWORD="kc-$(openssl rand -hex 12)"
E2E_PASSWORD="e2e-$(openssl rand -hex 12)"
OWNER_URL="postgres://postgres:${DB_PASSWORD}@localhost:5432/tkxel_vault"
APP_URL="postgres://tkxel_app:${APP_PASSWORD}@localhost:5432/tkxel_vault"

note() { echo "$(date +%H:%M:%S) $*"; }
step() { # step "<name>" command...   -> runs it, logs it, records PASS/FAIL
  local name="$1"; shift
  local log="$LOGS/$(printf '%s' "$name" | tr -c 'A-Za-z0-9' '_').log"
  local started=$SECONDS
  note "START $name"
  if "$@" > "$log" 2>&1; then
    echo "PASS  $name  ($((SECONDS - started))s)" | tee -a "$SUMMARY"
    return 0
  fi
  echo "FAIL  $name  ($((SECONDS - started))s)  see $log" | tee -a "$SUMMARY"
  tail -n 25 "$log" | sed 's/^/      | /'
  return 1
}
has_stage() { [[ " $STAGES " == *" $1 "* ]]; }
in_pod() { docker run --rm --network "container:$POD" "$@"; }
node_run() { # run a shell command in the source tree with Node 22, inside the pod
  docker run --rm --network "container:$POD" -v "$SRC:/work" -v tkreh-pnpm-store:/pnpm-store -w /work \
    -e CI=true -e HOME=/tmp/home -e npm_config_store_dir=/pnpm-store \
    -e DATABASE_URL="$OWNER_URL" -e REDIS_URL=redis://localhost:6379 \
    -e TEST_ADMIN_DATABASE_URL="postgres://postgres:${DB_PASSWORD}@localhost:5432/postgres" \
    -e TEST_DATABASE_HOST_URL="postgres://postgres:${DB_PASSWORD}@localhost:5432" \
    "${NODE_ENV_ARGS[@]}" "$NODE_IMAGE" bash -lc "corepack enable >/dev/null 2>&1; corepack prepare pnpm@${PNPM_VERSION} --activate >/dev/null 2>&1; $1"
}
NODE_ENV_ARGS=()
http_code() { in_pod "$NODE_IMAGE" node -e "fetch(process.argv[1],{method:process.argv[2]||'GET',headers:{'Content-Type':'application/json'},body:process.argv[2]==='POST'?'{}':undefined}).then(r=>console.log(r.status)).catch(()=>console.log('000'))" "$@"; }
http_body() { in_pod "$NODE_IMAGE" node -e "fetch(process.argv[1]).then(r=>r.text()).then(t=>console.log(t.trim())).catch(()=>console.log(''))" "$1"; }
expect_code() { local got; got="$(http_code "$2" "${3:-GET}")"; echo "$2 -> $got (want $1)"; [ "$got" = "$1" ]; }

cleanup_containers() {
  docker rm -f tkreh-runner tkreh-api tkreh-gateway tkreh-web tkreh-keycloak tkreh-gateway-oauth tkreh-redis tkreh-pg "$POD" >/dev/null 2>&1 || true
}
start_pod() { # an isolated network namespace shared by every rehearsal container
  cleanup_containers
  docker run -d --name "$POD" alpine:latest sleep infinity >/dev/null || return 1
  docker run -d --name tkreh-pg --network "container:$POD" -e POSTGRES_DB=tkxel_vault -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$DB_PASSWORD" "$PG_IMAGE" >/dev/null || return 1
  docker run -d --name tkreh-redis --network "container:$POD" redis:7-alpine >/dev/null || return 1
  for _ in $(seq 1 40); do
    in_pod -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" pg_isready -h localhost -U postgres -d tkxel_vault >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
reset_database() {
  in_pod -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS tkxel_vault WITH (FORCE)" -c "CREATE DATABASE tkxel_vault" -c "DROP ROLE IF EXISTS tkxel_app"
}

# ------------------------------------------------------------------ source
note "rehearsal home: $WORK   stages: $STAGES"
# earlier runs leave files owned by the container user, so a container removes them
docker run --rm -v "$WORK:/w" alpine:latest rm -rf /w/src >/dev/null 2>&1 || true
rm -rf "$SRC" && mkdir -p "$SRC"
if [ -d "$SOURCE" ]; then cp -a "$SOURCE/." "$SRC/"; else tar -xf "$SOURCE" -C "$SRC"; fi
find "$SRC" -name '*.sh' -exec sed -i 's/\r$//' {} +
note "source: ${REHEARSAL_COMMIT:-unknown commit}, $(find "$SRC" -type f | wc -l) files"

step "start isolated database and cache" start_pod || { note "cannot continue without the database"; exit 1; }

# ------------------------------------------------------------------ 1. tests
if has_stage tests; then
  step "install dependencies" node_run "pnpm install --frozen-lockfile" \
  && step "lint" node_run "pnpm turbo run lint" ; \
  step "typecheck" node_run "pnpm turbo run typecheck"
  if step "build packages and apps" node_run "pnpm turbo run build --force"; then
    step "apply database migrations" node_run "pnpm db:migrate"
    step "release claims have acceptance evidence" node_run "pnpm verify:release-claims"
    step "release-claim guard tests" node_run "node --test scripts/verify-release-claims.test.mjs"
    step "full test suite" node_run "pnpm turbo run test --force --concurrency=1"
    grep -hE "^ℹ (tests|pass|fail) |Tasks:|Failed:" "$LOGS/full_test_suite.log" 2>/dev/null | tail -n 40 > "$LOGS/full_test_suite.totals" || true
  fi
fi

# ------------------------------------------------------------------ 2. images
if has_stage images; then
  build_images() { for target in migration api-server mcp-gateway skill-runner web-app; do docker build --target "$target" -t "tkxel-vault/$target:rehearsal" "$SRC" || return 1; done; }
  if step "build every production image" build_images; then
    step "reset database for the image checks" reset_database
    create_role() {
      in_pod -e PGPASSWORD="$DB_PASSWORD" -e PGHOST=localhost -e POSTGRES_USER=postgres -e POSTGRES_DB=tkxel_vault -e APP_DB_PASSWORD="$APP_PASSWORD" \
        -v "$SRC/scripts/init-db-app-role.sh:/init-db-app-role.sh:ro" "$PG_IMAGE" bash /init-db-app-role.sh
    }
    step "create the least-privilege application role" create_role
    step "apply migrations as the schema owner (migration image)" in_pod -e DATABASE_URL="$OWNER_URL" tkxel-vault/migration:rehearsal

    as_app() { in_pod -e PGPASSWORD="$APP_PASSWORD" "$PG_IMAGE" psql -h localhost -U tkxel_app -d tkxel_vault -v ON_ERROR_STOP=1 -c "$1"; }
    role_checks() {
      as_app "SELECT count(*) FROM vaults" || return 1
      as_app "INSERT INTO audit_events (actor_id, action, target_id) VALUES ('rehearsal', 'boot_check', 'rehearsal')" || return 1
      for statement in "DELETE FROM audit_events" "ALTER TABLE audit_events DISABLE TRIGGER ALL" "DROP TABLE pages CASCADE" "CREATE TABLE public.injected (id int)"; do
        if as_app "$statement"; then echo "application role was allowed: $statement"; return 1; fi
      done
    }
    step "application role cannot alter the schema or the audit trail" role_checks

    STACK_ENV=(-e DATABASE_URL="$APP_URL" -e RUN_MIGRATIONS_ON_START=false -e REDIS_URL=redis://localhost:6379 -e RUNNER_SHARED_SECRET="$RUNNER_SECRET" -e SSO_WEBHOOK_SECRET="$WEBHOOK_SECRET" -e EMBEDDING_PROVIDER=deterministic)
    refuses_production() {
      for service in skill-runner api-server mcp-gateway; do
        if timeout 40 docker run --rm --network "container:$POD" "${STACK_ENV[@]}" -e NODE_ENV=production "tkxel-vault/$service:rehearsal" > "$LOGS/refusal_$service.log" 2>&1; then
          echo "$service started in production mode without KMS, SSO or model configuration"; return 1
        fi
        echo "== $service refused:"; grep -E "FATAL|forbidden|requires|required|must" "$LOGS/refusal_$service.log" | head -n 4
      done
    }
    step "production mode refuses to start without approved KMS, sign-in and model settings" refuses_production

    DEV=(-e NODE_ENV=development -e KMS_PROVIDER=mock -e ALLOW_DEV_MOCK_KMS=true -e ALLOW_DEV_MOCK_LLM=true -e ALLOW_DEV_HOST_SANDBOX=true -e ENABLE_DEV_AUTH_BYPASS=true)
    boot_services() {
      docker run -d --name tkreh-runner --network "container:$POD" "${STACK_ENV[@]}" "${DEV[@]}" -e PORT=3003 -e HOME=/tmp --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true tkxel-vault/skill-runner:rehearsal || return 1
      docker run -d --name tkreh-api --network "container:$POD" "${STACK_ENV[@]}" "${DEV[@]}" -e SKILL_RUNNER_URL=http://localhost:3003 tkxel-vault/api-server:rehearsal || return 1
      docker run -d --name tkreh-gateway --network "container:$POD" "${STACK_ENV[@]}" "${DEV[@]}" -e SKILL_RUNNER_URL=http://localhost:3003 -e MCP_DEV_HMAC_SECRET="$HMAC_SECRET" tkxel-vault/mcp-gateway:rehearsal || return 1
      docker run -d --name tkreh-web --network "container:$POD" tkxel-vault/web-app:rehearsal || return 1
      sleep 18
      docker ps -a --filter name=tkreh- --format '{{.Names}} {{.Status}}'
    }
    step "boot the services from their images" boot_services
    health_checks() {
      local ok=0
      expect_code 200 http://localhost:3002/api/health || ok=1
      expect_code 401 http://localhost:3002/api/vaults || ok=1
      expect_code 200 http://localhost:3001/health || ok=1
      expect_code 401 http://localhost:3001/mcp POST || ok=1
      expect_code 200 http://localhost:3003/health || ok=1
      local web; web="$(http_body http://localhost:80/healthz)"; echo "web /healthz -> '$web'"; [ "$web" = "ok" ] || ok=1
      for c in tkreh-runner tkreh-api tkreh-gateway; do
        local uid; uid="$(docker exec "$c" id -u)"; echo "$c runs as uid $uid"; [ "$uid" = "10001" ] || ok=1
      done
      docker exec tkreh-runner docker --version || ok=1
      if docker exec tkreh-runner test -S /var/run/docker.sock; then echo "runner has a local docker socket"; ok=1; fi
      return $ok
    }
    step "services answer, refuse anonymous callers and run unprivileged" health_checks
    for c in tkreh-runner tkreh-api tkreh-gateway tkreh-web; do docker logs --tail 60 "$c" > "$LOGS/container_$c.log" 2>&1 || true; done
    docker rm -f tkreh-runner tkreh-api tkreh-gateway tkreh-web >/dev/null 2>&1 || true
  fi
fi

# ------------------------------------------------------------------ 3. oauth
if has_stage oauth; then
  if [ ! -d "$SRC/services/mcp-gateway/dist" ]; then
    step "install and build for the sign-in check" node_run "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@tkxel-vault/mcp-gateway..."
  fi
  step "reset database for the sign-in check" reset_database
  NODE_ENV_ARGS=(-e NODE_ENV=development -e KMS_PROVIDER=mock -e ALLOW_DEV_MOCK_KMS=true -e EMBEDDING_PROVIDER=deterministic
    -e RUNNER_SHARED_SECRET="$RUNNER_SECRET" -e SSO_WEBHOOK_SECRET="$WEBHOOK_SECRET" -e GATEWAY_URL=http://localhost:3001
    -e KEYCLOAK_URL=http://localhost:8080 -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD"
    -e E2E_USER_EMAIL=e2e.reader@tkxel-test.local -e E2E_USER_PASSWORD="$E2E_PASSWORD")
  start_keycloak() { docker run -d --name tkreh-keycloak --network "container:$POD" -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" quay.io/keycloak/keycloak:26.0 start-dev --http-port=8080; }
  step "start Keycloak" start_keycloak
  seed() { node_run "pnpm db:migrate && cd services/mcp-gateway && node scripts/oauth-e2e-seed.mjs" | tee "$LOGS/oauth_seed.out"; }
  if step "migrate and seed the sign-in test data" seed; then
    E2E_VAULT_ID="$(grep VAULT_ID= "$LOGS/oauth_seed.out" | tail -n 1 | cut -d= -f2)"
    NODE_ENV_ARGS+=(-e E2E_VAULT_ID="$E2E_VAULT_ID")
    start_gateway() {
      docker run -d --name tkreh-gateway-oauth --network "container:$POD" -v "$SRC:/work" -w /work/services/mcp-gateway \
        -e DATABASE_URL="$OWNER_URL" -e REDIS_URL=redis://localhost:6379 "${NODE_ENV_ARGS[@]}" \
        -e OIDC_ISSUER=http://localhost:8080/realms/tkxel-vault -e OIDC_AUDIENCE=http://localhost:3001/mcp \
        -e OAUTH_AUTHORIZATION_SERVERS=http://localhost:8080/realms/tkxel-vault -e MCP_PUBLIC_URL=http://localhost:3001 \
        "$NODE_IMAGE" node dist/start.js || return 1
      for _ in $(seq 1 40); do [ "$(http_code http://localhost:3001/health)" = "200" ] && return 0; sleep 1; done
      return 1
    }
    step "start the gateway with Keycloak as its authorization server" start_gateway
    wait_keycloak() { for _ in $(seq 1 90); do [ "$(http_code http://localhost:8080/realms/master)" = "200" ] && return 0; sleep 2; done; return 1; }
    step "Keycloak is ready" wait_keycloak
    step "configure the Keycloak realm" node_run "cd services/mcp-gateway && node scripts/oauth-e2e-check.mjs --setup"
    step "OAuth 2.1 client flow against the MCP gateway" node_run "cd services/mcp-gateway && node scripts/oauth-e2e-check.mjs"
    docker logs --tail 60 tkreh-gateway-oauth > "$LOGS/container_gateway_oauth.log" 2>&1 || true
  fi
  NODE_ENV_ARGS=()
  docker rm -f tkreh-keycloak tkreh-gateway-oauth >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ 4. sandbox
if has_stage sandbox; then
  if docker info 2>/dev/null | grep -q runsc; then
    if [ ! -d "$SRC/services/skill-runner/dist" ]; then
      step "install and build for the sandbox check" node_run "pnpm install --frozen-lockfile && pnpm turbo run build --filter=@tkxel-vault/skill-runner..."
    fi
    docker image inspect python:3.12-alpine >/dev/null 2>&1 || docker pull -q python:3.12-alpine >/dev/null 2>&1 || true
    # Runs on the host: it starts real sandboxes through the host's Docker daemon
    sandbox_check() { (cd "$SRC/services/skill-runner" && node scripts/sandbox-gvisor-check.mjs); }
    step "gVisor sandbox check for the skill runner" sandbox_check
  else
    echo "SKIP  gVisor sandbox check (runsc runtime not installed)" | tee -a "$SUMMARY"
  fi
fi

cleanup_containers
note "done"
echo "----- summary -----"
cat "$SUMMARY"
[ -f "$LOGS/full_test_suite.totals" ] && { echo "----- test totals -----"; cat "$LOGS/full_test_suite.totals"; }
if grep -q "^FAIL" "$SUMMARY"; then exit 1; fi
