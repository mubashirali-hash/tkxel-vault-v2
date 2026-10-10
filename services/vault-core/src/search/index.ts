import { sql, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { pages, chunks, vaults } from '../schema/index.js';
import { HybridSearchEngine, SearchResultItem } from './hybrid.js';
import { getEmbeddingProvider, EmbeddingProvider } from './embedding-provider.js';

export * from './embedding-provider.js';
export * from './lifecycle.js';
export * from './chunker.js';
export * from './hybrid.js';
export * from './getContext.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Above this many candidate pages the index-backed narrowing is skipped in favour of the full scan. */
const MAX_CANDIDATE_PAGES = 500;

export interface SearchPagesOptions {
  mode?: 'hybrid' | 'lexical' | 'semantic';
  provider?: EmbeddingProvider;
  /** Restrict results to pages with a published snapshot (Readers and all retrieval tools, FR-43/FR-44). */
  publishedOnly?: boolean;
  /** FR-20 filters. */
  types?: string[];
  tags?: string[];
  updatedFrom?: Date;
  updatedTo?: Date;
  /**
   * Narrow keyword search to candidate pages found through the GIN indexes of migration 0009 before
   * ranking. Results are identical either way. Off unless set here or with SEARCH_CANDIDATE_INDEX=1:
   * it is several times faster for specific queries measured alone, but showed no reliable gain under
   * concurrent load in local tests and can be slower while table statistics are stale.
   */
  candidateIndex?: boolean;
}

export interface PageSearchResult {
  id: string;
  title: string;
  type: string;
  tags: string[];
  snippet: string;
  score: number;
  source: 'hybrid' | 'lexical' | 'vector';
}

/**
 * Searches pages in an open vault.
 * Strictly enforces zero-read isolation:
 * - Checks vault existence and mode before any provider activity.
 * - Locked vaults and unknown vaults return [] immediately with ZERO provider calls.
 * - Supports 'hybrid' (default), 'lexical', and 'semantic' modes.
 * - Accurately labels result source ('hybrid', 'lexical', 'vector') and never mislabels
 *   failed or skipped semantic searches as 'hybrid'.
 */
export async function searchPages(
  vaultId: string,
  query: string,
  limit: number = 10,
  options?: SearchPagesOptions
): Promise<PageSearchResult[]> {
  if (!query || !query.trim() || !vaultId || !UUID_REGEX.test(vaultId)) {
    return [];
  }

  // 1. Vault mode check: locked vaults cannot be searched (Zero-Read Invariant / ADR-017)
  // Non-existent or locked vaults return [] immediately with ZERO provider construction or calls.
  const vaultRec = await db.select({ mode: vaults.mode }).from(vaults).where(eq(vaults.id, vaultId)).limit(1);
  if (!vaultRec[0] || vaultRec[0].mode === 'locked') {
    return [];
  }

  const cleanQuery = query.trim();

  // Page-level predicate shared by the lexical and vector queries
  const pageFilters = [sql`p.vault_id = ${vaultId}::uuid`];
  if (options?.publishedOnly) {
    pageFilters.push(sql`p.current_version_id IS NOT NULL`);
  }
  const types = (options?.types || []).filter((t) => typeof t === 'string' && t.trim());
  if (types.length > 0) {
    pageFilters.push(sql`p.type IN (${sql.join(types.map((t) => sql`${t.trim()}`), sql`, `)})`);
  }
  const tagFilter = (options?.tags || []).filter((t) => typeof t === 'string' && t.trim());
  if (tagFilter.length > 0) {
    pageFilters.push(
      sql`p.tags::text[] && ARRAY[${sql.join(tagFilter.map((t) => sql`${t.trim().replace(/^#/, '')}`), sql`, `)}]::text[]`
    );
  }
  if (options?.updatedFrom && !isNaN(options.updatedFrom.getTime())) {
    pageFilters.push(sql`p.updated_at >= ${options.updatedFrom.toISOString()}::timestamptz`);
  }
  if (options?.updatedTo && !isNaN(options.updatedTo.getTime())) {
    pageFilters.push(sql`p.updated_at <= ${options.updatedTo.toISOString()}::timestamptz`);
  }
  const pageFilter = sql.join(pageFilters, sql` AND `);
  const searchMode = options?.mode ?? 'hybrid';
  const engine = new HybridSearchEngine(60);

  // 2. Lexical search (PostgreSQL Full-Text cover-density ranking via ts_rank_cd)
  let lexicalResults: SearchResultItem[] = [];
  if (searchMode === 'hybrid' || searchMode === 'lexical') {
    // 2a. Candidate pages through GIN indexes. A row can only satisfy the query below if at least one of
    // the query's words occurs in its chunk, its title or its tags, so "any word matches" is a safe
    // superset that the indexes can answer. The exact match and the ranking are still done by the query
    // below, unchanged; this only limits which pages it has to look at.
    let candidateFilter = sql``;
    let noCandidates = false;
    if (options?.candidateIndex ?? process.env.SEARCH_CANDIDATE_INDEX === '1') {
      const probe: any = await db.execute(sql`
        SELECT querytree(websearch_to_tsquery('english', ${cleanQuery})) AS tree,
               tsvector_to_array(to_tsvector('english', ${cleanQuery})) AS lexemes
      `);
      const tree: string = probe.rows?.[0]?.tree ?? '';
      const lexemes: string[] = probe.rows?.[0]?.lexemes ?? [];
      // 'T' or empty means the query has no indexable positive term (stop words only, or pure negation):
      // those keep the full scan. So does any word that would need escaping inside a tsquery literal.
      const indexable = tree !== '' && tree !== 'T' && lexemes.length > 0 && lexemes.every((l) => !/['\\]/.test(l));
      if (indexable) {
        const anyWord = lexemes.map((l) => `'${l}'`).join(' | ');
        // The lookup runs on its own with sequential scans disabled, so it uses the indexes even when
        // table statistics are stale (for example straight after a bulk import). It stops one row past
        // the cap: a query whose words occur in a large share of pages gains nothing from narrowing,
        // so it falls through to the full scan with no extra work.
        const candidateRows: any = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL enable_seqscan = off`);
          return tx.execute(sql`
            SELECT page_id FROM (
              SELECT c2.page_id FROM ${chunks} c2
              JOIN ${pages} pc ON pc.id = c2.page_id AND pc.vault_id = ${vaultId}::uuid
              WHERE c2.tsv_content @@ ${anyWord}::tsquery
              UNION
              SELECT p2.id FROM ${pages} p2
              WHERE p2.vault_id = ${vaultId}::uuid
                AND (to_tsvector('english', p2.title) @@ ${anyWord}::tsquery OR vault_tags_tsv(p2.tags) @@ ${anyWord}::tsquery)
            ) candidates
            LIMIT ${MAX_CANDIDATE_PAGES + 1}
          `);
        });
        const candidateIds: string[] = (candidateRows.rows || []).map((r: any) => r.page_id);
        if (candidateIds.length === 0) {
          noCandidates = true;
        } else if (candidateIds.length <= MAX_CANDIDATE_PAGES) {
          candidateFilter = sql`
        AND p.id = ANY(${`{${candidateIds.join(',')}}`}::uuid[])`;
        }
      }
    }

    // No page contains any of the query's words: nothing can match, so the ranking query is skipped
    const lexicalRows: any = noCandidates ? { rows: [] } : await db.execute(sql`
      SELECT p.id as page_id, p.title, p.type, p.tags, c.id as chunk_id, c.position as chunk_position,
             (
               COALESCE(
                 CASE WHEN q.query_parsed::text != '' AND c.tsv_content IS NOT NULL
                      THEN ts_rank_cd(c.tsv_content, q.query_parsed)
                      ELSE 0.0 END,
                 0.0
               ) +
               CASE WHEN (q.query_parsed::text != '' AND to_tsvector('english', p.title) @@ q.query_parsed)
                         OR p.title ILIKE ${'%' + cleanQuery + '%'}
                    THEN 0.50 ELSE 0.0 END +
               CASE WHEN p.tags IS NOT NULL AND (
                         (q.query_parsed::text != '' AND to_tsvector('english', array_to_string(p.tags, ' ')) @@ q.query_parsed)
                         OR array_to_string(p.tags, ' ') ILIKE ${'%' + cleanQuery + '%'}
                    )
                    THEN 0.20 ELSE 0.0 END
             ) as rank_score
      FROM ${pages} p
      LEFT JOIN ${chunks} c ON c.page_id = p.id
      CROSS JOIN (SELECT websearch_to_tsquery('english', ${cleanQuery}) as query_parsed) q
      WHERE ${pageFilter}${candidateFilter}
        AND (
          CASE
            WHEN q.query_parsed::text != '' THEN
              (to_tsvector('english', p.title) || COALESCE(to_tsvector('english', array_to_string(p.tags, ' ')), ''::tsvector) || COALESCE(c.tsv_content, ''::tsvector)) @@ q.query_parsed
            ELSE
              p.title ILIKE ${'%' + cleanQuery + '%'}
              OR (p.tags IS NOT NULL AND array_to_string(p.tags, ' ') ILIKE ${'%' + cleanQuery + '%'})
          END
        )
      ORDER BY rank_score DESC, p.id ASC, COALESCE(c.position, 0) ASC, COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) ASC
      LIMIT 25
    `);

    lexicalResults = (lexicalRows.rows || []).map((r: any) => {
      const rawScore = Number(r.rank_score);
      const score = !Number.isNaN(rawScore) ? rawScore : 0.0;
      return {
        id: r.chunk_id || r.page_id,
        pageId: r.page_id,
        title: r.title,
        type: r.type,
        tags: r.tags || [],
        position: r.chunk_position ?? 0,
        content: '', // safe metadata-only snippet: never leaks tsvector lexemes or unencrypted text
        score,
        source: 'lexical' as const,
      };
    });
  }

  // 3. Dense Vector semantic search (pgvector cosine distance)
  let vectorResults: SearchResultItem[] = [];

  if (searchMode === 'hybrid' || searchMode === 'semantic') {
    try {
      const embeddingProvider = options?.provider ?? getEmbeddingProvider();
      const queryEmbedding = await embeddingProvider.generateEmbedding(cleanQuery);
      const vectorLiteral = `[${queryEmbedding.join(',')}]`;

      const vectorRows: any = await db.execute(sql`
        SELECT p.id as page_id, p.title, p.type, p.tags, c.id as chunk_id, c.position as chunk_position,
               1 - (c.embedding <=> ${vectorLiteral}::vector) as similarity
        FROM ${pages} p
        JOIN ${chunks} c ON c.page_id = p.id
        WHERE ${pageFilter} AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vectorLiteral}::vector ASC, p.id ASC, COALESCE(c.position, 0) ASC, c.id ASC
        LIMIT 25
      `);

      vectorResults = (vectorRows.rows || [])
        .filter((r: any) => Number(r.similarity) > 0.25)
        .map((r: any) => ({
          id: r.chunk_id,
          pageId: r.page_id,
          title: r.title,
          type: r.type,
          tags: r.tags || [],
          position: r.chunk_position ?? 0,
          content: '',
          score: Number(r.similarity) || 0,
          source: 'vector' as const,
        }));
    } catch (vecErr) {
      if (searchMode === 'semantic') {
        // Pure semantic mode must fail closed and never pretend success or fall back to lexical
        throw vecErr;
      }
      // In hybrid mode, log warning and gracefully degrade to lexical without claiming 'hybrid'
      console.warn('Vector search fallback to lexical:', (vecErr as any)?.message);
    }
  }

  // 4. Mode-specific Fusion & Candidate Selection
  let candidates: SearchResultItem[];

  if (searchMode === 'semantic') {
    candidates = vectorResults;
  } else if (searchMode === 'lexical') {
    candidates = lexicalResults;
  } else {
    // Hybrid mode:
    // Only fuse if vector search succeeded AND returned results.
    // If vector search failed or returned 0 results, preserve lexical results with 'lexical' source.
    if (vectorResults.length > 0) {
      candidates = engine.fuseResults(lexicalResults, vectorResults, limit * 2);
    } else {
      candidates = lexicalResults;
    }
  }

  // 5. Deduplicate results per pageId
  const seenPages = new Set<string>();
  const aggregatedPages: PageSearchResult[] = [];

  for (const item of candidates) {
    if (!seenPages.has(item.pageId)) {
      seenPages.add(item.pageId);
      aggregatedPages.push({
        id: item.pageId,
        title: item.title,
        type: item.type || 'note',
        tags: item.tags || [],
        snippet: '', // safe metadata-only snippet: never leaks tsvector lexemes or unencrypted text
        score: item.score,
        source: item.source as 'hybrid' | 'lexical' | 'vector',
      });
      if (aggregatedPages.length >= limit) break;
    }
  }

  return aggregatedPages;
}
