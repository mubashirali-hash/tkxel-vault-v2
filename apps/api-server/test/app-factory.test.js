import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_LISTEN = 'true';

const { createApiApp } = await import('../dist/server.js');

test('API application factory returns independent listener-free Express instances', () => {
  const firstApp = createApiApp();
  const secondApp = createApiApp();

  assert.notEqual(firstApp, secondApp);

  const firstServer = http.createServer(firstApp);
  const secondServer = http.createServer(secondApp);
  assert.equal(firstServer.listening, false);
  assert.equal(secondServer.listening, false);
});
