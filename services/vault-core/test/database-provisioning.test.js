import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pkg from 'pg';
const { Client } = pkg;
import { runMigrations, getMigrationsFolder } from '../dist/index.js';

const ADMIN_DB_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/postgres';
const BASE_HOST_URL = process.env.TEST_DATABASE_HOST_URL || 'postgres://postgres:postgrespassword@localhost:5432';

test('PostgreSQL Structural Enforcement & Database Provisioning', async (t) => {
  async function withAdminClient(fn) {
    const client = new Client({ connectionString: ADMIN_DB_URL });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async function withTestDbClient(dbName, fn) {
    const client = new Client({ connectionString: `${BASE_HOST_URL}/${dbName}` });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  await t.test('1. Fresh database provisioning applies migrations and installs constraints and triggers', async () => {
    const freshDbName = `tkxel_fresh_${Date.now()}`;
    await withAdminClient(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${freshDbName}" WITH (FORCE);`);
      await admin.query(`CREATE DATABASE "${freshDbName}";`);
    });

    try {
      const freshDbUrl = `${BASE_HOST_URL}/${freshDbName}`;
      await runMigrations(freshDbUrl);

      await withTestDbClient(freshDbName, async (client) => {
        const constrRes = await client.query(
          "SELECT conname, convalidated FROM pg_constraint WHERE conname = 'links_resolved_has_target'"
        );
        assert.equal(constrRes.rows.length, 1, 'links_resolved_has_target constraint must exist');
        assert.equal(constrRes.rows[0].convalidated, true, 'links_resolved_has_target must be validated');

        const trigRes = await client.query(
          `SELECT tgname, tgenabled FROM pg_trigger
           WHERE tgname IN (
             'trg_links_before_update',
             'trg_links_enforce_invariants',
             'trg_pages_enforce_link_invariants',
             'trg_vaults_enforce_link_invariants'
           )
           ORDER BY tgname`
        );
        assert.equal(trigRes.rows.length, 4, 'All 4 link-graph triggers must be installed');
        for (const row of trigRes.rows) {
          assert.equal(row.tgenabled, 'O', `Trigger ${row.tgname} must be enabled ('O')`);
        }

        const vaultId = crypto.randomUUID();
        const pageId = crypto.randomUUID();
        await client.query(
          `INSERT INTO vaults (id, name, mode, owner_id, data_key_id, export_policy)
           VALUES ($1, 'Test Vault', 'open', 'owner-1', 'key-1', 'allowed_for_owner')`,
          [vaultId]
        );
        await client.query(
          `INSERT INTO pages (id, vault_id, type, title)
           VALUES ($1, $2, 'note', 'Page 1')`,
          [pageId, vaultId]
        );

        await assert.rejects(
          async () => {
            await client.query(
              `INSERT INTO links (from_page_id, to_page_id, raw_target, link_type, resolved)
               VALUES ($1, NULL, 'target', 'wiki', true)`,
              [pageId]
            );
          },
          /links_resolved_has_target|check constraint/i
        );

        await assert.rejects(
          async () => {
            await client.query(
              `INSERT INTO links (from_page_id, to_page_id, raw_target, link_type, resolved)
               VALUES ($1, $2, 'target', 'wiki', false)`,
              [pageId, pageId]
            );
          },
          /links_resolved_has_target|check constraint/i
        );
      });
    } finally {
      await withAdminClient(async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS "${freshDbName}" WITH (FORCE);`);
      });
    }
  });

  await t.test('2. Upgraded database provisioning applies forward migrations cleanly and enables ghosting on deletion', async () => {
    const upgradeDbName = `tkxel_upgrade_${Date.now()}`;
    await withAdminClient(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${upgradeDbName}" WITH (FORCE);`);
      await admin.query(`CREATE DATABASE "${upgradeDbName}";`);
    });

    try {
      const upgradeDbUrl = `${BASE_HOST_URL}/${upgradeDbName}`;
      const migrationsFolder = getMigrationsFolder();
      const baseline0000Sql = fs.readFileSync(path.join(migrationsFolder, '0000_tearful_mercury.sql'), 'utf-8');

      await withTestDbClient(upgradeDbName, async (client) => {
        const statements = baseline0000Sql.split('--> statement-breakpoint');
        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (trimmed) {
            await client.query(trimmed);
          }
        }
      });

      await withTestDbClient(upgradeDbName, async (client) => {
        const preConstr = await client.query(
          "SELECT conname FROM pg_constraint WHERE conname = 'links_resolved_has_target'"
        );
        assert.equal(preConstr.rows.length, 0, 'Constraint should not exist prior to forward migration');
      });

      await runMigrations(upgradeDbUrl);

      await withTestDbClient(upgradeDbName, async (client) => {
        const postConstr = await client.query(
          "SELECT conname, convalidated FROM pg_constraint WHERE conname = 'links_resolved_has_target'"
        );
        assert.equal(postConstr.rows.length, 1, 'links_resolved_has_target must exist after upgrade');
        assert.equal(postConstr.rows[0].convalidated, true, 'links_resolved_has_target must be validated');

        const trigRes = await client.query(
          `SELECT tgname, tgenabled FROM pg_trigger
           WHERE tgname IN (
             'trg_links_before_update',
             'trg_links_enforce_invariants',
             'trg_pages_enforce_link_invariants',
             'trg_vaults_enforce_link_invariants'
           )`
        );
        assert.equal(trigRes.rows.length, 4, 'All 4 triggers must exist after upgrade');

        const vaultId = crypto.randomUUID();
        const p1Id = crypto.randomUUID();
        const p2Id = crypto.randomUUID();

        await client.query(
          `INSERT INTO vaults (id, name, mode, owner_id, data_key_id, export_policy)
           VALUES ($1, 'Upgrade Vault', 'open', 'owner-1', 'key-1', 'allowed_for_owner')`,
          [vaultId]
        );
        await client.query(
          `INSERT INTO pages (id, vault_id, type, title)
           VALUES ($1, $2, 'note', 'Page Source'), ($3, $2, 'note', 'Page Target')`,
          [p1Id, vaultId, p2Id]
        );

        const linkId = crypto.randomUUID();
        await client.query(
          `INSERT INTO links (id, from_page_id, to_page_id, raw_target, link_type, resolved)
           VALUES ($1, $2, $3, 'Page Target', 'wiki', true)`,
          [linkId, p1Id, p2Id]
        );

        await client.query('DELETE FROM pages WHERE id = $1', [p2Id]);

        const linkCheck = await client.query('SELECT resolved, to_page_id FROM links WHERE id = $1', [linkId]);
        assert.equal(linkCheck.rows.length, 1, 'Link row must still exist');
        assert.equal(linkCheck.rows[0].resolved, false, 'Link must be converted to unresolved');
        assert.equal(linkCheck.rows[0].to_page_id, null, 'to_page_id must be null');
      });
    } finally {
      await withAdminClient(async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS "${upgradeDbName}" WITH (FORCE);`);
      });
    }
  });
});
