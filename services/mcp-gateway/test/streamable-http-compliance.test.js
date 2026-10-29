import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpGatewayServer } from '../dist/server.js';
import { OAuthValidator, InMemoryRevocationStore } from '../dist/auth/oauth.js';

const PORT = 3893;

function request(method, path, { token, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('FR-60 / FR-61: Streamable HTTP rules and OAuth protected-resource discovery', async (t) => {
  const oauth = new OAuthValidator('test-key-32b-gateway-secret-ok!', new InMemoryRevocationStore());
  const server = new McpGatewayServer({
    port: PORT,
    oauthValidator: oauth,
    vaultStore: {
      search: async () => [],
      getPage: async () => null,
      getLinks: async () => ({ nodes: [], edges: [] }),
      getContext: async () => ({ markdown: '', tokenEstimate: 0 }),
      addNote: async () => ({ noteId: 'n', status: 'draft_created' }),
    },
    accessResolver: async () => [],
    publicUrl: 'https://vault-mcp.example.com/',
    authorizationServers: ['https://login.example.com'],
    allowedOrigins: ['https://admin.example.com'],
  });
  await server.listen();
  const alice = oauth.createToken({ userId: 'alice@tkxel.com', email: 'alice@tkxel.com' });
  const bob = oauth.createToken({ userId: 'bob@tkxel.com', email: 'bob@tkxel.com' });
  const init = (token, version = '2025-11-25', headers = {}) =>
    request('POST', '/mcp', { token, headers, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } } });

  try {
    await t.test('protected-resource metadata and WWW-Authenticate point clients at the authorization server', async () => {
      const meta = await request('GET', '/.well-known/oauth-protected-resource');
      assert.equal(meta.status, 200);
      assert.deepEqual(meta.json, {
        resource: 'https://vault-mcp.example.com/mcp',
        authorization_servers: ['https://login.example.com'],
        bearer_methods_supported: ['header'],
        resource_name: 'tkxel Vault',
      });

      const unauth = await request('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
      assert.equal(unauth.status, 401);
      assert.equal(
        unauth.headers['www-authenticate'],
        'Bearer resource_metadata="https://vault-mcp.example.com/.well-known/oauth-protected-resource"'
      );
    });

    await t.test('protocol version is negotiated and an unsupported header is rejected', async () => {
      assert.equal((await init(alice, '2025-11-25')).json.result.protocolVersion, '2025-11-25');
      assert.equal((await init(alice, '2025-06-18')).json.result.protocolVersion, '2025-06-18');
      assert.equal((await init(alice, '1999-01-01')).json.result.protocolVersion, '2025-11-25');

      const badHeader = await init(alice, '2025-11-25', { 'MCP-Protocol-Version': '1999-01-01' });
      assert.equal(badHeader.status, 400);
      const goodHeader = await init(alice, '2025-11-25', { 'MCP-Protocol-Version': '2025-11-25' });
      assert.equal(goodHeader.status, 200);
    });

    await t.test('session id is issued on initialize and bound to the caller', async () => {
      const first = await init(alice);
      const sessionId = first.headers['mcp-session-id'];
      assert.ok(sessionId && sessionId.length > 20);
      assert.notEqual((await init(alice)).headers['mcp-session-id'], sessionId, 'each initialize gets a fresh session');

      const list = (token, sid) =>
        request('POST', '/mcp', { token, headers: sid ? { 'Mcp-Session-Id': sid } : {}, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
      assert.equal((await list(alice, sessionId)).status, 200);
      assert.equal((await list(alice)).status, 200, 'the session header is optional for this stateless server');
      assert.equal((await list(bob, sessionId)).status, 404, 'a session cannot be used by another caller');
      assert.equal((await list(alice, `${sessionId}x`)).status, 404, 'a tampered session id is rejected');
      assert.equal((await list(alice)).headers['mcp-session-id'], undefined);
    });

    await t.test('notifications get 202, GET/DELETE get 405, batches and oversized bodies are refused', async () => {
      const note = await request('POST', '/mcp', { token: alice, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
      assert.equal(note.status, 202);
      assert.equal(note.text, '');

      const get = await request('GET', '/mcp', { token: alice, headers: { Accept: 'text/event-stream' } });
      assert.equal(get.status, 405);
      assert.match(get.headers.allow, /POST/);
      assert.equal((await request('DELETE', '/mcp', { token: alice })).status, 405);

      const batch = await request('POST', '/mcp', { token: alice, body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] });
      assert.equal(batch.status, 400);

      const huge = await request('POST', '/mcp', {
        token: alice,
        body: { jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1024 * 1024 + 10) } },
      });
      assert.equal(huge.status, 413);
    });

    await t.test('browser origins are validated', async () => {
      const previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const evil = await init(alice, '2025-11-25', { Origin: 'https://evil.example.net' });
        assert.equal(evil.status, 403);
        const local = await init(alice, '2025-11-25', { Origin: 'http://localhost:3000' });
        assert.equal(local.status, 403, 'localhost origins are not trusted in production');

        for (const origin of ['https://claude.ai', 'https://admin.example.com']) {
          const ok = await init(alice, '2025-11-25', { Origin: origin });
          assert.equal(ok.status, 200);
          assert.equal(ok.headers['access-control-allow-origin'], origin);
        }
        // Non-browser clients send no Origin and rely on their bearer token
        assert.equal((await init(alice)).status, 200);
      } finally {
        if (previousEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnv;
      }
    });
  } finally {
    await server.close();
  }
});
