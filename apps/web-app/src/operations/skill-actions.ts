import { API_ORIGIN } from '../utils/api-base.js';
import { ApiRequestOptions } from './vault-actions.js';

export interface SkillUploadPayload {
  name: string;
  version?: string;
  description: string;
  runtime?: string;
  timeout_seconds?: number;
  system_instructions?: string;
  tool_schema?: string;
  /** Companion files from a skill bundle (helper scripts, templates), keyed by package-relative path. */
  files?: Record<string, string>;
}

/**
 * Picks the companion files of a skill bundle: every file that sits beside SKILL.md or below it,
 * other than SKILL.md and tool.json themselves. Paths are returned relative to SKILL.md's folder.
 * Archive housekeeping entries (__MACOSX, dotfiles) are left out.
 */
export function companionFilePaths(
  entryNames: string[],
  skillMdName: string,
  toolJsonName?: string
): { zipPath: string; relativePath: string }[] {
  const root = skillMdName.includes('/') ? skillMdName.slice(0, skillMdName.lastIndexOf('/') + 1) : '';
  return entryNames
    .filter((name) => !name.endsWith('/') && name !== skillMdName && name !== toolJsonName && name.startsWith(root))
    .map((name) => ({ zipPath: name, relativePath: name.slice(root.length) }))
    .filter(({ relativePath }) =>
      relativePath.length > 0
      && !relativePath.split('/').some((part) => part === '__MACOSX' || part === '..' || part.startsWith('.'))
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export interface StoredSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: string;
  timeout_seconds: number;
  status: 'draft' | 'published';
  tool_schema: string;
  created_at: string;
}

/**
 * Uploads a skill to the server, where it is validated, encrypted and stored.
 * Rejects with the server's validation message so the UI can show why an upload was refused.
 */
export async function createSkillApi(
  vaultId: string,
  payload: SkillUploadPayload,
  options?: ApiRequestOptions
): Promise<StoredSkill> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const res = await fetchFn(`${baseUrl}/api/vaults/${vaultId}/skills`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Skill upload failed (HTTP ${res.status})`);
  }
  return data.skill as StoredSkill;
}

export async function deleteSkillApi(vaultId: string, skillId: string, options?: ApiRequestOptions): Promise<void> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const res = await fetchFn(`${baseUrl}/api/vaults/${vaultId}/skills/${skillId}`, {
    method: 'DELETE',
    headers: options?.token ? { Authorization: `Bearer ${options.token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Skill delete failed (HTTP ${res.status})`);
  }
}
