import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, breakGlassRequests, auditEvents } from '../schema/index.js';
import { getConfiguredGlobalOwners } from '../auth/index.js';
import { VaultValidationError } from './create-vault.js';

/** How long an approved grant lasts unless a shorter time is requested. */
export const BREAK_GLASS_DEFAULT_MINUTES = 60;
export const BREAK_GLASS_MAX_MINUTES = 240;
/** A request nobody decides on lapses after this long. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface BreakGlassRequestRecord {
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

function toRecord(row: typeof breakGlassRequests.$inferSelect): BreakGlassRequestRecord {
  return {
    id: row.id,
    vault_id: row.vault_id,
    requester_id: row.requester_id,
    reason: row.reason,
    status: row.status as BreakGlassRequestRecord['status'],
    approver_id: row.approver_id,
    requested_at: row.requested_at.toISOString(),
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
  };
}

const isAdministrator = (userId: string) => getConfiguredGlobalOwners().includes(userId.toLowerCase().trim());

/** True while an approved, unexpired break-glass grant exists for this administrator on this vault. */
export async function hasActiveBreakGlassGrant(userId: string, vaultId: string, client: any = db): Promise<boolean> {
  const rows = await client
    .select({ id: breakGlassRequests.id })
    .from(breakGlassRequests)
    .where(
      and(
        eq(breakGlassRequests.vault_id, vaultId),
        sql`lower(${breakGlassRequests.requester_id}) = ${userId.toLowerCase().trim()}`,
        eq(breakGlassRequests.status, 'approved'),
        gt(breakGlassRequests.expires_at, new Date())
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * An administrator asks for emergency access to a locked vault (NFR-06). Nothing is granted yet:
 * a second person must approve. The request and its reason are audited and raise a security alert.
 */
export async function requestBreakGlass(params: {
  vaultId: string;
  requesterId: string;
  reason: string;
}): Promise<BreakGlassRequestRecord> {
  const requester = params.requesterId.toLowerCase().trim();
  if (!isAdministrator(requester)) {
    throw new Error('not_allowed');
  }
  const reason = (params.reason || '').trim();
  if (reason.length < 20 || reason.length > 2000) {
    throw new VaultValidationError('A reason of 20 to 2000 characters is required');
  }

  return await db.transaction(async (tx) => {
    const vaultRows = await tx.select({ id: vaults.id, mode: vaults.mode }).from(vaults).where(eq(vaults.id, params.vaultId)).limit(1);
    if (!vaultRows[0]) {
      throw new Error('not_found');
    }
    if (vaultRows[0].mode !== 'locked') {
      throw new VaultValidationError('Break-glass applies to locked vaults only');
    }

    const [row] = await tx.insert(breakGlassRequests)
      .values({ vault_id: params.vaultId, requester_id: requester, reason })
      .returning();

    await tx.insert(auditEvents).values([
      {
        actor_id: requester,
        action: 'break_glass_requested',
        target_id: params.vaultId,
        metadata: { vault_id: params.vaultId, request_id: row.id, reason },
      },
      {
        actor_id: 'system:break-glass',
        action: 'security_alert',
        target_id: requester,
        metadata: { kind: 'break_glass_requested', vault_id: params.vaultId, request_id: row.id },
      },
    ]);
    return toRecord(row);
  });
}

/**
 * A second person approves or denies a request. The approver must be a different person from the
 * requester and must be either the vault's own Owner or another administrator. Approval grants the
 * requester Owner-level access to that one vault until the grant expires.
 */
export async function decideBreakGlass(params: {
  requestId: string;
  approverId: string;
  approve: boolean;
  minutes?: number;
}): Promise<BreakGlassRequestRecord> {
  const approver = params.approverId.toLowerCase().trim();
  const minutes = Math.min(Math.max(Math.floor(params.minutes ?? BREAK_GLASS_DEFAULT_MINUTES), 5), BREAK_GLASS_MAX_MINUTES);

  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(breakGlassRequests).where(eq(breakGlassRequests.id, params.requestId)).for('update');
    const request = rows[0];
    if (!request) {
      throw new Error('not_found');
    }
    const vaultRows = await tx.select({ owner_id: vaults.owner_id }).from(vaults).where(eq(vaults.id, request.vault_id)).limit(1);
    const isVaultOwner = vaultRows[0]?.owner_id.toLowerCase().trim() === approver;
    if (!isVaultOwner && !isAdministrator(approver)) {
      throw new Error('not_allowed');
    }
    // Dual control: nobody approves their own request
    if (request.requester_id.toLowerCase() === approver) {
      throw new VaultValidationError('A break-glass request must be approved by a different person');
    }
    if (request.status !== 'pending') {
      throw new VaultValidationError('This request has already been decided');
    }
    if (Date.now() - request.requested_at.getTime() > PENDING_TTL_MS) {
      throw new VaultValidationError('This request has lapsed; a new one is required');
    }

    const now = new Date();
    const [updated] = await tx.update(breakGlassRequests)
      .set({
        status: params.approve ? 'approved' : 'denied',
        approver_id: approver,
        decided_at: now,
        expires_at: params.approve ? new Date(now.getTime() + minutes * 60_000) : null,
      })
      .where(eq(breakGlassRequests.id, request.id))
      .returning();

    await tx.insert(auditEvents).values({
      actor_id: approver,
      action: params.approve ? 'break_glass_approved' : 'break_glass_denied',
      target_id: request.vault_id,
      metadata: {
        vault_id: request.vault_id,
        request_id: request.id,
        requester_id: request.requester_id,
        ...(params.approve ? { minutes } : {}),
      },
    });
    return toRecord(updated);
  });
}

/** Ends an approved grant early. Allowed for the vault Owner, any administrator, or the requester. */
export async function revokeBreakGlass(params: { requestId: string; actorId: string }): Promise<BreakGlassRequestRecord> {
  const actor = params.actorId.toLowerCase().trim();
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(breakGlassRequests).where(eq(breakGlassRequests.id, params.requestId)).for('update');
    const request = rows[0];
    if (!request) {
      throw new Error('not_found');
    }
    const vaultRows = await tx.select({ owner_id: vaults.owner_id }).from(vaults).where(eq(vaults.id, request.vault_id)).limit(1);
    const permitted =
      vaultRows[0]?.owner_id.toLowerCase().trim() === actor || isAdministrator(actor) || request.requester_id.toLowerCase() === actor;
    if (!permitted) {
      throw new Error('not_allowed');
    }
    if (request.status !== 'approved') {
      throw new VaultValidationError('Only an approved grant can be revoked');
    }
    const [updated] = await tx.update(breakGlassRequests)
      .set({ status: 'revoked', expires_at: new Date() })
      .where(eq(breakGlassRequests.id, request.id))
      .returning();
    await tx.insert(auditEvents).values({
      actor_id: actor,
      action: 'break_glass_revoked',
      target_id: request.vault_id,
      metadata: { vault_id: request.vault_id, request_id: request.id, requester_id: request.requester_id },
    });
    return toRecord(updated);
  });
}

