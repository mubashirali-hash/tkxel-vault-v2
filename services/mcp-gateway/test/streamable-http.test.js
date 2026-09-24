import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamableHttpTransport,
  MCP_PROTOCOL_VERSION,
} from '../dist/transport/streamable-http.js';

test('Streamable HTTP: handles initialize handshake and returns protocol 2025-11-25', async () => {
  const transport = new StreamableHttpTransport();

  const response = await transport.handleMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'claude-ai', version: '1.0' },
      },
    },
    {
      userId: 'usr_claude',
      roles: new Map(),
      authorizedTools: new Set(['search']),
    }
  );

  assert.ok(response);
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(response.result.serverInfo.name, 'tkxel-vault-mcp');
  assert.ok(response.result.capabilities.tools);
});

test('Streamable HTTP: notifications/initialized returns null (no response required)', async () => {
  const transport = new StreamableHttpTransport();

  const response = await transport.handleMessage(
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    {
      userId: 'usr_test',
      roles: new Map(),
      authorizedTools: new Set(),
    }
  );

  assert.equal(response, null);
});

test('Streamable HTTP: tools/list returns only authorized tools for caller', async () => {
  const transport = new StreamableHttpTransport();

  transport.registerTool(
    {
      name: 'search',
      description: 'Search open vault',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );

  transport.registerTool(
    {
      name: 'run_skill',
      description: 'Run locked skill',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );

  // Caller A: Only has search authorized
  const resA = await transport.handleMessage(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      userId: 'usr_a',
      roles: new Map(),
      authorizedTools: new Set(['search']),
    }
  );

  assert.ok(resA?.result);
  assert.equal(resA.result.tools.length, 1);
  assert.equal(resA.result.tools[0].name, 'search');

  // Caller B: Both authorized
  const resB = await transport.handleMessage(
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    {
      userId: 'usr_b',
      roles: new Map(),
      authorizedTools: new Set(['search', 'run_skill']),
    }
  );

  assert.ok(resB?.result);
  assert.equal(resB.result.tools.length, 2);
});

test('Streamable HTTP: tools/call executes authorized tool and generic denial on unauthorized tool', async () => {
  const transport = new StreamableHttpTransport();

  transport.registerTool(
    {
      name: 'search',
      description: 'Search open vault',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
    async (params) => ({
      content: [{ type: 'text', text: `Search results for: ${params.query}` }],
    })
  );

  // Authorized call
  const okCall = await transport.handleMessage(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'SOC2 policy' } },
    },
    {
      userId: 'usr_allowed',
      roles: new Map(),
      authorizedTools: new Set(['search']),
    }
  );

  assert.ok(okCall?.result);
  assert.equal(okCall.result.content[0].text, 'Search results for: SOC2 policy');

  // Unauthorized call (FR-68 generic denial)
  const deniedCall = await transport.handleMessage(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'run_skill', arguments: { skill_name: 'secret-audit' } },
    },
    {
      userId: 'usr_unauthorized',
      roles: new Map(),
      authorizedTools: new Set(['search']),
    }
  );

  assert.ok(deniedCall?.error);
  assert.equal(deniedCall.error.code, -32601);
  assert.equal(deniedCall.error.message, 'Method not found or access not allowed.');
});
