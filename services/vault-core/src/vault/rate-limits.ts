import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, auditEvents } from '../schema/index.js';
import { VaultValidationError } from './create-vault.js';

/** Per-user hourly ceilings an Owner can set for one vault (FR-67). Omitted values use the platform default. */
export interface VaultRateLimits {
  /** `run_skill`, `ask_vault`, `list_skills` calls per user per hour. Platform default: 60. */
  locked_per_hour?: number;
  /** `search`, `get_page`, `get_links`, `get_context`, `add_note` calls per user per hour. Platform default: 300. */
  retrieval_per_hour?: number;
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 10_000;

function parseLimit(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new VaultValidationError(`${name} must be a whole number between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }
  return value;
}

/** Reads the stored limits defensively: anything malformed is treated as "use the default". */
export function normalizeVaultRateLimits(stored: unknown): VaultRateLimits {
  const doc = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const valid = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= MIN_LIMIT && v <= MAX_LIMIT ? v : undefined);
  return {
    ...(valid(doc.locked_per_hour) !== undefined ? { locked_per_hour: valid(doc.locked_per_hour) } : {}),
    ...(valid(doc.retrieval_per_hour) !== undefined ? { retrieval_per_hour: valid(doc.retrieval_per_hour) } : {}),
  };
}

export async function getVaultRateLimits(vaultId: string): Promise<VaultRateLimits> {
  const rows = await db.select({ rate_limits: vaults.rate_limits }).from(vaults).where(eq(vaults.id, vaultId)).limit(1);
  return normalizeVaultRateLimits(rows[0]?.rate_limits);
}

/** Sets a vault's limits. Passing null for a field (or an empty object) returns it to the platform default. */
export async function setVaultRateLimits(params: {
  vaultId: string;
  actorId: string;
  limits: unknown;
}): Promise<VaultRateLimits> {
  const input = params.limits;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VaultValidationError('Rate limits must be an object');
  }
  const doc = input as Record<string, unknown>;
  const next: VaultRateLimits = {};
  const locked = parseLimit(doc.locked_per_hour, 'locked_per_hour');
  const retrieval = parseLimit(doc.retrieval_per_hour, 'retrieval_per_hour');
  if (locked !== undefined) next.locked_per_hour = locked;
  if (retrieval !== undefined) next.retrieval_per_hour = retrieval;

  return await db.transaction(async (tx) => {
    const updated = await tx.update(vaults)
      .set({ rate_limits: Object.keys(next).length > 0 ? next : null })
      .where(eq(vaults.id, params.vaultId))
      .returning({ id: vaults.id });
    if (updated.length === 0) {
      throw new Error('not_found');
    }
    await tx.insert(auditEvents).values({
      actor_id: params.actorId,
      action: 'edit_vault',
      target_id: params.vaultId,
      metadata: { vault_id: params.vaultId, change: 'rate_limits', ...next },
    });
    return next;
  });
}
