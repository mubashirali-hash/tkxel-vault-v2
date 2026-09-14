# tkxel Vault - Disaster Recovery & Rollback Runbook

This runbook outlines the standard operating procedures for taking point-in-time backups of the tkxel Vault PostgreSQL database and restoring them in the event of data corruption, accidental deletion, or disaster.

## Prerequisites
- Access to the target PostgreSQL server (credentials, host, port).
- `pg_dump` and `pg_restore` utilities installed on the machine executing these scripts.
- Sufficient disk space for the backup files.

## 1. Taking a Backup

Backups are taken using the `dr_backup.sh` (or equivalent `.ps1` on Windows) script. The script uses `pg_dump` with the custom format (`-F c`) to produce a compressed, restorable snapshot.

### Usage
```bash
./dr_backup.sh [output_directory]
```
- **output_directory**: (Optional) The folder to store the backup. Defaults to `./backups`.

### Environment Variables
You must provide the connection details via environment variables if they differ from the defaults:
- `DB_NAME` (Default: `tkxel_vault`)
- `DB_USER` (Default: `postgres`)
- `DB_HOST` (Default: `localhost`)
- `DB_PORT` (Default: `5432`)

**Example:**
```bash
DB_PASSWORD="your_secure_password" DB_HOST="prod-db.example.com" ./dr_backup.sh /mnt/backups
```

## 2. Restoring a Backup

Restorations are performed using the `dr_restore.sh` script.

> [!CAUTION]
> Restoring a backup is a DESTRUCTIVE operation. The script will drop the existing database and recreate it from the backup file. All data created after the backup was taken will be permanently lost.

### Usage
```bash
./dr_restore.sh <path_to_backup_file.sql>
```

### Environment Variables
The restore script uses the same environment variables as the backup script (`DB_NAME`, `DB_USER`, `DB_HOST`, `DB_PORT`).

**Example:**
```bash
DB_PASSWORD="your_secure_password" DB_HOST="prod-db.example.com" ./dr_restore.sh /mnt/backups/vault_backup_20260911_120000.sql
```

## 3. Rollback Testing (Verification)

To ensure backups are valid, perform a dry-run restoration on a staging environment at least once a month.

1. **Take a snapshot:** `./dr_backup.sh ./test_backups`
2. **Verify file creation:** `ls -lh ./test_backups`
3. **Restore to a dummy database:**
   ```bash
   DB_NAME="tkxel_vault_test" ./dr_restore.sh ./test_backups/vault_backup_<TIMESTAMP>.sql
   ```
4. **Validate Data Integrity:**
   - Connect to `tkxel_vault_test` and verify that the `vaults`, `pages`, and `page_versions` tables contain expected row counts.
   - Verify that the `updated_at` timestamps for Optimistic Concurrency Control were preserved.
