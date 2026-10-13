#!/bin/bash
# Runs once, when the PostgreSQL data directory is first created (docker-entrypoint-initdb.d).
# Creates the role the services connect as. It has no administrative attributes; the migration that
# follows grants it data privileges only (tkxel_grant_app_role, migration 0011).
set -euo pipefail

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "APP_DB_PASSWORD is not set: the tkxel_app role was not created." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE tkxel_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tkxel_app') \gexec
ALTER ROLE tkxel_app PASSWORD :'app_password';
SQL
