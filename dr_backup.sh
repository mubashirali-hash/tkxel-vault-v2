#!/bin/bash
set -e

# tkxel Vault - Disaster Recovery Backup Script
# Usage: ./dr_backup.sh <output_dir>

OUTPUT_DIR=${1:-"./backups"}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME=${DB_NAME:-"tkxel_vault"}
DB_USER=${DB_USER:-"postgres"}
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}

mkdir -p "$OUTPUT_DIR"

BACKUP_FILE="${OUTPUT_DIR}/vault_backup_${TIMESTAMP}.sql"

echo "Starting tkxel Vault database backup to $BACKUP_FILE..."
pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -F c -b -v -f "$BACKUP_FILE" "$DB_NAME"

echo "Backup completed successfully: $BACKUP_FILE"
