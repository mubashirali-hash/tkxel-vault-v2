import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { sql, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Splits a SQL script into statements at top-level semicolons. Text inside dollar-quoted bodies
 * (function definitions, DO blocks) and line comments is left alone.
 */
function splitSqlStatements(script) {
  const statements = [];
  let current = '';
  let dollarTag = null;
  const lines = script.split('\n');
  for (const line of lines) {
    const code = dollarTag ? line : line.replace(/--.*$/, '');
    let rest = code;
    let buffer = '';
    while (rest.length > 0) {
      if (dollarTag) {
        const close = rest.indexOf(dollarTag);
        if (close === -1) { buffer += rest; rest = ''; break; }
        buffer += rest.slice(0, close + dollarTag.length);
        rest = rest.slice(close + dollarTag.length);
        dollarTag = null;
        continue;
      }
      const open = rest.match(/\$[A-Za-z_]*\$/);
      const semicolon = rest.indexOf(';');
      if (open && (semicolon === -1 || open.index < semicolon)) {
        buffer += rest.slice(0, open.index + open[0].length);
        rest = rest.slice(open.index + open[0].length);
        dollarTag = open[0];
        continue;
      }
      if (semicolon === -1) { buffer += rest; rest = ''; break; }
      current += buffer + rest.slice(0, semicolon);
      if (current.trim()) statements.push(current.trim());
      current = '';
      buffer = '';
      rest = rest.slice(semicolon + 1);
    }
    current += buffer + '\n';
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

test('PostgreSQL RLS Defense-in-Depth: Session context strictly filters rows at SQL engine level', async () => {
  const aliceId = 'alice.rls@example.com';
  const bobId = 'bob.rls@example.com';
  const strangerId = 'stranger.rls@example.com';

  const vaultAliceId = crypto.randomUUID();
  const vaultBobId = crypto.randomUUID();
  const pageAliceId = crypto.randomUUID();
  const pageBobId = crypto.randomUUID();

  try {
    // 1. Seed test vaults and pages directly
    await db.insert(schema.vaults).values([
      {
        id: vaultAliceId,
        name: 'Alice Open Vault',
        mode: 'open',
        owner_id: aliceId,
        data_key_id: 'mock_dek_alice',
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultBobId,
        name: 'Bob Locked Vault',
        mode: 'locked',
        owner_id: bobId,
        data_key_id: 'mock_dek_bob',
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    await db.insert(schema.pages).values([
      {
        id: pageAliceId,
        vault_id: vaultAliceId,
        type: 'note',
        title: 'Alice Public Note',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageBobId,
        vault_id: vaultBobId,
        type: 'note',
        title: 'Bob Secret Strategy',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // Ensure non-superuser vault_app role exists for RLS enforcement (superuser bypasses RLS in Postgres)
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vault_app') THEN
          CREATE ROLE vault_app LOGIN PASSWORD 'vaultpassword';
        END IF;
      END $$;
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vault_app;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vault_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vault_app;
    `);

    // Ensure RLS policies from rls.sql are applied if not present
    const hasPolicy = await db.execute(sql`SELECT 1 FROM pg_policies WHERE policyname = 'pages_select'`);
    if (hasPolicy.rows.length === 0) {
      const rlsSql = fs.readFileSync(path.resolve(__dirname, '../src/schema/rls.sql'), 'utf-8');
      // Enabling row-level security takes an exclusive lock on each table, and other test files use
      // the same tables at the same time. Run as one transaction, the script holds one table while
      // waiting for the next, which can deadlock and get either side rolled back. Run one statement
      // at a time, it never holds a lock while waiting for another, so no deadlock can involve it.
      for (const statement of splitSqlStatements(rlsSql)) {
        for (let attempt = 1; ; attempt++) {
          try {
            await db.execute(sql.raw(statement));
            break;
          } catch (error) {
            const code = error?.cause?.code ?? error?.code;
            // 42710: another test file created this policy first, which is the state wanted
            if (code === '42710') break;
            if ((code !== '40P01' && code !== '55P03') || attempt >= 8) throw error;
            await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          }
        }
      }
    }

    // 2. Query as Alice with RLS session context
    const aliceVisiblePages = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE vault_app`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${aliceId}, true)`);
      // Raw select without WHERE vault_id clause - testing database RLS engine policy
      const result = await tx.execute(
        sql`SELECT id, title, vault_id FROM pages WHERE id IN (${pageAliceId}, ${pageBobId})`
      );
      return result.rows;
    });

    assert.equal(aliceVisiblePages.length, 1, 'Alice must only see her own vault pages');
    assert.equal(aliceVisiblePages[0].id, pageAliceId);
    assert.equal(aliceVisiblePages[0].title, 'Alice Public Note');

    // 3. Query as Bob with RLS session context
    const bobVisiblePages = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE vault_app`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${bobId}, true)`);
      const result = await tx.execute(
        sql`SELECT id, title, vault_id FROM pages WHERE id IN (${pageAliceId}, ${pageBobId})`
      );
      return result.rows;
    });

    assert.equal(bobVisiblePages.length, 1, 'Bob must only see his own vault pages');
    assert.equal(bobVisiblePages[0].id, pageBobId);
    assert.equal(bobVisiblePages[0].title, 'Bob Secret Strategy');

    // 4. Query as Stranger with RLS session context
    const strangerVisiblePages = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE vault_app`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${strangerId}, true)`);
      const result = await tx.execute(
        sql`SELECT id, title, vault_id FROM pages WHERE id IN (${pageAliceId}, ${pageBobId})`
      );
      return result.rows;
    });

    assert.equal(strangerVisiblePages.length, 0, 'Stranger must see zero pages under RLS');

    // 5. Query vaults with RLS session context
    const aliceVisibleVaults = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE vault_app`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${aliceId}, true)`);
      const result = await tx.execute(
        sql`SELECT id, name FROM vaults WHERE id IN (${vaultAliceId}, ${vaultBobId})`
      );
      return result.rows;
    });

    assert.equal(aliceVisibleVaults.length, 1);
    assert.equal(aliceVisibleVaults[0].id, vaultAliceId);

  } finally {
    // Clean up
    await db.delete(schema.pages).where(sql`id IN (${pageAliceId}, ${pageBobId})`);
    await db.delete(schema.vaults).where(sql`id IN (${vaultAliceId}, ${vaultBobId})`);
  }
});
