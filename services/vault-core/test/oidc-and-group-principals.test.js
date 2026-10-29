import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import { createOidcVerifier, createOidcVerifierFromEnv } from '../dist/auth/oidc.js';
import {
  getUserRoleForVault,
  getUserAccessibleVaults,
  recordUserGroups,
  normalizeSharePrincipal,
} from '../dist/auth/index.js';
import { runMigrations } from '../dist/schema/migrator.js';

const ISSUER = 'https://login.microsoftonline.com/tenant-id/v2.0';
const AUDIENCE = 'api://tkxel-vault';

test('FR-50 / FR-61: OIDC tokens are verified for signature, issuer, audience, expiry and domain', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const verify = createOidcVerifier({ issuer: ISSUER, audience: AUDIENCE, allowedEmailDomains: ['tkxel.com'], keyResolver });

  const sign = (claims, { key = privateKey, issuer = ISSUER, audience = AUDIENCE, expiresIn = '5m' } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .setJti('jti-1')
      .sign(key);

  const identity = await verify(await sign({ preferred_username: 'Alice@Tkxel.com', name: 'Alice', groups: ['Vault-Readers', 'vault-readers', 'Eng'] }));
  assert.equal(identity.userId, 'alice@tkxel.com');
  assert.deepEqual(identity.groups, ['vault-readers', 'eng']);
  assert.equal(identity.tokenId, 'jti-1');
  assert.ok(identity.expiresAt > Date.now() / 1000);

  const rejected = [
    await sign({ email: 'alice@tkxel.com' }, { key: other.privateKey }), // wrong signing key
    await sign({ email: 'alice@tkxel.com' }, { issuer: 'https://evil.example.net' }),
    await sign({ email: 'alice@tkxel.com' }, { audience: 'api://someone-else' }),
    await sign({ email: 'alice@tkxel.com' }, { expiresIn: '-1m' }),
    await sign({ email: 'mallory@evil.example.net' }), // domain not allowed
    await sign({ name: 'No Email' }),
    'not-a-jwt',
  ];
  for (const token of rejected) {
    await assert.rejects(() => verify(token), { message: 'Token verification failed.' });
  }

  // Unsigned and symmetric tokens are never accepted
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, email: 'a@tkxel.com', exp: 9999999999 })).toString('base64url')}.`;
  await assert.rejects(() => verify(none), { message: 'Token verification failed.' });

  assert.equal(createOidcVerifierFromEnv({}), null);
  assert.equal(createOidcVerifierFromEnv({ OIDC_ISSUER: ISSUER }), null, 'an audience is mandatory');
  assert.equal(typeof createOidcVerifierFromEnv({ OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE }), 'function');
});

test('FR-52: shares resolve for individuals, SSO groups and the whole organization', async () => {
  await runMigrations(db);

  assert.equal(normalizeSharePrincipal(' Bob@Tkxel.com '), 'bob@tkxel.com');
  assert.equal(normalizeSharePrincipal('group:Vault-Readers'), 'group:vault-readers');
  assert.equal(normalizeSharePrincipal('org:all'), 'org:all');
  for (const bad of ['', 'not an email', 'group:', 'org:everyone', 'owner', 42, null, 'a@b', 'x'.repeat(300) + '@tkxel.com']) {
    assert.equal(normalizeSharePrincipal(bad), null, `must reject ${String(bad).slice(0, 20)}`);
  }

  const owner = 'grp.owner@test.com';
  const member = 'grp.member@test.com';
  const outsider = 'grp.outsider@test.com';
  const vaultGroup = crypto.randomUUID();
  const vaultOrg = crypto.randomUUID();
  const vaultPrivate = crypto.randomUUID();
  const vaultIds = [vaultGroup, vaultOrg, vaultPrivate];

  try {
    await db.insert(schema.vaults).values(
      vaultIds.map((id, i) => ({
        id,
        name: `Group Share Vault ${i}`,
        mode: 'open',
        owner_id: owner,
        data_key_id: 'key',
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      }))
    );
    await db.insert(schema.shares).values([
      { vault_id: vaultGroup, principal_id: 'group:vault-readers', role: 'reader', granted_by: owner },
      { vault_id: vaultGroup, principal_id: 'group:vault-editors', role: 'editor', granted_by: owner },
      { vault_id: vaultOrg, principal_id: 'org:all', role: 'reader', granted_by: owner },
    ]);

    // No groups recorded yet: only the org-wide share applies
    assert.equal(await getUserRoleForVault(member, vaultGroup), null);
    assert.equal(await getUserRoleForVault(member, vaultOrg), 'reader');
    assert.equal(await getUserRoleForVault(member, vaultPrivate), null);

    await recordUserGroups(member, ['Vault-Readers']);
    assert.equal(await getUserRoleForVault(member, vaultGroup), 'reader');
    assert.equal(await getUserRoleForVault(outsider, vaultGroup), null, "another user's groups never apply");

    // Several matching shares: the most capable role wins
    await recordUserGroups(member, ['vault-readers', 'vault-editors']);
    assert.equal(await getUserRoleForVault(member, vaultGroup), 'editor');
    const access = (await getUserAccessibleVaults(member)).filter((v) => vaultIds.includes(v.vaultId));
    assert.deepEqual(
      access.map((v) => [v.vaultId, v.role]).sort(),
      [[vaultGroup, 'editor'], [vaultOrg, 'reader']].sort()
    );

    // Membership follows the next sign-in: removed from the group, access is gone
    await recordUserGroups(member, []);
    assert.equal(await getUserRoleForVault(member, vaultGroup), null);

    // Stale membership (older than the TTL) is ignored
    await recordUserGroups(member, ['vault-readers']);
    await db.update(schema.userGroups).set({ seen_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(schema.userGroups.user_id, member));
    assert.equal(await getUserRoleForVault(member, vaultGroup), null);

    // A revoked group share stops applying at once
    await recordUserGroups(member, ['vault-readers']);
    assert.equal(await getUserRoleForVault(member, vaultGroup), 'reader');
    await db.update(schema.shares).set({ revoked_at: new Date() }).where(eq(schema.shares.vault_id, vaultGroup));
    assert.equal(await getUserRoleForVault(member, vaultGroup), null);

    // A share row can never confer ownership
    await db.insert(schema.shares).values({ vault_id: vaultPrivate, principal_id: 'org:all', role: 'owner', granted_by: owner });
    assert.equal(await getUserRoleForVault(member, vaultPrivate), null);
    assert.equal(await getUserRoleForVault(owner, vaultPrivate), 'owner');
  } finally {
    await db.delete(schema.userGroups).where(inArray(schema.userGroups.user_id, [member, outsider]));
    await db.delete(schema.shares).where(inArray(schema.shares.vault_id, vaultIds));
    await db.delete(schema.vaults).where(inArray(schema.vaults.id, vaultIds));
    await pool.end();
  }
});
