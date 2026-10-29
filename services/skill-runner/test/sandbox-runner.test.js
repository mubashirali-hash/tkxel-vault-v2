import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_HOST_SANDBOX = 'true';

import { SandboxRunner, SandboxPolicyError } from '../dist/sandbox/runner.js';

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

test('Sandbox Runner: streams helper source over stdin instead of process arguments', async () => {
  const runner = new SandboxRunner(5000);
  const sourceCanary = 'stdin-only-helper-source-canary';
  const result = await runner.execute(process.execPath, ['-'], {
    stdin: `console.log(${JSON.stringify(sourceCanary)});`,
  });

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes(sourceCanary));

  const dockerArgs = SandboxRunner.buildDockerArgs(
    'node',
    ['-'],
    SandboxRunner.getProductionPolicy('runsc'),
    { NODE_ENV: 'production' }
  );
  assert.equal(dockerArgs.join(' ').includes(sourceCanary), false);
});

test('Sandbox Runner: executable helper scripts are connected to SandboxRunner or rejected in production', async () => {
  const runner = new SandboxRunner(5000);
  const prevEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_DEV_HOST_SANDBOX;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEV_HOST_SANDBOX;

    // 1. In production, un-sandboxed host execution fallback of helper scripts is strictly forbidden
    await assert.rejects(
      async () => {
        await runner.execute('python', ['helper.py'], { useDocker: false });
      },
      (err) => {
        assert.ok(err instanceof SandboxPolicyError);
        assert.ok(err.message.includes('Host process execution fallback is forbidden'));
        return true;
      }
    );

    // 2. In production, container execution without live runsc gVisor runtime is rejected fail-closed
    await assert.rejects(
      async () => {
        await runner.execute('python', ['helper.py'], { useDocker: true, runtime: 'runsc' });
      },
      (err) => {
        assert.ok(err instanceof SandboxPolicyError);
        assert.ok(err.message.includes('Helper execution is unsupported and blocked in production mode'));
        return true;
      }
    );
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevAllow !== undefined) process.env.ALLOW_DEV_HOST_SANDBOX = prevAllow;
  }

  // 3. In authorized dev/test environment, helper scripts run connected to SandboxRunner with environment sanitization
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_HOST_SANDBOX = 'true';
  const devResult = await runner.execute(process.execPath, [
    '-e',
    'console.log("helper-script-executed-via-sandbox-runner");',
  ]);
  assert.equal(devResult.exitCode, 0);
  assert.ok(devResult.stdout.includes('helper-script-executed-via-sandbox-runner'));
});
