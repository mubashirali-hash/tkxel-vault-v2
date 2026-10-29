import { encode, decode } from 'gpt-tokenizer';

export interface SearchResultItem {
  id: string;
  pageId: string;
  title: string;
  content: string;
  score: number;
  source: 'lexical' | 'vector' | 'hybrid' | 'bm25';
  type?: string;
  tags?: string[];
  position?: number;
}

export interface ContextBundle {
  targetPage: {
    id: string;
    title: string;
    content: string;
    tags: string[];
  };
  directOutboundLinks: Array<{ pageId: string; title: string; snippet: string }>;
  directBacklinks: Array<{ pageId: string; title: string; snippet: string }>;
  assembledMarkdown: string;
  totalTokenEstimate: number;
}

/**
 * Hybrid Search using Reciprocal Rank Fusion (RRF) and Context Aggregator.
 */
export class HybridSearchEngine {
  private rrfK: number;

  constructor(rrfK: number = 60) {
    this.rrfK = rrfK;
  }

  /**
   * Combines BM25 and Vector search results using Reciprocal Rank Fusion (RRF).
   * RRF score = sum(1 / (k + rank))
   */
  public fuseResults(
    bm25Results: SearchResultItem[],
    vectorResults: SearchResultItem[],
    limit: number = 10
  ): SearchResultItem[] {
    const scoreMap = new Map<
      string,
      {
        item: SearchResultItem;
        rrfScore: number;
        inLexical: boolean;
        inVector: boolean;
      }
    >();

    // Process BM25 / Lexical rankings
    bm25Results.forEach((item, index) => {
      const rank = index + 1;
      const score = 1 / (this.rrfK + rank);
      scoreMap.set(item.id, {
        item,
        rrfScore: score,
        inLexical: true,
        inVector: false,
      });
    });

    // Process Vector rankings
    vectorResults.forEach((item, index) => {
      const rank = index + 1;
      const score = 1 / (this.rrfK + rank);
      const existing = scoreMap.get(item.id);
      if (existing) {
        existing.rrfScore += score;
        existing.inVector = true;
      } else {
        scoreMap.set(item.id, {
          item,
          rrfScore: score,
          inLexical: false,
          inVector: true,
        });
      }
    });

    // Sort by RRF score descending and assign source accurately
    const sorted = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit)
      .map((entry) => {
        let source: 'lexical' | 'vector' | 'hybrid';
        if (entry.inLexical && entry.inVector) {
          source = 'hybrid';
        } else if (entry.inVector) {
          source = 'vector';
        } else {
          source = 'lexical';
        }

        return {
          ...entry.item,
          source,
          score: entry.rrfScore,
        };
      });

    return sorted;
  }

  /**
   * Assembles a 1-hop graph neighborhood into a unified Markdown context bundle (FR-51, FR-52).
   */
  public assembleContextBundle(params: {
    targetPage: { id: string; title: string; content: string; tags: string[] };
    outboundPages: Array<{ pageId: string; title: string; content: string }>;
    backlinkPages: Array<{ pageId: string; title: string; content: string }>;
    maxTokens?: number;
  }): ContextBundle {
    const { targetPage, outboundPages, backlinkPages, maxTokens = 4000 } = params;

    const directOutboundLinks = outboundPages.map((p) => ({
      pageId: p.pageId,
      title: p.title,
      snippet: p.content.slice(0, 300) + (p.content.length > 300 ? '...' : ''),
    }));

    const directBacklinks = backlinkPages.map((p) => ({
      pageId: p.pageId,
      title: p.title,
      snippet: p.content.slice(0, 300) + (p.content.length > 300 ? '...' : ''),
    }));

    let markdown = `# Context Hub: ${targetPage.title}\n\n`;
    if (targetPage.tags.length > 0) {
      markdown += `**Tags:** ${targetPage.tags.map((t) => `#${t}`).join(' ')}\n\n`;
    }

    markdown += `## Target Document Content\n\n${targetPage.content}\n\n`;

    if (directOutboundLinks.length > 0) {
      markdown += `## Linked Outgoing Documents\n\n`;
      for (const link of directOutboundLinks) {
        markdown += `### [[${link.title}]]\n> ${link.snippet}\n\n`;
      }
    }

    if (directBacklinks.length > 0) {
      markdown += `## Documents Linking Here (Backlinks)\n\n`;
      for (const backlink of directBacklinks) {
        markdown += `### [[${backlink.title}]]\n> ${backlink.snippet}\n\n`;
      }
    }

    // Exact token counting via tokenizer
    const tokens = encode(markdown);
    let totalTokenEstimate = tokens.length;

    // Enforce maxTokens truncation if exceeded
    if (totalTokenEstimate > maxTokens) {
      const truncatedTokens = tokens.slice(0, maxTokens - 10); // leave room for notice
      markdown = decode(truncatedTokens) + '\n\n... [Context truncated to token budget]';
      totalTokenEstimate = maxTokens;
    }

    return {
      targetPage,
      directOutboundLinks,
      directBacklinks,
      assembledMarkdown: markdown,
      totalTokenEstimate,
    };
  }
}
