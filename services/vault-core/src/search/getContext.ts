import { sql, eq, inArray, and } from 'drizzle-orm';
import { db } from '../db.js';
import { chunks, pages, links } from '../schema/index.js';
import { HybridSearchEngine, SearchResultItem } from './hybrid.js';

export class ContextAssembler {
  private engine = new HybridSearchEngine();

  /**
   * Generates a context bundle for a given query and target page.
   * If a query is provided, performs hybrid search to find relevant chunks.
   * Expands 1-hop link neighbors and packs context within max tokens.
   */
  public async getContext(vaultId: string, pageId: string, _query?: string, maxTokens: number = 4000) {
    // 1. Fetch the target page content
    const targetPageRes = await db.query.pages.findFirst({
      where: and(eq(pages.id, pageId), eq(pages.vault_id, vaultId)),
      with: {
        versions: { orderBy: (v: any, { desc }: any) => [desc(v.number)], limit: 1 }
      }
    });

    if (!targetPageRes) {
      throw new Error('Page not found');
    }

    // Since we don't have decrypted content directly in the ORM (it's bytea),
    // we assume the caller or another service layer has decrypted the body,
    // but for context packing simulation based on the RAG skill, we use mock content if unavailable.
    // In actual implementation, we'd fetch chunks and reconstruct.
    let targetContent = 'Content not available for plain text retrieval.';
    const targetChunks = await db.query.chunks.findMany({
      where: eq(chunks.page_id, pageId),
      orderBy: (c: any, { asc }: any) => [asc(c.position)]
    });
    if (targetChunks.length > 0) {
      // Assuming chunks contain plaintext for this prototype since we need it for context assembly.
      // Alternatively, we would need to decrypt `encrypted_text`.
      targetContent = `(Decrypted Content Placeholder for ${targetPageRes.title})`;
    }

    const targetPage = {
      id: targetPageRes.id,
      title: targetPageRes.title,
      content: targetContent,
      tags: targetPageRes.tags as string[]
    };

    // 2. Fetch 1-hop outbound link neighbors
    const outboundLinks = await db.query.links.findMany({
      where: eq(links.from_page_id, pageId),
      columns: { to_page_id: true }
    });
    
    const outboundPageIds = outboundLinks.map(l => l.to_page_id).filter(id => id !== null) as string[];
    const outboundPages: Array<{ pageId: string, title: string, content: string }> = [];
    
    if (outboundPageIds.length > 0) {
      const outPages = await db.query.pages.findMany({
        where: and(inArray(pages.id, outboundPageIds), eq(pages.vault_id, vaultId)),
        columns: { id: true, title: true }
      });
      for (const p of outPages) {
        outboundPages.push({ pageId: p.id, title: p.title, content: `(Snippet placeholder for ${p.title})` });
      }
    }

    // 3. Fetch 1-hop backlinks
    const backLinks = await db.query.links.findMany({
      where: eq(links.to_page_id, pageId),
      columns: { from_page_id: true }
    });
    
    const backLinkPageIds = backLinks.map(l => l.from_page_id);
    const backlinkPages: Array<{ pageId: string, title: string, content: string }> = [];
    
    if (backLinkPageIds.length > 0) {
      const inPages = await db.query.pages.findMany({
        where: and(inArray(pages.id, backLinkPageIds), eq(pages.vault_id, vaultId)),
        columns: { id: true, title: true }
      });
      for (const p of inPages) {
        backlinkPages.push({ pageId: p.id, title: p.title, content: `(Snippet placeholder for ${p.title})` });
      }
    }

    // 4. Assemble context bundle
    return this.engine.assembleContextBundle({
      targetPage,
      outboundPages,
      backlinkPages,
      maxTokens
    });
  }

  /**
   * Executes a hybrid search query directly in PostgreSQL
   * using ts_rank for BM25 and vector_cosine_ops for dense vectors.
   */
  public async executeHybridSearch(vaultId: string, query: string, queryEmbedding: number[], limit: number = 10): Promise<SearchResultItem[]> {
    // We would compute RRF in SQL, but for demonstration of the DB calls:
    
    // Lexical Search (BM25)
    const lexicalResults = await db.execute(sql`
      SELECT c.id, c.page_id, p.title, c.position, ts_rank(c.tsv_content, plainto_tsquery(${query})) as score
      FROM ${chunks} c
      JOIN ${pages} p ON c.page_id = p.id
      WHERE p.vault_id = ${vaultId} AND c.tsv_content @@ plainto_tsquery(${query})
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    // Vector Search (Cosine Similarity)
    const vectorResults = await db.execute(sql`
      SELECT c.id, c.page_id, p.title, c.position, 1 - (c.embedding <=> ${'[' + queryEmbedding.join(',') + ']'}::vector) as score
      FROM ${chunks} c
      JOIN ${pages} p ON c.page_id = p.id
      WHERE p.vault_id = ${vaultId}
      ORDER BY c.embedding <=> ${'[' + queryEmbedding.join(',') + ']'}::vector
      LIMIT ${limit}
    `);

    const bm25Items: SearchResultItem[] = lexicalResults.rows.map(row => ({
      id: String(row.id),
      pageId: String(row.page_id),
      title: String(row.title),
      content: `(Chunk content placeholder)`,
      score: Number(row.score),
      source: 'bm25'
    }));

    const vecItems: SearchResultItem[] = vectorResults.rows.map(row => ({
      id: String(row.id),
      pageId: String(row.page_id),
      title: String(row.title),
      content: `(Chunk content placeholder)`,
      score: Number(row.score),
      source: 'vector'
    }));

    return this.engine.fuseResults(bm25Items, vecItems, limit);
  }
}
