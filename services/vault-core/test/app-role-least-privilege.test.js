import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { db, pool } from '../dist/db.js';
import { sql } from 'drizzle-orm';
import { runMigrations } from '../dist/schema/migrator.js';

/**
 * FR-84 / AC-6: the role the services connect as can read and write rows, but cannot change the
 * schema, cannot disable the append-only triggers, and cannot rewrite or delete audit events.
 * A real role is created and a real connection is made as that role.
 */
test('The application database role has data privileges only', async (t) => {
  await runMigrations(db);

  const [{ can_create_roles: canCreateRoles }] = (await db.execute(sql`
    SELECT (rolsuper OR rolcreaterole) AS can_create_roles FROM pg_roles WHERE rolname = current_user
  `)).rows;
  if (!canCreateRoles) {
    t.skip('the test connection cannot create roles');
    return;
  }

  const role = `tkxel_app_t_${crypto.randomBytes(5).toString('hex')}`;
  const password = crypto.randomBytes(18).toString('hex');
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/tkxel_vault');
  let appPool;
  const denied = (promise, pattern = /permission denied|must be owner/i) =>
    assert.rejects(promise, (err) => pattern.test(`${err?.message} ${err?.cause?.message ?? ''}`));

  try {
    await db.execute(sql.raw(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`));
    await db.execute(sql`SELECT tkxel_grant_app_role(${role})`);

    url.username = role;
    url.password = password;
    // One connection, so the session setting below applies to every statement
    appPool = new pg.Pool({ connectionString: url.toString(), max: 1 });
    const app = (text, values) => appPool.query(text, values);

    assert.equal((await app('SELECT current_user AS u')).rows[0].u, role);
    // Where the optional row-level policies (schema/rls.sql) are installed, rows are visible to the
    // user named in the session. The migrations do not install them; this keeps the test valid either way.
    await app(`SELECT set_config('app.current_user_id', 'lp.owner@test.com', false)`);

    // Ordinary work: rows can be written, read, changed and removed
    const vaultId = crypto.randomUUID();
    await app(`INSERT INTO vaults (id, name, mode, owner_id, data_key_id, export_policy) VALUES ($1, 'Least Privilege Vault', 'open', 'lp.owner@test.com', 'k', 'allowed_for_owner')`, [vaultId]);
    await app(`UPDATE vaults SET name = 'Least Privilege Vault 2' WHERE id = $1`, [vaultId]);
    assert.equal((await app('SELECT name FROM vaults WHERE id = $1', [vaultId])).rows[0].name, 'Least Privilege Vault 2');
    await app('DELETE FROM vaults WHERE id = $1', [vaultId]);

    // The audit trail: append and read only
    const target = `lp-${crypto.randomUUID()}`;
    await app(`INSERT INTO audit_events (actor_id, action, target_id, metadata) VALUES ('lp.owner@test.com', 'least_privilege_check', $1, '{}')`, [target]);
    assert.equal((await app('SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1', [target])).rows[0].n, 1);
    await denied(app(`UPDATE audit_events SET action = 'x' WHERE target_id = $1`, [target]));
    await denied(app('DELETE FROM audit_events WHERE target_id = $1', [target]));
    await denied(app('TRUNCATE audit_events'));

    // Nothing that weakens the protections or changes the schema
    await denied(app('ALTER TABLE audit_events DISABLE TRIGGER ALL'));
    await denied(app('DROP TRIGGER trg_audit_events_no_delete ON audit_events'));
    await denied(app(`CREATE OR REPLACE FUNCTION block_audit_modification() RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql`));
    await denied(app('DROP TABLE pages CASCADE'));
    await denied(app('ALTER TABLE pages ADD COLUMN injected text'));
    await denied(app('CREATE TABLE public.injected (id int)'));
    await denied(app(`SET session_replication_role = 'replica'`), /permission denied/i);
    await denied(app(`SELECT tkxel_grant_app_role('${role}')`));
    await denied(app(`CREATE ROLE ${role}_x`));

    // An administrative role is refused as the application role
    await assert.rejects(
      db.execute(sql`SELECT tkxel_grant_app_role(current_user::name)`),
      (err) => /administrative attributes/.test(`${err?.message} ${err?.cause?.message ?? ''}`)
    );
  } finally {
    if (appPool) await appPool.end();
    try {
      await db.execute(sql.raw(`DROP OWNED BY ${role}`));
      await db.execute(sql.raw(`DROP ROLE IF EXISTS ${role}`));
    } catch (err) {
      console.error('Role cleanup failed:', err?.message);
    }
    await pool.end();
  }
});
