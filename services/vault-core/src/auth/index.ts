import { eq, and, isNull, sql, inArray, gt } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, shares, userGroups, breakGlassRequests } from '../schema/index.js';
import { isVaultShredded } from '../vault/rekey.js';

export type Role = 'owner' | 'editor' | 'reader' | 'consumer';
export type VaultMode = 'open' | 'locked';
export type VaultOperation =
  | 'read_open_content'
  | 'write_open_content'
  | 'list_locked_skills'
  | 'execute_locked_skill'
  | 'manage_locked_content'
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
    case 'manage_locked_content':
      // Controlled administrative workflow (FR-53): Owners and Editors only; Consumers never
      return mode === 'locked' && (role === 'owner' || role === 'editor');
    case 'manage_vault':
      return role === 'owner';
    default:
      return false;
  }
}

/** Share principal granting access to every authenticated member of the organization (FR-52). */
export const ORG_WIDE_PRINCIPAL = 'org:all';
const GROUP_PRINCIPAL_PREFIX = 'group:';
/** Group memberships older than this are ignored, bounding how long a removed member keeps access. */
const GROUP_MEMBERSHIP_TTL_MS = 24 * 60 * 60 * 1000;
const ROLE_RANK: Record<string, number> = { owner: 4, editor: 3, reader: 2, consumer: 1 };

/** Validates and normalizes a share principal: an email, `group:<id>`, or `org:all`. Returns null when invalid. */
export function normalizeSharePrincipal(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const principal = value.trim().toLowerCase();
  if (!principal || principal.length > 255) return null;
  if (principal === ORG_WIDE_PRINCIPAL) return principal;
  if (principal.startsWith(GROUP_PRINCIPAL_PREFIX)) {
    return /^group:[a-z0-9][a-z0-9 ._@:\/-]{0,200}$/.test(principal) ? principal : null;
  }
  return /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(principal) ? principal : null;
}

/**
 * Replaces the stored group membership of a user with the groups asserted by their current SSO token.
 * Called at authentication, so membership follows the identity provider on every sign-in.
 */
export async function recordUserGroups(userId: string, groups: string[], client: any = db): Promise<void> {
  const user = userId.toLowerCase().trim();
  if (!user) return;
  const unique = Array.from(new Set(groups.map((g) => g.trim().toLowerCase()).filter(Boolean))).slice(0, 500);
  await client.transaction(async (tx: any) => {
    await tx.delete(userGroups).where(eq(userGroups.user_id, user));
    if (unique.length > 0) {
      await tx.insert(userGroups).values(unique.map((group_id) => ({ user_id: user, group_id })));
    }
  });
}

/** Every share principal that applies to a user: their email, their current groups, and the organization. */
export async function getUserPrincipals(userId: string, client: any = db): Promise<string[]> {
  const user = userId.toLowerCase().trim();
  if (!user) return [];
  const rows = await client
    .select({ group_id: userGroups.group_id })
    .from(userGroups)
    .where(and(eq(userGroups.user_id, user), gt(userGroups.seen_at, new Date(Date.now() - GROUP_MEMBERSHIP_TTL_MS))));
  return [user, ORG_WIDE_PRINCIPAL, ...rows.map((r: { group_id: string }) => `${GROUP_PRINCIPAL_PREFIX}${r.group_id}`)];
}

function strongestRole(roles: string[]): Role | null {
  let best: string | null = null;
  for (const role of roles) {
    // Ownership is never conferred by a share
    if (role === 'owner' || !(role in ROLE_RANK)) continue;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best as Role | null;
}

async function hasActiveGrant(client: any, normalizedUser: string, vaultId: string): Promise<boolean> {
  const grants = await client
    .select({ id: breakGlassRequests.id })
    .from(breakGlassRequests)
    .where(
      and(
        eq(breakGlassRequests.vault_id, vaultId),
        sql`lower(${breakGlassRequests.requester_id}) = ${normalizedUser}`,
        eq(breakGlassRequests.status, 'approved'),
        gt(breakGlassRequests.expires_at, new Date())
      )
    )
    .limit(1);
  return grants.length > 0;
}

export async function getUserRoleForVault(
  userId: string,
  vaultId: string,
  client: any = db,
  forShareLock = false
): Promise<Role | null> {
  if (!userId) return null;
  const normalizedUser = userId.toLowerCase().trim();

  // 1. Configured administrators manage open vaults. They get no standing access to a locked vault
  //    they do not own (NFR-06): that takes an approved, unexpired break-glass grant (step 2b).
  const isAdministrator = getConfiguredGlobalOwners().includes(normalizedUser);

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

  // 2b. Administrator access
  if (isAdministrator && vaultRows.length > 0) {
    if (vaultRows[0].mode !== 'locked') {
      return 'owner';
    }
    if (await hasActiveGrant(client, normalizedUser, vaultId)) {
      return 'owner';
    }
  }

  // 3. Active shares granted to the user directly, to one of their SSO groups, or org-wide
  const principals = await getUserPrincipals(normalizedUser, client);
  let shareQuery = client
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.vault_id, vaultId),
        inArray(sql`lower(${shares.principal_id})`, principals),
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

  // Several shares can apply; the most capable role wins
  return strongestRole(shareRows.map((s: { role: string }) => s.role));
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

  // Every vault that still exists. A destroyed (crypto-shredded) vault keeps a sealed record for the
  // audit trail, but nobody has access to it any more: not in the web app and not through MCP.
  const allVaults = (await db.select().from(vaults)).filter((v) => !isVaultShredded(v.data_key_id));

  // Administrators own every open vault. A locked vault they do not own is resolved below like anyone
  // else's, plus any active break-glass grant (NFR-06).
  const grantedVaultIds = new Set<string>();
  if (isGlobalOwner) {
    const grants = await db
      .select({ vault_id: breakGlassRequests.vault_id })
      .from(breakGlassRequests)
      .where(
        and(
          sql`lower(${breakGlassRequests.requester_id}) = ${normalizedUser}`,
          eq(breakGlassRequests.status, 'approved'),
          gt(breakGlassRequests.expires_at, new Date())
        )
      );
    grants.forEach((g) => grantedVaultIds.add(g.vault_id));
  }

  // Active shares for this user, their SSO groups, and the organization
  const principals = await getUserPrincipals(normalizedUser);
  const activeShares = await db
    .select()
    .from(shares)
    .where(
      and(
        inArray(sql`lower(${shares.principal_id})`, principals),
        isNull(shares.revoked_at)
      )
    );

  const accessList: UserVaultAccess[] = [];

  for (const v of allVaults) {
    if (
      v.owner_id.toLowerCase().trim() === normalizedUser ||
      (isGlobalOwner && (v.mode !== 'locked' || grantedVaultIds.has(v.id)))
    ) {
      accessList.push({ vaultId: v.id, mode: v.mode as 'open' | 'locked', role: 'owner' });
    } else {
      const role = strongestRole(activeShares.filter((s) => s.vault_id === v.id).map((s) => s.role));
      if (role) {
        accessList.push({ vaultId: v.id, mode: v.mode as 'open' | 'locked', role });
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

