#!/bin/bash
set -e

# tkxel Vault - Disaster Recovery Restore Script
# Usage: ./dr_restore.sh <backup_file>

BACKUP_FILE=$1
DB_NAME=${DB_NAME:-"tkxel_vault"}
DB_USER=${DB_USER:-"postgres"}
DB_HOST=${DB_HOST:-"localhost"}
DB_PORT=${DB_PORT:-"5432"}

if [ -z "$BACKUP_FILE" ]; then
  echo "Error: Backup file must be provided."
  echo "Usage: ./dr_restore.sh <backup_file>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file $BACKUP_FILE not found."
  exit 1
fi

echo "WARNING: This will overwrite the database '$DB_NAME'."
read -p "Are you sure you want to proceed? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Restore aborted."
  exit 1
fi

echo "Starting tkxel Vault database restoration from $BACKUP_FILE..."

# Terminate existing connections and drop/create the database
psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME';"
psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "CREATE DATABASE $DB_NAME;"

pg_restore -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -v "$BACKUP_FILE"

echo "Restoration completed successfully."
