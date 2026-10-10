import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray, and } from 'drizzle-orm';
import { getUserRoleForVault, getUserAccessibleVaults, authorizeVaultOperation } from '../dist/auth/index.js';
import { requestBreakGlass, decideBreakGlass, revokeBreakGlass, listBreakGlassRequests } from '../dist/vault/break-glass.js';
import { runMigrations } from '../dist/schema/migrator.js';

test('NFR-06: administrators have no standing access to locked vaults; break-glass needs two people and expires', async (t) => {
  await runMigrations(db);

  const adminA = 'bg.admin.a@test.com';
  const adminB = 'bg.admin.b@test.com';
  const vaultOwner = 'bg.vault.owner@test.com';
  const outsider = 'bg.outsider@test.com';
  const previousOwners = process.env.VAULT_OWNER_EMAIL;
  process.env.VAULT_OWNER_EMAIL = `${adminA}, ${adminB}`;

  const lockedId = crypto.randomUUID();
  const openId = crypto.randomUUID();
  const reason = 'Production incident 4471: skill returns corrupted output, need to inspect.';

  try {
    await db.insert(schema.vaults).values([
      { id: lockedId, name: 'BG Locked', mode: 'locked', owner_id: vaultOwner, data_key_id: 'k', export_policy: 'strictly_forbidden' },
      { id: openId, name: 'BG Open', mode: 'open', owner_id: vaultOwner, data_key_id: 'k', export_policy: 'allowed_for_owner' },
    ]);
    const lockedAccess = async (user) => (await getUserAccessibleVaults(user)).some((v) => v.vaultId === lockedId);

    await t.test('standing access: open vaults yes, locked vaults no', async () => {
      assert.equal(await getUserRoleForVault(adminA, openId), 'owner');
      assert.equal(await getUserRoleForVault(adminA, lockedId), null);
      assert.equal(await lockedAccess(adminA), false);
      assert.equal(await authorizeVaultOperation(adminA, lockedId, 'execute_locked_skill'), null);
      assert.equal(await authorizeVaultOperation(adminA, lockedId, 'manage_vault'), null);
      // The vault's own Owner is unaffected
      assert.equal(await getUserRoleForVault(vaultOwner, lockedId), 'owner');
    });

    let requestId;
    await t.test('a request alone grants nothing and is audited with an alert', async () => {
      await assert.rejects(() => requestBreakGlass({ vaultId: lockedId, requesterId: outsider, reason }), { message: 'not_allowed' });
      await assert.rejects(() => requestBreakGlass({ vaultId: lockedId, requesterId: adminA, reason: 'too short' }), /reason/);
      await assert.rejects(() => requestBreakGlass({ vaultId: openId, requesterId: adminA, reason }), /locked vaults only/);

      const request = await requestBreakGlass({ vaultId: lockedId, requesterId: adminA, reason });
      requestId = request.id;
      assert.equal(request.status, 'pending');
      assert.equal(await getUserRoleForVault(adminA, lockedId), null, 'pending is not access');

      const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, lockedId));
      assert.ok(audits.some((a) => a.action === 'break_glass_requested' && a.metadata.reason === reason));
      const alerts = await db.select().from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.action, 'security_alert'), eq(schema.auditEvents.target_id, adminA)));
      assert.ok(alerts.some((a) => a.metadata.request_id === requestId));
    });

    await t.test('dual control: self-approval and strangers are refused', async () => {
      await assert.rejects(() => decideBreakGlass({ requestId, approverId: adminA, approve: true }), /different person/);
      await assert.rejects(() => decideBreakGlass({ requestId, approverId: outsider, approve: true }), { message: 'not_allowed' });
      assert.equal(await getUserRoleForVault(adminA, lockedId), null);

      // The database itself refuses a self-approved row
      await assert.rejects(
        () => db.update(schema.breakGlassRequests).set({ status: 'approved', approver_id: adminA.toUpperCase() }).where(eq(schema.breakGlassRequests.id, requestId)),
        (err) => /break_glass_dual_control/.test(String(err?.cause?.message || err?.message))
      );
    });

    await t.test('approval by a second person grants time-limited access to that vault only', async () => {
      const approved = await decideBreakGlass({ requestId, approverId: adminB, approve: true, minutes: 30 });
      assert.equal(approved.status, 'approved');
      assert.equal(approved.approver_id, adminB);
      const lifetimeMs = new Date(approved.expires_at).getTime() - new Date(approved.decided_at).getTime();
      assert.equal(lifetimeMs, 30 * 60_000);

      assert.equal(await getUserRoleForVault(adminA, lockedId), 'owner');
      assert.equal(await lockedAccess(adminA), true);
      assert.equal(await getUserRoleForVault(adminB, lockedId), null, 'the approver gains nothing');

      await assert.rejects(() => decideBreakGlass({ requestId, approverId: adminB, approve: true }), /already been decided/);

      // Requested durations are capped
      const second = await requestBreakGlass({ vaultId: lockedId, requesterId: adminB, reason });
      const capped = await decideBreakGlass({ requestId: second.id, approverId: vaultOwner, approve: true, minutes: 100000 });
      assert.equal(new Date(capped.expires_at).getTime() - new Date(capped.decided_at).getTime(), 240 * 60_000);
      await revokeBreakGlass({ requestId: second.id, actorId: vaultOwner });
      assert.equal(await getUserRoleForVault(adminB, lockedId), null);
    });

    await t.test('expiry and revocation end access immediately', async () => {
      // Simulate the clock passing the expiry
      await db.update(schema.breakGlassRequests).set({ expires_at: new Date(Date.now() - 1000) }).where(eq(schema.breakGlassRequests.id, requestId));
      assert.equal(await getUserRoleForVault(adminA, lockedId), null);
      assert.equal(await lockedAccess(adminA), false);

      const third = await requestBreakGlass({ vaultId: lockedId, requesterId: adminA, reason });
      await decideBreakGlass({ requestId: third.id, approverId: adminB, approve: true });
      assert.equal(await getUserRoleForVault(adminA, lockedId), 'owner');
      await assert.rejects(() => revokeBreakGlass({ requestId: third.id, actorId: outsider }), { message: 'not_allowed' });
      await revokeBreakGlass({ requestId: third.id, actorId: vaultOwner });
      assert.equal(await getUserRoleForVault(adminA, lockedId), null);

      const denied = await requestBreakGlass({ vaultId: lockedId, requesterId: adminA, reason });
      await decideBreakGlass({ requestId: denied.id, approverId: adminB, approve: false });
      assert.equal(await getUserRoleForVault(adminA, lockedId), null);

      const history = await listBreakGlassRequests(lockedId);
      assert.deepEqual(history.map((r) => r.status).sort(), ['approved', 'denied', 'revoked', 'revoked']);
      const actions = (await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, lockedId))).map((a) => a.action);
      for (const expected of ['break_glass_requested', 'break_glass_approved', 'break_glass_denied', 'break_glass_revoked']) {
        assert.ok(actions.includes(expected), `audit trail must contain ${expected}`);
      }
    });
  } finally {
    if (previousOwners === undefined) delete process.env.VAULT_OWNER_EMAIL;
    else process.env.VAULT_OWNER_EMAIL = previousOwners;
    await db.delete(schema.vaults).where(inArray(schema.vaults.id, [lockedId, openId]));
    await pool.end();
  }
});