/** Requests for a vault, newest first. The caller enforces who may see them. */
export async function listBreakGlassRequests(vaultId: string): Promise<BreakGlassRequestRecord[]> {
  const rows = await db.select().from(breakGlassRequests)
    .where(eq(breakGlassRequests.vault_id, vaultId))
    .orderBy(desc(breakGlassRequests.requested_at))
    .limit(100);
  return rows.map(toRecord);
}

/** A locked vault an administrator may ask emergency access to, with their latest request for it. */
export interface BreakGlassCandidate {
  vault_id: string;
  name: string;
  owner_id: string;
  /** The administrator's most recent request for this vault, if any. */
  request: BreakGlassRequestRecord | null;
  /** True while an approved grant has not expired. */
  access_active: boolean;
}

/**
 * Locked vaults the administrator does not own, so that an emergency request can be raised from
 * the web app. Only the name and Owner are disclosed, and only to administrators; anyone else gets
 * an empty list, which is also how the app decides whether to offer the screen at all.
 */
export async function listBreakGlassCandidates(userId: string): Promise<BreakGlassCandidate[]> {
  const admin = (userId || '').toLowerCase().trim();
  if (!admin || !isAdministrator(admin)) return [];

  const lockedVaults = (await db.select().from(vaults).where(eq(vaults.mode, 'locked')))
    .filter((vault) => vault.owner_id.toLowerCase().trim() !== admin)
    // A destroyed vault keeps a sealed record but is no longer a place anyone can be let into
    .filter((vault) => !(typeof vault.data_key_id === 'string' && vault.data_key_id.startsWith('shredded:')));
  if (lockedVaults.length === 0) return [];

  const mine = await db.select().from(breakGlassRequests)
    .where(sql`lower(${breakGlassRequests.requester_id}) = ${admin}`)
    .orderBy(desc(breakGlassRequests.requested_at));
  const latest = new Map<string, BreakGlassRequestRecord>();
  for (const row of mine) if (!latest.has(row.vault_id)) latest.set(row.vault_id, toRecord(row));

  const now = Date.now();
  return lockedVaults
    .map((vault) => {
      const request = latest.get(vault.id) ?? null;
      return {
        vault_id: vault.id,
        name: vault.name,
        owner_id: vault.owner_id,
        request,
        access_active: Boolean(request && request.status === 'approved' && request.expires_at && new Date(request.expires_at).getTime() > now),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
