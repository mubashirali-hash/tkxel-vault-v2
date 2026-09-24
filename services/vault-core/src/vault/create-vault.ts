import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../db.js';
import { vaults, shares, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption, KmsProvider } from '../crypto/kms.js';
import type { VaultMode, ExportPolicy } from '@tkxel-vault/types';

export class VaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultValidationError';
  }
}

export interface CreateVaultOptions {
  name: string;
  mode: VaultMode | string;
  ownerId: string;
  exportPolicy?: ExportPolicy | string;
  kms?: KmsProvider;
  includeKeyId?: boolean;
  db?: any;
}

export interface CreateVaultResult {
  id: string;
  name: string;
  mode: VaultMode;
  owner_id: string;
  export_policy: ExportPolicy;
  role: 'owner';
  created_at: Date;
  data_key_id?: string;
}

/**
 * Creates a new vault transactionally with unique KMS envelope encryption,
 * automatically registers the owner in the shares table, and writes an
 * immutable audit event in a single atomic database transaction.
 *
 * Security guarantees:
 * - Generates unique 256-bit DEK per vault.
 * - Securely wipes raw DEK from memory immediately after KMS wrapping.
 * - Enforces server-side validation on mode and export policy.
 * - Omits wrapped-key identifiers from client output unless explicitly requested.
 * - Rolls back all mutations atomically if any step fails.
 */
export async function createVault(options: CreateVaultOptions): Promise<CreateVaultResult> {
  // 1. Validate name
  if (!options.name || typeof options.name !== 'string' || options.name.trim().length === 0) {
    throw new VaultValidationError('Vault name is required and cannot be empty.');
  }
  const trimmedName = options.name.trim();
  if (trimmedName.length > 255) {
    throw new VaultValidationError('Vault name cannot exceed 255 characters.');
  }

  // 2. Validate mode
  if (options.mode !== 'open' && options.mode !== 'locked') {
    throw new VaultValidationError("Vault mode must be either 'open' or 'locked'.");
  }
  const mode: VaultMode = options.mode;

  // 3. Validate ownerId
  if (!options.ownerId || typeof options.ownerId !== 'string' || options.ownerId.trim().length === 0) {
    throw new VaultValidationError('Owner ID is required.');
  }
  const normalizedOwnerId = options.ownerId.toLowerCase().trim();

  // 4. Validate export policy
  let resolvedExportPolicy: ExportPolicy;
  if (mode === 'locked') {
    if (options.exportPolicy && options.exportPolicy !== 'strictly_forbidden') {
      throw new VaultValidationError("Locked vaults must have export_policy 'strictly_forbidden'.");
    }
    resolvedExportPolicy = 'strictly_forbidden';
  } else {
    if (options.exportPolicy === undefined || options.exportPolicy === null || options.exportPolicy === '') {
      resolvedExportPolicy = 'allowed_for_owner';
    } else if (options.exportPolicy === 'allowed_for_owner' || options.exportPolicy === 'strictly_forbidden') {
      resolvedExportPolicy = options.exportPolicy as ExportPolicy;
    } else {
      throw new VaultValidationError(
        `Invalid export_policy '${options.exportPolicy}'. Must be 'allowed_for_owner' or 'strictly_forbidden'.`
      );
    }
  }

  // 5. Generate and wrap unique DEK with KMS; ensure raw key buffer is wiped
  const kms = options.kms || createKmsProvider();
  const rawDek = EnvelopeEncryption.generateDek();
  let wrappedKey: string;
  try {
    wrappedKey = await kms.wrapKey(rawDek);
  } finally {
    rawDek.fill(0);
  }

  // 6. Execute atomic transaction
  const activeDb = options.db || defaultDb;
  const vaultId = crypto.randomUUID();
  const now = new Date();

  const [createdVault] = await activeDb.transaction(async (tx: any) => {
    // Set RLS session context for the owner
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${normalizedOwnerId}, true)`);

    // A. Insert vault record
    const [newVault] = await tx
      .insert(vaults)
      .values({
        id: vaultId,
        name: trimmedName,
        mode,
        owner_id: normalizedOwnerId,
        data_key_id: wrappedKey,
        export_policy: resolvedExportPolicy,
        created_at: now,
        updated_at: now,
      })
      .returning();

    // B. Insert owner share
    await tx.insert(shares).values({
      vault_id: vaultId,
      principal_id: normalizedOwnerId,
      role: 'owner',
      granted_by: normalizedOwnerId,
      granted_at: now,
    });

    // C. Insert append-only audit event
    await tx.insert(auditEvents).values({
      actor_id: normalizedOwnerId,
      action: 'create_vault',
      target_id: vaultId,
      timestamp: now,
      metadata: {
        name: trimmedName,
        mode,
        export_policy: resolvedExportPolicy,
      },
    });

    return [newVault];
  });

  // 7. Format clean result without leaking wrapped-key identifiers unless explicitly requested
  const result: CreateVaultResult = {
    id: createdVault.id,
    name: createdVault.name,
    mode: createdVault.mode,
    owner_id: createdVault.owner_id,
    export_policy: createdVault.export_policy,
    role: 'owner',
    created_at: createdVault.created_at,
  };

  if (options.includeKeyId) {
    result.data_key_id = createdVault.data_key_id;
  }

  return result;
}
