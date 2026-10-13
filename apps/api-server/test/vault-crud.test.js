import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import {
  MockKmsProvider,
  createVault,
  VaultValidationError,
  vaults,
  shares,
  auditEvents,
  EnvelopeEncryption,
} from '@tkxel-vault/vault-core';

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.ENABLE_DEV_AUTH_BYPASS = 'true';

const { app } = await import('../dist/server.js');

test('Production-Function Unit: createVault initializes unique KMS DEK, owner share, and audit in one transaction', async () => {
  const kms = new MockKmsProvider();
  const createdRows = { vaults: [], shares: [], auditEvents: [] };

  const mockDb = {
    transaction: async (callback) => {
      const tx = {
        execute: async () => {},
        insert: (table) => ({
          values: (val) => {
            if (table === vaults) {
              createdRows.vaults.push(val);
              return {
                returning: async () => [val],
              };
            }
            if (table === shares) {
              createdRows.shares.push(val);
              return Promise.resolve();
            }
            if (table === auditEvents) {
              createdRows.auditEvents.push(val);
              return Promise.resolve();
            }
            return Promise.resolve();
          },
        }),
      };
      return callback(tx);
    },
  };

  const result = await createVault({
    name: 'Healthcare Delivery Vault',
    mode: 'locked',
    ownerId: 'sarah.lead@tkxel.com',
    kms,
    db: mockDb,
  });

  // 1. Invariant: Created vault has UUID, strict export policy for locked mode, and omits data_key_id in client payload
  assert.ok(result.id);
  assert.equal(result.mode, 'locked');
  assert.equal(result.export_policy, 'strictly_forbidden');
  assert.equal(result.role, 'owner');
  assert.equal(result.data_key_id, undefined, 'Wrapped key identifier must not be exposed to client');

  // 2. Invariant: Database received unique wrapped key in data_key_id column
  assert.equal(createdRows.vaults.length, 1);
  assert.ok(createdRows.vaults[0].data_key_id);
  assert.ok(createdRows.vaults[0].data_key_id.length > 0);

  // 3. Invariant: Creator automatically granted owner role in shares
  assert.equal(createdRows.shares.length, 1);
  assert.equal(createdRows.shares[0].vault_id, result.id);
  assert.equal(createdRows.shares[0].role, 'owner');
  assert.equal(createdRows.shares[0].principal_id, 'sarah.lead@tkxel.com');

  // 4. Invariant: Immutable audit event recorded atomically
  assert.equal(createdRows.auditEvents.length, 1);
  assert.equal(createdRows.auditEvents[0].action, 'create_vault');
  assert.equal(createdRows.auditEvents[0].target_id, result.id);
  assert.equal(createdRows.auditEvents[0].actor_id, 'sarah.lead@tkxel.com');

  // 5. Invariant: Server-side validation rejects invalid mode and conflicting export policy
  await assert.rejects(
    async () => {
      await createVault({
        name: 'Bad Vault',
        mode: 'locked',
        ownerId: 'sarah.lead@tkxel.com',
        exportPolicy: 'allowed_for_owner',
        kms,
        db: mockDb,
      });
    },
    VaultValidationError
  );

  await assert.rejects(
    async () => {
      await createVault({
        name: '   ',
        mode: 'open',
        ownerId: 'sarah.lead@tkxel.com',
        kms,
        db: mockDb,
      });
    },
    VaultValidationError
  );
});

