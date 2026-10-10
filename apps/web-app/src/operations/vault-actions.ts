import { Vault } from '@tkxel-vault/types';
import { API_ORIGIN } from '../utils/api-base.js';

export interface CreateVaultParams {
  name: string;
  mode: 'open' | 'locked';
  export_policy?: string;
}

export interface ApiRequestOptions {
  token?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function createVaultApi(
  data: CreateVaultParams,
  options?: ApiRequestOptions
): Promise<Vault> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const token = options?.token;

  const res = await fetchFn(`${baseUrl}/api/vaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to create vault (HTTP ${res.status})`);
  }

  const resJson = await res.json();
  const rawVault = resJson.vault;
  return {
    id: rawVault.id,
    name: rawVault.name,
    mode: rawVault.mode,
    owner_id: rawVault.owner_id,
    data_key_id: rawVault.encrypted === false ? '' : 'kms-managed',
    export_policy: rawVault.export_policy,
    created_at: new Date(rawVault.created_at),
  };
}

export async function movePageApi(
  pageId: string,
  destinationVaultId: string,
  options?: ApiRequestOptions
): Promise<void> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const token = options?.token;

  const res = await fetchFn(`${baseUrl}/api/pages/${pageId}/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ destination_vault_id: destinationVaultId }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to move note (HTTP ${res.status})`);
  }
}

export async function deleteVaultApi(
  vaultId: string,
  options?: ApiRequestOptions
): Promise<void> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const token = options?.token;

  const res = await fetchFn(`${baseUrl}/api/vaults/${vaultId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to delete vault (HTTP ${res.status})`);
  }
}

export async function changeVaultModeApi(
  vaultId: string,
  mode: 'open' | 'locked',
  options?: ApiRequestOptions
): Promise<{ mode: 'open' | 'locked'; export_policy: string; revoked_shares: number; unpublished_skills: number }> {
  const baseUrl = options?.baseUrl || API_ORIGIN;
  const fetchFn = options?.fetchImpl || fetch;
  const res = await fetchFn(`${baseUrl}/api/vaults/${vaultId}/mode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({ mode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Vault mode change failed (HTTP ${res.status})`);
  }
  return {
    mode: data.vault.mode,
    export_policy: data.vault.export_policy,
    revoked_shares: data.revoked_shares,
    unpublished_skills: data.unpublished_skills,
  };
}
