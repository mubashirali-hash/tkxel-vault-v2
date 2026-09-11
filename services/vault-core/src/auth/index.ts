import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, shares } from '../schema/index.js';

export type Role = 'owner' | 'editor' | 'reader' | 'consumer';

export async function getUserRoleForVault(userId: string, vaultId: string): Promise<Role | null> {
  if (!userId) return null;
  const normalizedUser = userId.toLowerCase().trim();

  // 1. Check if user is in configured global owner emails or legacy admin
  const configuredOwners = (process.env.VAULT_OWNER_EMAIL || 'admin@tkxel.com,usr_admin,mubashir.ali@camp1.tkxel.com')
    .toLowerCase()
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  if (configuredOwners.includes(normalizedUser) || normalizedUser === 'usr_admin') {
    return 'owner';
  }

  // 2. Check if user is the direct vault owner in DB
  const vaultRows = await db.select().from(vaults).where(eq(vaults.id, vaultId));
  if (vaultRows.length > 0 && vaultRows[0].owner_id.toLowerCase().trim() === normalizedUser) {
    return 'owner';
  }

  // 3. Check if user has an active share record (revoked_at is null, case-insensitive match)
  const shareRows = await db.select()
    .from(shares)
    .where(
      and(
        eq(shares.vault_id, vaultId),
        sql`lower(${shares.principal_id}) = ${normalizedUser}`,
        isNull(shares.revoked_at)
      )
    );

  if (shareRows.length > 0) {
    return shareRows[0].role as Role;
  }

  return null;
}