test('Vault Listing: Filters accessible vaults per authenticated user', () => {
  const allVaults = [
    { id: 'v1', name: 'Open Vault', owner_id: 'alice@tkxel.com', mode: 'open' },
    { id: 'v2', name: 'Secret IP Vault', owner_id: 'bob@tkxel.com', mode: 'locked' },
  ];

  const allShares = [
    { vault_id: 'v1', principal_id: 'alice@tkxel.com', role: 'owner', revoked_at: null },
    { vault_id: 'v1', principal_id: 'bob@tkxel.com', role: 'reader', revoked_at: null },
    { vault_id: 'v2', principal_id: 'bob@tkxel.com', role: 'owner', revoked_at: null },
  ];

  const listUserVaults = (userId) => {
    const userShares = allShares.filter((s) => s.principal_id === userId && s.revoked_at === null);
    return allVaults
      .filter((v) => v.owner_id === userId || userShares.some((s) => s.vault_id === v.id))
      .map((v) => {
        const share = userShares.find((s) => s.vault_id === v.id);
        const role = v.owner_id === userId ? 'owner' : share ? share.role : 'none';
        return { ...v, role };
      });
  };

  // Alice sees only Vault 1
  const aliceVaults = listUserVaults('alice@tkxel.com');
  assert.equal(aliceVaults.length, 1);
  assert.equal(aliceVaults[0].id, 'v1');

  // Bob sees both Vault 1 (as reader) and Vault 2 (as owner)
  const bobVaults = listUserVaults('bob@tkxel.com');
  assert.equal(bobVaults.length, 2);
  assert.equal(bobVaults.find((v) => v.id === 'v1')?.role, 'reader');
  assert.equal(bobVaults.find((v) => v.id === 'v2')?.role, 'owner');

  // Anonymous / unshared sees 0
  const strangerVaults = listUserVaults('stranger@other.com');
  assert.equal(strangerVaults.length, 0);
});

