import type { Page, Share, AuditEvent, TimelineEntry, VaultRole } from '@tkxel-vault/types';
import type { SkillItem } from '../components/skills/AddSkillModal.js';

/**
 * Secure Auth Token Storage for tkxel Vault Web App
 * Adheres to ADR-017 & OAuth 2.1 SPA Guidance:
 * - Production bearer tokens are stored in sessionStorage (session-scoped) rather than persistent localStorage.
 * - Tokens expire automatically when the tab/window is closed.
 * - Legacy tokens in localStorage are actively scrubbed.
 */
export function getAuthToken(): string | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ssoToken')) {
      const legacy = localStorage.getItem('ssoToken');
      localStorage.removeItem('ssoToken');
      if (legacy && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('ssoToken', legacy);
      }
      return legacy;
    }
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('ssoToken');
    }
  } catch (err) {
    console.warn('Failed to read auth token from sessionStorage:', err);
  }
  return null;
}

export function setAuthToken(token: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ssoToken');
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('ssoToken', token);
    }
  } catch (err) {
    console.warn('Failed to write auth token to sessionStorage:', err);
  }
}

export function removeAuthToken(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ssoToken');
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('ssoToken');
    }
  } catch (err) {
    console.warn('Failed to remove auth token:', err);
  }
}

export interface VaultData {
  pages: Page[];
  links: Array<{ from_page_id: string; to_page_id: string }>;
  shares: Share[];
  auditEvents: AuditEvent[];
  lockedSkills: SkillItem[];
  timelineEntries: TimelineEntry[];
  currentRole?: VaultRole;
}

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002/api';

let lastDbFailureTime = 0;
const DB_FAILURE_COOLDOWN_MS = 5000;

export function saveVaultLocalCache(vaultId: string, data: Partial<VaultData>, vaultMode?: string): void {
  try {
    const key = `tkxel_vault_cache_${vaultId}`;
    if (vaultMode === 'locked') {
      localStorage.removeItem(key);
      return;
    }
    const raw = localStorage.getItem(key);
    const existing = raw ? JSON.parse(raw) : {};

    // Zero-read invariant: note content and front_matter body must NEVER hit localStorage (ADR-017)
    const sanitizedPages = data.pages
      ? data.pages.map((p: any) => {
          const { content, ...rest } = p;
          if (rest.front_matter && typeof rest.front_matter === 'object') {
            const { body, ...cleanFm } = rest.front_matter;
            rest.front_matter = cleanFm;
          }
          return rest;
        })
      : existing.pages;

    const merged = {
      ...existing,
      ...data,
      pages: sanitizedPages,
      cached_at: new Date().toISOString(),
    };

    // Zero-read invariant: locked skills are NEVER persisted in browser storage
    delete (merged as any).lockedSkills;

    localStorage.setItem(key, JSON.stringify(merged));
  } catch (err) {
    console.warn('Failed to save vault local cache:', err);
  }
}

