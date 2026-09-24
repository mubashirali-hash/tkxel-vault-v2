import { Page, PageType } from '@tkxel-vault/types';
import { MarkdownEngine } from '@tkxel-vault/vault-core/markdown';
import { resolveOutgoingLinks } from './wiki-link-actions.js';
import { ApiRequestOptions } from './vault-actions.js';

export interface PageSavePayload {
  title: string;
  content: string;
  tags: string[];
  type: PageType;
  aliases?: string[];
  folder?: string;
}

export interface ApplyPageSaveResult {
  updatedPages: Page[];
  updatedActivePage: Page;
  renamed: boolean;
  oldTitle: string;
  newTitle: string;
  newOutgoingLinks: Array<{ from_page_id: string; to_page_id: string }>;
}

export function applyPageSave(params: {
  pages: Page[];
  activePage: Page | null;
  updated: PageSavePayload;
}): ApplyPageSaveResult {
  const { pages, activePage, updated } = params;
  if (!activePage) {
    return {
      updatedPages: pages,
      updatedActivePage: {
        id: '',
        vault_id: '',
        type: updated.type,
        title: updated.title,
        aliases: updated.aliases || [],
        tags: updated.tags || [],
        content: updated.content,
        front_matter: { title: updated.title, type: updated.type, tags: updated.tags, aliases: updated.aliases },
        created_at: new Date(),
      },
      renamed: false,
      oldTitle: updated.title,
      newTitle: updated.title,
      newOutgoingLinks: [],
    };
  }

  const oldTitle = activePage.title;
  const newTitle = updated.title.trim();
  const renamed = oldTitle !== newTitle;

  let updatedPages = [...pages];

  // If title was renamed, refactor wiki-links across other notes in memory
  if (renamed) {
    updatedPages = updatedPages.map((p) => {
      if (p.id === activePage.id) return p;
      const currentBody = p.content || '';
      const refactored = MarkdownEngine.refactorLinks(currentBody, oldTitle, newTitle);
      if (refactored !== currentBody) {
        const cleanFm = { ...p.front_matter };
        delete (cleanFm as any).body;
        return {
          ...p,
          content: refactored,
          front_matter: cleanFm,
          updated_at: p.updated_at,
        };
      }
      return p;
    });
  }

  // Update active page
  let updatedActivePage: Page | null = null;
  updatedPages = updatedPages.map((p) => {
    if (p.id === activePage.id) {
      const cleanFrontMatter = { ...p.front_matter };
      delete (cleanFrontMatter as any).body;
      const modified: Page = {
        ...p,
        title: newTitle,
        type: updated.type,
        folder: updated.folder,
        tags: updated.tags,
        aliases: updated.aliases || p.aliases || [],
        front_matter: {
          ...cleanFrontMatter,
          title: newTitle,
          type: updated.type,
          folder: updated.folder,
          tags: updated.tags,
          aliases: updated.aliases || p.aliases || [],
        },
        content: updated.content,
        updated_at: p.updated_at,
      };
      updatedActivePage = modified;
      return modified;
    }
    return p;
  });

  const finalActivePage = updatedActivePage || activePage;
  const newOutgoingLinks = resolveOutgoingLinks(finalActivePage.id, updated.content, updatedPages);

  return {
    updatedPages,
    updatedActivePage: finalActivePage,
    renamed,
    oldTitle,
    newTitle,
    newOutgoingLinks,
  };
}

export interface SavePageApiPayload {
  content: string;
  vault_id: string;
  updated_at?: string;
  title?: string;
  type?: PageType;
  folder?: string;
  tags?: string[];
  aliases?: string[];
}

export async function savePageContentApi(
  pageId: string,
  payload: SavePageApiPayload,
  isDraft: boolean,
  options?: ApiRequestOptions
): Promise<Response> {
  const baseUrl = options?.baseUrl || 'http://localhost:3002';
  const fetchFn = options?.fetchImpl || fetch;
  const token = options?.token;
  const endpoint = isDraft ? 'draft' : 'publish';

  const res = await fetchFn(`${baseUrl}/api/pages/${pageId}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  return res;
}
