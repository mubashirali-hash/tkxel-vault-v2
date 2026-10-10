#!/bin/bash
set -euo pipefail

# tkxel Vault - Encrypted Database Backup (NFR-21, NFR-22)
#
# Usage: ./dr_backup.sh [output_dir]
#
# The dump is piped straight from pg_dump into GnuPG (AES-256, integrity protected), so no plaintext
# copy of the database ever touches disk. A SHA-256 checksum is written next to each archive, archives
# older than the retention window are removed, and the archive can be copied off-host.
#
# Required:
#   BACKUP_PASSPHRASE_FILE   Path to a file holding the backup passphrase (mode 600; keep it in the
#                            secrets manager, never beside the backups).
# Optional:
#   DB_NAME (tkxel_vault)  DB_USER (postgres)  DB_HOST (localhost)  DB_PORT (5432)  PGPASSWORD
#   BACKUP_DOCKER_CONTAINER  Run pg_dump inside this container instead of on the host.
#   BACKUP_RETENTION_DAYS    Days to keep local archives (default 30).
#   BACKUP_S3_URI            e.g. s3://bucket/tkxel-vault/ - copy each archive there with the AWS CLI.

OUTPUT_DIR=${1:-"./backups"}
DB_NAME=${DB_NAME:-"tkxel_vault"}
DB_USER=${DB_USER:-"postgres"}
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}

if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "Error: BACKUP_PASSPHRASE_FILE must point to a non-empty passphrase file. Unencrypted backups are not supported." >&2
  exit 1
fi
if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || [ "$RETENTION_DAYS" -lt 1 ]; then
  echo "Error: BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi
command -v gpg >/dev/null 2>&1 || { echo "Error: gpg is required." >&2; exit 1; }

mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR" 2>/dev/null || true

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_FILE="${OUTPUT_DIR}/vault_backup_${TIMESTAMP}.dump.gpg"
PARTIAL_FILE="${BACKUP_FILE}.partial"
trap 'rm -f "$PARTIAL_FILE"' EXIT

dump_database() {
  if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
    docker exec "$BACKUP_DOCKER_CONTAINER" pg_dump -U "$DB_USER" -F c -b "$DB_NAME"
  else
    pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -F c -b "$DB_NAME"
  fi
}

echo "Starting encrypted backup of '$DB_NAME' -> $BACKUP_FILE"
dump_database | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
  --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --output "$PARTIAL_FILE"

if [ ! -s "$PARTIAL_FILE" ]; then
  echo "Error: backup archive is empty." >&2
  exit 1
fi
mv "$PARTIAL_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE" 2>/dev/null || true

( cd "$OUTPUT_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" )
echo "Backup written: $BACKUP_FILE ($(wc -c < "$BACKUP_FILE") bytes)"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  command -v aws >/dev/null 2>&1 || { echo "Error: BACKUP_S3_URI is set but the AWS CLI is not installed." >&2; exit 1; }
  aws s3 cp "$BACKUP_FILE" "${BACKUP_S3_URI%/}/" --only-show-errors
  aws s3 cp "${BACKUP_FILE}.sha256" "${BACKUP_S3_URI%/}/" --only-show-errors
  echo "Copied off-host to ${BACKUP_S3_URI%/}/"
fi

# Retention: remove local archives (and their checksums) older than the window
find "$OUTPUT_DIR" -maxdepth 1 -type f \( -name 'vault_backup_*.dump.gpg' -o -name 'vault_backup_*.dump.gpg.sha256' \) \
  -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/Removed expired backup: /'

echo "Backup completed successfully."
