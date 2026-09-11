import YAML from 'yaml';

export interface ParsedWikiLink {
  raw: string; // "[[Client A|Client Alpha]]"
  target: string; // "Client A"
  alias?: string; // "Client Alpha"
  linkType?: string; // e.g. "works_at" if typed [[works_at::Client A]]
}

export interface ParsedMarkdown {
  frontMatter: Record<string, unknown>;
  body: string;
  tags: string[];
  links: ParsedWikiLink[];
}

export class MarkdownEngine {
  private static FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  private static WIKILINK_REGEX = /\[\[(.*?)\]\]/g;
  private static TAG_REGEX = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;

  /**
   * Parses markdown document into YAML front matter, body, tags, and wiki-links.
   */
  static parse(content: string): ParsedMarkdown {
    let frontMatter: Record<string, unknown> = {};
    let body = content;

    const match = content.match(this.FRONTMATTER_REGEX);
    if (match) {
      try {
        frontMatter = YAML.parse(match[1]) || {};
        body = match[2];
      } catch {
        // If YAML fails to parse, treat as normal body
        body = content;
      }
    }

    // Extract tags from body and frontmatter
    const tagsSet = new Set<string>();
    if (Array.isArray(frontMatter.tags)) {
      frontMatter.tags.forEach((t) => tagsSet.add(String(t).replace(/^#/, '')));
    }

    let tagMatch: RegExpExecArray | null;
    const bodyCopy = body;
    const tagRegex = new RegExp(this.TAG_REGEX);
    while ((tagMatch = tagRegex.exec(bodyCopy)) !== null) {
      tagsSet.add(tagMatch[1]);
    }

    // Extract wiki-links [[page]] or [[page|alias]] or [[type::page]]
    const links: ParsedWikiLink[] = [];
    let linkMatch: RegExpExecArray | null;
    const linkRegex = new RegExp(this.WIKILINK_REGEX);
    while ((linkMatch = linkRegex.exec(bodyCopy)) !== null) {
      const raw = linkMatch[0];
      const inner = linkMatch[1].trim();

      let target = inner;
      let alias: string | undefined = undefined;
      let linkType: string | undefined = undefined;

      // Handle piped alias [[target|alias]]
      if (inner.includes('|')) {
        const parts = inner.split('|');
        target = parts[0].trim();
        alias = parts.slice(1).join('|').trim();
      }

      // Handle typed link [[type::target]]
      if (target.includes('::')) {
        const typedParts = target.split('::');
        linkType = typedParts[0].trim();
        target = typedParts[1].trim();
      }

      links.push({
        raw,
        target,
        alias,
        linkType,
      });
    }

    return {
      frontMatter,
      body,
      tags: Array.from(tagsSet),
      links,
    };
  }

  /**
   * Serializes YAML front matter and body back to clean Markdown without formatting corruption.
   */
  static stringify(frontMatter: Record<string, unknown>, body: string): string {
    const keys = Object.keys(frontMatter);
    if (keys.length === 0) {
      return body;
    }
    const yamlStr = YAML.stringify(frontMatter).trim();
    return `---\n${yamlStr}\n---\n\n${body.trimStart()}`;
  }

  /**
   * Refactors all wiki-links in a markdown body when a target page is renamed.
   * Matches [[Old Title]], [[Old Title|Alias]], and [[type::Old Title]].
   */
  static refactorLinks(body: string, oldTitle: string, newTitle: string): string {
    const escapedOld = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Pattern matches [[oldTitle]] or [[oldTitle|alias]] or [[typed::oldTitle]]
    const pattern = new RegExp(`\\[\\[(?:([^:\\]]+)::)?${escapedOld}(?:\\|([^\\]]+))?\\]\\]`, 'g');

    return body.replace(pattern, (_match, typePrefix, alias) => {
      const typePart = typePrefix ? `${typePrefix}::` : '';
      const aliasPart = alias ? `|${alias}` : '';
      return `[[${typePart}${newTitle}${aliasPart}]]`;
    });
  }
}

export function parseMarkdown(content: string): ParsedMarkdown {
  return MarkdownEngine.parse(content);
}

export function stringifyMarkdown(frontMatter: Record<string, unknown>, body: string): string {
  return MarkdownEngine.stringify(frontMatter, body);
}
