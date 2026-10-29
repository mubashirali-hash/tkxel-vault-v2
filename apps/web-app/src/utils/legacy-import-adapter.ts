/**
 * Legacy Import Compatibility Adapter (Epic 4, Chunk 4.1)
 *
 * Invariant: Page.content is the SOLE operational body field across tkxel Vault.
 * front_matter.body handling is strictly quarantined to this legacy import adapter,
 * which immediately scrubs any 'body' key from front_matter upon ingestion.
 */

import { Page } from '@tkxel-vault/types';

export interface RawImportPage {
  id?: string;
  vault_id?: string;
  type?: any;
  title?: string;
  folder?: string;
  aliases?: string[];
  tags?: string[];
  front_matter?: Record<string, unknown>;
  content?: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

/**
 * Adapts a legacy imported page object into a clean, compliant Page.
 * Extracts body text from Page.content (priority) or legacy front_matter.body,
 * immediately scrubs 'body' from front_matter, and guarantees Page.content is set.
 */
export function adaptLegacyImportPage(raw: RawImportPage): Page {
  const legacyBody = (raw.front_matter as Record<string, unknown> | undefined)?.body;
  const content = typeof raw.content === 'string' && raw.content.trim().length > 0
    ? raw.content
    : typeof legacyBody === 'string'
      ? legacyBody
      : typeof raw.content === 'string'
        ? raw.content
        : '';

  // Scrub body from front_matter immediately
  const cleanFrontMatter: Record<string, unknown> = { ...(raw.front_matter || {}) };
  delete cleanFrontMatter.body;

  const folder = raw.folder || (cleanFrontMatter.folder as string) || undefined;
  delete cleanFrontMatter.folder; // Normalize folder to top-level property

  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : Array.isArray(cleanFrontMatter.tags)
      ? (cleanFrontMatter.tags as string[])
      : [];
  delete cleanFrontMatter.tags;

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases
    : Array.isArray(cleanFrontMatter.aliases)
      ? (cleanFrontMatter.aliases as string[])
      : [];
  delete cleanFrontMatter.aliases;

  const title = raw.title || (cleanFrontMatter.title as string) || 'Untitled Note';
  delete cleanFrontMatter.title;

  return {
    id: raw.id || crypto.randomUUID(),
    vault_id: raw.vault_id || '',
    type: (raw.type || cleanFrontMatter.type || 'note') as any,
    title,
    folder,
    aliases,
    tags,
    front_matter: cleanFrontMatter,
    content,
    created_at: raw.created_at ? new Date(raw.created_at) : new Date(),
    updated_at: raw.updated_at ? new Date(raw.updated_at) : new Date(),
  };
}

/**
 * Batch adapts an array of raw or legacy imported page objects.
 */
export function adaptLegacyImportPages(rawPages: RawImportPage[]): Page[] {
  if (!Array.isArray(rawPages)) return [];
  return rawPages.map((p) => adaptLegacyImportPage(p));
}
