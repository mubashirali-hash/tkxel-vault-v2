import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpGatewayServer } from '../dist/server.js';

test('MCP gateway factory returns independent listener-free server instances', () => {
  const firstServer = createMcpGatewayServer({ port: 0 });
  const secondServer = createMcpGatewayServer({ port: 0 });

  assert.notEqual(firstServer, secondServer);
  assert.equal(firstServer.getPort(), 0);
  assert.equal(secondServer.getPort(), 0);
});
