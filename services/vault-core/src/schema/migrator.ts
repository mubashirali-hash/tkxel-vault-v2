import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the absolute directory path to the tracked Drizzle migrations folder.
 */
export function getMigrationsFolder(): string {
  const candidates = [
    path.resolve(__dirname, '../../drizzle'),
    path.resolve(__dirname, '../drizzle'),
    path.resolve(process.cwd(), 'services/vault-core/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'meta/_journal.json'))) {
      return candidate;
    }
  }
  throw new Error(`Could not locate migrations folder with meta/_journal.json. Checked: ${candidates.join(', ')}`);
}

/**
 * Runs all pending tracked Drizzle migrations against the target database.
 * This is the canonical migration and provisioning runner for tkxel Vault.
 *
 * Safe to run multiple times (idempotent, records applied migrations in drizzle.__drizzle_migrations).
 */
export async function runMigrations(customDbOrPoolOrUrl?: any): Promise<void> {
  const migrationsFolder = getMigrationsFolder();

  // 1. If an active Drizzle instance with dialect is passed
  if (customDbOrPoolOrUrl && typeof customDbOrPoolOrUrl.query === 'function' && customDbOrPoolOrUrl.dialect) {
    await migrate(customDbOrPoolOrUrl, { migrationsFolder });
    return;
  }

  // 2. If a connection string is passed
  if (typeof customDbOrPoolOrUrl === 'string') {
    const tempPool = new Pool({ connectionString: customDbOrPoolOrUrl });
    const targetDb = drizzle(tempPool);
    try {
      await migrate(targetDb, { migrationsFolder });
    } finally {
      await tempPool.end();
    }
    return;
  }

  // 3. If a pg.Pool or pg.Client is passed
  if (customDbOrPoolOrUrl && (typeof customDbOrPoolOrUrl.connect === 'function' || typeof customDbOrPoolOrUrl.query === 'function')) {
    const targetDb = drizzle(customDbOrPoolOrUrl);
    await migrate(targetDb, { migrationsFolder });
    return;
  }

  // 4. Default: use core database instance
  const { db } = await import('../db.js');
  await migrate(db, { migrationsFolder });
}
