import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { recordAccessDenial, DENIAL_ALERT_THRESHOLD } from '../dist/audit/access-denials.js';
import { runMigrations } from '../dist/schema/migrator.js';

// Audit events are append-only, so each run uses its own user and leaves its rows behind.
test('FR-81/FR-83: refused web requests are audited and repeated refusals raise one alert', async () => {
  await runMigrations(db);
  const user = `Denied.${crypto.randomUUID()}@Test.com`;
  const other = `quiet.${crypto.randomUUID()}@test.com`;
  const vaultId = crypto.randomUUID();
  const denial = { userId: user, vaultId, operation: 'GET /api/vaults/:vaultId/pages', source: 'web_api' };

  const events = (action, target) =>
    db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, action), eq(schema.auditEvents.target_id, target)));

  try {
    for (let i = 1; i < DENIAL_ALERT_THRESHOLD; i++) {
      assert.deepEqual(await recordAccessDenial(denial, {}), { recorded: true, alerted: false });
    }
    assert.equal((await events('security_alert', user.toLowerCase())).length, 0);

    // A denial from the MCP gateway counts towards the same threshold
    const otherResult = await recordAccessDenial({ ...denial, userId: other }, {});
    assert.deepEqual(otherResult, { recorded: true, alerted: false });

    assert.deepEqual(await recordAccessDenial(denial, {}), { recorded: true, alerted: true });
    // Further denials are still recorded, but the alert is not repeated within the hour
    assert.deepEqual(await recordAccessDenial(denial, {}), { recorded: true, alerted: false });

    const denied = (await events('access_denied', vaultId)).filter((e) => e.actor_id === user);
    assert.equal(denied.length, DENIAL_ALERT_THRESHOLD + 1);
    assert.deepEqual(denied[0].metadata, { vault_id: vaultId, operation: denial.operation, source: 'web_api' });

    const alerts = await events('security_alert', user.toLowerCase());
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].metadata.kind, 'repeated_denials');
    assert.equal(alerts[0].metadata.denials_last_10_min, DENIAL_ALERT_THRESHOLD);
    assert.equal((await events('security_alert', other)).length, 0);

    // Gateway denials (tool_denied) and web denials add up for one user
    const mixed = `mixed.${crypto.randomUUID()}@test.com`;
    for (let i = 0; i < DENIAL_ALERT_THRESHOLD - 1; i++) {
      await db.insert(schema.auditEvents).values({ actor_id: mixed, action: 'tool_denied', target_id: vaultId, metadata: {} });
    }
    assert.deepEqual(await recordAccessDenial({ ...denial, userId: mixed }, {}), { recorded: true, alerted: true });

    // FR-84: the trail stays append-only
    await assert.rejects(
      db.execute(sql`DELETE FROM audit_events WHERE target_id = ${vaultId}`),
      (err) => /immutable and append-only/i.test(`${err?.message} ${err?.cause?.message}`)
    );
  } finally {
    await pool.end();
  }
});
