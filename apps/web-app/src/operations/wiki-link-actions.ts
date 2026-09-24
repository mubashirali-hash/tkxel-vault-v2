import { Page } from '@tkxel-vault/types';
import { MarkdownEngine } from '@tkxel-vault/vault-core/markdown';

export function insertWikiLink(sourcePage: Page, targetTitle: string): Page {
  const linkSyntax = `[[${targetTitle}]]`;
  const currentContent = sourcePage.content || '';

  if (currentContent.includes(linkSyntax)) {
    return sourcePage;
  }

  const newContent = currentContent.trim()
    ? `${currentContent}\n\n- ${linkSyntax}`
    : `- ${linkSyntax}`;

  const { body: _scrubbedBody, ...cleanFrontMatter } = (sourcePage.front_matter || {}) as any;

  return {
    ...sourcePage,
    content: newContent,
    front_matter: cleanFrontMatter,
    updated_at: new Date(),
  };
}

export function resolveOutgoingLinks(
  sourcePageId: string,
  content: string,
  allPages: Page[]
): Array<{ from_page_id: string; to_page_id: string }> {
  const parsed = MarkdownEngine.parse(content || '');
  const outgoing: Array<{ from_page_id: string; to_page_id: string }> = [];

  parsed.links.forEach((link) => {
    const target = allPages.find(
      (p) =>
        p.title.toLowerCase() === link.target.toLowerCase() ||
        p.aliases?.some((a) => a.toLowerCase() === link.target.toLowerCase())
    );
    if (target && target.id !== sourcePageId) {
      if (!outgoing.some((e) => e.to_page_id === target.id)) {
        outgoing.push({ from_page_id: sourcePageId, to_page_id: target.id });
      }
    }
  });

  return outgoing;
}
