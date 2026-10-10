#!/bin/bash
set -euo pipefail

# tkxel Vault - Encrypted Database Restore (NFR-21, NFR-22)
#
# Usage:
#   ./dr_restore.sh --verify-only <backup_file.dump.gpg>   Check integrity and readability; changes nothing.
#   ./dr_restore.sh [--yes] <backup_file.dump.gpg>         Restore (DESTRUCTIVE: replaces the database).
#
# Required:
#   BACKUP_PASSPHRASE_FILE   Path to the passphrase file used when the backup was taken.
# Optional:
#   DB_NAME (tkxel_vault)  DB_USER (postgres)  DB_HOST (localhost)  DB_PORT (5432)  PGPASSWORD
#   BACKUP_DOCKER_CONTAINER  Run pg_restore / psql inside this container instead of on the host.

VERIFY_ONLY=false
ASSUME_YES=false
BACKUP_FILE=""
for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=true ;;
    --yes) ASSUME_YES=true ;;
    -*) echo "Error: unknown option $arg" >&2; exit 1 ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done

DB_NAME=${DB_NAME:-"tkxel_vault"}
DB_USER=${DB_USER:-"postgres"}
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: an existing backup file must be provided." >&2
  echo "Usage: ./dr_restore.sh [--verify-only|--yes] <backup_file.dump.gpg>" >&2
  exit 1
fi
if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "Error: BACKUP_PASSPHRASE_FILE must point to the backup passphrase file." >&2
  exit 1
fi
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "Error: DB_NAME must be a plain identifier." >&2
  exit 1
fi

run_pg() {
  # run_pg <tool> [args...] - reads stdin when the tool does
  local tool=$1; shift
  if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
    docker exec -i "$BACKUP_DOCKER_CONTAINER" "$tool" -U "$DB_USER" "$@"
  else
    "$tool" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$@"
  fi
}

decrypt() {
  gpg --batch --quiet --decrypt --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" "$BACKUP_FILE"
}

# 1. Checksum (detects truncation or tampering before any decryption)
if [ -f "${BACKUP_FILE}.sha256" ]; then
  ( cd "$(dirname "$BACKUP_FILE")" && sha256sum --check --quiet "$(basename "$BACKUP_FILE").sha256" )
  echo "Checksum OK."
else
  echo "Warning: no .sha256 file found next to the archive; skipping checksum verification." >&2
fi

# 2. Decrypt and read the archive's table of contents (proves the passphrase and the dump are both good)
OBJECT_COUNT=$(decrypt | run_pg pg_restore --list | grep -c -E '^[0-9]+;' || true)
if [ "$OBJECT_COUNT" -lt 1 ]; then
  echo "Error: the archive decrypted but contains no restorable objects." >&2
  exit 1
fi
echo "Archive is readable: $OBJECT_COUNT restorable objects."

if [ "$VERIFY_ONLY" = true ]; then
  echo "Verification completed successfully. No changes were made."
  exit 0
fi

echo "WARNING: This will replace the database '$DB_NAME'. Data written after this backup will be lost."
if [ "$ASSUME_YES" != true ]; then
  read -r -p "Type the database name to proceed: " REPLY
  if [ "$REPLY" != "$DB_NAME" ]; then
    echo "Restore aborted."
    exit 1
  fi
fi

echo "Restoring '$DB_NAME' from $BACKUP_FILE..."
run_pg psql -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null
run_pg psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
run_pg psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"

decrypt | run_pg pg_restore -d "$DB_NAME" --no-owner --exit-on-error

echo "Restoration completed successfully."
