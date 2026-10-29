import { Page, Version } from '@tkxel-vault/types';

export interface DiffChange {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
}

export class VersioningService {
  /**
   * Transition state from draft to published, generating an immutable Version record.
   */
  public publishVersion(
    page: Page,
    contentBlob: Buffer,
    currentVersionCount: number,
    authorId: string
  ): { page: Page; newVersion: Version } {
    const nextVersionNumber = currentVersionCount + 1;
    const now = new Date();
    const versionId = `ver_${page.id}_v${nextVersionNumber}`;

    const newVersion: Version = {
      id: versionId,
      page_id: page.id,
      number: nextVersionNumber,
      status: 'published',
      encrypted_blob: contentBlob,
      created_by: authorId,
      created_at: now,
    };

    const updatedPage: Page = {
      ...page,
      current_version_id: versionId,
      updated_at: now,
    };

    return { page: updatedPage, newVersion };
  }

  /**
   * Rollback a page to a specified historical version.
   * In an append-only version model, this creates a new version whose blob matches the target historical version.
   */
  public rollbackToVersion(
    page: Page,
    historicalVersion: Version,
    currentVersionCount: number,
    rollbackAuthorId: string
  ): { page: Page; newVersion: Version } {
    const nextVersionNumber = currentVersionCount + 1;
    const now = new Date();
    const versionId = `ver_${page.id}_v${nextVersionNumber}`;

    const newVersion: Version = {
      id: versionId,
      page_id: page.id,
      number: nextVersionNumber,
      status: 'published',
      encrypted_blob: historicalVersion.encrypted_blob,
      created_by: rollbackAuthorId,
      created_at: now,
    };

    const updatedPage: Page = {
      ...page,
      current_version_id: versionId,
      updated_at: now,
    };

    return { page: updatedPage, newVersion };
  }

  /**
   * Computes line-by-line diff between two version contents.
   */
  public computeLineDiff(oldContent: string, newContent: string): DiffChange[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: DiffChange[] = [];

    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        diff.push({ type: 'unchanged', line: oldLines[i] });
        i++;
        j++;
      } else if (j < newLines.length && (i >= oldLines.length || !oldLines.includes(newLines[j], i))) {
        diff.push({ type: 'added', line: newLines[j] });
        j++;
      } else if (i < oldLines.length) {
        diff.push({ type: 'removed', line: oldLines[i] });
        i++;
      }
    }

    return diff;
  }
}
