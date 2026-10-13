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
   * Reference implementation: match by scanning every page of the vault, as before migration 0010.
   * Results are identical to the indexed query; this exists so tests can prove that.
   */
  legacyScan?: boolean;
  /**
   * Keyword search normally needs every word of the query to match. With this set, when that finds
   * fewer pages than asked for, pages matching any of the words are added after them, best match
   * first. It lets a question asked in plain words ("why did we choose a phased go-live?") still
   * reach the right page when no semantic search is available. Used by the retrieval tools.
   */
  matchAnyFallback?: boolean;
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
  // A page can hold index entries for its published version and for a newer draft. Readers and the
  // retrieval tools search the published text only (FR-43); Owners and Editors search the newest.
  // Index entries exist for at most two versions of a page: the published one and one newer draft.
  // So "newest" means: the draft's entries, or the published entries when there is no draft.
  const visible = (alias: string) => {
    const versionId = sql.raw(`${alias}.version_id`);
    return options?.publishedOnly
      ? sql`${versionId} = p.current_version_id`
      : sql`(${versionId} IS DISTINCT FROM p.current_version_id
             OR NOT EXISTS (SELECT 1 FROM ${chunks} d WHERE d.page_id = p.id AND d.version_id IS DISTINCT FROM p.current_version_id))`;
  };
  const searchMode = options?.mode ?? 'hybrid';
  const engine = new HybridSearchEngine(60);

  // 2. Lexical search (PostgreSQL Full-Text cover-density ranking via ts_rank_cd)
  let lexicalResults: SearchResultItem[] = [];
  if (searchMode === 'hybrid' || searchMode === 'lexical') {
    const titleLike = '%' + cleanQuery + '%';
    // Relevance: cover density of the chunk text, plus fixed bonuses for a title or tag hit
    const rankScore = sql`(
               COALESCE(
                 CASE WHEN q.query_parsed::text != '' AND c.tsv_content IS NOT NULL
                      THEN ts_rank_cd(c.tsv_content, q.query_parsed)
                      ELSE 0.0 END,
                 0.0
               ) +
               CASE WHEN (q.query_parsed::text != '' AND to_tsvector('english', p.title) @@ q.query_parsed)
                         OR p.title ILIKE ${titleLike}
                    THEN 0.50 ELSE 0.0 END +
               CASE WHEN p.tags IS NOT NULL AND (
                         (q.query_parsed::text != '' AND to_tsvector('english', array_to_string(p.tags, ' ')) @@ q.query_parsed)
                         OR array_to_string(p.tags, ' ') ILIKE ${titleLike}
                    )
                    THEN 0.20 ELSE 0.0 END
             )`;

    // A query made only of stop words parses to nothing and is answered by title/tag substring match.
    // That path has no indexable term, so it keeps the scan.
    const parsed: any = await db.execute(sql`SELECT websearch_to_tsquery('english', ${cleanQuery})::text AS parsed`);
    const hasTerms = (parsed.rows?.[0]?.parsed ?? '') !== '';

    const strictQuery = sql`websearch_to_tsquery('english', ${cleanQuery})`;
    const runIndexed = (tsq: typeof strictQuery) => db.execute(sql`
      SELECT m.page_id, m.title, m.type, m.tags, m.chunk_id, m.chunk_position, m.rank_score
      FROM (
        SELECT p.id as page_id, p.title, p.type, p.tags, c.id as chunk_id, c.position as chunk_position,
               ${rankScore} as rank_score
        FROM (
          -- OFFSET 0 keeps this as its own step, so the GIN index lookup always runs first and the
          -- vault and version checks are applied to the matches only
          SELECT c1.id, c1.page_id, c1.version_id, c1.position, c1.tsv_content
          FROM ${chunks} c1
          WHERE c1.search_tsv @@ ${tsq}
          OFFSET 0
        ) c
        JOIN ${pages} p ON p.id = c.page_id
        CROSS JOIN (SELECT ${tsq} as query_parsed) q
        WHERE ${pageFilter}
          AND ${visible('c')}
        UNION ALL
        SELECT p.id as page_id, p.title, p.type, p.tags, NULL::uuid as chunk_id, NULL::integer as chunk_position,
               ${sql`(
               CASE WHEN to_tsvector('english', p.title) @@ q.query_parsed OR p.title ILIKE ${titleLike}
                    THEN 0.50 ELSE 0.0 END +
               CASE WHEN p.tags IS NOT NULL AND (
                         to_tsvector('english', array_to_string(p.tags, ' ')) @@ q.query_parsed
                         OR array_to_string(p.tags, ' ') ILIKE ${titleLike}
                    )
                    THEN 0.20 ELSE 0.0 END
             )`} as rank_score
        FROM ${pages} p
        CROSS JOIN (SELECT ${tsq} as query_parsed) q
        WHERE ${pageFilter}
          AND p.meta_tsv @@ ${tsq}
          AND NOT EXISTS (SELECT 1 FROM ${chunks} c0 WHERE c0.page_id = p.id AND ${visible('c0')})
      ) m
      ORDER BY m.rank_score DESC, m.page_id ASC, COALESCE(m.chunk_position, 0) ASC, COALESCE(m.chunk_id, '00000000-0000-0000-0000-000000000000'::uuid) ASC
      LIMIT 25
    `);

    const lexicalRows: any = hasTerms && !options?.legacyScan
      // Indexed: `search_tsv` holds title || tags || chunk text for each chunk and `meta_tsv` holds
      // title || tags for each page (migration 0010), so both arms are GIN index lookups. The second
      // arm covers pages that have no chunks, which the scan reached through its LEFT JOIN.
      ? await runIndexed(strictQuery)
      : await db.execute(sql`
      SELECT p.id as page_id, p.title, p.type, p.tags, c.id as chunk_id, c.position as chunk_position,
             ${rankScore} as rank_score
      FROM ${pages} p
      LEFT JOIN ${chunks} c ON c.page_id = p.id AND ${visible('c')}
      CROSS JOIN (SELECT websearch_to_tsquery('english', ${cleanQuery}) as query_parsed) q
      WHERE ${pageFilter}
        AND (
          CASE
            WHEN q.query_parsed::text != '' THEN
              (to_tsvector('english', p.title) || COALESCE(to_tsvector('english', array_to_string(p.tags, ' ')), ''::tsvector) || COALESCE(c.tsv_content, ''::tsvector)) @@ q.query_parsed
            ELSE
              p.title ILIKE ${titleLike}
              OR (p.tags IS NOT NULL AND array_to_string(p.tags, ' ') ILIKE ${titleLike})
          END
        )
      ORDER BY rank_score DESC, p.id ASC, COALESCE(c.position, 0) ASC, COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) ASC
      LIMIT 25
    `);

    const toItems = (rows: any[]): SearchResultItem[] => rows.map((r: any) => {
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
    lexicalResults = toItems(lexicalRows.rows || []);

    // Plain-word questions: when requiring every word found too few pages, add pages matching any word.
    // Negated terms are left alone, since "any of these, or not that" would match nearly everything.
    const parsedText: string = parsed.rows?.[0]?.parsed ?? '';
    const strictPages = new Set(lexicalResults.map((item) => item.pageId));
    if (options?.matchAnyFallback && hasTerms && !options?.legacyScan && strictPages.size < limit
        && parsedText.includes(' & ') && !parsedText.includes('!')) {
      const anyWord: any = await runIndexed(sql`replace(websearch_to_tsquery('english', ${cleanQuery})::text, ' & ', ' | ')::tsquery`);
      lexicalResults = lexicalResults.concat(toItems(anyWord.rows || []).filter((item) => !strictPages.has(item.pageId)));
    }
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
        WHERE ${pageFilter} AND c.embedding IS NOT NULL AND ${visible('c')}
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
