import { encode, decode } from 'gpt-tokenizer';

export interface TextChunk {
  chunkIndex: number;
  content: string;
  heading?: string;
  tokenEstimate: number;
}

export interface ChunkerOptions {
  maxTokensPerChunk?: number;
  overlapTokens?: number;
}

/**
 * Token-aware Sliding-window Markdown Chunker.
 * Segments Markdown documents into semantically coherent chunks, preserving headings, YAML frontmatter, and wiki-links.
 */
export class MarkdownChunker {
  private maxTokens: number;
  private overlapTokens: number;

  constructor(options?: ChunkerOptions) {
    this.maxTokens = options?.maxTokensPerChunk ?? 512;
    this.overlapTokens = options?.overlapTokens ?? 50;
  }

  public chunk(markdown: string): TextChunk[] {
    const lines = markdown.split('\n');
    const sections: Array<{ heading?: string; text: string }> = [];

    let currentHeading: string | undefined = undefined;
    let currentLines: string[] = [];
    
    // Extract frontmatter
    let inFrontmatter = false;
    let frontmatter = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && line.trim() === '---') {
        inFrontmatter = true;
        frontmatter += line + '\n';
        continue;
      }
      
      if (inFrontmatter) {
        frontmatter += line + '\n';
        if (line.trim() === '---') {
          inFrontmatter = false;
          currentLines.push(frontmatter.trim());
        }
        continue;
      }

      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            text: currentLines.join('\n').trim(),
          });
          currentLines = [];
        }
        currentHeading = headingMatch[1].trim();
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        text: currentLines.join('\n').trim(),
      });
    }

    // Now convert sections into chunks respecting token boundaries & overlap
    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      if (!section.text) continue;

      const fullText = section.heading ? `## ${section.heading}\n\n${section.text}` : section.text;
      const tokens = encode(fullText);

      if (tokens.length <= this.maxTokens) {
        chunks.push({
          chunkIndex: chunkIndex++,
          content: fullText,
          heading: section.heading,
          tokenEstimate: tokens.length,
        });
        continue;
      }

      // Sliding window over tokens
      let start = 0;
      while (start < tokens.length) {
        const end = Math.min(start + this.maxTokens, tokens.length);
        const chunkTokens = tokens.slice(start, end);
        const chunkText = decode(chunkTokens);

        // Prepend heading if it's a split section and we are past the first chunk
        const finalChunkText = (start > 0 && section.heading) ? `## ${section.heading} (continued)\n\n${chunkText}` : chunkText;

        chunks.push({
          chunkIndex: chunkIndex++,
          content: finalChunkText,
          heading: section.heading,
          tokenEstimate: chunkTokens.length,
        });

        if (end >= tokens.length) break;
        start += this.maxTokens - this.overlapTokens;
      }
    }

    return chunks;
  }
}
