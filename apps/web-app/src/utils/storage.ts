import { Page, Share, AuditEvent, TimelineEntry, VaultRole } from '@tkxel-vault/types';
import { SkillItem } from '../components/skills/AddSkillModal.js';

export interface PersistedVaultState {
  pages: Page[];
  links: Array<{ from_page_id: string; to_page_id: string }>;
  shares: Share[];
  auditEvents: AuditEvent[];
  lockedSkills: SkillItem[];
  timelineEntries: TimelineEntry[];
  currentRole?: VaultRole;
}

const STORAGE_KEY = 'tkxel_vault_storage_v1';
const API_URL = 'http://localhost:3002/api';

function reviveState(parsed: any): PersistedVaultState {
  const result: PersistedVaultState = {
    pages: [],
    links: [],
    shares: [],
    auditEvents: [],
    lockedSkills: [],
    timelineEntries: [],
    currentRole: parsed.currentRole,
  };

  if (Array.isArray(parsed.pages)) {
    result.pages = parsed.pages.map((p: Page) => ({
      ...p,
      folder: p.folder || (p.front_matter?.folder as string) || undefined,
      created_at: new Date(p.created_at),
      updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
    }));
  }

  if (Array.isArray(parsed.links)) {
    const seenPair = new Set<string>();
    result.links = parsed.links.filter((l: any) => {
      if (!l || !l.from_page_id || !l.to_page_id || l.from_page_id === l.to_page_id) return false;
      const key = `${l.from_page_id}->${l.to_page_id}`;
      if (seenPair.has(key)) return false;
      seenPair.add(key);
      return true;
    });
  }

  if (Array.isArray(parsed.auditEvents)) {
    result.auditEvents = parsed.auditEvents.map((a: AuditEvent) => ({
      ...a,
      timestamp: new Date(a.timestamp),
    }));
  }

  if (Array.isArray(parsed.timelineEntries)) {
    result.timelineEntries = parsed.timelineEntries.map((t: TimelineEntry) => ({
      ...t,
      created_at: new Date(t.created_at),
    }));
  }

  if (Array.isArray(parsed.shares)) {
    result.shares = parsed.shares.map((s: Share) => ({
      ...s,
      granted_at: new Date(s.granted_at),
    }));
  }

  if (Array.isArray(parsed.lockedSkills)) {
    result.lockedSkills = parsed.lockedSkills.map((sk: SkillItem) => ({
      ...sk,
      created_at: new Date(sk.created_at),
    }));
  }

  return result;
}

export async function saveVaultState(
  state: PersistedVaultState,
  userId: string = 'usr_admin',
  vaultId?: string
): Promise<void> {
  // 1. Immediate, synchronous browser storage write (guarantees persistence across refresh)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save tkxel Vault state to localStorage:', err);
  }

  // 2. Asynchronous API / PostgreSQL database persistence
  try {
    const token = localStorage.getItem('ssoToken');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-id': userId,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    await fetch(`${API_URL}/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...state, vault_id: vaultId }),
    });
  } catch (err) {
    console.warn('API save background sync failed (local state is safely retained):', err);
  }
}

export async function loadVaultState(userId: string = 'usr_admin'): Promise<PersistedVaultState | null> {
  // 1. Retrieve local storage state first (instant response)
  let localState: PersistedVaultState | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      localState = reviveState(JSON.parse(raw));
    }
  } catch (err) {
    console.error('Failed to parse localStorage state:', err);
  }

  // 2. Query the PostgreSQL API state
  try {
    const token = localStorage.getItem('ssoToken');
    const headers: Record<string, string> = {
      'x-user-id': userId,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}/state`, { headers });
    if (res.ok) {
      const parsedApi = await res.json();
      const revivedApi = reviveState(parsedApi);

      // Smart Merge:
      // If the API has pages, use API pages and merge any local-only skills/timeline/shares
      if (revivedApi.pages.length > 0) {
        const merged: PersistedVaultState = {
          ...revivedApi,
          lockedSkills: revivedApi.lockedSkills.length > 0 ? revivedApi.lockedSkills : (localState?.lockedSkills || []),
          timelineEntries: revivedApi.timelineEntries.length > 0 ? revivedApi.timelineEntries : (localState?.timelineEntries || []),
          currentRole: localState?.currentRole || revivedApi.currentRole,
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {}
        return merged;
      }

      // If API returned 0 pages BUT localState has user's uploaded/created pages:
      // NEVER overwrite the user's notes with empty data!
      if (localState && localState.pages.length > 0) {
        console.log('API returned 0 pages; retaining user local notes and syncing to backend...');
        saveVaultState(localState, userId).catch(console.error);
        return localState;
      }

      if (localState) {
        return localState;
      }
      return revivedApi;
    }
  } catch (err) {
    console.warn('API server unavailable; using localStorage vault state:', err);
  }

  return localState;
}

export async function clearVaultState(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
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
