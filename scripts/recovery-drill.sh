#!/usr/bin/env bash
# Recovery drill, following backup_restore_runbook.md: back up the local database, verify the archive,
# show that tampering and a wrong passphrase are caught, restore into a scratch database, compare it
# with the source, read an encrypted page from the restored copy, then remove the scratch database.
# The source database is only ever read.
# Usage: scripts/recovery-drill.sh [work-dir]   (run from anywhere; needs docker, gpg and the built vault-core)
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; WORK="${1:-$(mktemp -d)}"
CONTAINER="${BACKUP_DOCKER_CONTAINER:-tkxel-vault-postgres}"
DRILL_DB=tkxel_vault_drill
export BACKUP_DOCKER_CONTAINER="$CONTAINER"
mkdir -p "$WORK/backups"
PASS_FILE="$WORK/drill-passphrase"
head -c 32 /dev/urandom | base64 > "$PASS_FILE"; chmod 600 "$PASS_FILE"
export BACKUP_PASSPHRASE_FILE="$PASS_FILE"
ok=0; bad=0
result() { if [ "$1" -eq 0 ]; then echo "PASS  $2"; ok=$((ok+1)); else echo "FAIL  $2"; bad=$((bad+1)); fi; }
sql() { docker exec "$CONTAINER" psql -U postgres -d "$1" -At -c "$2"; }
counts() { sql "$1" "select (select count(*) from vaults)||' vaults, '||(select count(*) from pages)||' pages, '||(select count(*) from versions)||' versions, '||(select count(*) from chunks)||' chunks, '||(select count(*) from audit_events)||' audit events, '||(select count(*) from skills)||' skills'"; }

cd "$REPO"
t0=$SECONDS
bash ./dr_backup.sh "$WORK/backups" > "$WORK/backup.log" 2>&1; result $? "backup runs (encrypted archive and checksum written)"
ARCHIVE="$(ls -t "$WORK"/backups/*.gpg 2>/dev/null | head -n 1)"
echo "      archive: $(basename "$ARCHIVE")  $(stat -c %s "$ARCHIVE") bytes  backup took $((SECONDS - t0))s"
[ -f "$ARCHIVE.sha256" ]; result $? "checksum file exists next to the archive"
head -c 4096 "$ARCHIVE" | grep -a -q "CREATE TABLE\|PGDMP"; [ $? -ne 0 ]; result $? "archive on disk is not a readable database dump"

bash ./dr_restore.sh --verify-only "$ARCHIVE" > "$WORK/verify.log" 2>&1; result $? "verify-only accepts the archive"
grep -q "No changes were made" "$WORK/verify.log"; result $? "verify-only says it changed nothing"

cp "$ARCHIVE" "$WORK/tampered.dump.gpg"; cp "$ARCHIVE.sha256" "$WORK/tampered.dump.gpg.sha256"
printf '\x00\x01\x02' | dd of="$WORK/tampered.dump.gpg" bs=1 seek=2000 conv=notrunc 2>/dev/null
sed -i "s/$(basename "$ARCHIVE")/tampered.dump.gpg/" "$WORK/tampered.dump.gpg.sha256"
bash ./dr_restore.sh --verify-only "$WORK/tampered.dump.gpg" > "$WORK/tamper.log" 2>&1; [ $? -ne 0 ]; result $? "a modified archive is rejected"

echo "wrong-passphrase" > "$WORK/wrong-pass"; chmod 600 "$WORK/wrong-pass"
BACKUP_PASSPHRASE_FILE="$WORK/wrong-pass" bash ./dr_restore.sh --verify-only "$ARCHIVE" > "$WORK/wrongpass.log" 2>&1; [ $? -ne 0 ]; result $? "a wrong passphrase is rejected"

t1=$SECONDS
DB_NAME="$DRILL_DB" bash ./dr_restore.sh --yes "$ARCHIVE" > "$WORK/restore.log" 2>&1; result $? "restore into the scratch database"
echo "      restore took $((SECONDS - t1))s"
SRC="$(counts tkxel_vault)"; DST="$(counts "$DRILL_DB")"
echo "      source:   $SRC"; echo "      restored: $DST"
[ "$SRC" = "$DST" ]; result $? "row counts match the source"
SRC_SUM="$(sql tkxel_vault "select md5(string_agg(id::text||md5(encrypted_blob), ',' order by id)) from versions")"
DST_SUM="$(sql "$DRILL_DB" "select md5(string_agg(id::text||md5(encrypted_blob), ',' order by id)) from versions")"
[ -n "$SRC_SUM" ] && [ "$SRC_SUM" = "$DST_SUM" ]; result $? "every stored (encrypted) version is byte-identical after the restore"
[ "$(sql "$DRILL_DB" "select count(*) from pg_trigger where tgrelid = 'audit_events'::regclass and not tgisinternal")" -ge 1 ]; result $? "the audit trail's append-only trigger came back with the restore"
docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -c "DELETE FROM audit_events" > "$WORK/audit-delete.log" 2>&1; [ $? -ne 0 ]; result $? "the restored audit trail still refuses deletion"

# Read a page through the application code, pointed at the restored database
PAGE="$(sql "$DRILL_DB" "select p.id from pages p join vaults v on v.id = p.vault_id where p.current_version_id is not null and v.data_key_id not like 'shredded:%' limit 1")"
if [ -n "$PAGE" ]; then
  DBPASS="$(docker exec "$CONTAINER" printenv POSTGRES_PASSWORD)"
  ( cd services/vault-core && DATABASE_URL="postgres://postgres:${DBPASS}@localhost:5432/${DRILL_DB}" NODE_ENV=development node --input-type=module -e "
    import { getPageContent } from './dist/versions/index.js';
    import { pool } from './dist/db.js';
    const page = await getPageContent('$PAGE', undefined, { publishedOnly: true });
    console.log(page && typeof page.content === 'string' && page.content.length > 0 ? 'DECRYPTED-OK' : 'DECRYPT-MISMATCH');
    await pool.end();
  " ) > "$WORK/decrypt.log" 2>&1
  grep -q "DECRYPTED-OK" "$WORK/decrypt.log"; result $? "a page read from the restored database decrypts"
else
  echo "SKIP  no suitable page for the decrypt check"
fi

docker exec "$CONTAINER" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS \"$DRILL_DB\"" > /dev/null 2>&1; result $? "scratch database removed"
rm -f "$PASS_FILE" "$WORK/wrong-pass" "$WORK"/backups/* "$WORK"/tampered.dump.gpg*
echo "$ok passed, $bad failed"
[ "$bad" -eq 0 ]
