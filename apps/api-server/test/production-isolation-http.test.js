import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption, saveDraft, publishVersion } from '@tkxel-vault/vault-core';
import { eq, inArray } from 'drizzle-orm';

import { createSkillRunnerApp, getRedisClient, setRedisClientForTesting } from '@tkxel-vault/skill-runner';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_PROVIDER = 'deterministic';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.ENABLE_DEV_AUTH_BYPASS = 'true';
process.env.RUNNER_SHARED_SECRET = 'externally-supplied-runner-secret-key-32b!';
delete process.env.REDIS_URL;

const { app } = await import('../dist/server.js');

test('Production-Path REST HTTP Isolation & Anti-Disclosure Suite', async (t) => {
  const sockets = new Set();
  // Boot independent Skill Runner server on ephemeral port
  const runnerApp = createSkillRunnerApp();
  const runnerServer = http.createServer(runnerApp);
  runnerServer.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => runnerServer.listen(0, '127.0.0.1', resolve));
  const runnerPort = runnerServer.address().port;
  process.env.SKILL_RUNNER_URL = `http://127.0.0.1:${runnerPort}`;

  // Start real HTTP server on an ephemeral port
  const server = http.createServer(app);
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // Test identities
  const userAlpha = 'user.alpha@test.com';
  const userBeta = 'user.beta@test.com';
  const userGamma = 'user.gamma@test.com';
  const userDelta = 'user.delta.consumer@test.com';

  const vaultAlphaId = crypto.randomUUID();
  const vaultBetaId = crypto.randomUUID();
  const vaultGammaId = crypto.randomUUID();

  const pageAlphaId = crypto.randomUUID();
  const pageBetaId = crypto.randomUUID();
  const skillGammaId = crypto.randomUUID();

  const kms = new MockKmsProvider();
  const rawDekAlpha = EnvelopeEncryption.generateDek();
  const wrappedDekAlpha = await kms.wrapKey(rawDekAlpha);

  const rawDekBeta = EnvelopeEncryption.generateDek();
  const wrappedDekBeta = await kms.wrapKey(rawDekBeta);

  const rawDekGamma = EnvelopeEncryption.generateDek();
  const wrappedDekGamma = await kms.wrapKey(rawDekGamma);

  let createdShareId = null;

  // Helper for authenticated HTTP requests using unpooled client sockets
  const apiRequest = (method, path, userEmail, body = null) => {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          agent: false,
          headers: {
            Authorization: `Bearer test_user:${userEmail}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsed = data;
            try {
              parsed = JSON.parse(data);
            } catch {}
            resolve({ status: res.statusCode, headers: res.headers, data: parsed });
          });
        }
      );
      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  };

  try {
    // 1. Seed Vaults
    await db.insert(schema.vaults).values([
      {
        id: vaultAlphaId,
        name: 'Vault Alpha Corp',
        mode: 'open',
        owner_id: userAlpha,
        data_key_id: wrappedDekAlpha,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultBetaId,
        name: 'Vault Beta Confidential',
        mode: 'open',
        owner_id: userBeta,
        data_key_id: wrappedDekBeta,
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultGammaId,
        name: 'Vault Gamma Proprietary Skills',
        mode: 'locked',
        owner_id: userGamma,
        data_key_id: wrappedDekGamma,
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    // 2. Seed Shares
    await db.insert(schema.shares).values([
      {
        vault_id: vaultAlphaId,
        principal_id: userAlpha,
        role: 'owner',
        granted_by: userAlpha,
        granted_at: new Date(),
      },
      {
        vault_id: vaultBetaId,
        principal_id: userBeta,
        role: 'owner',
        granted_by: userBeta,
        granted_at: new Date(),
      },
      {
        vault_id: vaultGammaId,
        principal_id: userGamma,
        role: 'owner',
        granted_by: userGamma,
        granted_at: new Date(),
      },
      {
        vault_id: vaultGammaId,
        principal_id: userDelta,
        role: 'consumer',
        granted_by: userGamma,
        granted_at: new Date(),
      },
    ]);

    // 3. Seed Pages & Versions
    await db.insert(schema.pages).values([
      {
        id: pageAlphaId,
        vault_id: vaultAlphaId,
        type: 'note',
        title: 'Alpha Operations Runbook',
        aliases: ['alpha-ops'],
        tags: ['ops', 'runbook'],
        front_matter: { title: 'Alpha Operations Runbook' },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageBetaId,
        vault_id: vaultBetaId,
        type: 'note',
        title: 'Beta Secret Strategy M&A',
        aliases: ['mna-strategy'],
        tags: ['finance', 'secret'],
        front_matter: { title: 'Beta Secret Strategy M&A' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await saveDraft(pageAlphaId, 'Confidential Alpha Runbook Content', userAlpha);
    await publishVersion(pageAlphaId, userAlpha);

    await saveDraft(pageBetaId, 'Top Secret Beta Financial Data', userBeta);
    await publishVersion(pageBetaId, userBeta);

    // 4. Seed Locked Skill in Vault Gamma
    const skillMdGamma = `---
name: analyze_risk
description: Proprietary financial risk simulation tool
---
# Instructions
Execute Monte Carlo risk simulations without disclosing algorithm details.`;
    const encryptedPayloadGamma = EnvelopeEncryption.encrypt(Buffer.from(skillMdGamma, 'utf-8'), rawDekGamma).toString('base64');

    await db.insert(schema.skills).values({
      id: skillGammaId,
      vault_id: vaultGammaId,
      name: 'analyze_risk',
      code: 'print("Analyzing proprietary risk parameters...")',
      tool_schema: {
        description: 'Proprietary financial risk simulation tool',
        encrypted_payload: encryptedPayloadGamma,
        tool_schema: { type: 'object', properties: { horizon: { type: 'number' } } },
        runtime: 'Python 3.12 Sandboxed',
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    // -------------------------------------------------------------
    // Test 1: Cross-Vault Read & Uniform 404 Error Parity
    // -------------------------------------------------------------
    await t.test('Cross-Vault Read: Unauthorized resource returns uniform 404 not_found without existence disclosure', async () => {
      // User Alpha tries to read Beta's page (without passing vaultId)
      const resCrossVault = await apiRequest('GET', `/api/pages/${pageBetaId}`, userAlpha);
      assert.equal(resCrossVault.status, 404);
      assert.deepEqual(resCrossVault.data, { error: 'not_found' });

      // User Alpha tries to read a completely fake, non-existent page ID
      const fakePageId = crypto.randomUUID();
      const resNonExistent = await apiRequest('GET', `/api/pages/${fakePageId}`, userAlpha);
      assert.equal(resNonExistent.status, 404);
      assert.deepEqual(resNonExistent.data, { error: 'not_found' });

      // Invariant: Both errors must be completely identical (no 403 vs 404 oracle)
      assert.deepEqual(resCrossVault.data, resNonExistent.data);

      // User Alpha reading their own page succeeds
      const resOwnPage = await apiRequest('GET', `/api/pages/${pageAlphaId}`, userAlpha);
      assert.equal(resOwnPage.status, 200);
      assert.equal(resOwnPage.data.page.title, 'Alpha Operations Runbook');
      assert.ok(resOwnPage.data.page.content.includes('Alpha Runbook Content'));
    });

    // -------------------------------------------------------------
    // Test 2: Cross-Vault Search Scoping
    // -------------------------------------------------------------
    await t.test('Cross-Vault Search: Caller cannot search unauthorized vault', async () => {
      // User Alpha attempts search in Vault Beta
      const resForbiddenSearch = await apiRequest('GET', `/api/search?vaultId=${vaultBetaId}&q=Secret`, userAlpha);
      assert.equal(resForbiddenSearch.status, 403);
      assert.deepEqual(resForbiddenSearch.data, { error: 'not_allowed' });

      // User Alpha searching authorized Vault Alpha succeeds
      const resAllowedSearch = await apiRequest('GET', `/api/search?vaultId=${vaultAlphaId}&q=Operations`, userAlpha);
      assert.equal(resAllowedSearch.status, 200);
      assert.ok(Array.isArray(resAllowedSearch.data.results));
    });

    // -------------------------------------------------------------
    // Test 3: Cross-Vault Mutation Scoping
    // -------------------------------------------------------------
    await t.test('Cross-Vault Mutation: Caller cannot modify pages in unauthorized vault', async () => {
      // User Alpha attempts to save draft on Beta's page without vaultId -> uniform 404
      const resForbiddenDraft = await apiRequest('POST', `/api/pages/${pageBetaId}/draft`, userAlpha, {
        content: 'Overwriting beta secret',
      });
      assert.equal(resForbiddenDraft.status, 404);
      assert.deepEqual(resForbiddenDraft.data, { error: 'not_found' });

      // User Alpha attempts to save draft on Beta's page with explicit vaultId -> 403 not_allowed
      const resExplicitForbidden = await apiRequest('POST', `/api/pages/${pageBetaId}/draft?vaultId=${vaultBetaId}`, userAlpha, {
        content: 'Overwriting beta secret',
      });
      assert.equal(resExplicitForbidden.status, 403);
      assert.deepEqual(resExplicitForbidden.data, { error: 'not_allowed' });
    });

    // -------------------------------------------------------------
    // Test 4: Locked-Vault Zero-Read Containment for Consumers
    // -------------------------------------------------------------
    await t.test('Locked Consumer Containment: Consumers cannot read or search locked vault', async () => {
      // Consumer User Delta attempts GET /api/search on locked Vault Gamma
      const resSearch = await apiRequest('GET', `/api/search?vaultId=${vaultGammaId}&q=risk`, userDelta);
      assert.equal(resSearch.status, 403);
      assert.deepEqual(resSearch.data, { error: 'not_allowed' });

      // Consumer User Delta attempts GET /api/vaults/:vaultId/pages on locked Vault Gamma
      const resPages = await apiRequest('GET', `/api/vaults/${vaultGammaId}/pages`, userDelta);
      assert.equal(resPages.status, 403);
      assert.deepEqual(resPages.data, { error: 'not_allowed' });

      // Consumer User Delta calls GET /api/skills on Vault Gamma -> Approved high-level metadata only
      const resSkills = await apiRequest('GET', `/api/skills?vaultId=${vaultGammaId}`, userDelta);
      assert.equal(resSkills.status, 200);
      assert.equal(resSkills.data.count, 1);
      assert.equal(resSkills.data.skills[0].skillName, 'analyze_risk');
      assert.equal(resSkills.data.skills[0].description, 'Proprietary financial risk simulation tool');
      assert.equal(resSkills.data.skills[0].code, undefined, 'Raw skill code must not be exposed');
    });

    // -------------------------------------------------------------
    // Test 5: Locked Skill Execution & Ask-Vault Boundaries
    // -------------------------------------------------------------
    await t.test('Locked Skill Execution: Consumers can run authorized skills; cross-vault skill calls are denied', async () => {
      // Consumer User Delta runs skill in authorized Vault Gamma
      const resRunSkill = await apiRequest('POST', '/api/run-skill', userDelta, {
        vaultId: vaultGammaId,
        skillName: 'analyze_risk',
        parameters: { horizon: 30 },
      });
      assert.equal(resRunSkill.status, 200);

      // Consumer User Delta attempts to run skill in Vault Alpha (where they have no role)
      const resCrossSkill = await apiRequest('POST', '/api/run-skill', userDelta, {
        vaultId: vaultAlphaId,
        skillName: 'some_skill',
      });
      assert.equal(resCrossSkill.status, 403);
      assert.deepEqual(resCrossSkill.data, { error: 'not_allowed' });

      // Consumer User Delta calls ask_vault on Vault Gamma
      const resAskVault = await apiRequest('POST', '/api/ask-vault', userDelta, {
        vaultId: vaultGammaId,
        query: 'What capabilities are available in this vault?',
      });
      assert.equal(resAskVault.status, 200);
      assert.ok(typeof resAskVault.data.answer === 'string');

      // Consumer User Delta calls ask_vault on unauthorized Vault Alpha
      const resCrossAsk = await apiRequest('POST', '/api/ask-vault', userDelta, {
        vaultId: vaultAlphaId,
        query: 'Tell me about alpha',
      });
      assert.equal(resCrossAsk.status, 403);
      assert.deepEqual(resCrossAsk.data, { error: 'not_allowed' });
    });

    // -------------------------------------------------------------
    // Test 6: Share Grant & Immediate Revocation (<60s SLA)
    // -------------------------------------------------------------
    await t.test('Share Revocation SLA: Immediate access termination on next request', async () => {
      // Before share: User Alpha cannot read Page Beta
      const preShare = await apiRequest('GET', `/api/pages/${pageBetaId}`, userAlpha);
      assert.equal(preShare.status, 404);

      // User Beta grants reader share to User Alpha
      const grantRes = await apiRequest('POST', `/api/vaults/${vaultBetaId}/shares`, userBeta, {
        principal_id: userAlpha,
        role: 'reader',
      });
      assert.equal(grantRes.status, 200);
      assert.ok(grantRes.data.share?.id);
      createdShareId = grantRes.data.share.id;

      // Immediately after share: User Alpha can read Page Beta
      const postShare = await apiRequest('GET', `/api/pages/${pageBetaId}`, userAlpha);
      assert.equal(postShare.status, 200);
      assert.equal(postShare.data.page.title, 'Beta Secret Strategy M&A');

      // User Beta immediately revokes the share
      const revokeRes = await apiRequest('DELETE', `/api/vaults/${vaultBetaId}/shares/${createdShareId}`, userBeta);
      assert.equal(revokeRes.status, 200);
      assert.equal(revokeRes.data.success, true);

      // Immediate next request by User Alpha fails with uniform 404 (zero grace period / cache latency)
      const postRevoke = await apiRequest('GET', `/api/pages/${pageBetaId}`, userAlpha);
      assert.equal(postRevoke.status, 404);
      assert.deepEqual(postRevoke.data, { error: 'not_found' });
    });

    // -------------------------------------------------------------
    // REST Link Isolation: GET /api/vaults/:vaultId/links with seeded legacy cross-vault row
    // -------------------------------------------------------------
    await t.test('REST Link Isolation: GET /api/vaults/:vaultId/links suppresses legacy cross-vault link row', async () => {
      // Temporarily bypass trigger to seed legacy invalid cross-vault row (simulating unmigrated legacy state)
      await pool.query('ALTER TABLE links DISABLE TRIGGER trg_links_enforce_invariants');
      const seededLegacyLinkId = crypto.randomUUID();
      await db.insert(schema.links).values({
        id: seededLegacyLinkId,
        from_page_id: pageAlphaId, // in vaultAlpha
        to_page_id: pageBetaId,   // in vaultBeta
        raw_target: 'Beta Secret Strategy M&A',
        link_type: 'wiki',
        resolved: true,
      });
      await pool.query('ALTER TABLE links ENABLE TRIGGER trg_links_enforce_invariants');

      try {
        // Authenticated request by User Alpha for vaultAlpha links
        const res = await apiRequest('GET', `/api/vaults/${vaultAlphaId}/links`, userAlpha);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.links));

        // The foreign pageBetaId must NEVER appear in the returned links
        const hasForeignId = res.data.links.some((l) => l.to_page_id === pageBetaId || l.from_page_id === pageBetaId);
        assert.equal(hasForeignId, false, 'Foreign page ID must never appear in authenticated GET /api/vaults/:vaultId/links');
      } finally {
        await db.delete(schema.links).where(eq(schema.links.id, seededLegacyLinkId));
      }
    });

    // -------------------------------------------------------------
    // REST Import Isolation: POST /api/vaults/:vaultId/import safely ghosts cross-vault endpoints
    // -------------------------------------------------------------
    await t.test('REST Import Isolation: POST /api/vaults/:vaultId/import safely ghosts cross-vault links with zero partial corruption', async () => {
      const importedPageId = crypto.randomUUID();
      const importPayload = {
        pages: [
          {
            id: importedPageId,
            title: 'Imported Note Alpha',
            type: 'note',
            content: '# Imported Note\nReferences [[Beta Secret Strategy M&A]].',
          },
        ],
        links: [
          {
            from_page_id: importedPageId,
            to_page_id: pageBetaId, // Foreign page in vaultBeta!
            raw_target: 'Beta Secret Strategy M&A',
            link_type: 'wiki',
          },
        ],
      };

      const res = await apiRequest('POST', `/api/vaults/${vaultAlphaId}/import`, userAlpha, importPayload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);

      try {
        // Query database to inspect imported link row
        const importedLinks = await db
          .select()
          .from(schema.links)
          .where(eq(schema.links.from_page_id, importedPageId));

        assert.equal(importedLinks.length, 1);
        // Cross-vault target must be safely converted to ghost link (to_page_id = null, resolved = false)
        assert.equal(importedLinks[0].to_page_id, null, 'Foreign endpoint must not be set as to_page_id');
        assert.equal(importedLinks[0].resolved, false, 'Link must be unresolved ghost link');
        assert.equal(importedLinks[0].raw_target, 'Beta Secret Strategy M&A');
      } finally {
        await db.delete(schema.links).where(eq(schema.links.from_page_id, importedPageId));
        await db.delete(schema.versions).where(eq(schema.versions.page_id, importedPageId));
        await db.delete(schema.pages).where(eq(schema.pages.id, importedPageId));
      }
    });

  } finally {
    try {
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, [pageAlphaId, pageBetaId]));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, [pageAlphaId, pageBetaId]));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageAlphaId, pageBetaId]));
      await db.delete(schema.skills).where(eq(schema.skills.id, skillGammaId));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultAlphaId, vaultBetaId, vaultGammaId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultAlphaId, vaultBetaId, vaultGammaId]));
    } catch (cleanupErr) {
      console.error('Test cleanup error:', cleanupErr);
    }

    for (const s of sockets) {
      try { s.destroy(); } catch {}
    }
    sockets.clear();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    if (typeof runnerServer.closeAllConnections === 'function') runnerServer.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => runnerServer.close(resolve));

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
      setRedisClientForTesting(null);
    }

    await pool.end();
  }



});

