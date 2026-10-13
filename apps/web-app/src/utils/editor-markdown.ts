/**
 * The TipTap Markdown serializer backslash-escapes square brackets, so a wiki-link typed as
 * `[[Page]]` is emitted as `\[\[Page\]\]` and no longer parses as a link (FR-01, FR-03).
 * This restores wiki-link syntax in serializer output while leaving fenced and inline code,
 * and any other intentionally escaped brackets, untouched.
 */
const ESCAPED_WIKI_LINK = /\\\[\\\[((?:[^\]\\\n]|\\[^\n])+?)\\\]\\\]/g;
const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|~<>])/g;
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

function restoreWikiLinks(text: string): string {
  return text.replace(ESCAPED_WIKI_LINK, (_match, inner: string) => `[[${inner.replace(MARKDOWN_ESCAPE, '$1')}]]`);
}

export function normalizeEditorMarkdown(markdown: string): string {
  if (!markdown || !markdown.includes('\\[\\[')) return markdown;
  // Odd indexes are code segments captured by the split group; they are passed through verbatim
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : restoreWikiLinks(segment)))
    .join('');
}

/** Reads the current document from a TipTap editor as clean Markdown. */
export function getEditorMarkdown(editor: { storage: unknown }): string {
  return normalizeEditorMarkdown((editor.storage as any).markdown.getMarkdown());
}
