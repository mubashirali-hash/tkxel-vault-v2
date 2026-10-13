import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import {
  createVault,
  movePage,
  LinkGraphIndexer,
  MockKmsProvider,
  EnvelopeEncryption,
  VaultValidationError,
  ContextAssembler,
  LocalDeterministicEmbeddingProvider,
  ensureLinkGraphInvariants,
  runMigrations,
} from '../dist/index.js';

test('Epic 6 Chunk 6.3: Cross-Vault Link Policy and Graph Integrity', async (t) => {
  const kms = new MockKmsProvider();
  const provider = new LocalDeterministicEmbeddingProvider();
  const createdVaultIds = [];

  const actorAlice = `alice_${Date.now()}@tkxel.com`;
  const actorBob = `bob_${Date.now()}@tkxel.com`;

  // Helper to create and seed a page with content and graph links
  async function seedPage({
    vaultId,
    title,
    aliases = [],
    content,
    authorId = actorAlice,
    dek,
    mode = 'open',
  }) {
    const pageId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    // 1. Insert page record
    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: 'note',
      title,
      aliases,
      current_version_id: versionId,
    });

    // 2. Insert published version
    const encBlob = EnvelopeEncryption.encrypt(content, dek);
    await db.insert(schema.versions).values({
      id: versionId,
      page_id: pageId,
      number: 1,
      status: 'published',
      encrypted_blob: encBlob,
      created_by: authorId,
    });

    // 3. Update links if open mode
    if (mode === 'open') {
      await LinkGraphIndexer.updateLinksForPage(vaultId, pageId, content);
    }

    return { pageId, versionId };
  }

  try {
    await runMigrations(db);

    // 1. Outbound links re-resolve to matching destination pages when moving between open vaults
    await t.test('1. Outbound links re-resolve to matching destination pages when moving between open vaults', async () => {
      const vSrc = await createVault({ name: 'Src Open 1', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 1', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      // Seed destination target page
      const { pageId: dstTargetId } = await seedPage({
        vaultId: vDst.id,
        title: 'Destination Target',
        content: '# Destination Target\nReady to receive links.',
        dek: dstDek,
      });

      // Seed moving page in source vault
      const movingContent = '# Moving Note\nReferences [[Destination Target]] and [[Nonexistent Note]].';
      const { pageId: movingPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Moving Note',
        content: movingContent,
        dek: srcDek,
      });

      // Move page from vSrc to vDst
      const moveRes = await movePage({
        pageId: movingPageId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(moveRes.success, true);

      // Verify outgoing links of movingPageId in vDst
      const outgoingLinks = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, movingPageId));

      assert.equal(outgoingLinks.length, 2);

      const resolvedLink = outgoingLinks.find((l) => l.raw_target === 'Destination Target');
      assert.ok(resolvedLink);
      assert.equal(resolvedLink.resolved, true);
      assert.equal(resolvedLink.to_page_id, dstTargetId);

      const ghostLink = outgoingLinks.find((l) => l.raw_target === 'Nonexistent Note');
      assert.ok(ghostLink);
      assert.equal(ghostLink.resolved, false);
      assert.equal(ghostLink.to_page_id, null);
    });

    // 2. Outbound links become ghost links when target does not exist in destination vault
    await t.test('2. Outbound links become ghost links when target is absent in destination vault', async () => {
      const vSrc = await createVault({ name: 'Src Open 2', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 2', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      // Target note exists ONLY in source vault
      await seedPage({
        vaultId: vSrc.id,
        title: 'Source-Only Target',
        content: '# Source Only',
        dek: srcDek,
      });

      const { pageId: movingPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Moving Linker',
        content: 'Links to [[Source-Only Target]]',
        dek: srcDek,
      });

      // Before move, link is resolved in vSrc
      const beforeLinks = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, movingPageId));
      assert.equal(beforeLinks[0].resolved, true);

      // Move to vDst where 'Source-Only Target' does NOT exist
      await movePage({
        pageId: movingPageId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // After move, link becomes ghost link in vDst
      const afterLinks = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, movingPageId));
      assert.equal(afterLinks.length, 1);
      assert.equal(afterLinks[0].resolved, false);
      assert.equal(afterLinks[0].to_page_id, null);
      assert.equal(afterLinks[0].raw_target, 'Source-Only Target');
    });

    // 3. Inbound source links convert to ghost links when target page is moved out (no alternative page)
    await t.test('3. Inbound source links convert to ghost links when target page moves out', async () => {
      const vSrc = await createVault({ name: 'Src Open 3', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 3', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const { pageId: targetPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Target In Source',
        content: '# Target',
        dek: srcDek,
      });

      const { pageId: callerPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Caller Note',
        content: 'Check out [[Target In Source]]',
        dek: srcDek,
      });

      // Assert link is resolved before move
      const [linkBefore] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, callerPageId));
      assert.equal(linkBefore.resolved, true);
      assert.equal(linkBefore.to_page_id, targetPageId);

      // Move targetPageId to vDst
      await movePage({
        pageId: targetPageId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // Caller link in vSrc must now be a ghost link (no alternative page in vSrc)
      const [linkAfter] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, callerPageId));
      assert.equal(linkAfter.resolved, false);
      assert.equal(linkAfter.to_page_id, null);
      assert.equal(linkAfter.raw_target, 'Target In Source');
    });

    // 4. Inbound source links re-resolve to an alternative source page if another page with same title/alias exists in source vault
    await t.test('4. Inbound source links re-resolve to alternative source page matching title/alias', async () => {
      const vSrc = await createVault({ name: 'Src Open 4', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 4', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      // Page A: Moving note titled "Architecture Spec"
      const { pageId: pageAId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Architecture Spec',
        content: '# Arch Spec Original',
        dek: srcDek,
      });

      // Caller note pointing to [[Architecture Spec]] - initially resolves to Page A
      const { pageId: callerId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Caller Note 4',
        content: 'Read [[Architecture Spec]]',
        dek: srcDek,
      });

      // Page B: Another note in source with alias "Architecture Spec"
      const { pageId: pageBId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Next Gen Architecture',
        aliases: ['Architecture Spec'],
        content: '# Next Gen',
        dek: srcDek,
      });

      // Move Page A to vDst
      await movePage({
        pageId: pageAId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // Caller link in vSrc should re-point to Page B
      const [callerLink] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, callerId));
      assert.equal(callerLink.resolved, true);
      assert.equal(callerLink.to_page_id, pageBId);
    });

    // 5. Unresolved destination links pointing to moved page's title/alias become resolved upon page arrival
    await t.test('5. Unresolved destination ghost links become resolved when matching page arrives', async () => {
      const vSrc = await createVault({ name: 'Src Open 5', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 5', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      // In destination vault: Note referencing [[Arriving Note]] (unresolved ghost link)
      const { pageId: dstCallerId } = await seedPage({
        vaultId: vDst.id,
        title: 'Existing Dst Caller',
        content: 'Waiting for [[Arriving Note]] to arrive.',
        dek: dstDek,
      });

      const [dstLinkBefore] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, dstCallerId));
      assert.equal(dstLinkBefore.resolved, false);
      assert.equal(dstLinkBefore.to_page_id, null);

      // Create Arriving Note in source vault and move it to destination
      const { pageId: arrivingId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Arriving Note',
        content: '# Arriving Note Body',
        dek: srcDek,
      });

      await movePage({
        pageId: arrivingId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // Existing ghost link in destination must now be resolved to arrivingId!
      const [dstLinkAfter] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, dstCallerId));
      assert.equal(dstLinkAfter.resolved, true);
      assert.equal(dstLinkAfter.to_page_id, arrivingId);
    });

    // 6. Moving to a locked vault purges all outgoing links and search index rows (zero metadata disclosure)
    await t.test('6. Moving to a locked vault purges outgoing links and search chunks', async () => {
      const vSrc = await createVault({ name: 'Src Open 6', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vLocked = await createVault({
        name: 'Dst Locked 6',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
        exportPolicy: 'strictly_forbidden',
      });
      createdVaultIds.push(vLocked.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const { pageId: movingPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Confidential Recipe',
        content: '# Secret Recipe\nReferences [[Ingredient One]] and [[Technique]].',
        dek: srcDek,
      });

      // Verify outgoing links and chunks exist in open source
      const linksBefore = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, movingPageId));
      assert.ok(linksBefore.length > 0);

      // Move to locked vault
      await movePage({
        pageId: movingPageId,
        destinationVaultId: vLocked.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // Zero-read invariant: Zero outgoing links in links table!
      const linksAfter = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, movingPageId));
      assert.equal(linksAfter.length, 0);

      // Zero-read invariant: Zero chunks in chunks table!
      const chunksAfter = await db
        .select()
        .from(schema.chunks)
        .where(eq(schema.chunks.page_id, movingPageId));
      assert.equal(chunksAfter.length, 0);
    });

    // 7. Moving to a locked vault converts inbound source links to ghost links
    await t.test('7. Moving to a locked vault converts inbound source links to ghost links', async () => {
      const vSrc = await createVault({ name: 'Src Open 7', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vLocked = await createVault({
        name: 'Dst Locked 7',
        mode: 'locked',
        ownerId: actorAlice,
        kms,
        exportPolicy: 'strictly_forbidden',
      });
      createdVaultIds.push(vLocked.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const { pageId: secretPageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Secret Blueprint',
        content: '# Secret Blueprint',
        dek: srcDek,
      });

      const { pageId: openCallerId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Public Roadmap',
        content: 'Mentions [[Secret Blueprint]]',
        dek: srcDek,
      });

      // Move secret blueprint into locked vault
      await movePage({
        pageId: secretPageId,
        destinationVaultId: vLocked.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      // Inbound link in open vault becomes ghost link (zero disclosure of destination)
      const [linkAfter] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.from_page_id, openCallerId));
      assert.equal(linkAfter.resolved, false);
      assert.equal(linkAfter.to_page_id, null);
    });

    // 8. Cross-vault link query never returns cross-vault links or ghost links as connected edges
    await t.test('8. Link graph queries strictly enforce vault boundary and resolved state', async () => {
      const vSrc = await createVault({ name: 'Src Open 8', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 8', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const { pageId: p1 } = await seedPage({ vaultId: vSrc.id, title: 'Page 1', content: '# P1', dek: srcDek });
      const { pageId: p2 } = await seedPage({ vaultId: vSrc.id, title: 'Page 2', content: 'Links [[Page 1]] and [[Unresolved Ghost]]', dek: srcDek });

      // Run defensive query pattern (same as GET /api/vaults/:vaultId/links)
      const fromPages = alias(schema.pages, 'from_pages');
      const toPages = alias(schema.pages, 'to_pages');
      const vSrcLinks = await db
        .select({
          from_page_id: schema.links.from_page_id,
          to_page_id: schema.links.to_page_id,
        })
        .from(schema.links)
        .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vSrc.id)))
        .innerJoin(toPages, and(eq(schema.links.to_page_id, toPages.id), eq(toPages.vault_id, vSrc.id)))
        .where(eq(schema.links.resolved, true));

      assert.equal(vSrcLinks.length, 1);
      assert.equal(vSrcLinks[0].from_page_id, p2);
      assert.equal(vSrcLinks[0].to_page_id, p1);

      // Querying vDst returns 0 links
      const vDstLinks = await db
        .select({
          from_page_id: schema.links.from_page_id,
          to_page_id: schema.links.to_page_id,
        })
        .from(schema.links)
        .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vDst.id)))
        .innerJoin(toPages, and(eq(schema.links.to_page_id, toPages.id), eq(toPages.vault_id, vDst.id)))
        .where(eq(schema.links.resolved, true));
      assert.equal(vDstLinks.length, 0);
    });

    // 9. Title collision in destination vault aborts move and rolls back
    await t.test('9. Title collision in destination vault aborts move and rolls back', async () => {
      const vSrc = await createVault({ name: 'Src Open 9', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 9', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      // Destination has page titled "Common Title"
      await seedPage({
        vaultId: vDst.id,
        title: 'Common Title',
        content: '# Dst Common',
        dek: dstDek,
      });

      // Source has page titled "Common Title"
      const { pageId: srcCollidingId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Common Title',
        content: '# Src Common',
        dek: srcDek,
      });

      // Attempt movePage: must throw VaultValidationError
      await assert.rejects(
        async () => {
          await movePage({
            pageId: srcCollidingId,
            destinationVaultId: vDst.id,
            actorId: actorAlice,
            kms,
            provider,
          });
        },
        (err) => {
          assert.ok(err instanceof VaultValidationError || err.name === 'VaultValidationError');
          assert.match(err.message, /collides with an existing page/);
          return true;
        }
      );

      // Verify page remains in source vault
      const [pageAfter] = await db.select().from(schema.pages).where(eq(schema.pages.id, srcCollidingId));
      assert.equal(pageAfter.vault_id, vSrc.id);
    });

    // 10. Alias collision in destination vault aborts move and rolls back
    await t.test('10. Alias collision in destination vault aborts move and rolls back', async () => {
      const vSrc = await createVault({ name: 'Src Open 10', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 10', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      // Destination has page with alias "sec-guide"
      await seedPage({
        vaultId: vDst.id,
        title: 'Security Whitepaper',
        aliases: ['sec-guide'],
        content: '# Security',
        dek: dstDek,
      });

      // Source has page with alias "sec-guide"
      const { pageId: srcAliasCollidingId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Internal Guidelines',
        aliases: ['sec-guide'],
        content: '# Guidelines',
        dek: srcDek,
      });

      // Attempt movePage: must throw VaultValidationError
      await assert.rejects(
        async () => {
          await movePage({
            pageId: srcAliasCollidingId,
            destinationVaultId: vDst.id,
            actorId: actorAlice,
            kms,
            provider,
          });
        },
        (err) => {
          assert.ok(err instanceof VaultValidationError || err.name === 'VaultValidationError');
          assert.match(err.message, /collides with an existing page/);
          return true;
        }
      );

      // Verify page remains in source vault
      const [pageAfter] = await db.select().from(schema.pages).where(eq(schema.pages.id, srcAliasCollidingId));
      assert.equal(pageAfter.vault_id, vSrc.id);
    });

    // 11. Transactional rollback test: injected failure during link reconciliation rolls back all mutations
    await t.test('11. Injected failure during link reconciliation rolls back all mutations', async () => {
      const vSrc = await createVault({ name: 'Src Open 11', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 11', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      const originalPlaintext = '# Critical Plan\nLinks to [[Dest 11]]';
      const { pageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Critical Plan',
        content: originalPlaintext,
        dek: srcDek,
      });

      // Target note in destination
      await seedPage({
        vaultId: vDst.id,
        title: 'Dest 11',
        content: '# Dest 11',
        dek: dstDek,
      });

      // Proxy db to inject error when inserting into links table during link reconciliation
      const proxyDb = {
        transaction: async (cb) => {
          return await db.transaction(async (realTx) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'insert') {
                  return (table) => {
                    if (table === schema.links) {
                      throw new Error('Injected database fault during link reconciliation in transaction');
                    }
                    return target.insert(table);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return await cb(proxyTx);
          });
        },
      };

      await assert.rejects(
        async () => {
          await movePage({
            pageId,
            destinationVaultId: vDst.id,
            actorId: actorAlice,
            kms,
            provider,
            db: proxyDb,
          });
        },
        /Injected database fault during link reconciliation/
      );

      // 1. Page remains in source vault
      const [pageAfter] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(pageAfter.vault_id, vSrc.id);

      // 2. Version ciphertext was NOT committed with destDek; decryptable with srcDek
      const [versionRow] = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      assert.throws(() => EnvelopeEncryption.decryptToString(versionRow.encrypted_blob, dstDek));
      const decrypted = EnvelopeEncryption.decryptToString(versionRow.encrypted_blob, srcDek);
      assert.equal(decrypted, originalPlaintext);
    });

    // 12. Markdown content round-trip: raw Markdown content is preserved byte-for-byte
    await t.test('12. Markdown content round-trip: raw Markdown content is preserved byte-for-byte', async () => {
      const vSrc = await createVault({ name: 'Src Open 12', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 12', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      const complexMarkdown = `---
title: Advanced Specification
tags: [security, crypto, zero-trust]
---

# Section 1: Invariants
We reference [[Nonexistent Page]] and [[Another Note|Custom Alias]].
- Special syntax: $E=mc^2$
- Code block:
\`\`\`typescript
const x: number = 42;
\`\`\`
Ending note with wiki link: [[Final Note]].
`;

      const { pageId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Advanced Specification',
        content: complexMarkdown,
        dek: srcDek,
      });

      await movePage({
        pageId,
        destinationVaultId: vDst.id,
        actorId: actorAlice,
        kms,
        provider,
      });

      const [pageAfter] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
      assert.equal(pageAfter.vault_id, vDst.id);

      const [versionAfter] = await db.select().from(schema.versions).where(eq(schema.versions.page_id, pageId));
      const decrypted = EnvelopeEncryption.decryptToString(versionAfter.encrypted_blob, dstDek);
      assert.equal(decrypted, complexMarkdown, 'Markdown content must remain 100% byte-for-byte identical');
    });

    // 13. ContextAssembler strictly respects vault boundary and returns zero cross-vault links
    await t.test('13. ContextAssembler expands links strictly within the specified vault', async () => {
      const vSrc = await createVault({ name: 'Src Open 13', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Open 13', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);

      const { pageId: focalId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Focal Note 13',
        content: '# Focal Note\nDiscussing architecture.',
        dek: srcDek,
      });

      const { pageId: neighborId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Neighbor Note 13',
        content: '# Neighbor Note\nConnected to [[Focal Note 13]].',
        dek: srcDek,
      });

      const assembler = new ContextAssembler();
      const bundle = await assembler.getContext(vSrc.id, focalId);
      assert.ok(bundle.assembledMarkdown.includes('Focal Note 13'));

      // If we attempt to getContext using vDst.id for focalId (which is in vSrc), it must throw 'Page not found'
      await assert.rejects(
        async () => {
          await assembler.getContext(vDst.id, focalId);
        },
        /Page not found/
      );
    });

    // 14. Authoritative-vault enforcement in LinkGraphIndexer public methods
    await t.test('14. Authoritative-vault enforcement in LinkGraphIndexer public methods', async () => {
      const vOpen1 = await createVault({ name: 'Open 14-1', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vOpen1.id);
      const vOpen2 = await createVault({ name: 'Open 14-2', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vOpen2.id);
      const vLocked = await createVault({ name: 'Locked 14', mode: 'locked', ownerId: actorAlice, kms });
      createdVaultIds.push(vLocked.id);

      const [v1Row] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vOpen1.id));
      const v1Dek = await kms.unwrapKey(v1Row.data_key_id);

      const { pageId: p1Id } = await seedPage({
        vaultId: vOpen1.id,
        title: 'Authoritative P1',
        content: '# P1\nInitial content without links.',
        dek: v1Dek,
      });

      // Count initial links for p1Id
      const initialLinks = await db.select().from(schema.links).where(eq(schema.links.from_page_id, p1Id));
      assert.equal(initialLinks.length, 0);

      // A. updateLinksForPage with mismatched expected vault ID fails closed
      await assert.rejects(
        async () => {
          await LinkGraphIndexer.updateLinksForPage(vOpen2.id, p1Id, '# P1\nLinking to [[Nonexistent Target]].');
        },
        /not_found/
      );
      const linksAfterMismatch = await db.select().from(schema.links).where(eq(schema.links.from_page_id, p1Id));
      assert.equal(linksAfterMismatch.length, 0, 'Mismatched vault ID must perform zero mutations');

      // B. updateLinksForPage with locked-vault ID paired with a foreign page ID fails closed
      await assert.rejects(
        async () => {
          await LinkGraphIndexer.updateLinksForPage(vLocked.id, p1Id, '# P1\nLinking to [[Nonexistent Target]].');
        },
        /not_found/
      );
      const linksAfterLockedMismatch = await db.select().from(schema.links).where(eq(schema.links.from_page_id, p1Id));
      assert.equal(linksAfterLockedMismatch.length, 0, 'Locked vault with foreign page must perform zero mutations');

      // C. resolveIncomingGhostLinks with mismatched vault fails closed
      await assert.rejects(
        async () => {
          await LinkGraphIndexer.resolveIncomingGhostLinks(vOpen2.id, p1Id, 'Authoritative P1', []);
        },
        /not_found/
      );

      // D. resolveIncomingGhostLinks derives metadata from PostgreSQL and never resolves foreign links
      // Seed a ghost link in vOpen2 that happens to reference "Authoritative P1"
      const [v2Row] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vOpen2.id));
      const v2Dek = await kms.unwrapKey(v2Row.data_key_id);
      const { pageId: p2Id } = await seedPage({
        vaultId: vOpen2.id,
        title: 'Foreign Page in V2',
        content: '# Foreign Page\nReferences [[Authoritative P1]].',
        dek: v2Dek,
      });

      // Verify the link in vOpen2 is currently an unresolved ghost link
      const [ghostInV2] = await db.select().from(schema.links).where(eq(schema.links.from_page_id, p2Id));
      assert.ok(ghostInV2);
      assert.equal(ghostInV2.resolved, false);
      assert.equal(ghostInV2.to_page_id, null);

      // Call resolveIncomingGhostLinks for p1Id (which belongs to vOpen1)
      await LinkGraphIndexer.resolveIncomingGhostLinks(vOpen1.id, p1Id);

      // Verify the ghost link in vOpen2 was NOT resolved to p1Id
      const [ghostInV2After] = await db.select().from(schema.links).where(eq(schema.links.from_page_id, p2Id));
      assert.equal(ghostInV2After.resolved, false);
      assert.equal(ghostInV2After.to_page_id, null, 'Foreign page in vOpen1 must NEVER resolve ghost link in vOpen2');
    });

    // 15. Structural database enforcement rejects invalid writes via deferred constraint triggers
    await t.test('15. Structural database enforcement rejects invalid writes via deferred constraint triggers', async () => {
      const vA = await createVault({ name: 'Direct SQL Vault A', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vA.id);
      const vB = await createVault({ name: 'Direct SQL Vault B', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vB.id);
      const vLock = await createVault({ name: 'Direct SQL Vault Locked', mode: 'locked', ownerId: actorAlice, kms });
      createdVaultIds.push(vLock.id);

      const [vARow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vA.id));
      const [vBRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vB.id));
      const [vLockRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vLock.id));
      const aDek = await kms.unwrapKey(vARow.data_key_id);
      const bDek = await kms.unwrapKey(vBRow.data_key_id);
      const lockDek = await kms.unwrapKey(vLockRow.data_key_id);

      const { pageId: pA1 } = await seedPage({ vaultId: vA.id, title: 'Page A1', content: '# A1', dek: aDek });
      const { pageId: pA2 } = await seedPage({ vaultId: vA.id, title: 'Page A2', content: '# A2', dek: aDek });
      const { pageId: pB1 } = await seedPage({ vaultId: vB.id, title: 'Page B1', content: '# B1', dek: bDek });
      const { pageId: pLock1 } = await seedPage({ vaultId: vLock.id, title: 'Page Lock1', content: '# Lock1', dek: lockDek, mode: 'locked' });

      // Helper to match error in either err.message or err.cause.message
      const errorMatches = (pattern) => (err) => {
        const fullMsg = `${err.message} ${err.cause?.message || ''}`;
        return pattern.test(fullMsg);
      };

      // A. Direct SQL insert: resolved = true when to_page_id is null rejected at commit
      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            await tx.insert(schema.links).values({
              from_page_id: pA1,
              to_page_id: null,
              raw_target: 'Target Null',
              link_type: 'wiki',
              resolved: true,
            });
          });
        },
        errorMatches(/Link invariant violation.*resolved link must have non-null to_page_id|links_resolved_has_target|check constraint/i)
      );

      // A2. Direct SQL insert: resolved = false when to_page_id is non-null rejected by check constraint
      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            await tx.insert(schema.links).values({
              from_page_id: pA1,
              to_page_id: pA2,
              raw_target: 'Target Non-Null Ghost',
              link_type: 'wiki',
              resolved: false,
            });
          });
        },
        errorMatches(/links_resolved_has_target|check constraint/i)
      );

      // B. Direct SQL insert: cross-vault resolved link rejected at commit
      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            await tx.insert(schema.links).values({
              from_page_id: pA1,
              to_page_id: pB1,
              raw_target: 'Page B1',
              link_type: 'wiki',
              resolved: true,
            });
          });
        },
        errorMatches(/Link invariant violation.*resolved link endpoints belong to different vaults/)
      );

      // C. Direct SQL insert: link originating from locked vault rejected at commit
      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            await tx.insert(schema.links).values({
              from_page_id: pLock1,
              to_page_id: null,
              raw_target: 'Target In Locked',
              link_type: 'wiki',
              resolved: false,
            });
          });
        },
        errorMatches(/Link invariant violation.*links originating from locked vaults are forbidden/)
      );

      // D. Direct SQL update: page-vault change leaving cross-vault resolved link rejected at commit
      // Create valid intra-vault link A1 -> A2
      const [validLink] = await db
        .insert(schema.links)
        .values({
          from_page_id: pA1,
          to_page_id: pA2,
          raw_target: 'Page A2',
          link_type: 'wiki',
          resolved: true,
        })
        .returning({ id: schema.links.id });

      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            // Update pA1 vault_id to vB without updating its links
            await tx.update(schema.pages).set({ vault_id: vB.id }).where(eq(schema.pages.id, pA1));
          });
        },
        errorMatches(/Page link invariant violation/)
      );

      // Clean up valid link before next test
      await db.delete(schema.links).where(eq(schema.links.id, validLink.id));

      // E. Direct SQL update: vault mode change to locked leaving links rejected at commit
      const [validLink2] = await db
        .insert(schema.links)
        .values({
          from_page_id: pA1,
          to_page_id: pA2,
          raw_target: 'Page A2',
          link_type: 'wiki',
          resolved: true,
        })
        .returning({ id: schema.links.id });

      await assert.rejects(
        async () => {
          await db.transaction(async (tx) => {
            await tx.update(schema.vaults).set({ mode: 'locked' }).where(eq(schema.vaults.id, vA.id));
          });
        },
        errorMatches(/Vault mode invariant violation.*locked vault cannot have outgoing links/)
      );

      await db.delete(schema.links).where(eq(schema.links.id, validLink2.id));

      // F. Target page deletion automatically converts resolved link to ghost link (resolved = false, to_page_id = null)
      const { pageId: pTempTarget } = await seedPage({ vaultId: vA.id, title: 'Temp Target', content: '# Temp', dek: aDek });
      const [ghostTestLink] = await db
        .insert(schema.links)
        .values({
          from_page_id: pA1,
          to_page_id: pTempTarget,
          raw_target: 'Temp Target',
          link_type: 'wiki',
          resolved: true,
        })
        .returning({ id: schema.links.id });

      // Delete target page - trigger trg_links_before_update intercepts ON DELETE SET NULL and sets resolved = false
      await db.delete(schema.pages).where(eq(schema.pages.id, pTempTarget));

      const [ghostAfterDelete] = await db
        .select()
        .from(schema.links)
        .where(eq(schema.links.id, ghostTestLink.id));

      assert.ok(ghostAfterDelete, 'Link must persist after target page deletion');
      assert.equal(ghostAfterDelete.resolved, false, 'Link must be converted to unresolved');
      assert.equal(ghostAfterDelete.to_page_id, null, 'to_page_id must be null');

      await db.delete(schema.links).where(eq(schema.links.id, ghostTestLink.id));
    });

    // 16. Title/alias collision preflight fails closed before DEK unwrap with zero mutations
    await t.test('16. Title/alias collision preflight fails closed before DEK unwrap with zero mutations', async () => {
      const vSrc = await createVault({ name: 'Src Collision Preflight', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vSrc.id);
      const vDst = await createVault({ name: 'Dst Collision Preflight', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vDst.id);

      const [srcRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vSrc.id));
      const [dstRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vDst.id));
      const srcDek = await kms.unwrapKey(srcRow.data_key_id);
      const dstDek = await kms.unwrapKey(dstRow.data_key_id);

      // Seed destination conflicting page
      const { pageId: dstConflictingId } = await seedPage({
        vaultId: vDst.id,
        title: 'Collision Conflict Note',
        content: '# Collision Conflict Note\nExisting page in destination.',
        dek: dstDek,
      });

      // Seed moving page in source with identical title
      const originalPlaintext = '# Collision Conflict Note\nMoving page in source.';
      const { pageId: movingPageId, versionId: origVersionId } = await seedPage({
        vaultId: vSrc.id,
        title: 'Collision Conflict Note',
        content: originalPlaintext,
        dek: srcDek,
      });

      // Capture database state before attempt
      const [pageBefore] = await db.select().from(schema.pages).where(eq(schema.pages.id, movingPageId));
      const [versionBefore] = await db.select().from(schema.versions).where(eq(schema.versions.id, origVersionId));
      const auditsBefore = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, movingPageId));

      // Attempt movePage: must reject with generic VaultValidationError without identifying conflicting destination page
      await assert.rejects(
        async () => {
          await movePage({
            pageId: movingPageId,
            destinationVaultId: vDst.id,
            actorId: actorAlice,
            kms,
            provider,
          });
        },
        (err) => {
          assert.ok(err instanceof VaultValidationError);
          assert.equal(err.message, 'Validation error: title or alias collides with an existing page in destination vault');
          assert.ok(!err.message.includes(dstConflictingId), 'Must not disclose destination page ID');
          return true;
        }
      );

      // Verify ZERO mutations across all tables
      const [pageAfter] = await db.select().from(schema.pages).where(eq(schema.pages.id, movingPageId));
      assert.equal(pageAfter.vault_id, vSrc.id, 'Page must remain in source vault');
      assert.equal(pageAfter.updated_at.getTime(), pageBefore.updated_at.getTime(), 'Page updated_at must be unchanged');

      const [versionAfter] = await db.select().from(schema.versions).where(eq(schema.versions.id, origVersionId));
      assert.deepEqual(versionAfter.encrypted_blob, versionBefore.encrypted_blob, 'Ciphertext blob must be untouched');
      const decrypted = EnvelopeEncryption.decryptToString(versionAfter.encrypted_blob, srcDek);
      assert.equal(decrypted, originalPlaintext, 'Version must still be decryptable with source DEK');

      const auditsAfter = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.target_id, movingPageId));
      assert.equal(auditsAfter.length, auditsBefore.length, 'Zero audit events emitted on collision rejection');
    });

    // 17. Locked-to-open movement rebuilding outgoing links from decrypted in-memory Markdown
    await t.test('17. Locked-to-open movement rebuilding outgoing links from decrypted in-memory Markdown', async () => {
      const vLock = await createVault({ name: 'Locked Source 17', mode: 'locked', ownerId: actorAlice, kms });
      createdVaultIds.push(vLock.id);
      const vOpen = await createVault({ name: 'Open Destination 17', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vOpen.id);

      const [lockRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vLock.id));
      const [openRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vOpen.id));
      const lockDek = await kms.unwrapKey(lockRow.data_key_id);
      const openDek = await kms.unwrapKey(openRow.data_key_id);

      // Seed destination open target note
      const { pageId: openTargetId } = await seedPage({
        vaultId: vOpen.id,
        title: 'Open Destination Target 17',
        content: '# Open Destination Target 17\nReady to receive link.',
        dek: openDek,
      });

      // Seed locked note in vLock referencing Open Destination Target 17
      const lockedPlaintext = '# Secret Skill Document\nReferences [[Open Destination Target 17]].';
      const { pageId: lockedPageId } = await seedPage({
        vaultId: vLock.id,
        title: 'Secret Skill Document',
        content: lockedPlaintext,
        dek: lockDek,
        mode: 'locked',
      });

      // In locked vault, zero outgoing links exist
      const initialLockedLinks = await db.select().from(schema.links).where(eq(schema.links.from_page_id, lockedPageId));
      assert.equal(initialLockedLinks.length, 0, 'Locked vault must have zero outgoing links');

      // Move page from locked to open vault
      const moveRes = await movePage({
        pageId: lockedPageId,
        destinationVaultId: vOpen.id,
        actorId: actorAlice,
        kms,
        provider,
      });
      assert.equal(moveRes.success, true);

      // In open destination, outgoing link was reconstructed from decrypted in-memory markdown!
      const linksAfterMove = await db.select().from(schema.links).where(eq(schema.links.from_page_id, lockedPageId));
      assert.equal(linksAfterMove.length, 1, 'Outgoing link must be reconstructed in open destination');
      assert.equal(linksAfterMove[0].to_page_id, openTargetId);
      assert.equal(linksAfterMove[0].resolved, true);

      // Verify version is now decryptable with openDek
      const [versionRow] = await db.select().from(schema.versions).where(eq(schema.versions.page_id, lockedPageId));
      const decrypted = EnvelopeEncryption.decryptToString(versionRow.encrypted_blob, openDek);
      assert.equal(decrypted, lockedPlaintext);
    });

    // 18. Unknown and mismatched vault and page IDs causing zero mutation
    await t.test('18. Unknown and mismatched vault and page IDs causing zero mutation', async () => {
      const vReal = await createVault({ name: 'Real Vault 18', mode: 'open', ownerId: actorAlice, kms });
      createdVaultIds.push(vReal.id);

      const fakePageId = crypto.randomUUID();
      const fakeVaultId = crypto.randomUUID();

      // Unknown page ID on move
      await assert.rejects(
        async () => {
          await movePage({
            pageId: fakePageId,
            destinationVaultId: vReal.id,
            actorId: actorAlice,
            kms,
            provider,
          });
        },
        /not_found/
      );

      // Unknown destination vault ID on move
      const [realRow] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vReal.id));
      const realDek = await kms.unwrapKey(realRow.data_key_id);
      const { pageId: realPageId } = await seedPage({
        vaultId: vReal.id,
        title: 'Real Note 18',
        content: '# Real Note',
        dek: realDek,
      });

      await assert.rejects(
        async () => {
          await movePage({
            pageId: realPageId,
            destinationVaultId: fakeVaultId,
            actorId: actorAlice,
            kms,
            provider,
          });
        },
        /not_found/
      );

      // Unknown page ID on updateLinksForPage
      await assert.rejects(
        async () => {
          await LinkGraphIndexer.updateLinksForPage(vReal.id, fakePageId, '# Fake Content');
        },
        /not_found/
      );
    });

    // 19. Final SQL assertion showing zero invalid resolved edges and zero locked-vault outgoing links
    await t.test('19. Final SQL assertion: zero invalid resolved edges and zero locked-vault outgoing links in DB', async () => {
      // Cross-vault resolved links
      const crossVaultRes = await db.execute(sql`
        SELECT l.id, p1.vault_id as from_vault, p2.vault_id as to_vault
        FROM ${schema.links} l
        JOIN ${schema.pages} p1 ON l.from_page_id = p1.id
        JOIN ${schema.pages} p2 ON l.to_page_id = p2.id
        WHERE l.resolved = true AND p1.vault_id != p2.vault_id
      `);
      assert.equal(crossVaultRes.rows.length, 0, 'Database must have 0 cross-vault resolved links');

      // Resolved links with null to_page_id
      const nullTargetRes = await db.execute(sql`
        SELECT id FROM ${schema.links}
        WHERE resolved = true AND to_page_id IS NULL
      `);
      assert.equal(nullTargetRes.rows.length, 0, 'Database must have 0 resolved links with null to_page_id');

      // Outgoing links originating from locked vaults
      const lockedLinksRes = await db.execute(sql`
        SELECT l.id FROM ${schema.links} l
        JOIN ${schema.pages} p ON l.from_page_id = p.id
        JOIN ${schema.vaults} v ON p.vault_id = v.id
        WHERE v.mode = 'locked'
      `);
      assert.equal(lockedLinksRes.rows.length, 0, 'Database must have 0 links originating from locked vaults');
    });
  } finally {
    if (createdVaultIds.length > 0) {
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, createdVaultIds));
    }
  }
});

