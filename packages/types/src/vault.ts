/**
 * Vault Domain Definitions & Access Control Models
 * Authoritative reference: tkxel_vault_SRS.md (Section 2.3, Section 3.6, Section 6)
 */

export type VaultMode = 'open' | 'locked';

export type ExportPolicy = 'allowed_for_owner' | 'strictly_forbidden';

export type VaultRole = 'owner' | 'editor' | 'reader' | 'consumer';

export interface Vault {
  id: string;
  name: string;
  mode: VaultMode;
  owner_id: string;
  data_key_id: string;
  export_policy: ExportPolicy;
  created_at: Date;
  updated_at?: Date;
}

export interface Share {
  id: string;
  vault_id: string;
  principal_id: string; // User ID or SSO Group ID
  role: VaultRole;
  granted_by: string;
  granted_at: Date;
  revoked_at?: Date | null;
}

export interface VaultAccessContext {
  userId: string;
  roles: Map<string, VaultRole>; // vault_id -> VaultRole
  ssoGroups: string[];
}
