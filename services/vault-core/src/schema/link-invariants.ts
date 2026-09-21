import fs from 'node:fs';
import path from 'node:path';
import { runMigrations, getMigrationsFolder } from './migrator.js';

/**
 * Loads the canonical link invariants DDL directly from the forward migration file.
 * This guarantees zero drift between tracked database migrations and runtime helpers.
 */
export function getCanonicalLinkInvariantsSql(): string {
  const migrationsFolder = getMigrationsFolder();
  const migrationPath = path.join(migrationsFolder, '0001_add_link_graph_invariants.sql');
  return fs.readFileSync(migrationPath, 'utf-8');
}

/**
 * Ensures link graph invariants and cross-vault boundary triggers are installed in PostgreSQL.
 * Subordinate to the canonical migration runner `runMigrations()`.
 * Executes the tracked migrations path directly.
 */
export async function ensureLinkGraphInvariants(clientOrDb?: any): Promise<void> {
  await runMigrations(clientOrDb);
}
