import JSZip from 'jszip';
import { Page } from '@tkxel-vault/types';

export function serializePageToMarkdown(page: Page): string {
  const rawBody = page.content || `# ${page.title}\n`;
  const fm: Record<string, unknown> = {
    title: page.title,
    type: page.type,
    tags: page.tags,
    aliases: page.aliases || [],
    created_at: page.created_at ? new Date(page.created_at).toISOString() : new Date().toISOString(),
  };

  const yamlHeader = `---\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n`;

  return rawBody.startsWith('---') ? rawBody : `${yamlHeader}${rawBody}`;
}

export function createSafeExportFilename(title: string): string {
  return `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
}

export async function buildExportZipPackage(
  pages: Page[],
  vaultId: string,
  zipInstance?: JSZip
): Promise<{ zip: JSZip; fileCount: number; files: Record<string, string> }> {
  const zip = zipInstance || new JSZip();
  const vaultNotes = pages.filter((p) => p.vault_id === vaultId);
  const files: Record<string, string> = {};

  vaultNotes.forEach((page) => {
    const markdown = serializePageToMarkdown(page);
    const filename = createSafeExportFilename(page.title);
    files[filename] = markdown;
    zip.file(filename, markdown);
  });

  return {
    zip,
    fileCount: vaultNotes.length,
    files,
  };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const downloadUrl = URL.createObjectURL(blob);
  const linkEl = document.createElement('a');
  linkEl.href = downloadUrl;
  linkEl.download = filename;
  document.body.appendChild(linkEl);
  linkEl.click();
  document.body.removeChild(linkEl);
  URL.revokeObjectURL(downloadUrl);
}
