import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { versions, pages, vaults } from '../schema/index.js';
import { MockKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';

export async function saveDraft(pageId: string, content: string, authorId: string) {
  // Check if there's already a draft
  const existingDrafts = await db.select()
    .from(versions)
    .where(and(eq(versions.page_id, pageId), eq(versions.status, 'draft')))
    .orderBy(desc(versions.number))
    .limit(1);
    
  const latestDraft = existingDrafts[0];
  
  // Find highest version number (published or draft)
  const allVersions = await db.select()
    .from(versions)
    .where(eq(versions.page_id, pageId))
    .orderBy(desc(versions.number))
    .limit(1);
    
  const nextNumber = allVersions.length > 0 ? allVersions[0].number + 1 : 1;

  // Get Vault DEK for encryption
  const pageRec = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!pageRec[0]) throw new Error('Page not found');
  const vaultRec = await db.select().from(vaults).where(eq(vaults.id, pageRec[0].vault_id)).limit(1);
  if (!vaultRec[0]) throw new Error('Vault not found');
  
  const kms = new MockKmsProvider();
  const dek = await kms.unwrapKey(vaultRec[0].data_key_id);
  const encryptedBlob = EnvelopeEncryption.encrypt(content, dek);

  if (latestDraft) {
    // Overwrite existing draft
    await db.update(versions)
      .set({ encrypted_blob: encryptedBlob, created_by: authorId, created_at: new Date() })
      .where(eq(versions.id, latestDraft.id));
    return latestDraft.id;
  } else {
    // Create new draft
    const inserted = await db.insert(versions).values({
      page_id: pageId,
      number: nextNumber,
      status: 'draft',
      encrypted_blob: encryptedBlob,
      created_by: authorId
    }).returning({ id: versions.id });
    return inserted[0].id;
  }
}

export async function publishVersion(pageId: string, authorId: string) {
  // Find latest draft
  const existingDrafts = await db.select()
    .from(versions)
    .where(and(eq(versions.page_id, pageId), eq(versions.status, 'draft')))
    .orderBy(desc(versions.number))
    .limit(1);

  if (existingDrafts.length === 0) {
    throw new Error('No draft to publish');
  }

  const draftId = existingDrafts[0].id;

  // Update status to published
  await db.update(versions)
    .set({ status: 'published', created_by: authorId, created_at: new Date() })
    .where(eq(versions.id, draftId));

  // Update page current_version_id
  await db.update(pages)
    .set({ current_version_id: draftId })
    .where(eq(pages.id, pageId));

  return draftId;
}
