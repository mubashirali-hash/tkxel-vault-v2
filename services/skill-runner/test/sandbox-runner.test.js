import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxRunner } from '../dist/sandbox/runner.js';

test('Sandbox Runner: executes standard process and captures output', async () => {
  const runner = new SandboxRunner(5000);

  const result = await runner.execute(process.execPath, [
    '-e',
    "console.log('Hello from isolated sandbox');",
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.ok(result.stdout.includes('Hello from isolated sandbox'));
});

test('Sandbox Runner: enforces execution timeout and terminates runaway process (FR-74)', async () => {
  // Short timeout of 200ms for test
  const runner = new SandboxRunner(200);

  const result = await runner.execute(process.execPath, [
    '-e',
    'setTimeout(() => {}, 10000);',
  ]);

  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, -1);
  assert.ok(result.stderr.includes('Execution exceeded hard timeout limit'));
});

test('Sandbox Runner: strips sensitive host environment variables', async () => {
  const runner = new SandboxRunner(5000);

  // Set fake host secret in current process
  process.env.AWS_SECRET_ACCESS_KEY = 'super-secret-host-key';
  process.env.DATABASE_URL = 'postgres://admin:password@host/db';

  const result = await runner.execute(process.execPath, [
    '-e',
    "console.log(JSON.stringify({ aws: process.env.AWS_SECRET_ACCESS_KEY, db: process.env.DATABASE_URL }));",
  ]);

  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.aws, undefined);
  assert.equal(output.db, undefined);
});
