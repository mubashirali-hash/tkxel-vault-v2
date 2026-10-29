import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import {
  createVault,
  VaultValidationError,
  MockKmsProvider,
} from '../dist/index.js';

test('Epic 6 Chunk 6.1: Transactional Vault Creation, Key Uniqueness & Anti-Disclosure', async (t) => {
  const testVaultIds = [];
  const testOwnerAlice = `alice_${Date.now()}@tkxel.com`;
  const testOwnerBob = `bob_${Date.now()}@tkxel.com`;

  try {
    // 1. Transactional creation of Open Vault with automatic owner share and audit event
    await t.test('1. Creates Open Vault atomically in PostgreSQL with share and audit event', async () => {
      const result = await createVault({
        name: 'Engineering Systems Documentation',
        mode: 'open',
        ownerId: testOwnerAlice,
      });

      testVaultIds.push(result.id);

      // Invariant: Result contains clean client representation and omits wrapped-key identifiers
      assert.ok(result.id, 'Vault ID must be generated');
      assert.equal(result.name, 'Engineering Systems Documentation');
      assert.equal(result.mode, 'open');
      assert.equal(result.owner_id, testOwnerAlice.toLowerCase());
      assert.equal(result.export_policy, 'allowed_for_owner');
      assert.equal(result.role, 'owner');
      assert.ok(result.created_at instanceof Date);
      assert.equal(result.data_key_id, undefined, 'Wrapped key identifier must NOT be returned in client result');

      // Database verification: Vault row exists with unique KMS wrapped key
      const [vaultRow] = await db
        .select()
        .from(schema.vaults)
        .where(eq(schema.vaults.id, result.id));
      assert.ok(vaultRow, 'Vault row must exist in PostgreSQL');
      assert.equal(vaultRow.name, 'Engineering Systems Documentation');
      assert.equal(vaultRow.mode, 'open');
      assert.equal(vaultRow.export_policy, 'allowed_for_owner');
      assert.ok(vaultRow.data_key_id, 'data_key_id must be stored in database');
      assert.ok(vaultRow.data_key_id.length > 20, 'Wrapped key must be valid base64 payload');

      // Database verification: Owner share was created atomically
      const [shareRow] = await db
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.vault_id, result.id));
      assert.ok(shareRow, 'Share row must exist in PostgreSQL');
      assert.equal(shareRow.principal_id, testOwnerAlice.toLowerCase());
      assert.equal(shareRow.role, 'owner');
      assert.equal(shareRow.granted_by, testOwnerAlice.toLowerCase());

      // Database verification: Append-only audit event was created atomically
      const [auditRow] = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.target_id, result.id));
      assert.ok(auditRow, 'Audit event must exist in PostgreSQL');
      assert.equal(auditRow.action, 'create_vault');
      assert.equal(auditRow.actor_id, testOwnerAlice.toLowerCase());
      assert.equal(auditRow.metadata?.name, 'Engineering Systems Documentation');
      assert.equal(auditRow.metadata?.mode, 'open');
      assert.equal(auditRow.metadata?.export_policy, 'allowed_for_owner');
    });

    // 2. Transactional creation of Locked Vault enforces strictly_forbidden export policy
    await t.test('2. Creates Locked Vault enforcing strictly_forbidden export policy', async () => {
      const result = await createVault({
        name: 'Proprietary IP Vault',
        mode: 'locked',
        ownerId: testOwnerBob,
      });

      testVaultIds.push(result.id);

      assert.equal(result.mode, 'locked');
      assert.equal(result.export_policy, 'strictly_forbidden');
      assert.equal(result.data_key_id, undefined);

      const [vaultRow] = await db
        .select()
        .from(schema.vaults)
        .where(eq(schema.vaults.id, result.id));
      assert.equal(vaultRow.mode, 'locked');
      assert.equal(vaultRow.export_policy, 'strictly_forbidden');

      const [shareRow] = await db
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.vault_id, result.id));
      assert.equal(shareRow.role, 'owner');
      assert.equal(shareRow.principal_id, testOwnerBob.toLowerCase());
    });

    // 3. Independent DEK generation per vault
    await t.test('3. Each created vault receives an independent, distinct KMS wrapped DEK', async () => {
      const resultA = await createVault({
        name: 'Vault Alpha',
        mode: 'open',
        ownerId: testOwnerAlice,
        includeKeyId: true,
      });
      const resultB = await createVault({
        name: 'Vault Beta',
        mode: 'open',
        ownerId: testOwnerAlice,
        includeKeyId: true,
      });

      testVaultIds.push(resultA.id, resultB.id);

      assert.ok(resultA.data_key_id, 'data_key_id present when explicitly requested');
      assert.ok(resultB.data_key_id, 'data_key_id present when explicitly requested');
      assert.notEqual(
        resultA.data_key_id,
        resultB.data_key_id,
        'Each vault must have a unique, non-shared cryptographic DEK'
      );
    });

    // 4. Atomic Rollback on Injected Failure
    await t.test('4. Full atomic rollback: failure during share or audit leaves zero database mutations', async () => {
      let capturedVaultId = null;

      // Create a failing DB proxy that aborts during share creation
      const failingDb = {
        transaction: async (callback) => {
          return db.transaction(async (tx) => {
            const proxyTx = {
              execute: (...args) => tx.execute(...args),
              insert: (table) => {
                if (table === schema.shares) {
                  throw new Error('Simulated database error during share insertion');
                }
                const originalInsert = tx.insert(table);
                return {
                  values: (...args) => {
                    const res = originalInsert.values(...args);
                    return {
                      returning: async () => {
                        const rows = await res.returning();
                        if (table === schema.vaults && rows[0]) {
                          capturedVaultId = rows[0].id;
                        }
                        return rows;
                      },
                    };
                  },
                };
              },
            };
            return callback(proxyTx);
          });
        },
      };

      await assert.rejects(
        async () => {
          await createVault({
            name: 'Doomed Rollback Vault',
            mode: 'open',
            ownerId: testOwnerAlice,
            db: failingDb,
          });
        },
        /Simulated database error during share insertion/
      );

      assert.ok(capturedVaultId, 'Vault ID should have been generated prior to rollback');

      // Verify rollback in real database: zero rows exist for capturedVaultId
      const orphanedVault = await db
        .select()
        .from(schema.vaults)
        .where(eq(schema.vaults.id, capturedVaultId));
      assert.equal(orphanedVault.length, 0, 'Orphaned vault must NOT exist after rollback');

      const orphanedShares = await db
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.vault_id, capturedVaultId));
      assert.equal(orphanedShares.length, 0, 'Orphaned shares must NOT exist after rollback');

      const orphanedAudits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.target_id, capturedVaultId));
      assert.equal(orphanedAudits.length, 0, 'Orphaned audit events must NOT exist after rollback');
    });

    // 5. Server-Side Validation: Name, Mode, and Export Policy
    await t.test('5. Server-side validation rejects malformed inputs and policy conflicts', async () => {
      // Missing or empty name
      await assert.rejects(
        () => createVault({ name: '', mode: 'open', ownerId: testOwnerAlice }),
        /Vault name is required/
      );
      await assert.rejects(
        () => createVault({ name: '   \t  ', mode: 'open', ownerId: testOwnerAlice }),
        /Vault name is required/
      );

      // Name exceeding 255 chars
      await assert.rejects(
        () => createVault({ name: 'a'.repeat(256), mode: 'open', ownerId: testOwnerAlice }),
        /cannot exceed 255 characters/
      );

      // Invalid mode
      await assert.rejects(
        () => createVault({ name: 'Valid Name', mode: 'semi-open', ownerId: testOwnerAlice }),
        /mode must be either 'open' or 'locked'/
      );

      // Missing owner ID
      await assert.rejects(
        () => createVault({ name: 'Valid Name', mode: 'open', ownerId: '   ' }),
        /Owner ID is required/
      );

      // Locked vault with conflicting export policy
      await assert.rejects(
        () =>
          createVault({
            name: 'Locked Secret',
            mode: 'locked',
            ownerId: testOwnerAlice,
            exportPolicy: 'allowed_for_owner',
          }),
        /Locked vaults must have export_policy 'strictly_forbidden'/
      );

      // Open vault with invalid export policy
      await assert.rejects(
        () =>
          createVault({
            name: 'Open Docs',
            mode: 'open',
            ownerId: testOwnerAlice,
            exportPolicy: 'public_unrestricted',
          }),
        /Invalid export_policy 'public_unrestricted'/
      );
    });
  } finally {
    // Teardown: cleanly purge all seeded test vaults (cascades to shares).
    // Note: audit_events are immutable and append-only per database trigger block_audit_modification.
    if (testVaultIds.length > 0) {
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, testVaultIds));
    }
  }
});
