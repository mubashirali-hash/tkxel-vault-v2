import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, pool } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { searchPages } from '../dist/search/index.js';
import { runMigrations } from '../dist/schema/migrator.js';

/**
 * The indexed keyword query (migration 0010) must never change what keyword search returns.
 * Every query here is run twice, through the indexed query and through the reference scan, and the
 * two results must be identical: same pages, same order, same scores.
 */
test('Keyword search returns identical results through the index and through the reference scan', async () => {
  await runMigrations(db);

  const vaultId = crypto.randomUUID();
  const otherVaultId = crypto.randomUUID();
  const owner = 'search.equivalence@test.com';

  const docs = [
    { title: 'Payment Architecture Reference', tags: ['fintech', 'architecture'], chunks: ['Event driven clearing platform deployed on AWS.', 'Idempotent settlement with ledger reconciliation.'] },
    { title: 'Acme Corp', tags: ['client', 'enterprise'], chunks: ['Kickoff call held; commercial proposal sent to the buyer.'] },
    { title: 'Planning Notes', tags: ['q3-planning', 'meetings'], chunks: ['Roadmap priorities for the payment team and hiring plan.'] },
    { title: 'Zero-Trust Networking', tags: ['security'], chunks: ['Mutual TLS and ephemeral credentials for every service call.'] },
    { title: 'Encryption at Rest', tags: ['security', 'kms'], chunks: ['Envelope encryption with AES and a cloud KMS master key.', 'Key rotation happens annually.'] },
    { title: 'Untitled Draft', tags: [], chunks: [] }, // a page with no chunks at all
    { title: 'Running the Runners', tags: ['runner'], chunks: ['The runners ran quickly while running sandboxed helpers.'] },
    { title: "O'Brien's Review", tags: ["o'brien"], chunks: ["Notes from O'Brien about the architecture review."] },
    { title: 'Architecture', tags: ['payment'], chunks: ['A short page.'] },
  ];
  // Filler so that most of the vault does not match most queries
  for (let i = 0; i < 60; i++) {
    docs.push({ title: `Filler Topic ${i}`, tags: [`misc${i % 5}`], chunks: [`Unrelated filler content number ${i} about gardening and weather.`] });
  }

  const queries = [
    'payment',                       // title, tag and chunk hits on different pages
    'architecture',                  // title vs tag vs chunk
    'payment architecture',          // AND: words may sit in different fields of the same row
    'architecture payment team',     // AND across title/tag/chunk
    '"commercial proposal"',         // phrase
    '"proposal commercial"',         // phrase in the wrong order: no match
    'kms or roadmap',                // OR
    'security -kms',                 // negation with a positive term
    '-payment',                      // pure negation: not indexable, must fall back
    'the and of',                    // stop words only: falls back to the substring path
    'running',                       // stemming (run / runner / running)
    'q3-planning',                   // hyphenated tag
    'zero-trust',                    // hyphenated title
    "o'brien",                       // apostrophe
    'enterprise',                    // tag only
    'Untitled',                      // title only, page without chunks
    'gardening',                     // matches many filler pages (exercises LIMIT and ordering)
    'filler topic 7',
    'nonexistentterm',
    'Acme',
    'AES',
  ];

  try {
    for (const [id, name] of [[vaultId, 'Equivalence Vault'], [otherVaultId, 'Equivalence Other Vault']]) {
      await db.insert(schema.vaults).values({ id, name, mode: 'open', owner_id: owner, data_key_id: 'k', export_policy: 'allowed_for_owner' });
    }
    // The same content also exists in another vault and must never surface
    for (const targetVault of [vaultId, otherVaultId]) {
      for (const doc of docs) {
        const pageId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        await db.insert(schema.pages).values({
          id: pageId, vault_id: targetVault, type: 'note', title: doc.title, tags: doc.tags, aliases: [], front_matter: {}, current_version_id: versionId,
        });
        await db.insert(schema.versions).values({ id: versionId, page_id: pageId, number: 1, status: 'published', encrypted_blob: Buffer.from('x'), created_by: owner });
        for (const [position, text] of doc.chunks.entries()) {
          await db.insert(schema.chunks).values({
            page_id: pageId, version_id: versionId, position, encrypted_text: Buffer.from('x'), tsv_content: sql`to_tsvector('english', ${text})`, embedding: null,
          });
        }
      }
    }

    const vaultPageIds = new Set((await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.vault_id, vaultId))).map((p) => p.id));
    let nonEmpty = 0;

    for (const query of queries) {
      for (const extra of [{}, { types: ['note'], tags: ['security'] }, { publishedOnly: true }]) {
        const indexed = await searchPages(vaultId, query, 10, { mode: 'lexical', legacyScan: false, ...extra });
        const scanned = await searchPages(vaultId, query, 10, { mode: 'lexical', legacyScan: true, ...extra });
        assert.deepEqual(indexed, scanned, `results differ for query "${query}" with options ${JSON.stringify(extra)}`);
        assert.ok(indexed.every((r) => vaultPageIds.has(r.id)), `query "${query}" returned a page from another vault`);
        if (indexed.length > 0) nonEmpty++;
      }
    }

    // Guard against a vacuous pass: the sample must actually exercise matches and the known hard cases
    assert.ok(nonEmpty >= 30, `only ${nonEmpty} query/option combinations returned results`);
    assert.ok((await searchPages(vaultId, 'payment architecture', 10, { mode: 'lexical', legacyScan: false })).length >= 2);
    assert.ok((await searchPages(vaultId, '-payment', 10, { mode: 'lexical', legacyScan: false })).length > 0, 'pure negation still works through the fallback');
    assert.equal((await searchPages(vaultId, '"proposal commercial"', 10, { mode: 'lexical', legacyScan: false })).length, 0);
    assert.ok((await searchPages(vaultId, 'Untitled', 10, { mode: 'lexical', legacyScan: false })).some((r) => r.title === 'Untitled Draft'));

    // The stored search vector must follow a rename and a tag change (database trigger), for pages
    // with and without chunks
    const [withChunks] = await db.select().from(schema.pages).where(sql`${schema.pages.vault_id} = ${vaultId}::uuid AND ${schema.pages.title} = 'Acme Corp'`);
    const [withoutChunks] = await db.select().from(schema.pages).where(sql`${schema.pages.vault_id} = ${vaultId}::uuid AND ${schema.pages.title} = 'Untitled Draft'`);
    await db.update(schema.pages).set({ title: 'Globex Holdings', tags: ['partner', 'renewal'] }).where(eq(schema.pages.id, withChunks.id));
    await db.update(schema.pages).set({ title: 'Quarterly Zebra Report', tags: ['zebra'] }).where(eq(schema.pages.id, withoutChunks.id));
    for (const query of ['Globex', 'Acme', 'renewal', 'enterprise', 'zebra', 'Untitled', 'quarterly report', 'commercial proposal']) {
      const indexed = await searchPages(vaultId, query, 10, { mode: 'lexical', legacyScan: false });
      const scanned = await searchPages(vaultId, query, 10, { mode: 'lexical', legacyScan: true });
      assert.deepEqual(indexed, scanned, `results differ after rename for query "${query}"`);
    }
    const titles = async (query) => (await searchPages(vaultId, query, 10, { mode: 'lexical' })).map((r) => r.title);
    assert.deepEqual(await titles('Globex'), ['Globex Holdings']);
    assert.deepEqual(await titles('Acme'), [], 'the old title no longer matches');
    assert.deepEqual(await titles('zebra'), ['Quarterly Zebra Report']);
    assert.ok((await titles('commercial proposal')).includes('Globex Holdings'), 'chunk text still matches after the rename');
  } finally {
    await db.delete(schema.vaults).where(eq(schema.vaults.id, vaultId));
    await db.delete(schema.vaults).where(eq(schema.vaults.id, otherVaultId));
    await pool.end();
  }
});
