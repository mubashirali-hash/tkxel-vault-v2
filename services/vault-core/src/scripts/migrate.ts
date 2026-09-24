import { runMigrations } from '../schema/migrator.js';

async function main() {
  const url = process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/tkxel_vault';
  console.log(`[Migration] Running canonical database migrations against: ${url.replace(/:[^:@]+@/, ':****@')}`);
  await runMigrations(url);
  console.log('[Migration] All tracked migrations successfully applied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Migration] Failed to apply migrations:', err);
  process.exit(1);
});
