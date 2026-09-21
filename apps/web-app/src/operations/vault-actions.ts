import { Vault } from '@tkxel-vault/types';

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
  const baseUrl = options?.baseUrl || 'http://localhost:3002';
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
    data_key_id: rawVault.data_key_id,
    export_policy: rawVault.export_policy,
    created_at: new Date(rawVault.created_at),
  };
}

export async function movePageApi(
  pageId: string,
  destinationVaultId: string,
  options?: ApiRequestOptions
): Promise<void> {
  const baseUrl = options?.baseUrl || 'http://localhost:3002';
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
