import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { McpGatewayServer } from '../dist/server.js';
import { OAuthValidator, InMemoryRevocationStore } from '../dist/auth/oauth.js';

function makeHttpRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try {
            json = JSON.parse(bodyStr);
          } catch {
            // non-json
          }
          resolve({ statusCode: res.statusCode || 500, body: bodyStr, json });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('E2E MCP Gateway: handles health, authentication, initialize handshake, and deprovisioning webhook', async () => {
  const store = new InMemoryRevocationStore();
  const oauth = new OAuthValidator('test-key-32b-gateway-secret-ok!', store);

  const mockVaultStore = {
    search: async (q) => [{ id: 'doc1', title: 'Doc 1', snippet: `Match for ${q}` }],
    getPage: async (t) => ({ title: t, content: 'Content', tags: ['policy'], backlinks: [] }),
    getLinks: async () => ({ nodes: [], edges: [] }),
    getContext: async () => ({ markdown: '# Context', tokenEstimate: 50 }),
    addNote: async () => ({ noteId: 'note_123', status: 'created' }),
  };

  const server = new McpGatewayServer({
    port: 3899,
    oauthValidator: oauth,
    vaultStore: mockVaultStore,
    ssoWebhookSecret: 'okta-webhook-secret-acceptance-key-32b!',
    accessResolver: async (userId) => {
      if (userId === 'usr_allowed') {
        return [{ vaultId: 'vlt_1', mode: 'open', role: 'reader' }];
      }
      return [];
    },
  });

  await server.listen();

  try {
    // 1. GET /health
    const healthRes = await makeHttpRequest('http://127.0.0.1:3899/health', {
      method: 'GET',
    });
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json.status, 'ok');

    // 2. Unauthenticated POST /mcp -> 401
    const unauthRes = await makeHttpRequest('http://127.0.0.1:3899/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(unauthRes.statusCode, 401);
    assert.equal(unauthRes.json.error.code, -32001);

    // 3. Authenticated POST /mcp -> initialize
    const token = oauth.createToken({
      userId: 'usr_allowed',
      email: 'allowed@tkxel.com',
      tokenId: 'tok_e2e_1',
    });

    const initRes = await makeHttpRequest('http://127.0.0.1:3899/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }),
    });

    assert.equal(initRes.statusCode, 200);
    assert.equal(initRes.json.result.protocolVersion, '2025-11-25');

    // 4. Authenticated POST /mcp -> tools/list (should show open retrieval tools)
    const toolsRes = await makeHttpRequest('http://127.0.0.1:3899/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    assert.equal(toolsRes.statusCode, 200);
    assert.ok(toolsRes.json.result.tools.some((t) => t.name === 'search'));
    assert.ok(toolsRes.json.result.tools.some((t) => t.name === 'get_context'));

    // 5. SSO Deprovisioning webhook (Unauthenticated must be rejected with 401)
    const unauthDeprovRes = await makeHttpRequest('http://127.0.0.1:3899/api/sso/deprovision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_allowed' }),
    });
    assert.equal(unauthDeprovRes.statusCode, 401, 'Unauthenticated SSO deprovision must fail with 401');

    // 5b. Authenticated SSO Deprovisioning webhook
    const deprovisionBody = JSON.stringify({ userId: 'usr_allowed' });
    const deprovRes = await makeHttpRequest('http://127.0.0.1:3899/api/sso/deprovision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Okta-Signature': crypto
          .createHmac('sha256', 'okta-webhook-secret-acceptance-key-32b!')
          .update(deprovisionBody)
          .digest('base64'),
      },
      body: deprovisionBody,
    });
    assert.equal(deprovRes.statusCode, 200);
    assert.equal(deprovRes.json.revoked, true);

    // 6. Next call with the same token must now fail with 401
    const postDeprovRes = await makeHttpRequest('http://127.0.0.1:3899/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      }),
    });
    assert.equal(postDeprovRes.statusCode, 401);
    assert.match(postDeprovRes.json.error.message, /access has been revoked/);
  } finally {
    await server.close();
  }
});

test('Regression: Default access resolver fails closed to empty array [] on lookup error or missing memberships (no vlt_default fallback)', async () => {
  const server = new McpGatewayServer({ port: 3898 });
  const defaultResolver = server.getAccessResolver();
  assert.ok(typeof defaultResolver === 'function');

  // Calling default resolver for an unknown user or when DB has no records returns []
  const result = await defaultResolver('usr_nonexistent_unknown_9999');
  assert.deepEqual(result, [], 'Must return empty array [] and never fallback to vlt_default');
});

test('Regression: SSO deprovision webhook fails closed with 500 when secret is not configured', async () => {
  const origOkta = process.env.OKTA_WEBHOOK_SECRET;
  const origSso = process.env.SSO_WEBHOOK_SECRET;
  delete process.env.OKTA_WEBHOOK_SECRET;
  delete process.env.SSO_WEBHOOK_SECRET;

  const server = new McpGatewayServer({ port: 3897 });
  await server.listen();

  try {
    const res = await makeHttpRequest('http://127.0.0.1:3897/api/sso/deprovision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer any-token',
      },
      body: JSON.stringify({ userId: 'usr_victim' }),
    });

    assert.equal(res.statusCode, 500);
    assert.match(res.json.error, /secret not configured/);
  } finally {
    if (origOkta) process.env.OKTA_WEBHOOK_SECRET = origOkta;
    if (origSso) process.env.SSO_WEBHOOK_SECRET = origSso;
    await server.close();
  }
});
