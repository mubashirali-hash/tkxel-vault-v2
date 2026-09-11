import JSZip from 'jszip';
import { Vault, VaultRole } from '@tkxel-vault/types';
import { stringifyMarkdown } from '../markdown/parser.js';

export class ExportForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportForbiddenError';
  }
}

export interface ExportRequest {
  vault: Vault;
  requesterUserId: string;
  requesterRole: VaultRole;
  pages: Array<{
    title: string;
    slug: string;
    content: string;
    frontmatter?: Record<string, unknown>;
  }>;
  justification?: string;
}

export interface ExportResult {
  zipBuffer: Buffer;
  pageCount: number;
  vaultId: string;
  exportedAt: Date;
  requesterUserId: string;
}

/**
 * Vault Export Engine enforcing strict dual-mode export policy (FR-56):
 * - Open Vault: Export permitted ONLY for Vault Owner; requires audit logging.
 * - Locked Vault: Export strictly forbidden for ALL roles (even Owners).
 */
export class VaultExportService {
  /**
   * Evaluates permissions and builds an export archive.
   */
  public async exportVault(request: ExportRequest): Promise<ExportResult> {
    const { vault, requesterUserId, requesterRole, pages, justification } = request;

    // Rule 1: Locked Vaults NEVER permit export under any role
    if (vault.mode === 'locked') {
      throw new ExportForbiddenError(
        `Export strictly forbidden: Locked vault '${vault.id}' cannot be exported by any role.`
      );
    }

    // Rule 2: Open Vaults permit export ONLY for Vault Owners
    if (requesterRole !== 'owner') {
      throw new ExportForbiddenError(
        `Export forbidden: Role '${requesterRole}' is not permitted to export vault '${vault.id}'. Only Vault Owners can export open vaults.`
      );
    }

    // Assemble ZIP archive
    const zip = new JSZip();

    for (const page of pages) {
      const fullMarkdown = stringifyMarkdown(page.frontmatter || {}, page.content);
      const fileName = `${page.slug || 'untitled'}.md`;
      zip.file(fileName, fullMarkdown);
    }

    // Include export metadata manifest
    const manifest = {
      vaultId: vault.id,
      vaultName: vault.name,
      vaultMode: vault.mode,
      exportedAt: new Date().toISOString(),
      exportedBy: requesterUserId,
      justification: justification || 'Owner requested export',
      pageCount: pages.length,
    };
    zip.file('tkxel-vault-export-manifest.json', JSON.stringify(manifest, null, 2));

    const zipUint8 = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipBuffer = Buffer.from(zipUint8);

    return {
      zipBuffer,
      pageCount: pages.length,
      vaultId: vault.id,
      exportedAt: new Date(),
      requesterUserId,
    };
  }
}