export function getVaultLocalCache(vaultId: string): VaultData | null {
  try {
    const raw = localStorage.getItem(`tkxel_vault_cache_${vaultId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      pages: (parsed.pages || []).map((p: any) => ({
        ...p,
        folder: p.folder || (p.front_matter?.folder as string) || undefined,
        content: '', // Plaintext note content is never restored from browser cache (ADR-017)
        created_at: new Date(p.created_at),
        updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
      })),
      links: parsed.links || [],
      lockedSkills: [], // Zero-read invariant: locked skills never retrieved from browser cache
      timelineEntries: (parsed.timelineEntries || []).map((t: any) => ({ ...t, created_at: new Date(t.created_at) })),
      shares: (parsed.shares || []).map((s: any) => ({ ...s, granted_at: new Date(s.granted_at) })),
      auditEvents: (parsed.auditEvents || []).map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) })),
    };
  } catch {
    return null;
  }
}

export async function loadVaultData(vaultId: string, userId: string = 'usr_admin', vaultMode?: string): Promise<VaultData | null> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'x-user-id': userId };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Locked vaults have zero browser caching
  if (vaultMode === 'locked') {
    try {
      localStorage.removeItem(`tkxel_vault_cache_${vaultId}`);
    } catch {}
  } else {
    // If we had a database outage recently, use local cache immediately to avoid spamming the backend
    const now = Date.now();
    if (now - lastDbFailureTime < DB_FAILURE_COOLDOWN_MS) {
      const cached = getVaultLocalCache(vaultId);
      if (cached && cached.pages.length > 0) {
        return cached;
      }
    }
  }

  try {
    const [pagesRes, linksRes, skillsRes, timelineRes, sharesRes, auditsRes] = await Promise.all([
      fetch(`${API_URL}/vaults/${vaultId}/pages`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/links`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/skills`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/timeline`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/shares`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/audits`, { headers }).catch(() => null),
    ]);

    const anyServerError = [pagesRes, linksRes, skillsRes, timelineRes, sharesRes, auditsRes].some(
      (res) => res && (res.status === 500 || res.status === 503)
    );
    if (anyServerError) {
      lastDbFailureTime = Date.now();
    }

    const [pagesData, linksData, skillsData, timelineData, sharesData, auditsData] = await Promise.all([
      pagesRes?.ok ? pagesRes.json() : null,
      linksRes?.ok ? linksRes.json() : null,
      skillsRes?.ok ? skillsRes.json() : null,
      timelineRes?.ok ? timelineRes.json() : null,
      sharesRes?.ok ? sharesRes.json() : null,
      auditsRes?.ok ? auditsRes.json() : null,
    ]);

    // If server responded with valid pages data, update cache and return
    if (pagesRes?.ok && pagesData && Array.isArray(pagesData.pages)) {
      const result: VaultData = {
        pages: pagesData.pages.map((p: any) => ({
          ...p,
          folder: p.folder || (p.front_matter?.folder as string) || undefined,
          created_at: new Date(p.created_at),
          updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
        })),
        links: linksData?.links || [],
        lockedSkills: (skillsData?.lockedSkills || []).map((s: any) => ({ ...s, created_at: new Date(s.created_at) })),
        timelineEntries: (timelineData?.timelineEntries || []).map((t: any) => ({ ...t, created_at: new Date(t.created_at) })),
        shares: (sharesData?.shares || []).map((s: any) => ({ ...s, granted_at: new Date(s.granted_at) })),
        auditEvents: (auditsData?.auditEvents || []).map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) })),
      };
      if (vaultMode !== 'locked') {
        saveVaultLocalCache(vaultId, result, vaultMode);
      }
      return result;
    }

    if (vaultMode !== 'locked') {
      // If server is offline or errored, check local cache fallback
      const localCached = getVaultLocalCache(vaultId);
      if (localCached && localCached.pages.length > 0) {
        return localCached;
      }
    }

    return {
      pages: (pagesData?.pages || []).map((p: any) => ({
        ...p,
        folder: p.folder || (p.front_matter?.folder as string) || undefined,
        created_at: new Date(p.created_at),
        updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
      })),
      links: linksData?.links || [],
      lockedSkills: (skillsData?.lockedSkills || []).map((s: any) => ({ ...s, created_at: new Date(s.created_at) })),
      timelineEntries: (timelineData?.timelineEntries || []).map((t: any) => ({ ...t, created_at: new Date(t.created_at) })),
      shares: (sharesData?.shares || []).map((s: any) => ({ ...s, granted_at: new Date(s.granted_at) })),
      auditEvents: (auditsData?.auditEvents || []).map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) })),
    };
  } catch (err) {
    lastDbFailureTime = Date.now();
    console.error('Failed to load vault data, attempting cache fallback:', err);
    return vaultMode === 'locked' ? null : getVaultLocalCache(vaultId);
  }
}

export async function importVaultData(
  vaultId: string,
  pages: any[],
  links: any[],
  userId: string = 'usr_admin'
): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    await fetch(`${API_URL}/vaults/${vaultId}/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pages, links }),
    });
  } catch (err) {
    console.error('API import failed:', err);
  }
}

export async function clearVaultState(): Promise<void> {
  try {
    removeAuthToken();
    localStorage.removeItem('ssoToken');
    localStorage.removeItem('tkxel_vault_storage_v1');
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('tkxel_vault_cache_') || key.startsWith('tkxel_vault_storage_'))) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
    }
  } catch (err) {
    console.error('Failed to clear tkxel Vault localStorage:', err);
  }
}

export async function addVaultShareApi(
  vaultId: string,
  principalId: string,
  role: VaultRole,
  userId: string = 'usr_admin',
  token?: string | null
): Promise<Share | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}/vaults/${vaultId}/shares`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ principal_id: principalId, role, vault_id: vaultId }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to add share');
    }

    const data = await res.json();
    return {
      id: data.share.id,
      vault_id: data.share.vault_id,
      principal_id: data.share.principal_id,
      role: data.share.role,
      granted_by: data.share.granted_by,
      granted_at: new Date(data.share.granted_at),
    };
  } catch (err) {
    console.error('Error in addVaultShareApi:', err);
    return null;
  }
}

export async function revokeVaultShareApi(
  vaultId: string,
  shareId: string,
  userId: string = 'usr_admin',
  token?: string | null
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'x-user-id': userId,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}/vaults/${vaultId}/shares/${shareId}`, {
      method: 'DELETE',
      headers,
    });

    return res.ok;
  } catch (err) {
    console.error('Error in revokeVaultShareApi:', err);
    return false;
  }
}

export async function deletePageApi(
  pageId: string,
  vaultId: string,
  userId: string = 'usr_admin',
  token?: string | null
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'x-user-id': userId,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}/pages/${pageId}?vaultId=${vaultId}`, {
      method: 'DELETE',
      headers,
    });

    return res.ok;
  } catch (err) {
    console.error('Error in deletePageApi:', err);
    return false;
  }
}

