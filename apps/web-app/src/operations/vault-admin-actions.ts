import { API_ORIGIN } from '../utils/api-base.js';
import { ApiRequestOptions } from './vault-actions.js';

export interface VaultRateLimits {
  locked_per_hour?: number;
  retrieval_per_hour?: number;
}

export interface BreakGlassRequest {
  id: string;
  vault_id: string;
  requester_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'revoked';
  approver_id: string | null;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
}

async function call<T>(method: string, path: string, body: unknown, options?: ApiRequestOptions): Promise<T> {
  const fetchFn = options?.fetchImpl || fetch;
  const res = await fetchFn(`${options?.baseUrl || API_ORIGIN}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server answers refusals generically; that is passed on as it is
    throw new Error(typeof data?.error === 'string' && data.error !== 'not_allowed' ? data.error : res.status === 403 ? 'You are not allowed to do this.' : `Request failed (HTTP ${res.status})`);
  }
  return data as T;
}

/** Per-vault rate limits (FR-67). Owners only. */
export async function getVaultRateLimitsApi(vaultId: string, options?: ApiRequestOptions) {
  return call<{ rate_limits: VaultRateLimits; defaults: Required<VaultRateLimits> }>('GET', `/api/vaults/${vaultId}/rate-limits`, undefined, options);
}

/** A field left out returns to the platform default. */
export async function setVaultRateLimitsApi(vaultId: string, limits: VaultRateLimits, options?: ApiRequestOptions) {
  return call<{ rate_limits: VaultRateLimits }>('PUT', `/api/vaults/${vaultId}/rate-limits`, limits, options);
}

/** Rotates the vault's data key and re-encrypts its content (NFR-05). Owners only. */
export async function rekeyVaultApi(vaultId: string, options?: ApiRequestOptions) {
  return call<{ reencrypted: { versions: number; chunks: number; timeline_entries: number; skills: number } }>('POST', `/api/vaults/${vaultId}/rekey`, {}, options);
}

/** Irreversibly destroys the vault's key and content. The vault name must be repeated exactly. */
export async function cryptoShredVaultApi(vaultId: string, confirmName: string, options?: ApiRequestOptions) {
  return call<{ pages_removed: number; skills_removed: number; shares_revoked: number }>('POST', `/api/vaults/${vaultId}/crypto-shred`, { confirm_name: confirmName }, options);
}

/** Emergency administrator access to a locked vault (NFR-06): requested by one person, decided by another. */
export async function listBreakGlassApi(vaultId: string, options?: ApiRequestOptions) {
  return (await call<{ requests: BreakGlassRequest[] }>('GET', `/api/vaults/${vaultId}/break-glass`, undefined, options)).requests;
}

/** A locked vault an administrator may ask emergency access to. */
export interface EmergencyVault {
  vault_id: string;
  name: string;
  owner_id: string;
  request: BreakGlassRequest | null;
  access_active: boolean;
}

/** Empty for anyone who is not an administrator. */
export async function listEmergencyVaultsApi(options?: ApiRequestOptions) {
  return (await call<{ vaults: EmergencyVault[] }>('GET', '/api/break-glass/vaults', undefined, options)).vaults;
}

export async function requestBreakGlassApi(vaultId: string, reason: string, options?: ApiRequestOptions) {
  return (await call<{ request: BreakGlassRequest }>('POST', `/api/vaults/${vaultId}/break-glass`, { reason }, options)).request;
}

export async function decideBreakGlassApi(requestId: string, decision: 'approve' | 'deny' | 'revoke', options?: ApiRequestOptions) {
  return (await call<{ request: BreakGlassRequest }>('POST', `/api/break-glass/${requestId}/${decision}`, {}, options)).request;
}

/** Reference pages of a locked vault (FR-53). Owners and Editors only; Consumers never see them. */
export interface LockedPageSummary {
  id: string;
  title: string;
  type: string;
  tags: string[];
  published: boolean;
  has_draft: boolean;
  updated_at: string;
}

export async function listLockedPagesApi(vaultId: string, options?: ApiRequestOptions) {
  return (await call<{ pages: LockedPageSummary[] }>('GET', `/api/vaults/${vaultId}/locked-pages`, undefined, options)).pages;
}

/** Fetches the working copy for editing. The server records this read in the audit trail. */
export async function getLockedPageApi(vaultId: string, pageId: string, options?: ApiRequestOptions) {
  return (await call<{ page: { id: string; title: string; content: string; published: boolean } }>('GET', `/api/vaults/${vaultId}/locked-pages/${pageId}`, undefined, options)).page;
}

export async function saveLockedPageApi(vaultId: string, pageId: string, page: { title: string; content: string }, options?: ApiRequestOptions) {
  return call<{ page_id: string; draft_id: string }>('PUT', `/api/vaults/${vaultId}/locked-pages/${pageId}`, page, options);
}

/** Owners only. */
export async function publishLockedPageApi(vaultId: string, pageId: string, options?: ApiRequestOptions) {
  return call<{ version_id: string }>('POST', `/api/vaults/${vaultId}/locked-pages/${pageId}/publish`, {}, options);
}

export async function deleteLockedPageApi(vaultId: string, pageId: string, options?: ApiRequestOptions) {
  return call<{ success: boolean }>('DELETE', `/api/vaults/${vaultId}/locked-pages/${pageId}`, undefined, options);
}
