import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/tkxel_vault';
const pool = new Pool({ connectionString });

async function cleanDatabase() {
  console.log('Connecting to PostgreSQL to purge legacy demo data...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Delete dependent child records
    console.log('Clearing chunks...');
    await client.query('DELETE FROM chunks;');

    console.log('Clearing links...');
    await client.query('DELETE FROM links;');

    console.log('Clearing timeline entries...');
    try {
      await client.query('DELETE FROM timeline_entries;');
    } catch {
      // Table might not exist or empty
    }

    console.log('Clearing page versions...');
    await client.query('DELETE FROM versions;');

    console.log('Clearing pages...');
    await client.query('DELETE FROM pages;');

    console.log('Clearing skills...');
    try {
      await client.query('DELETE FROM skills;');
    } catch {
      // Table might not exist or empty
    }

    // Retain root vaults and shares, but clean demo-specific audit events
    console.log('Cleaning mock audit events...');
    try {
      await client.query("DELETE FROM audit_events WHERE actor_id = 'alex.dev@tkxel.com' OR actor_id = 'usr_admin';");
    } catch (e) {
      console.log('Audit events table clean skipped or error:', e.message);
    }

    await client.query('COMMIT');
    console.log('✅ Successfully purged all legacy demo data from database!');
    console.log('Root vaults and active owner shares preserved for clean start.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to clean database:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDatabase();
