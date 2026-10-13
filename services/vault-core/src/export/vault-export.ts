import JSZip from 'jszip';
import { eq, desc, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, pages, versions, assets, auditEvents } from '../schema/index.js';
import { VAULT_ASSET_SCHEME } from '../vault/assets.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { stringifyMarkdown } from '../markdown/parser.js';
import { getUserRoleForVault } from '../auth/index.js';
import { listTimelineEntries } from '../vault/timeline.js';

/** Thrown for every refused export. Carries no detail about why, or whether the vault exists (FR-68). */
export class ExportNotAllowedError extends Error {
  constructor() {
    super('not_allowed');
    this.name = 'ExportNotAllowedError';
  }
}

export interface VaultExportArchive {
  zipBuffer: Buffer;
  fileName: string;
  pageCount: number;
}

function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Server-side vault export (FR-56).
 *
 * - Locked vaults can never be exported, by anyone. Every attempt is refused and audited.
 * - Open vaults can be exported by their Owner only. The archive contains one clean Markdown file per
 *   page with complete YAML front matter, wiki-links untouched, and the page timeline.
 * - The audit event is written before the archive is returned, so no export is ever unrecorded.
 */
export async function exportVaultArchive(params: {
  vaultId: string;
  actorId: string;
  justification?: string;
  /** True only for the non-production local dev administrator, who is treated as owner. */
  treatAsOwner?: boolean;
}): Promise<VaultExportArchive> {
  const vaultRows = await db.select().from(vaults).where(eq(vaults.id, params.vaultId)).limit(1);
  const vault = vaultRows[0];
  if (!vault) {
    throw new ExportNotAllowedError();
  }

  const role = params.treatAsOwner ? 'owner' : await getUserRoleForVault(params.actorId, params.vaultId);

  if (vault.mode !== 'open' || vault.export_policy !== 'allowed_for_owner') {
    // Recorded for any caller, including Owners and administrators (FR-81)
    await db.insert(auditEvents).values({
      actor_id: params.actorId,
      action: 'export_locked_denied',
      target_id: vault.id,
      metadata: { vault_id: vault.id, role: role ?? 'none' },
    });
    throw new ExportNotAllowedError();
  }

  if (role !== 'owner') {
    throw new ExportNotAllowedError();
  }

  const vaultPages = await db.select().from(pages).where(eq(pages.vault_id, vault.id));
  const pageIds = vaultPages.map((p) => p.id);
  const allVersions = pageIds.length > 0
    ? await db.select().from(versions).where(inArray(versions.page_id, pageIds)).orderBy(desc(versions.number))
    : [];
  const timeline = await listTimelineEntries(vault.id);

  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const dek = await createKmsProvider().unwrapKey(vault.data_key_id);
  const vaultAssets = await db.select().from(assets).where(eq(assets.vault_id, vault.id));
  // Vault-hosted images travel with the export; Markdown references are rewritten to the bundled files
  const assetPaths = new Map<string, string>();

  try {
    for (const asset of vaultAssets) {
      const path = `assets/${asset.id.slice(0, 8)}-${safeSegment(asset.file_name, 'image')}`;
      assetPaths.set(asset.id, path);
      zip.file(path, EnvelopeEncryption.decrypt(asset.encrypted_blob, dek));
    }

    for (const page of vaultPages) {
      // Owners export their working copy: the newest version of the page, whatever its status
      const latest = allVersions.find((v) => v.page_id === page.id);
      const body = latest ? EnvelopeEncryption.decryptToString(latest.encrypted_blob, dek) : '';

      const { body: _legacyBody, folder, ...extraFrontMatter } = (page.front_matter as Record<string, unknown>) || {};
      const frontMatter: Record<string, unknown> = {
        ...extraFrontMatter,
        title: page.title,
        type: page.type,
        ...(Array.isArray(page.tags) && page.tags.length > 0 ? { tags: page.tags } : {}),
        ...(Array.isArray(page.aliases) && page.aliases.length > 0 ? { aliases: page.aliases } : {}),
      };

      let content = body;
      const entries = timeline.filter((e) => e.page_id === page.id);
      if (entries.length > 0 && !/^##\s+Timeline\s*$/m.test(body)) {
        content = `${body.trimEnd()}\n\n## Timeline\n${entries.map((e) => `- ${e.date}: ${e.entry_text}`).join('\n')}\n`;
      }

      const folderPath = typeof folder === 'string'
        ? folder.split('/').map((seg) => safeSegment(seg, '')).filter(Boolean).join('/')
        : '';
      const base = `${folderPath ? `${folderPath}/` : ''}${safeSegment(page.title, 'untitled')}`;
      let path = `${base}.md`;
      for (let n = 2; usedPaths.has(path.toLowerCase()); n++) {
        path = `${base} (${n}).md`;
      }
      usedPaths.add(path.toLowerCase());

      const depth = path.split('/').length - 1;
      const portable = content.replace(
        new RegExp(`${VAULT_ASSET_SCHEME}([0-9a-fA-F-]{36})`, 'g'),
        (whole, assetId: string) => {
          const target = assetPaths.get(assetId.toLowerCase());
          return target ? `${'../'.repeat(depth)}${encodeURI(target)}` : whole;
        }
      );
      zip.file(path, stringifyMarkdown(frontMatter, portable));
    }
  } finally {
    dek.fill(0);
  }

  const zipBuffer = Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));

  await db.insert(auditEvents).values({
    actor_id: params.actorId,
    action: 'export_open_vault',
    target_id: vault.id,
    metadata: {
      vault_id: vault.id,
      page_count: vaultPages.length,
      archive_bytes: zipBuffer.length,
      justification: (params.justification || '').slice(0, 500),
    },
  });

  return {
    zipBuffer,
    fileName: `${safeSegment(vault.name, 'vault')}-export-${new Date().toISOString().slice(0, 10)}.zip`,
    pageCount: vaultPages.length,
  };
}
