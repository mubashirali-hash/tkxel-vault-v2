import { sql } from 'drizzle-orm';
import { db } from '../db.js';
import { pages } from '../schema/index.js';

export async function searchPages(vaultId: string, query: string) {
  if (!query) {
    return [];
  }
  
  // Use tsvector search on title, tags, and chunk text
  // For Epic A, we just do a simple ilike on title/tags, or a tsquery on chunks.
  // We'll do ilike on title/tags for the foundation since chunks may not be populated yet.
  const results = await db.execute(sql`
    SELECT id, title, type, tags
    FROM ${pages}
    WHERE vault_id = ${vaultId}
      AND (
        title ILIKE ${'%' + query + '%'}
        OR array_to_string(tags, ' ') ILIKE ${'%' + query + '%'}
      )
  `);

  return results.rows;
}
