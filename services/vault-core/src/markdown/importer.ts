import JSZip from 'jszip';
import { parseMarkdown, ParsedMarkdown } from './parser.js';

export interface ImportedPage {
  filePath: string;
  title: string;
  slug: string;
  folder?: string;
  content: string;
  rawFrontmatter?: Record<string, unknown>;
  parsed: ParsedMarkdown;
}

export interface ImportResult {
  pages: ImportedPage[];
  totalFilesProcessed: number;
  totalWikiLinksFound: number;
  totalTagsFound: number;
  skippedFiles: string[];
}

/**
 * Universal Markdown & Obsidian Vault Importer.
 * Supports individual markdown files, file maps, and zip bundles (e.g. exported Obsidian vaults).
 * Note: Obsidian is supported purely as an import format and UX reference; there is no runtime dependency on Obsidian.
 */
export class MarkdownImporter {
  /**
   * Import pages from an in-memory map of relative file paths to string contents.
   */
  public importFromMap(files: Map<string, string>): ImportResult {
    const pages: ImportedPage[] = [];
    const skippedFiles: string[] = [];
    let totalWikiLinks = 0;
    const allTags = new Set<string>();

    const toolSchemas = new Map<string, string>();

    // First pass: extract tool schemas
    for (const [filePath, content] of files.entries()) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.toLowerCase().endsWith('tool.json')) {
        const pathParts = normalizedPath.split('/');
        const directoryFolder = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
        toolSchemas.set(directoryFolder, content);
      }
    }

    for (const [filePath, content] of files.entries()) {
      // Normalize path separators
      const normalizedPath = filePath.replace(/\\/g, '/');

      // Skip internal hidden directories (e.g., .obsidian, .trash, .git)
      if (
        normalizedPath.startsWith('.obsidian/') ||
        normalizedPath.startsWith('.trash/') ||
        normalizedPath.startsWith('.git/') ||
        normalizedPath.includes('/.obsidian/')
      ) {
        skippedFiles.push(normalizedPath);
        continue;
      }

      const isMd = normalizedPath.toLowerCase().endsWith('.md');
      const isToolJson = normalizedPath.toLowerCase().endsWith('tool.json');
      const isTextFile = normalizedPath.match(/\.(py|json|ts|js|html|css|txt|j2|yaml|yml|sh|bash|xml|csv)$/i);

      // Only process markdown files and supported text files
      if (!isMd && !isTextFile && !isToolJson) {
        skippedFiles.push(normalizedPath);
        continue;
      }
      
      if (isToolJson) {
        continue;
      }

      let processContent = content;
      const pathParts = normalizedPath.split('/');
      const directoryFolder = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
      const rawFileName = pathParts.pop() || 'Untitled';
      
      if (!isMd && isTextFile) {
        const ext = rawFileName.split('.').pop() || 'text';
        processContent = `---\ntitle: ${rawFileName}\ntype: reference\n---\n\n\`\`\`${ext}\n${content}\n\`\`\``;
      }

      const parsed = parseMarkdown(processContent);
      const folder = (parsed.frontMatter.folder as string) || (directoryFolder ? directoryFolder : undefined);
      const fileName = isMd ? rawFileName.replace(/\.md$/i, '') : rawFileName;
      const title = (parsed.frontMatter.title as string) || fileName;
      const slug = this.slugify(title);

      if (toolSchemas.has(directoryFolder)) {
        parsed.frontMatter.tool_schema = toolSchemas.get(directoryFolder);
        if (!parsed.frontMatter.type) {
          parsed.frontMatter.type = 'skill';
        }
      } else if (!parsed.frontMatter.type) {
        parsed.frontMatter.type = isMd ? 'agent' : 'reference';
      }

      parsed.tags.forEach((tag: string) => allTags.add(tag));
      totalWikiLinks += parsed.links.length;

      pages.push({
        filePath: normalizedPath,
        title,
        slug,
        folder,
        content: parsed.body,
        rawFrontmatter: parsed.frontMatter,
        parsed,
      });
    }

    return {
      pages,
      totalFilesProcessed: pages.length,
      totalWikiLinksFound: totalWikiLinks,
      totalTagsFound: allTags.size,
      skippedFiles,
    };
  }

  /**
   * Import pages from a ZIP archive buffer (e.g. an exported Obsidian vault or zipped markdown collection).
   */
  public async importFromZip(zipBuffer: Buffer | Uint8Array): Promise<ImportResult> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const fileMap = new Map<string, string>();

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (!zipEntry.dir) {
        const bytes = await zipEntry.async('uint8array');
        const text = new TextDecoder('utf-8').decode(bytes);
        fileMap.set(relativePath, text);
      }
    }

    return this.importFromMap(fileMap);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
