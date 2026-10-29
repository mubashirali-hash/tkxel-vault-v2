# tkxel Vault - Backup, Restore and Recovery Drill Runbook

Covers NFR-21 (daily encrypted backups, 30-day retention, quarterly recovery drills) and NFR-22 (RPO 24 hours, RTO 4 hours).

## What the scripts do

| Script | Purpose |
| :--- | :--- |
| `dr_backup.sh [output_dir]` | Dumps the database and encrypts it in one stream (GnuPG, AES-256, integrity protected). Writes a `.sha256` checksum, removes local archives older than the retention window, and optionally copies the archive off-host. |
| `dr_restore.sh --verify-only <file>` | Checks the checksum, decrypts, and reads the archive's table of contents. Changes nothing. |
| `dr_restore.sh [--yes] <file>` | Verifies as above, then **replaces** the database with the backup. |

No plaintext copy of the database is ever written to disk, and the backup script refuses to run without a passphrase file.

## Prerequisites

- `gpg` on the machine running the scripts.
- `pg_dump`, `pg_restore` and `psql` on that machine, **or** set `BACKUP_DOCKER_CONTAINER` to run them inside the Postgres container.
- A passphrase file (mode `600`). Store the passphrase in the cloud secrets manager and materialise the file at run time. Never keep it in the backup directory or bucket: a backup is only as safe as its passphrase.
- For off-host copies: the AWS CLI with write access to the backup bucket.

## Configuration

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `BACKUP_PASSPHRASE_FILE` | none (required) | Path to the passphrase file. |
| `DB_NAME` / `DB_USER` / `DB_HOST` / `DB_PORT` | `tkxel_vault` / `postgres` / `localhost` / `5432` | Connection details. Supply the password with `PGPASSWORD` or `~/.pgpass`. |
| `BACKUP_DOCKER_CONTAINER` | unset | Container name to run the Postgres tools in. |
| `BACKUP_RETENTION_DAYS` | `30` | Local retention. Apply the same lifetime to the bucket with a lifecycle rule. |
| `BACKUP_S3_URI` | unset | e.g. `s3://tkxel-vault-backups/prod/`. Keep the bucket in the designated region (NFR-31) with versioning and default encryption on. |

## Daily automated backup (RPO 24 hours)

Schedule the backup once a day on the database host or a dedicated operations host. Example crontab entry (02:15 UTC):

```cron
15 2 * * * BACKUP_PASSPHRASE_FILE=/run/secrets/vault_backup_passphrase BACKUP_DOCKER_CONTAINER=tkxel-vault-postgres BACKUP_S3_URI=s3://tkxel-vault-backups/prod/ /opt/tkxel-vault/dr_backup.sh /var/backups/tkxel-vault >> /var/log/tkxel-vault-backup.log 2>&1
```

Alert on a non-zero exit status and on a missing archive for the current day. A backup that silently stops is the most common way to miss the RPO.

## Verifying a backup

Run after every backup if time allows, and at least weekly:

```bash
BACKUP_PASSPHRASE_FILE=/run/secrets/vault_backup_passphrase \
BACKUP_DOCKER_CONTAINER=tkxel-vault-postgres \
./dr_restore.sh --verify-only /var/backups/tkxel-vault/vault_backup_<TIMESTAMP>.dump.gpg
```

Expected output ends with `Verification completed successfully. No changes were made.` A wrong passphrase, a truncated file or a modified file all fail this check.

## Restoring (RTO 4 hours)

> **Caution:** restore is destructive. It drops the target database and recreates it from the archive. Everything written after the backup was taken is lost.

1. Stop the API server, MCP gateway and skill runner so nothing writes during the restore.
2. Fetch the archive and its `.sha256` file if they are only in the bucket.
3. Run the restore and type the database name when asked (or pass `--yes` in automation):

   ```bash
   BACKUP_PASSPHRASE_FILE=/run/secrets/vault_backup_passphrase ./dr_restore.sh /var/backups/tkxel-vault/vault_backup_<TIMESTAMP>.dump.gpg
   ```
4. Apply any migrations newer than the backup: `pnpm db:migrate`.
5. Start the services and check `/api/health`, then sign in and open a page in an open vault.

The restored database holds vault content as ciphertext. It is readable only while the KMS master key that wrapped each vault's data key is available, so KMS key policy and backup retention must be planned together. A vault that was crypto-shredded after the backup stays unreadable: its wrapped key is in the backup, but restoring it deliberately undoes the shred, so treat that as a decision for the vault Owner, not an operational default.

## Quarterly recovery drill

1. Pick the most recent archive from the bucket, not from local disk.
2. Restore it into a scratch database: `DB_NAME=tkxel_vault_drill ./dr_restore.sh --yes <file>`.
3. Record the elapsed time (target: well inside the 4-hour RTO) and the age of the archive (target: under 24 hours).
4. Run `pnpm db:migrate` against the scratch database and confirm row counts for `vaults`, `pages`, `versions` and `audit_events` are plausible.
5. Drop the scratch database and file the drill record with the date, operator, timings and any problems found.

## Rolling back an application release

Application rollback is redeploying the previous image tag. Database migrations in this project are forward-only, so a release that added a migration is rolled back by restoring the backup taken before that release, following the restore steps above.

## Audit trail retention (FR-84: at least 2 years)

The audit trail is kept in the live database, not in the backups. `audit_events` is append-only: database triggers reject UPDATE, DELETE and TRUNCATE, and the application has no purge job, so events are kept for as long as the database exists. That is what meets the 2-year minimum. The 30-day backup window above is for disaster recovery only and does not limit how far back the audit trail goes.

What operators must do to keep it that way:

- Do not add a job, script or manual step that removes rows from `audit_events`. If storage ever forces archiving, events older than 2 years may be exported first (the Owner CSV export, or `COPY` by a database administrator) and only then removed by a database administrator who disables the triggers for that one operation, with a record of who did it and when.
- A restore brings back the audit trail as of the backup, so up to 24 hours of the newest events can be lost (the RPO). Record that gap in the incident report.
- Check the oldest event during each quarterly drill: `SELECT min("timestamp"), count(*) FROM audit_events;`. On a system older than 2 years the oldest event must be at least 2 years old.

