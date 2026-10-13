import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { McpGatewayServer } from '../dist/server.js';
import { PostgresOpenVaultStore } from '../dist/tools/postgres-store.js';
import { OAuthValidator, InMemoryRevocationStore } from '../dist/auth/oauth.js';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption, saveDraft, publishVersion } from '@tkxel-vault/vault-core';
import { eq, inArray } from 'drizzle-orm';

test('Production-Path Streamable HTTP MCP Multi-Tenant Isolation Suite', async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
  process.env.NODE_ENV = 'test';
  process.env.EMBEDDING_PROVIDER = 'deterministic';

  const revocationStore = new InMemoryRevocationStore();
  const oauthValidator = new OAuthValidator('tkxel-vault-test-secret-key-32b-min', revocationStore);
  const vaultStore = new PostgresOpenVaultStore();

  const server = new McpGatewayServer({
    port: 0,
    vaultStore,
    oauthValidator,
  });

  const port = await server.listen();
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;

  // Identities
  const userAlpha = 'alpha.mcp@example.com';
  const userBeta = 'beta.mcp@example.com';
  const userGamma = 'gamma.mcp@example.com';
  const userDelta = 'delta.mcp.consumer@example.com';

  const vaultAlphaId = crypto.randomUUID();
  const vaultBetaId = crypto.randomUUID();
  const vaultGammaId = crypto.randomUUID();

  const pageAlphaId = crypto.randomUUID();
  const pageAlpha2Id = crypto.randomUUID();
  const pageBetaId = crypto.randomUUID();
  const skillGammaId = crypto.randomUUID();
  const linkAlphaId = crypto.randomUUID();

  const kms = new MockKmsProvider();
  const rawDekAlpha = EnvelopeEncryption.generateDek();
  const wrappedDekAlpha = await kms.wrapKey(rawDekAlpha);

  const rawDekBeta = EnvelopeEncryption.generateDek();
  const wrappedDekBeta = await kms.wrapKey(rawDekBeta);

  const rawDekGamma = EnvelopeEncryption.generateDek();
  const wrappedDekGamma = await kms.wrapKey(rawDekGamma);

  // Issue real HMAC-SHA256 JWT tokens
  const tokenAlpha = oauthValidator.createToken({ userId: userAlpha, email: userAlpha });
  const tokenBeta = oauthValidator.createToken({ userId: userBeta, email: userBeta });
  const tokenDelta = oauthValidator.createToken({ userId: userDelta, email: userDelta });

  const mcpCall = async (token, method, params = null) => {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    };
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { status: res.status, data };
  };

  try {
    // 1. Seed Vaults
    await db.insert(schema.vaults).values([
      {
        id: vaultAlphaId,
        name: 'Vault Alpha Open',
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
        name: 'Vault Gamma Locked Skills',
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

    // 3. Seed Pages & Versions in Postgres
    await db.insert(schema.pages).values([
      {
        id: pageAlphaId,
        vault_id: vaultAlphaId,
        type: 'note',
        title: 'Alpha Architecture Document',
        aliases: ['alpha-arch'],
        tags: ['mcp', 'alpha'],
        front_matter: { title: 'Alpha Architecture Document' },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageAlpha2Id,
        vault_id: vaultAlphaId,
        type: 'note',
        title: 'Alpha Microservices Design',
        aliases: ['alpha-microservices'],
        tags: ['mcp', 'microservices'],
        front_matter: { title: 'Alpha Microservices Design' },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: pageBetaId,
        vault_id: vaultBetaId,
        type: 'note',
        title: 'Beta Secret Acquisition Terms',
        aliases: ['beta-terms'],
        tags: ['finance', 'secret'],
        front_matter: { title: 'Beta Secret Acquisition Terms' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await saveDraft(pageAlphaId, 'Confidential Alpha Architecture Content', userAlpha);
    await publishVersion(pageAlphaId, userAlpha);

    await saveDraft(pageAlpha2Id, 'Detailed microservices architecture connecting to [[Alpha Architecture Document]].', userAlpha);
    await publishVersion(pageAlpha2Id, userAlpha);

    await saveDraft(pageBetaId, 'Top Secret Beta Acquisition Content', userBeta);
    await publishVersion(pageBetaId, userBeta);

    await db.insert(schema.links).values({
      id: linkAlphaId,
      from_page_id: pageAlpha2Id,
      to_page_id: pageAlphaId,
      raw_target: 'Alpha Architecture Document',
      link_type: 'wiki',
      resolved: true,
    });

    // 4. Seed Locked Skill in Vault Gamma
    await db.insert(schema.skills).values({
      id: skillGammaId,
      vault_id: vaultGammaId,
      name: 'mcp_risk_calc',
      code: 'print("Evaluating proprietary risk equation")',
      tool_schema: {
        description: 'Proprietary risk calculator',
        system_instructions: 'Calculate risk scores without disclosing proprietary formula.',
        tool_schema: { type: 'object', properties: { asset: { type: 'string' } } },
        runtime: 'Python 3.12 Sandboxed',
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    // -------------------------------------------------------------
    // Test 1: Dynamic Dual-Mode Tool Palette Filtering
    // -------------------------------------------------------------
    await t.test('Dynamic Palette: Open reader receives open tools; Locked consumer receives locked tools', async () => {
      // User Alpha lists tools
      const resAlpha = await mcpCall(tokenAlpha, 'tools/list');
      assert.equal(resAlpha.status, 200);
      const alphaToolNames = resAlpha.data.result.tools.map((t) => t.name);
      assert.ok(alphaToolNames.includes('search'));
      assert.ok(alphaToolNames.includes('get_page'));
      assert.ok(alphaToolNames.includes('get_links'));
      assert.ok(alphaToolNames.includes('get_context'));
      assert.ok(alphaToolNames.includes('add_note'));
      assert.ok(!alphaToolNames.includes('run_skill'), 'Locked tool in open reader palette');
      assert.ok(!alphaToolNames.includes('ask_vault'), 'Locked tool in open reader palette');
      assert.ok(!alphaToolNames.includes('list_skills'), 'Locked tool in open reader palette');

      // User Delta (locked consumer) lists tools
      const resDelta = await mcpCall(tokenDelta, 'tools/list');
      assert.equal(resDelta.status, 200);
      const deltaToolNames = resDelta.data.result.tools.map((t) => t.name);
      assert.ok(deltaToolNames.includes('run_skill'));
      assert.ok(deltaToolNames.includes('ask_vault'));
      assert.ok(deltaToolNames.includes('list_skills'));
      assert.ok(!deltaToolNames.includes('search'), 'Open retrieval tool in locked consumer palette');
      assert.ok(!deltaToolNames.includes('get_page'), 'Open retrieval tool in locked consumer palette');
      assert.ok(!deltaToolNames.includes('get_links'), 'Open retrieval tool in locked consumer palette');
      assert.ok(!deltaToolNames.includes('get_context'), 'Open retrieval tool in locked consumer palette');
      assert.ok(!deltaToolNames.includes('add_note'), 'Open retrieval tool in locked consumer palette');
    });

    // -------------------------------------------------------------
    // Test 2: Multi-Tenant Exact Vault Authorization & Cross-Vault Rejection
    // -------------------------------------------------------------
    await t.test('Exact-Vault Authorization: User Alpha calling open tools on unauthorized Vault Beta is rejected', async () => {
      // 1. Authorized search in Vault Alpha
      const resAllowedSearch = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'search',
        arguments: { query: 'Architecture', vault_id: vaultAlphaId },
      });
      assert.equal(resAllowedSearch.status, 200);
      assert.ok(!resAllowedSearch.data.result?.isError, 'Authorized search failed');
      const searchContent = JSON.parse(resAllowedSearch.data.result.content[0].text);
      assert.ok(Array.isArray(searchContent));

      // 2. Cross-vault search in Vault Beta
      const resDeniedSearch = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'search',
        arguments: { query: 'Acquisition', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedSearch.status, 200);
      assert.equal(resDeniedSearch.data.result.isError, true);
      assert.ok(resDeniedSearch.data.result.content[0].text.includes('not_allowed'));

      // 3. Cross-vault get_page targeting existing page in Vault Beta
      const resDeniedGetPage = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'Beta Secret Acquisition Terms', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedGetPage.status, 200);
      assert.equal(resDeniedGetPage.data.result.isError, true);
      assert.ok(resDeniedGetPage.data.result.content[0].text.includes('not_allowed'));

      // 4. Uniform Error Parity: Guessed non-existent page in Vault Beta returns identical error
      const resGuessedGetPage = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'NonExistentSecretPage', vault_id: vaultBetaId },
      });
      assert.equal(resGuessedGetPage.status, 200);
      assert.equal(resGuessedGetPage.data.result.isError, true);
      assert.equal(resDeniedGetPage.data.result.content[0].text, resGuessedGetPage.data.result.content[0].text);

      // 5. Cross-vault get_links on Vault Beta
      const resDeniedLinks = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_links',
        arguments: { page_id: pageBetaId, vault_id: vaultBetaId },
      });
      assert.equal(resDeniedLinks.data.result.isError, true);
      assert.ok(resDeniedLinks.data.result.content[0].text.includes('not_allowed'));

      // 6. Cross-vault get_context on Vault Beta
      const resDeniedContext = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_context',
        arguments: { query: 'terms', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedContext.data.result.isError, true);
      assert.ok(resDeniedContext.data.result.content[0].text.includes('not_allowed'));

      // 7. Cross-vault add_note on Vault Beta
      const resDeniedNote = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'add_note',
        arguments: { title: 'Unauthorized Note', content: 'Injected text', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedNote.data.result.isError, true);
      assert.ok(resDeniedNote.data.result.content[0].text.includes('not_allowed'));
    });

    // -------------------------------------------------------------
    // Test 3: PostgresOpenVaultStore.getLinks verifies live bidirectional graph and rejects cross-vault links
    // -------------------------------------------------------------
    await t.test('Graph Retrieval: PostgresOpenVaultStore.getLinks traverses authorized graph and blocks cross-vault queries', async () => {
      // 1. Direct store call within authorized vault Alpha
      const alphaGraph = await vaultStore.getLinks(pageAlphaId, vaultAlphaId, 1);
      assert.ok(alphaGraph.nodes.some((n) => n.id === pageAlphaId && n.label === 'Alpha Architecture Document'));
      assert.ok(alphaGraph.nodes.some((n) => n.id === pageAlpha2Id && n.label === 'Alpha Microservices Design'));
      assert.ok(alphaGraph.edges.some((e) => e.from === pageAlpha2Id && e.to === pageAlphaId));

      // 2. Querying a node from a foreign vault yields empty graph
      const crossVaultGraph = await vaultStore.getLinks(pageAlphaId, vaultBetaId, 1);
      assert.deepEqual(crossVaultGraph, { nodes: [], edges: [] });

      const foreignNodeGraph = await vaultStore.getLinks(pageBetaId, vaultAlphaId, 1);
      assert.deepEqual(foreignNodeGraph, { nodes: [], edges: [] });

      // 3. HTTP MCP streamable call by authorized user succeeds
      const resAllowedLinks = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_links',
        arguments: { page_id: pageAlphaId, vault_id: vaultAlphaId },
      });
      assert.equal(resAllowedLinks.status, 200);
      assert.ok(!resAllowedLinks.data.result?.isError, 'Authorized get_links failed');
      const parsedGraph = JSON.parse(resAllowedLinks.data.result.content[0].text);
      assert.ok(parsedGraph.nodes.some((n) => n.id === pageAlphaId));
      assert.ok(parsedGraph.nodes.some((n) => n.id === pageAlpha2Id));
      assert.ok(parsedGraph.edges.some((e) => e.from === pageAlpha2Id && e.to === pageAlphaId));

      // 4. HTTP MCP call cross-vault is denied
      const resDeniedLinks = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_links',
        arguments: { page_id: pageBetaId, vault_id: vaultBetaId },
      });
      assert.equal(resDeniedLinks.status, 200);
      assert.equal(resDeniedLinks.data.result.isError, true);
      assert.ok(resDeniedLinks.data.result.content[0].text.includes('not_allowed'));
    });

    // -------------------------------------------------------------
    // Test 4: PostgresOpenVaultStore.getPage verifies live backlinks and excludes foreign vault references
    // -------------------------------------------------------------
    await t.test('Page Backlinks: PostgresOpenVaultStore.getPage accurately computes backlinks strictly within same vault', async () => {
      // 1. Direct store call for target page in vault Alpha
      const pageData = await vaultStore.getPage('Alpha Architecture Document', vaultAlphaId);
      assert.ok(pageData);
      assert.equal(pageData.title, 'Alpha Architecture Document');
      assert.ok(pageData.backlinks.includes('Alpha Microservices Design'), 'Backlinks missing linked document');

      // 2. Direct store call in wrong vault returns null
      const foreignPageData = await vaultStore.getPage('Alpha Architecture Document', vaultBetaId);
      assert.equal(foreignPageData, null);

      // 3. HTTP MCP streamable call by authorized user returns formatted backlinks
      const resAllowedGetPage = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'Alpha Architecture Document', vault_id: vaultAlphaId },
      });
      assert.equal(resAllowedGetPage.status, 200);
      const contentText = resAllowedGetPage.data.result.content[0].text;
      assert.ok(contentText.includes('**Backlinks:** Alpha Microservices Design'));

      // 4. HTTP MCP call for page in another vault returns not_allowed
      const resDeniedGetPage = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'Beta Secret Acquisition Terms', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedGetPage.status, 200);
      assert.equal(resDeniedGetPage.data.result.isError, true);
      assert.ok(resDeniedGetPage.data.result.content[0].text.includes('not_allowed'));
    });

    // -------------------------------------------------------------
    // Test 5: Live MCP get_context synthesizes authorized context and rejects cross-vault retrieval
    // -------------------------------------------------------------
    await t.test('Context Synthesis: Live MCP get_context generates high-density context and rejects cross-vault access', async () => {
      // 1. Direct store call getContext
      const ctxResult = await vaultStore.getContext('Architecture', vaultAlphaId, 'Alpha Architecture Document');
      assert.ok(ctxResult.markdown.includes('# Context Document: Alpha Architecture Document'));
      assert.ok(ctxResult.markdown.includes('**Referenced In (Backlinks):** Alpha Microservices Design'));
      assert.ok(ctxResult.markdown.includes('[[Alpha Microservices Design]]'));
      assert.ok(ctxResult.tokenEstimate > 0);

      // 2. HTTP MCP streamable call by authorized user
      const resAllowedContext = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_context',
        arguments: { query: 'Architecture', vault_id: vaultAlphaId, target_page: 'Alpha Architecture Document' },
      });
      assert.equal(resAllowedContext.status, 200);
      assert.ok(!resAllowedContext.data.result?.isError);
      const mcpContextText = resAllowedContext.data.result.content[0].text;
      assert.ok(mcpContextText.includes('# Context Document: Alpha Architecture Document'));
      assert.ok(mcpContextText.includes('[[Alpha Microservices Design]]'));

      // 3. HTTP MCP streamable call cross-vault is denied
      const resDeniedContext = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_context',
        arguments: { query: 'Architecture', vault_id: vaultBetaId },
      });
      assert.equal(resDeniedContext.status, 200);
      assert.equal(resDeniedContext.data.result.isError, true);
      assert.ok(resDeniedContext.data.result.content[0].text.includes('not_allowed'));
    });

    // -------------------------------------------------------------
    // Test 6: Locked Consumer Retrieval Rejection at Protocol Layer
    // -------------------------------------------------------------
    await t.test('Locked Consumer Denial: Direct invocation of retrieval tools by consumer fails closed', async () => {
      // User Delta directly calls 'search'
      const resSearchCall = await mcpCall(tokenDelta, 'tools/call', {
        name: 'search',
        arguments: { query: 'risk', vault_id: vaultGammaId },
      });
      assert.equal(resSearchCall.status, 200);
      assert.equal(resSearchCall.data.error?.code, -32601);
      assert.ok(resSearchCall.data.error?.message.includes('Method not found or access not allowed.'));

      // User Delta directly calls 'get_page'
      const resGetPageCall = await mcpCall(tokenDelta, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'any', vault_id: vaultGammaId },
      });
      assert.equal(resGetPageCall.status, 200);
      assert.equal(resGetPageCall.data.error?.code, -32601);
    });

    // -------------------------------------------------------------
    // Test 7: Sub-60-Second Revocation SLA
    // -------------------------------------------------------------
    await t.test('SSO Revocation SLA: Revoking user or token immediately rejects next request with 401', async () => {
      // Request before revocation succeeds
      const resPreRevoke = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'Alpha Architecture Document', vault_id: vaultAlphaId },
      });
      assert.equal(resPreRevoke.status, 200);
      assert.ok(!resPreRevoke.data.result?.isError);

      // Trigger immediate revocation via SSO RevocationStore
      await revocationStore.revokeUser(userAlpha);

      // Immediate next request fails with 401 Unauthorized
      const resPostRevoke = await mcpCall(tokenAlpha, 'tools/call', {
        name: 'get_page',
        arguments: { title: 'Alpha Architecture Document', vault_id: vaultAlphaId },
      });
      assert.equal(resPostRevoke.status, 401);
      assert.equal(resPostRevoke.data.error?.code, -32001);
      assert.ok(resPostRevoke.data.error?.message.includes('revoked'));
    });

  } finally {
    // Teardown: Clean up test records
    try {
      await db.delete(schema.links).where(eq(schema.links.id, linkAlphaId));
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, [pageAlphaId, pageAlpha2Id, pageBetaId]));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, [pageAlphaId, pageAlpha2Id, pageBetaId]));
      await db.delete(schema.pages).where(inArray(schema.pages.id, [pageAlphaId, pageAlpha2Id, pageBetaId]));
      await db.delete(schema.skills).where(eq(schema.skills.id, skillGammaId));
      await db.delete(schema.shares).where(inArray(schema.shares.vault_id, [vaultAlphaId, vaultBetaId, vaultGammaId]));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, [vaultAlphaId, vaultBetaId, vaultGammaId]));
    } catch (cleanupErr) {
      console.error('Test cleanup error:', cleanupErr);
    } finally {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (originalEmbeddingProvider !== undefined) {
        process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
      } else {
        delete process.env.EMBEDDING_PROVIDER;
      }
    }

    await server.close();
  }
});
