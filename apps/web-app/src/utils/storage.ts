import { Page, Share, AuditEvent, TimelineEntry, VaultRole } from '@tkxel-vault/types';
import { SkillItem } from '../components/skills/AddSkillModal.js';

export interface VaultData {
  pages: Page[];
  links: Array<{ from_page_id: string; to_page_id: string }>;
  shares: Share[];
  auditEvents: AuditEvent[];
  lockedSkills: SkillItem[];
  timelineEntries: TimelineEntry[];
  currentRole?: VaultRole;
}

const API_URL = 'http://localhost:3002/api';

export async function loadVaultData(vaultId: string, userId: string = 'usr_admin'): Promise<VaultData | null> {
  const token = localStorage.getItem('ssoToken');
  const headers: Record<string, string> = { 'x-user-id': userId };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const [pagesRes, linksRes, skillsRes, timelineRes, sharesRes, auditsRes] = await Promise.all([
      fetch(`${API_URL}/vaults/${vaultId}/pages`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/links`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/skills`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/timeline`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/shares`, { headers }).catch(() => null),
      fetch(`${API_URL}/vaults/${vaultId}/audits`, { headers }).catch(() => null),
    ]);

    const [pagesData, linksData, skillsData, timelineData, sharesData, auditsData] = await Promise.all([
      pagesRes?.ok ? pagesRes.json() : { pages: [] },
      linksRes?.ok ? linksRes.json() : { links: [] },
      skillsRes?.ok ? skillsRes.json() : { lockedSkills: [] },
      timelineRes?.ok ? timelineRes.json() : { timelineEntries: [] },
      sharesRes?.ok ? sharesRes.json() : { shares: [] },
      auditsRes?.ok ? auditsRes.json() : { auditEvents: [] },
    ]);

    return {
      pages: (pagesData.pages || []).map((p: any) => ({
        ...p,
        folder: p.folder || (p.front_matter?.folder as string) || undefined,
        created_at: new Date(p.created_at),
        updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
      })),
      links: linksData.links || [],
      lockedSkills: (skillsData.lockedSkills || []).map((s: any) => ({ ...s, created_at: new Date(s.created_at) })),
      timelineEntries: (timelineData.timelineEntries || []).map((t: any) => ({ ...t, created_at: new Date(t.created_at) })),
      shares: (sharesData.shares || []).map((s: any) => ({ ...s, granted_at: new Date(s.granted_at) })),
      auditEvents: (auditsData.auditEvents || []).map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) })),
    };
  } catch (err) {
    console.error('Failed to load vault data:', err);
    return null;
  }
}

export async function importVaultData(
  vaultId: string,
  pages: any[],
  links: any[],
  userId: string = 'usr_admin'
): Promise<void> {
  const token = localStorage.getItem('ssoToken');
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
  // tkxel_vault_storage_v1 is intentionally abandoned/cleared if found
  try {
    localStorage.removeItem('tkxel_vault_storage_v1');
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
