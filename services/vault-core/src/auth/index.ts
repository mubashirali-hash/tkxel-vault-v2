import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, shares } from '../schema/index.js';

export type Role = 'owner' | 'editor' | 'reader' | 'consumer';
export type VaultMode = 'open' | 'locked';
export type VaultOperation =
  | 'read_open_content'
  | 'write_open_content'
  | 'list_locked_skills'
  | 'execute_locked_skill'
  | 'manage_vault';

export interface VaultAuthorizationContext {
  vaultId: string;
  mode: VaultMode;
  role: Role;
}
export function getConfiguredGlobalOwners(
  environment: { VAULT_OWNER_EMAIL?: string } = process.env,
): string[] {
  return (environment.VAULT_OWNER_EMAIL || '')
    .toLowerCase()
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

export function isVaultOperationAllowed(
  mode: VaultMode,
  role: Role,
  operation: VaultOperation,
): boolean {
  switch (operation) {
    case 'read_open_content':
      return mode === 'open' && (role === 'owner' || role === 'editor' || role === 'reader');
    case 'write_open_content':
      return mode === 'open' && (role === 'owner' || role === 'editor');
    case 'list_locked_skills':
    case 'execute_locked_skill':
      return mode === 'locked' && (role === 'owner' || role === 'editor' || role === 'consumer');
    case 'manage_vault':
      return role === 'owner';
    default:
      return false;
  }
}

export async function getUserRoleForVault(
  userId: string,
  vaultId: string,
  client: any = db,
  forShareLock = false
): Promise<Role | null> {
  if (!userId) return null;
  const normalizedUser = userId.toLowerCase().trim();

  // 1. Check if user is in configured global owner emails or legacy admin
  const configuredOwners = getConfiguredGlobalOwners();

  if (configuredOwners.includes(normalizedUser)) {
    return 'owner';
  }

  // 2. Check if user is the direct vault owner in DB
  let vaultQuery = client.select().from(vaults).where(eq(vaults.id, vaultId));
  if (forShareLock) {
    if (typeof vaultQuery.for !== 'function') {
      throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
    }
    vaultQuery = vaultQuery.for('share');
  }
  const vaultRows = await vaultQuery;
  if (vaultRows.length > 0 && vaultRows[0].owner_id.toLowerCase().trim() === normalizedUser) {
    return 'owner';
  }

  // 3. Check if user has an active share record (revoked_at is null, case-insensitive match)
  let shareQuery = client
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.vault_id, vaultId),
        sql`lower(${shares.principal_id}) = ${normalizedUser}`,
        isNull(shares.revoked_at)
      )
    );
  if (forShareLock) {
    if (typeof shareQuery.for !== 'function') {
      throw new Error('Database adapter cannot provide required row-level locking (FOR SHARE). Failing closed.');
    }
    shareQuery = shareQuery.for('share');
  }
  const shareRows = await shareQuery;

  if (shareRows.length > 0) {
    return shareRows[0].role as Role;
  }

  return null;
}

export interface UserVaultAccess {
  vaultId: string;
  mode: 'open' | 'locked';
  role: Role;
}

export async function getUserAccessibleVaults(userId: string): Promise<UserVaultAccess[]> {
  if (!userId) return [];
  const normalizedUser = userId.toLowerCase().trim();

  const configuredOwners = getConfiguredGlobalOwners();

  const isGlobalOwner = configuredOwners.includes(normalizedUser);

  // Fetch all vaults
  const allVaults = await db.select().from(vaults);

  if (isGlobalOwner) {
    return allVaults.map((v) => ({
      vaultId: v.id,
      mode: v.mode as 'open' | 'locked',
      role: 'owner' as Role,
    }));
  }

  // Active shares for this user
  const activeShares = await db
    .select()
    .from(shares)
    .where(
      and(
        sql`lower(${shares.principal_id}) = ${normalizedUser}`,
        isNull(shares.revoked_at)
      )
    );

  const accessList: UserVaultAccess[] = [];

  for (const v of allVaults) {
    if (v.owner_id.toLowerCase().trim() === normalizedUser) {
      accessList.push({ vaultId: v.id, mode: v.mode as 'open' | 'locked', role: 'owner' });
    } else {
      const share = activeShares.find((s) => s.vault_id === v.id);
      if (share) {
        accessList.push({ vaultId: v.id, mode: v.mode as 'open' | 'locked', role: share.role as Role });
      }
    }
  }

  return accessList;
}

export async function getVaultAuthorizationContext(
  userId: string,
  vaultId: string,
): Promise<VaultAuthorizationContext | null> {
  if (!userId || !vaultId) return null;

  const vaultRows = await db
    .select({ id: vaults.id, mode: vaults.mode })
    .from(vaults)
    .where(eq(vaults.id, vaultId))
    .limit(1);
  const vault = vaultRows[0];
  if (!vault) return null;

  const role = await getUserRoleForVault(userId, vaultId);
  if (!role || (vault.mode !== 'open' && vault.mode !== 'locked')) return null;

  return {
    vaultId,
    mode: vault.mode,
    role,
  };
}

export async function authorizeVaultOperation(
  userId: string,
  vaultId: string,
  operation: VaultOperation,
): Promise<VaultAuthorizationContext | null> {
  const context = await getVaultAuthorizationContext(userId, vaultId);
  if (!context || !isVaultOperationAllowed(context.mode, context.role, operation)) {
    return null;
  }
  return context;
}

