import { Page, PageType } from '@tkxel-vault/types';
import { ImportResult, MarkdownEngine } from '@tkxel-vault/vault-core/markdown';
import { adaptLegacyImportPages } from '../utils/legacy-import-adapter.js';

export interface ProcessImportResult {
  newPages: Page[];
  combinedPages: Page[];
  importedLinks: Array<{ from_page_id: string; to_page_id: string }>;
}

export function processImportPages(
  result: ImportResult,
  currentVaultId: string,
  existingPages: Page[]
): ProcessImportResult {
  const rawPages: Page[] = result.pages.map((p) => ({
    id: crypto.randomUUID(),
    vault_id: currentVaultId,
    type: (p.parsed.frontMatter.type as PageType) || 'note',
    title: p.title,
    folder: p.folder,
    aliases: Array.isArray(p.parsed.frontMatter.aliases) ? (p.parsed.frontMatter.aliases as string[]) : [],
    tags: p.parsed.tags,
    content: p.content,
    front_matter: {
      ...p.parsed.frontMatter,
      title: p.title,
      folder: p.folder,
      type: p.parsed.frontMatter.type || 'note',
      tags: p.parsed.tags,
    },
    created_at: new Date(),
  }));

  // Clean legacy front_matter.body and ensure Page.content is set
  const newPages = adaptLegacyImportPages(rawPages);
  const combinedPages = [...newPages, ...existingPages];

  const importedLinks: Array<{ from_page_id: string; to_page_id: string }> = [];
  newPages.forEach((np) => {
    const parsed = MarkdownEngine.parse(np.content || '');
    parsed.links.forEach((l) => {
      const target = combinedPages.find(
        (cp) =>
          cp.title.toLowerCase() === l.target.toLowerCase() ||
          cp.aliases?.some((a) => a.toLowerCase() === l.target.toLowerCase())
      );
      if (target && target.id !== np.id) {
        if (!importedLinks.some((il) => il.from_page_id === np.id && il.to_page_id === target.id)) {
          importedLinks.push({ from_page_id: np.id, to_page_id: target.id });
        }
      }
    });
  });

  return {
    newPages,
    combinedPages,
    importedLinks,
  };
}
