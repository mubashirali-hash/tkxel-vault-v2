// Test data for oauth-e2e-check.mjs: one open vault shared with the e2e user (E2E_USER_EMAIL), with one
// published page. Needs the mock KMS (non-production). Prints VAULT_ID=<id>.
import crypto from 'node:crypto';
import { db, pool } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { MockKmsProvider, EnvelopeEncryption, saveDraft, publishVersion } from '@tkxel-vault/vault-core';
import { eq } from 'drizzle-orm';

const owner = 'e2e.owner@tkxel-test.local';
const reader = process.env.E2E_USER_EMAIL;
const existing = await db.select().from(schema.vaults).where(eq(schema.vaults.name, 'OAuth E2E Vault'));
let vaultId = existing[0]?.id;
if (!vaultId) {
  vaultId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  await db.insert(schema.vaults).values({
    id: vaultId, name: 'OAuth E2E Vault', mode: 'open', owner_id: owner,
    data_key_id: await new MockKmsProvider().wrapKey(EnvelopeEncryption.generateDek()), export_policy: 'allowed_for_owner',
  });
  await db.insert(schema.shares).values({ vault_id: vaultId, principal_id: reader, role: 'reader', granted_by: owner, granted_at: new Date() });
  await db.insert(schema.pages).values({ id: pageId, vault_id: vaultId, type: 'note', title: 'Gateway Notes', tags: ['e2e'], aliases: [], front_matter: {} });
  await saveDraft(pageId, '# Gateway Notes\n\nThe MCP gateway validates OAuth access tokens issued for it.', owner);
  await publishVersion(pageId, owner);
}
console.log(`VAULT_ID=${vaultId}`);
await pool.end();
