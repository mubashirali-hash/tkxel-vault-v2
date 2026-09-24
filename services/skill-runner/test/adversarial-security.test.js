import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core';
import { eq } from 'drizzle-orm';

process.env.NODE_ENV = 'test';
process.env.SKIP_SERVER_LISTEN = 'true';
process.env.RUNNER_SHARED_SECRET = 'active-externally-supplied-secret-key-32b!';
process.env.ALLOW_DEV_PLAINTEXT_SKILLS = 'true';

const {
  createSkillRunnerApp,
  createServiceToken,
  getRunnerSecret,
  getCallerSigningKey,
  resolveCallerVerificationKey,
  recordAndVerifyNonce,
  getRedisClient,
  SandboxRunner,
  SandboxPolicyError,
  clearNonceCache,
} = await import('../dist/index.js');

test('Adversarial Security Suite: Token Claims, Nonce Replay, Plaintext Rejection & Sandbox Topology', async (t) => {
  const app = createSkillRunnerApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ownerUser = 'owner.adv@test.com';
  const consumerUser = 'consumer.adv@test.com';

  const vaultAlphaId = crypto.randomUUID();
  const vaultBetaId = crypto.randomUUID();
  const skillEncryptedId = crypto.randomUUID();
  const skillPlaintextId = crypto.randomUUID();

  const kms = new MockKmsProvider();
  const rawDek = EnvelopeEncryption.generateDek();
  const wrappedDek = await kms.wrapKey(rawDek);

  const activeSecret = process.env.RUNNER_SHARED_SECRET;

  try {
    // 1. Seed Locked Vaults Alpha and Beta
    await db.insert(schema.vaults).values([
      {
        id: vaultAlphaId,
        name: 'Adversarial Vault Alpha',
        mode: 'locked',
        owner_id: ownerUser,
        data_key_id: wrappedDek,
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
      {
        id: vaultBetaId,
        name: 'Adversarial Vault Beta',
        mode: 'locked',
        owner_id: ownerUser,
        data_key_id: wrappedDek,
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    await db.insert(schema.shares).values([
      {
        vault_id: vaultAlphaId,
        principal_id: consumerUser,
        role: 'consumer',
        granted_by: ownerUser,
      },
      {
        vault_id: vaultBetaId,
        principal_id: consumerUser,
        role: 'consumer',
        granted_by: ownerUser,
      },
    ]);

    // Skill 1: Encrypted Artifact
    const skillMd = `---
name: encrypted_calc
description: Secure financial algorithm
---
# Instructions
Compute net asset value without disclosing discount rates.`;
    const encryptedPayload = EnvelopeEncryption.encrypt(Buffer.from(skillMd, 'utf-8'), rawDek).toString('base64');

    await db.insert(schema.skills).values([
      {
        id: skillEncryptedId,
        vault_id: vaultAlphaId,
        name: 'encrypted_calc',
        tool_schema: {
          description: 'Secure financial algorithm',
          encrypted_payload: encryptedPayload,
          runtime: 'Python 3.12 Sandboxed',
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: skillPlaintextId,
        vault_id: vaultAlphaId,
        name: 'plaintext_only_skill',
        tool_schema: {
          description: 'Skill with plaintext instructions only (no encrypted payload)',
          system_instructions: 'Evaluate portfolio risk using proprietary formula.',
          runtime: 'Python 3.12 Sandboxed',
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // -------------------------------------------------------------
    // Test 1: Token Vault Mismatch Rejection
    // -------------------------------------------------------------
    await t.test('Adversarial: Token vault mismatch is rejected with 403 not_allowed', async () => {
      // Mint token bound to Vault Alpha
      const tokenAlpha = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
        },
        activeSecret
      );

      // Attempt to execute against Vault Beta using Token Alpha
      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
        },
        body: JSON.stringify({
          vaultId: vaultBetaId, // Mismatch!
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.deepEqual(data, { error: 'not_allowed' });
    });

    // -------------------------------------------------------------
    // Test 2: Token Operation Mismatch Rejection
    // -------------------------------------------------------------
    await t.test('Adversarial: Token operation mismatch is rejected with 403 not_allowed', async () => {
      // Mint token bound to 'ask_vault'
      const tokenAsk = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'ask_vault',
          role: 'consumer',
        },
        activeSecret
      );

      // Attempt to execute /api/run-skill using 'ask_vault' token
      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAsk}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.deepEqual(data, { error: 'not_allowed' });
    });

    // -------------------------------------------------------------
    // Test 3: Token Nonce Replay Protection
    // -------------------------------------------------------------
    await t.test('Adversarial: Token replay with duplicate nonce is rejected with 401', async () => {
      clearNonceCache();

      const replayToken = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
        },
        activeSecret
      );

      // First presentation: Accepted
      const res1 = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${replayToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });
      assert.equal(res1.status, 200);

      // Replay attempt: Exact same token presented again
      const res2 = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${replayToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res2.status, 401);
      const data2 = await res2.json();
      assert.ok(data2.error.toLowerCase().includes('unauthorized'));
    });

    // -------------------------------------------------------------
    // Test 4: Forged Default Secrets Rejection
    // -------------------------------------------------------------
    await t.test('Adversarial: Tokens signed with old default/forged secret fail verification', async () => {
      const forgedSecret = 'tkxel-vault-internal-runner-secret-key-32b!'; // old default string

      const forgedToken = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
        },
        forgedSecret
      );

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${forgedToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 401);

      // Verify getRunnerSecret throws when env secret is unset
      const prevSecret = process.env.RUNNER_SHARED_SECRET;
      delete process.env.RUNNER_SHARED_SECRET;
      delete process.env.RUNNER_SERVICE_SECRET;
      try {
        assert.throws(() => getRunnerSecret(), /RUNNER_SHARED_SECRET must be externally supplied/);
      } finally {
        process.env.RUNNER_SHARED_SECRET = prevSecret;
      }
    });

    // -------------------------------------------------------------
    // Test 5: Plaintext-Skill Rejection in Production Mode
    // -------------------------------------------------------------
    await t.test('Adversarial: Plaintext skills without encrypted artifact are rejected in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevBypass = process.env.ALLOW_DEV_PLAINTEXT_SKILLS;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_DEV_PLAINTEXT_SKILLS;

        const token = createServiceToken(
          {
            caller: 'tkxel-vault-mcp-gateway',
            userId: consumerUser,
            vaultId: vaultAlphaId,
            operation: 'run_skill',
            role: 'consumer',
          },
          activeSecret
        );

        // Attempt to execute plaintext_only_skill
        const res = await fetch(`${baseUrl}/api/run-skill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            vaultId: vaultAlphaId,
            skillName: 'plaintext_only_skill',
          }),
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.deepEqual(data, { error: 'plaintext_skill_forbidden' });
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevBypass !== undefined) process.env.ALLOW_DEV_PLAINTEXT_SKILLS = prevBypass;
      }
    });

    // -------------------------------------------------------------
    // Test 6: Audit-Store Failure Forces Fail-Closed 500
    // -------------------------------------------------------------
    await t.test('Adversarial: Mandatory audit write failure fails closed with 500', async () => {
      // Mock db.insert to throw an error simulating PostgreSQL failure
      const originalInsert = db.insert;
      db.insert = () => {
        throw new Error('Database connection reset during audit write');
      };

      try {
        const token = createServiceToken(
          {
            caller: 'tkxel-vault-mcp-gateway',
            userId: consumerUser,
            vaultId: vaultAlphaId,
            operation: 'run_skill',
            role: 'consumer',
          },
          activeSecret
        );

        const res = await fetch(`${baseUrl}/api/run-skill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            vaultId: vaultAlphaId,
            skillName: 'encrypted_calc',
          }),
        });

        assert.equal(res.status, 500);
        const data = await res.json();
        assert.deepEqual(data, { error: 'audit_write_failed' });
      } finally {
        db.insert = originalInsert;
      }
    });

    // -------------------------------------------------------------
    // Test 7: Unavailable Sandbox Runtime in Production Fails Closed
    // -------------------------------------------------------------
    await t.test('Adversarial: Production sandbox fails closed with no host fallback', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevAllow = process.env.ALLOW_DEV_HOST_SANDBOX;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_DEV_HOST_SANDBOX;

        const runner = new SandboxRunner(120000);

        // Attempt host-based execution in production without container flag
        await assert.rejects(
          async () => {
            await runner.execute('node', ['-e', 'console.log("host execution")'], {
              useDocker: false,
            });
          },
          (err) => {
            assert.ok(err instanceof SandboxPolicyError);
            assert.ok(err.message.includes('Host process execution fallback is forbidden'));
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevAllow !== undefined) process.env.ALLOW_DEV_HOST_SANDBOX = prevAllow;
      }
    });

    // -------------------------------------------------------------
    // Test 8: Container Policy Configuration Proof (gVisor, Non-Root, Read-Only Root, Cap-Drop)
    // -------------------------------------------------------------
    await t.test('Sandbox policy verification: proves non-root, read-only root, cap-drop, tmpfs, and gVisor', () => {
      const policy = SandboxRunner.getProductionPolicy('runsc');

      assert.equal(policy.user, '10001:10001', 'Must run as non-root UID:GID');
      assert.equal(policy.readOnly, true, 'Root filesystem must be read-only');
      assert.equal(policy.tmpfs, '/tmp:rw,noexec,nosuid,size=64m', 'tmpfs must be noexec and nosuid');
      assert.deepEqual(policy.capDrop, ['ALL'], 'All Linux capabilities must be dropped');
      assert.deepEqual(policy.securityOpt, ['no-new-privileges:true'], 'Must enforce no-new-privileges');
      assert.equal(policy.network, 'none', 'Network must default to none (deny egress)');
      assert.equal(policy.cpus, '1.0', 'CPU limit must be enforced');
      assert.equal(policy.memory, '512m', 'Memory limit must be enforced');
      assert.equal(policy.pidsLimit, 100, 'PID limit must be enforced');
      assert.equal(policy.timeoutMs, 120000, 'Hard timeout must default to 120 seconds');
      assert.equal(policy.runtime, 'runsc', 'Runtime must specify gVisor runsc');

      const dockerArgs = SandboxRunner.buildDockerArgs(
        'python',
        ['script.py'],
        policy,
        { PATH: '/usr/bin' }
      );

      assert.ok(dockerArgs.includes('--user=10001:10001'));
      assert.ok(dockerArgs.includes('--read-only'));
      assert.ok(dockerArgs.includes('--tmpfs=/tmp:rw,noexec,nosuid,size=64m'));
      assert.ok(dockerArgs.includes('--cap-drop=ALL'));
      assert.ok(dockerArgs.includes('--security-opt=no-new-privileges:true'));
      assert.ok(dockerArgs.includes('--network=none'));
      assert.ok(dockerArgs.includes('--cpus=1.0'));
      assert.ok(dockerArgs.includes('--memory=512m'));
      assert.ok(dockerArgs.includes('--pids-limit=100'));
      assert.ok(dockerArgs.includes('--runtime=runsc'));
    });

    // -------------------------------------------------------------
    // Test 9: Docker-Compose Topology & Hardening Inspection
    // -------------------------------------------------------------
    await t.test('Container topology: docker-compose isolates skill-runner without public host publishing', () => {
      let composePath = path.resolve(process.cwd(), 'docker-compose.yml');
      if (!fs.existsSync(composePath)) {
        composePath = path.resolve(process.cwd(), '../../docker-compose.yml');
      }
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      // 1. Must NOT publish port 3003 publicly to the host network
      assert.ok(
        !composeContent.includes('"3003:3003"'),
        'Port 3003 must not be published to the host network in ports'
      );
      assert.ok(
        composeContent.includes('expose:\n      - "3003"') ||
          composeContent.includes('expose:\r\n      - "3003"'),
        'Port 3003 must be exposed internally only via expose'
      );

      // 2. Must not contain fallback default secret
      assert.ok(
        !composeContent.includes('tkxel-vault-internal-runner-secret-key-32b!'),
        'docker-compose must not supply a hardcoded fallback default secret'
      );

      // 3. Must specify container security hardening parameters
      assert.ok(composeContent.includes('user: "10001:10001"'), 'Container must run as non-root 10001:10001');
      assert.ok(composeContent.includes('read_only: true'), 'Container must enforce read_only: true');
      assert.ok(composeContent.includes('cap_drop:\n      - ALL') || composeContent.includes('cap_drop:\r\n      - ALL'), 'Must drop ALL capabilities');
      assert.ok(composeContent.includes('no-new-privileges:true'), 'Must enforce no-new-privileges:true');
    });

    // -------------------------------------------------------------
    // Test 10: Request Body Parameter Tampering (bodyHash mismatch)
    // -------------------------------------------------------------
    await t.test('Adversarial: Request body parameter tampering (bodyHash mismatch) is rejected with 403 not_allowed', async () => {
      const legitBody = {
        vaultId: vaultAlphaId,
        skillName: 'encrypted_calc',
        parameters: { discountRate: 0.05 },
      };

      // Mint token strictly bound to legitBody
      const tokenWithBody = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
          body: legitBody,
        },
        activeSecret
      );

      // Adversary tampers with the parameters in-flight
      const tamperedBody = {
        vaultId: vaultAlphaId,
        skillName: 'encrypted_calc',
        parameters: { discountRate: 0.99 }, // Tampered parameter!
      };

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenWithBody}`,
        },
        body: JSON.stringify(tamperedBody),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.deepEqual(data, { error: 'not_allowed' });
    });

    // -------------------------------------------------------------
    // Test 11: Expired Service Token Rejection
    // -------------------------------------------------------------
    await t.test('Adversarial: Expired service token is rejected with 401', async () => {
      const expiredToken = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
          ttlMs: -1000, // Expired in the past
        },
        activeSecret
      );

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expiredToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 401);
    });

    // -------------------------------------------------------------
    // Test 12: Future-Issued Service Token Rejection (Clock Skew Probe)
    // -------------------------------------------------------------
    await t.test('Adversarial: Future-issued service token is rejected with 401', async () => {
      const futureToken = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
          iat: Date.now() + 60000, // 60 seconds into the future
        },
        activeSecret
      );

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${futureToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 401);
    });

    // -------------------------------------------------------------
    // Test 13: Audience Mismatch Rejection
    // -------------------------------------------------------------
    await t.test('Adversarial: Token with invalid audience is rejected', async () => {
      const wrongAudToken = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
          aud: 'tkxel-vault-api-server', // Mismatched audience
        },
        activeSecret
      );

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${wrongAudToken}`,
        },
        body: JSON.stringify({
          vaultId: vaultAlphaId,
          skillName: 'encrypted_calc',
        }),
      });

      assert.equal(res.status, 401);
    });

    // -------------------------------------------------------------
    // Test 14: Caller Key ID Isolation (kid mapping per caller)
    // -------------------------------------------------------------
    await t.test('Caller key isolation: distinct key IDs and derived keys per caller', async () => {
      const mcpKey = getCallerSigningKey('tkxel-vault-mcp-gateway', activeSecret);
      const apiServerKey = getCallerSigningKey('tkxel-vault-api-server', activeSecret);

      assert.equal(mcpKey.kid, 'kid-mcp-gateway-01');
      assert.equal(apiServerKey.kid, 'kid-api-server-01');
      assert.notEqual(mcpKey.key, apiServerKey.key, 'Callers must have distinct derived keys');

      // Verifying with wrong kid fails
      assert.throws(() => {
        resolveCallerVerificationKey('tkxel-vault-mcp-gateway', 'kid-api-server-01', activeSecret);
      }, /Invalid or retired key ID/);
    });

    // -------------------------------------------------------------
    // Test 15: Durable Non-Leaking Two-Phase Audit Trail
    // -------------------------------------------------------------
    await t.test('Two-phase audit trail: records attempted and success without secret prompts or keys', async () => {
      const requestBody = {
        vaultId: vaultAlphaId,
        skillName: 'encrypted_calc',
        parameters: { confidentialFactor: 'super-secret-risk-formula-input-123' },
      };

      const token = createServiceToken(
        {
          caller: 'tkxel-vault-mcp-gateway',
          userId: consumerUser,
          vaultId: vaultAlphaId,
          operation: 'run_skill',
          role: 'consumer',
          body: requestBody,
        },
        activeSecret
      );

      const res = await fetch(`${baseUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);

      // Verify audit events recorded in database
      const auditRows = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.target_id, skillEncryptedId));

      const attempted = auditRows.find((r) => r.metadata?.status === 'attempted');
      const success = auditRows.find((r) => r.metadata?.status === 'success');

      assert.ok(attempted, 'Must record pre-execution attempted audit event');
      assert.ok(success, 'Must record post-execution success audit event');

      // Strict leakage check: NO raw inputs, parameters, or instructions in audit metadata
      for (const row of auditRows) {
        const metaStr = JSON.stringify(row.metadata);
        assert.ok(!metaStr.includes('super-secret-risk-formula-input-123'), 'Audit log must not contain raw parameter values');
        assert.ok(!metaStr.includes('Compute net asset value'), 'Audit log must not contain raw skill instructions');
        assert.ok(!metaStr.includes(rawDek.toString('hex')), 'Audit log must not contain encryption keys');
        assert.ok(row.metadata?.correlation_id, 'Audit log must contain correlation_id');
      }
    });

    // -------------------------------------------------------------
    // Test 16: Redis Atomic Nonce Replay Across Replicas
    // -------------------------------------------------------------
    await t.test('Redis replay protection: atomic SET NX PX rejects duplicate presentation', async () => {
      const redisClient = getRedisClient();
      if (!redisClient) {
        return; // Skip if local redis container not bound to REDIS_URL
      }
      const testNonce = crypto.randomUUID();
      const exp = Date.now() + 30000;

      // First use: must succeed
      await recordAndVerifyNonce(testNonce, exp, redisClient);

      // Replay attempt: must throw replay detected
      await assert.rejects(async () => {
        await recordAndVerifyNonce(testNonce, exp, redisClient);
      }, /Service token replay detected/);
    });

  } finally {
    // Teardown HTTP server
    await new Promise((resolve) => server.close(resolve));

    // Teardown database fixtures (preserving audit triggers)
    await db.delete(schema.skills).where(eq(schema.skills.vault_id, vaultAlphaId));
    await db.delete(schema.shares).where(eq(schema.shares.vault_id, vaultAlphaId));
    await db.delete(schema.shares).where(eq(schema.shares.vault_id, vaultBetaId));
    await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultAlphaId));
    await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultBetaId));
  }
});
