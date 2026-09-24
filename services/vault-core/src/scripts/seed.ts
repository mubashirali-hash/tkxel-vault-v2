import { db } from '../db.js';
import * as schema from '../schema/index.js';
import { MockKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';

const VAULT_OPEN_ENG = '11111111-1111-1111-1111-111111111111';
const VAULT_LOCKED_AI = '22222222-2222-2222-2222-222222222222';

const PAGE_ARCH = '33333333-3333-3333-3333-333333333333';
const PAGE_SEC = '44444444-4444-4444-4444-444444444444';
const PAGE_DB = '55555555-5555-5555-5555-555555555555';
const PAGE_BOB = '66666666-6666-6666-6666-666666666666';

const VER_ARCH = '77777777-7777-7777-7777-777777777771';
const VER_SEC = '77777777-7777-7777-7777-777777777772';
const VER_DB = '77777777-7777-7777-7777-777777777773';
const VER_BOB = '77777777-7777-7777-7777-777777777774';

async function seed() {
  console.log('🌱 Starting database seed...');
  
  const kms = new MockKmsProvider();
  
  // 1. Generate DEKs for the Vaults
  const dekOpen = EnvelopeEncryption.generateDek();
  const dekLocked = EnvelopeEncryption.generateDek();
  
  const wrappedDekOpen = await kms.wrapKey(dekOpen);
  const wrappedDekLocked = await kms.wrapKey(dekLocked);

  // 2. Clean DB (Delete in reverse dependency order)
  console.log('🧹 Cleaning existing data...');
  await db.delete(schema.links);
  await db.delete(schema.versions);
  await db.delete(schema.pages);
  await db.delete(schema.shares);
  await db.delete(schema.vaults);

  // 3. Insert Vaults
  console.log('🏦 Inserting Vaults...');
  await db.insert(schema.vaults).values([
    {
      id: VAULT_OPEN_ENG,
      name: 'Engineering Context Hub',
      mode: 'open',
      owner_id: 'usr_admin',
      data_key_id: wrappedDekOpen,
      export_policy: 'allowed_for_owner'
    },
    {
      id: VAULT_LOCKED_AI,
      name: 'Claude System Prompts',
      mode: 'locked',
      owner_id: 'usr_admin',
      data_key_id: wrappedDekLocked,
      export_policy: 'strictly_forbidden'
    }
  ]);

  // 4. Insert Shares (Role assignments)
  console.log('🔐 Inserting Shares...');
  await db.insert(schema.shares).values([
    { vault_id: VAULT_OPEN_ENG, principal_id: 'usr_admin', role: 'editor', granted_by: 'system' }, // owner
    { vault_id: VAULT_OPEN_ENG, principal_id: 'sarah.lead@tkxel.com', role: 'editor', granted_by: 'usr_admin' },
    { vault_id: VAULT_OPEN_ENG, principal_id: 'engineering-team@tkxel.com', role: 'reader', granted_by: 'usr_admin' },
    { vault_id: VAULT_OPEN_ENG, principal_id: 'external.auditor@client.com', role: 'consumer', granted_by: 'usr_admin' },

    { vault_id: VAULT_LOCKED_AI, principal_id: 'usr_admin', role: 'editor', granted_by: 'system' },
    { vault_id: VAULT_LOCKED_AI, principal_id: 'sarah.lead@tkxel.com', role: 'editor', granted_by: 'usr_admin' },
    { vault_id: VAULT_LOCKED_AI, principal_id: 'engineering-team@tkxel.com', role: 'consumer', granted_by: 'usr_admin' }, // No readers in locked vault
  ]);

  // 5. Insert Pages
  console.log('📄 Inserting Pages...');
  await db.insert(schema.pages).values([
    {
      id: PAGE_ARCH,
      vault_id: VAULT_OPEN_ENG,
      type: 'decision',
      title: 'Architecture Overview',
      aliases: ['System Architecture'],
      tags: ['architecture', 'mcp', 'security'],
      front_matter: { title: 'Architecture Overview', type: 'decision' },
      current_version_id: VER_ARCH
    },
    {
      id: PAGE_SEC,
      vault_id: VAULT_OPEN_ENG,
      type: 'decision',
      title: 'Security Model',
      aliases: ['Zero Trust Model'],
      tags: ['security', 'crypto', 'zero-read'],
      front_matter: { title: 'Security Model', type: 'decision' },
      current_version_id: VER_SEC
    },
    {
      id: PAGE_DB,
      vault_id: VAULT_OPEN_ENG,
      type: 'decision',
      title: 'Database Schema',
      aliases: ['Storage Layer'],
      tags: ['postgres', 'pgvector', 'schema'],
      front_matter: { title: 'Database Schema', type: 'decision' },
      current_version_id: VER_DB
    },
    {
      id: PAGE_BOB,
      vault_id: VAULT_OPEN_ENG,
      type: 'person',
      title: 'Bob Vance',
      aliases: ['Bob'],
      tags: ['team', 'leadership'],
      front_matter: { title: 'Bob Vance', type: 'person' },
      current_version_id: VER_BOB
    }
  ]);

  // 6. Insert Versions (With real envelope encryption)
  console.log('🔒 Encrypting and inserting Versions...');
  const encryptBody = (text: string, dek: Buffer) => EnvelopeEncryption.encrypt(text, dek);

  await db.insert(schema.versions).values([
    {
      id: VER_ARCH,
      page_id: PAGE_ARCH,
      number: 1,
      status: 'published',
      encrypted_blob: encryptBody(`# Architecture Overview\n\nWelcome to the tkxel Vault context hub.\n\nThis system implements zero-read locked vaults and open markdown knowledge graphs. See [[Security Model]] and [[Database Schema]] for deep-dive technical specs.\n\nKey contributor: [[Bob Vance]].`, dekOpen),
      created_by: 'usr_admin',
    },
    {
      id: VER_SEC,
      page_id: PAGE_SEC,
      number: 1,
      status: 'published',
      encrypted_blob: encryptBody(`# Security Model\n\nAll content is envelope encrypted via AES-256-GCM. Locked skills run strictly in-memory without persistent disk cache. Backlinked to [[Architecture Overview]].`, dekOpen),
      created_by: 'usr_admin',
    },
    {
      id: VER_DB,
      page_id: PAGE_DB,
      number: 1,
      status: 'published',
      encrypted_blob: encryptBody(`# Database Schema\n\nPostgreSQL 16 with pgvector and Row-Level Security. Connected to [[Architecture Overview]].`, dekOpen),
      created_by: 'usr_admin',
    },
    {
      id: VER_BOB,
      page_id: PAGE_BOB,
      number: 1,
      status: 'published',
      encrypted_blob: encryptBody(`# Bob Vance\n\nLead Systems Architect. Works on [[Architecture Overview]].`, dekOpen),
      created_by: 'usr_admin',
    }
  ]);

  // 7. Insert Links
  console.log('🔗 Inserting Links...');
  await db.insert(schema.links).values([
    { from_page_id: PAGE_ARCH, to_page_id: PAGE_SEC, raw_target: 'Security Model' },
    { from_page_id: PAGE_ARCH, to_page_id: PAGE_DB, raw_target: 'Database Schema' },
    { from_page_id: PAGE_ARCH, to_page_id: PAGE_BOB, raw_target: 'Bob Vance' },
    { from_page_id: PAGE_SEC, to_page_id: PAGE_ARCH, raw_target: 'Architecture Overview' },
    { from_page_id: PAGE_DB, to_page_id: PAGE_ARCH, raw_target: 'Architecture Overview' },
    { from_page_id: PAGE_BOB, to_page_id: PAGE_ARCH, raw_target: 'Architecture Overview' },
  ]);

  console.log('✅ Seed completed successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