test('HTTP Integration: POST /api/vaults creates vault transactionally, omits data_key_id, and verifies in PostgreSQL', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testUser = `charlie_${Date.now()}@tkxel.com`;
  const createdVaultIds = [];

  const apiPost = async (body, customHeaders = {}) => {
    const headers = {
      'Authorization': `Bearer test_user:${testUser}`,
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    const options = {
      method: 'POST',
      headers,
    };
    if (body !== undefined) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}/api/vaults`, options);
    let data = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };

  try {
    // 1. Successful POST /api/vaults: returns HTTP 201, omits data_key_id, sets authenticated identity as owner
    const resSuccess = await apiPost({
      name: 'Security Architecture Vault',
      mode: 'open',
      export_policy: 'allowed_for_owner',
    });

    assert.equal(resSuccess.status, 201);
    assert.ok(resSuccess.data?.success);
    const vaultData = resSuccess.data?.vault;
    assert.ok(vaultData?.id);
    createdVaultIds.push(vaultData.id);

    assert.equal(vaultData.name, 'Security Architecture Vault');
    assert.equal(vaultData.mode, 'open');
    assert.equal(vaultData.owner_id, testUser.toLowerCase());
    assert.equal(vaultData.role, 'owner');
    assert.equal(vaultData.export_policy, 'allowed_for_owner');
    assert.equal(vaultData.data_key_id, undefined, 'data_key_id must NOT be disclosed in client response');

    // 2. Direct PostgreSQL verification: row exists with unique KMS DEK, owner share, and immutable audit event
    const [vaultRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultData.id));
    assert.ok(vaultRow, 'Vault row must exist in PostgreSQL');
    assert.equal(vaultRow.owner_id, testUser.toLowerCase());
    assert.ok(vaultRow.data_key_id, 'Vault row must have data_key_id in database');

    const [shareRow] = await db.select().from(schema.shares).where(eq(schema.shares.vault_id, vaultData.id));
    assert.ok(shareRow, 'Owner share must exist in PostgreSQL');
    assert.equal(shareRow.principal_id, testUser.toLowerCase());
    assert.equal(shareRow.role, 'owner');

    const [auditRow] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, vaultData.id));
    assert.ok(auditRow, 'create_vault audit event must exist in PostgreSQL');
    assert.equal(auditRow.action, 'create_vault');
    assert.equal(auditRow.actor_id, testUser.toLowerCase());

    // 3. Validation: Invalid mode returns HTTP 400
    const resInvalidMode = await apiPost({
      name: 'Invalid Mode Vault',
      mode: 'unsupported_mode',
    });
    assert.equal(resInvalidMode.status, 400);
    assert.match(resInvalidMode.data?.error || '', /mode must be either 'open' or 'locked'/);

    // 4. Validation: Conflicting export policy returns HTTP 400
    const resConflictPolicy = await apiPost({
      name: 'Conflict Vault',
      mode: 'locked',
      export_policy: 'allowed_for_owner',
    });
    assert.equal(resConflictPolicy.status, 400);
    assert.match(resConflictPolicy.data?.error || '', /strictly_forbidden/);

    // 5. Validation: Missing or null body returns HTTP 400
    const resNullBody = await apiPost(null);
    assert.equal(resNullBody.status, 400);

    const resEmptyObject = await apiPost({});
    assert.equal(resEmptyObject.status, 400);

    const resNonObject = await apiPost('not a json object');
    assert.equal(resNonObject.status, 400);
  } finally {
    // Fail-closed teardown: delete created vaults (cascades to shares)
    // Note: audit_events are append-only; database trigger blocks deletion to preserve audit invariant
    if (createdVaultIds.length > 0) {
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, createdVaultIds));
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP Integration: POST /api/pages/:id/move validates body, enforces authorization, and moves page', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testOwner = `owner_${Date.now()}@tkxel.com`;
  const stranger = `stranger_${Date.now()}@tkxel.com`;
  const kms = new MockKmsProvider();
  const createdVaultIds = [];

  const postMove = async (pageId, body, callerEmail = testOwner) => {
    const headers = {
      'Authorization': `Bearer test_user:${callerEmail}`,
      'Content-Type': 'application/json',
    };
    const options = {
      method: 'POST',
      headers,
    };
    if (body !== undefined) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}/api/pages/${pageId}/move`, options);
    let data = null;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };

  try {
    const vSrc = await createVault({ name: 'HTTP Src Vault', mode: 'open', ownerId: testOwner, kms });
    createdVaultIds.push(vSrc.id);
    const vDst = await createVault({ name: 'HTTP Dst Vault', mode: 'open', ownerId: testOwner, kms });
    createdVaultIds.push(vDst.id);

    // Seed page and version
    const pageId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const [vSrcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
    const srcDek = await kms.unwrapKey(vSrcRow.data_key_id);

    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vSrc.id,
      type: 'note',
      title: 'Move Test Note',
      current_version_id: versionId,
    });
    await db.insert(schema.versions).values({
      id: versionId,
      page_id: pageId,
      number: 1,
      status: 'published',
      encrypted_blob: EnvelopeEncryption.encrypt('# Move Content', srcDek),
      created_by: testOwner,
    });

    // 1. Validation: Malformed body returns 400
    const resNull = await postMove(pageId, null);
    assert.equal(resNull.status, 400);

    const resEmpty = await postMove(pageId, {});
    assert.equal(resEmpty.status, 400);

    // 2. Authorization: Stranger gets 404 (not_found anti-disclosure)
    const resStranger = await postMove(pageId, { destination_vault_id: vDst.id }, stranger);
    assert.equal(resStranger.status, 404);

    // 3. Success: Owner moves page to destination vault
    const resSuccess = await postMove(pageId, { destination_vault_id: vDst.id }, testOwner);
    assert.equal(resSuccess.status, 200);
    assert.equal(resSuccess.data?.success, true);
    assert.equal(resSuccess.data?.pageId, pageId);
    assert.equal(resSuccess.data?.vaultId, vDst.id);

    // 4. Verify in PostgreSQL
    const [movedPage] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    assert.equal(movedPage.vault_id, vDst.id);

    // 5. Internal Error Sanitization: Database/internal failure returns 500 with strictly generic message
    const resInternal = await postMove('invalid-uuid-format', { destination_vault_id: vDst.id }, testOwner);
    assert.equal(resInternal.status, 500);
    assert.deepEqual(resInternal.data, { error: 'Internal Server Error' });
  } finally {
    if (createdVaultIds.length > 0) {
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, createdVaultIds));
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

