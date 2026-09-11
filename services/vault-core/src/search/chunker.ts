export interface TextChunk {
  chunkIndex: number;
  content: string;
  heading?: string;
  tokenEstimate: number;
}

export interface ChunkerOptions {
  maxWordsPerChunk?: number;
  overlapWords?: number;
}

/**
 * Sliding-window Markdown Chunker.
 * Segments Markdown documents into semantically coherent chunks, preserving headings and context.
 */
export class MarkdownChunker {
  private maxWords: number;
  private overlap: number;

  constructor(options?: ChunkerOptions) {
    this.maxWords = options?.maxWordsPerChunk ?? 400;
    this.overlap = options?.overlapWords ?? 50;
  }

  public chunk(markdown: string): TextChunk[] {
    const lines = markdown.split('\n');
    const sections: Array<{ heading?: string; text: string }> = [];

    let currentHeading: string | undefined;
    let currentLines: string[] = [];

    for (const line of lines) {
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

    // Now convert sections into chunks respecting word boundaries & overlap
    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      if (!section.text) continue;

      const words = section.text.split(/\s+/).filter(Boolean);
      if (words.length <= this.maxWords) {
        chunks.push({
          chunkIndex: chunkIndex++,
          content: section.heading ? `## ${section.heading}\n\n${section.text}` : section.text,
          heading: section.heading,
          tokenEstimate: Math.ceil(words.length * 1.3),
        });
        continue;
      }

      // Sliding window over words
      let start = 0;
      while (start < words.length) {
        const end = Math.min(start + this.maxWords, words.length);
        const chunkWords = words.slice(start, end);
        const chunkText = chunkWords.join(' ');

        chunks.push({
          chunkIndex: chunkIndex++,
          content: section.heading ? `## ${section.heading}\n\n${chunkText}` : chunkText,
          heading: section.heading,
          tokenEstimate: Math.ceil(chunkWords.length * 1.3),
        });

        if (end >= words.length) break;
        start += this.maxWords - this.overlap;
      }
    }

    return chunks;
  }
}
