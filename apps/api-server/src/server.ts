// Auto-load .env file if available in Node 20.6+
if (typeof (process as any).loadEnvFile === 'function') {
  try {
    (process as any).loadEnvFile();
  } catch {}
}

import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { searchPages } from '@tkxel-vault/vault-core/search';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  authorizeVaultOperation,
  getConfiguredGlobalOwners,
  getUserRoleForVault,
  Role,
  VaultOperation,
} from '@tkxel-vault/vault-core/auth';
import { saveDraft, publishVersion, getPageContent } from '@tkxel-vault/vault-core/versions';
import { createKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core/crypto';
import { movePage, createVault, VaultValidationError, runMigrations } from '@tkxel-vault/vault-core';
import crypto from 'node:crypto';
import { aiRouter } from './routes/ai.js';
import { createServiceToken } from '@tkxel-vault/skill-runner';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidMap = new Map<string, string>();

function toValidUuid(id?: string): string {
  if (!id) return crypto.randomUUID();
  if (UUID_REGEX.test(id)) return id;
  if (uuidMap.has(id)) return uuidMap.get(id)!;
  const newUuid = crypto.randomUUID();
  uuidMap.set(id, newUuid);
  return newUuid;
}

const app: Express = express();
const port = process.env.PORT || 3002;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001'];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      (process.env.NODE_ENV !== 'production' && process.env.ALLOW_ALL_DEV_CORS === 'true')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', service: 'tkxel-vault-api-server', database: 'connected' });
  } catch (err: any) {
    res.status(503).json({ status: 'degraded', service: 'tkxel-vault-api-server', database: 'disconnected', error: err.message });
  }
});

import { OAuth2Client } from 'google-auth-library';
const oauthClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);


// Mock Auth for Local Development Testing
if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true') {
  app.post('/api/auth/mock', (_req: Request, res: Response) => {
    // Return a mock token that the middleware will explicitly trust in dev mode
    res.json({ idToken: 'dev_admin_token' });
  });
}
app.use(async (req: Request, res: Response, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
    return;
  }
  
  const token = authHeader.split(' ')[1];

  // Dev bypass: strictly forbidden in production and requires explicit dev opt-in flag
  const allowDevBypass = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true';
  if (token === 'dev_admin_token') {
    if (allowDevBypass) {
      (req as any).userId = process.env.VITE_VAULT_OWNER_EMAIL || process.env.VAULT_OWNER_EMAIL || 'mubashir.ali@camp1.tkxel.com';
      return next();
    }
    res.status(401).json({ error: 'Unauthorized: Dev auth bypass is disabled' });
    return;
  }

  if (token.startsWith('test_user:')) {
    if (allowDevBypass) {
      (req as any).userId = token.slice('test_user:'.length).trim();
      return next();
    }
    res.status(401).json({ error: 'Unauthorized: Dev auth bypass is disabled' });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (payload && payload.email) {
      // Check Domain Restrictions
      const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS;
      if (allowedDomainsStr) {
        const allowedDomains = allowedDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean);
        const domain = payload.email.split('@')[1];
        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
          res.status(403).json({ error: `Forbidden: Unauthorized domain @${domain}` });
          return;
        }
      }
      (req as any).userId = payload.email; // Use email as the real identity
    } else {
      res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
      return;
    }
  } catch (e) {
    console.error('Invalid Google Token', e);
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    return;
  }

  next();
});

// AI Plugin Routes (Protected by Authentication)
app.use('/api/ai', aiRouter);

// Helper middleware generator for AuthZ
export const requireRole = (allowedRoles: Role[], operation?: VaultOperation) => {
  return async (req: Request, res: Response, next: any): Promise<void> => {
    const userId = (req as any).userId;
    // Vault ID might be in query, body, or path params
    let vaultId = (req.query.vaultId as string) || req.body?.vault_id || req.body?.vaultId || req.params.vaultId;
    const isPageLookupWithoutVault = !vaultId && Boolean(req.params.id);

    // If not directly supplied, resolve from page ID if present
    if (isPageLookupWithoutVault) {
      try {
        const pageRes = await db.select({ vault_id: schema.pages.vault_id })
          .from(schema.pages)
          .where(eq(schema.pages.id, req.params.id))
          .limit(1);
        if (pageRes.length === 0) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        vaultId = pageRes[0].vault_id;
      } catch (err) {
        res.status(500).json({ error: 'Failed to resolve vault context' });
        return;
      }
    }

    if (!vaultId) {
      res.status(400).json({ error: 'Bad Request: Vault context is required for authorization' });
      return;
    }

    try {
      const authorization = operation
        ? await authorizeVaultOperation(userId, vaultId, operation)
        : null;
      const userRole = authorization?.role || (!operation ? await getUserRoleForVault(userId, vaultId) : null);
      if (!userRole || !allowedRoles.includes(userRole)) {
        if (isPageLookupWithoutVault) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.status(403).json({ error: 'not_allowed' });
        return;
      }
      (req as any).userRole = userRole;
      (req as any).vaultId = vaultId;
      next();
    } catch (e) {
      res.status(500).json({ error: 'AuthZ Check Failed' });
      return;
    }
  };
};

// GET /api/vaults: List all vaults accessible to the authenticated user
app.get('/api/vaults', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const normalizedUser = userId.toLowerCase().trim();
    const configuredOwners = getConfiguredGlobalOwners(process.env);
    const isGlobalOwner = configuredOwners.includes(normalizedUser);

    const allVaults = await db.select().from(schema.vaults);
    const activeShares = await db
      .select()
      .from(schema.shares)
      .where(
        and(
          sql`lower(${schema.shares.principal_id}) = ${normalizedUser}`,
          isNull(schema.shares.revoked_at)
        )
      );

    const accessibleVaults = allVaults
      .filter(
        (v) =>
          isGlobalOwner ||
          v.owner_id.toLowerCase().trim() === normalizedUser ||
          activeShares.some((s) => s.vault_id === v.id)
      )
      .map((v) => {
        let role = 'reader';
        if (isGlobalOwner || v.owner_id.toLowerCase().trim() === normalizedUser) {
          role = 'owner';
        } else {
          const share = activeShares.find((s) => s.vault_id === v.id);
          if (share) role = share.role;
        }
        return {
          id: v.id,
          name: v.name,
          mode: v.mode,
          owner_id: v.owner_id,
          data_key_id: v.data_key_id,
          export_policy: v.export_policy,
          role,
          created_at: v.created_at.toISOString(),
        };
      });

    res.json({ vaults: accessibleVaults });
  } catch (error) {
    console.error('Error listing vaults:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults: Create a new vault with unique KMS DEK in an atomic transaction
app.post('/api/vaults', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Request body must be a valid JSON object' });
      return;
    }

    const { name, mode = 'open', export_policy } = req.body;

    const vault = await createVault({
      name,
      mode,
      ownerId: userId,
      exportPolicy: export_policy,
    });

    res.status(201).json({
      success: true,
      vault: {
        id: vault.id,
        name: vault.name,
        mode: vault.mode,
        owner_id: vault.owner_id,
        export_policy: vault.export_policy,
        role: vault.role,
        created_at: vault.created_at.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Error creating vault:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/pages
app.get('/api/vaults/:vaultId/pages', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select().from(schema.pages).where(eq(schema.pages.vault_id, vaultId));
    });

    // Fetch Vault KMS DEK once to decrypt page contents
    const vaultRec = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
    let dek: Buffer | null = null;
    if (vaultRec.length > 0 && vaultRec[0].data_key_id) {
      try {
        const kms = createKmsProvider();
        dek = await kms.unwrapKey(vaultRec[0].data_key_id);
      } catch (err) {
        console.error('Failed to unwrap DEK for vault pages:', err);
      }
    }

    // Fetch versions for pages
    let pageVersions: any[] = [];
    if (result.length > 0) {
      const pageIds = result.map((p) => p.id);
      pageVersions = await db.select({
        id: schema.versions.id,
        page_id: schema.versions.page_id,
        encrypted_blob: schema.versions.encrypted_blob,
        status: schema.versions.status,
      }).from(schema.versions)
        .where(sql`${schema.versions.page_id} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`);
    }

    res.json({
      pages: result.map((p: any) => {
        const v = pageVersions.find((ver) => ver.page_id === p.id && ver.id === p.current_version_id)
               || pageVersions.find((ver) => ver.page_id === p.id && ver.status === 'published')
               || pageVersions.find((ver) => ver.page_id === p.id);
        let decryptedContent = '';
        if (v && v.encrypted_blob && dek) {
          try {
            decryptedContent = EnvelopeEncryption.decryptToString(v.encrypted_blob, dek);
          } catch {}
        }

        // Scrub body from front_matter
        const cleanFrontMatter = { ...(p.front_matter || {}) };
        delete (cleanFrontMatter as any).body;

        return {
          id: p.id,
          vault_id: p.vault_id,
          type: p.type,
          title: p.title,
          folder: (p.front_matter as any)?.folder || undefined,
          aliases: p.aliases,
          tags: p.tags,
          front_matter: cleanFrontMatter,
          content: decryptedContent,
          current_version_id: p.current_version_id,
          created_at: p.created_at.toISOString(),
          updated_at: p.updated_at.toISOString(),
        };
      })
    });
  } catch (error) {
    console.error('Error fetching vault pages:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/pages/:id: Fetch single page with decrypted content
app.get('/api/pages/:id', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;

    const pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx
        .select()
        .from(schema.pages)
        .where(and(eq(schema.pages.id, id), eq(schema.pages.vault_id, vaultId)))
        .limit(1);
    });

    if (!pageRec[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const page = pageRec[0];
    const pageContent = await getPageContent(page.id);
    const cleanFrontMatter = { ...(page.front_matter || {}) };
    delete (cleanFrontMatter as any).body;

    res.json({
      page: {
        id: page.id,
        vault_id: page.vault_id,
        type: page.type,
        title: page.title,
        aliases: page.aliases,
        tags: page.tags,
        front_matter: cleanFrontMatter,
        content: pageContent?.content || '',
        current_version_id: page.current_version_id,
        created_at: page.created_at.toISOString(),
        updated_at: page.updated_at.toISOString(),
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// POST /api/pages/:id/move: Move page to another vault with re-encryption
app.post('/api/pages/:id/move', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Request body must be a valid JSON object' });
      return;
    }
    const { destination_vault_id } = req.body;
    const userId = (req as any).userId;

    if (!destination_vault_id || typeof destination_vault_id !== 'string' || destination_vault_id.trim() === '') {
      res.status(400).json({ error: 'destination_vault_id is required' });
      return;
    }

    const result = await movePage({
      pageId: id,
      destinationVaultId: destination_vault_id.trim(),
      actorId: userId,
    });

    res.json(result);
  } catch (err: any) {
    if (err instanceof VaultValidationError || err.name === 'VaultValidationError' || err.message?.includes('Validation error')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.message?.includes('not_found') || err.message?.includes('Page not found')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (err.message?.includes('not_allowed') || err.message?.includes('Forbidden')) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    console.error('Error moving page:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/links
app.get('/api/vaults/:vaultId/links', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      // Since links don't have vault_id directly, join with pages on both endpoints strictly within vaultId
      const fromPages = alias(schema.pages, 'from_pages');
      const toPages = alias(schema.pages, 'to_pages');
      return await tx.select({
        from_page_id: schema.links.from_page_id,
        to_page_id: schema.links.to_page_id
      }).from(schema.links)
        .innerJoin(fromPages, and(eq(schema.links.from_page_id, fromPages.id), eq(fromPages.vault_id, vaultId)))
        .innerJoin(toPages, and(eq(schema.links.to_page_id, toPages.id), eq(toPages.vault_id, vaultId)))
        .where(eq(schema.links.resolved, true));
    });
    res.json({ links: result });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/skills
app.get('/api/vaults/:vaultId/skills', requireRole(['owner', 'editor', 'consumer'], 'list_locked_skills'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select().from(schema.skills).where(eq(schema.skills.vault_id, vaultId));
    });
    const userRole = (req as any).userRole;
    const canViewInstructions = userRole === 'owner' || userRole === 'editor';

    res.json({
      lockedSkills: result.map((sk: any) => ({
        id: sk.id,
        name: sk.name,
        version: (sk.tool_schema as any)?.version || 'v1.0',
        description: (sk.tool_schema as any)?.description || '',
        runtime: (sk.tool_schema as any)?.runtime || 'Python 3.12 Sandboxed',
        timeout_seconds: (sk.tool_schema as any)?.timeout_seconds || 30,
        system_instructions: canViewInstructions ? ((sk.tool_schema as any)?.system_instructions || '') : undefined,
        tool_schema: (sk.tool_schema as any)?.tool_schema || '',
        created_at: sk.created_at.toISOString(),
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/timeline
app.get('/api/vaults/:vaultId/timeline', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select({
        id: schema.timelineEntries.id,
        page_id: schema.timelineEntries.page_id,
        date: schema.timelineEntries.date,
        entry_text: schema.timelineEntries.entry_text,
        created_by: schema.timelineEntries.created_by,
        created_at: schema.timelineEntries.created_at
      }).from(schema.timelineEntries)
        .innerJoin(schema.pages, eq(schema.timelineEntries.page_id, schema.pages.id))
        .where(eq(schema.pages.vault_id, vaultId));
    });
    res.json({
      timelineEntries: result.map((t: any) => ({
        ...t, created_at: t.created_at.toISOString()
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/audits
app.get('/api/vaults/:vaultId/audits', requireRole(['owner', 'editor', 'reader']), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    // RLS doesn't fully apply to audits yet, we must scope manually based on vaultId and target_id
    // For simplicity in this chunk, we just filter where target_id = vaultId (which handles vault shares/exports)
    // Or we could fetch audits for pages within the vault. 
    // To match original behavior, we fetch recent audits and filter.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      
      const pageIds = (await tx.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.vault_id, vaultId))).map(p => p.id);
      const skillIds = (await tx.select({ id: schema.skills.id }).from(schema.skills).where(eq(schema.skills.vault_id, vaultId))).map(s => s.id);
      
      const audits = await tx.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.timestamp)).limit(100);
      
      return audits.filter(a => 
        a.target_id === vaultId || 
        pageIds.includes(a.target_id) || 
        skillIds.includes(a.target_id)
      );
    });
    
    // Additional AuthZ check: if consumer, maybe don't show all audits? The original checked 'role === owner'.
    // Let's preserve the original role check for audits
    const role = (req as any).userRole;
    const filteredAudits = result.filter(a => {
      if (role === 'owner') return true;
      return a.action !== 'share_vault' && a.action !== 'revoke_vault';
    });

    res.json({
      auditEvents: filteredAudits.map((a: any) => ({
        id: a.id, actor_id: a.actor_id, action: a.action, target_id: a.target_id,
        timestamp: a.timestamp.toISOString(), metadata: a.metadata,
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/shares: Get all active shares for a vault (Owner only)
app.get('/api/vaults/:vaultId/shares', requireRole(['owner']), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const activeShares = await db.select()
      .from(schema.shares)
      .where(and(eq(schema.shares.vault_id, vaultId), isNull(schema.shares.revoked_at)));

    res.json({
      shares: activeShares.map((s: any) => ({
        id: s.id,
        vault_id: s.vault_id,
        principal_id: s.principal_id,
        role: s.role,
        granted_by: s.granted_by,
        granted_at: s.granted_at.toISOString(),
      }))
    });
  } catch (error) {
    console.error('Error fetching vault shares:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/shares: Grant or update share access (Owner only)
app.post('/api/vaults/:vaultId/shares', requireRole(['owner']), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const { principal_id, role } = req.body;
    const userId = (req as any).userId || 'usr_admin';

    if (!principal_id || !role) {
      res.status(400).json({ error: 'principal_id and role are required' });
      return;
    }

    const normalizedPrincipal = principal_id.toLowerCase().trim();

    // Check if an existing active share already exists for this principal
    const existing = await db.select()
      .from(schema.shares)
      .where(and(
        eq(schema.shares.vault_id, vaultId),
        sql`lower(${schema.shares.principal_id}) = ${normalizedPrincipal}`,
        isNull(schema.shares.revoked_at)
      ));

    let shareRecord: any;
    if (existing.length > 0) {
      const [updated] = await db.update(schema.shares)
        .set({ role, granted_by: userId, granted_at: new Date() })
        .where(eq(schema.shares.id, existing[0].id))
        .returning();
      shareRecord = updated;
    } else {
      const [inserted] = await db.insert(schema.shares)
        .values({
          vault_id: vaultId,
          principal_id: normalizedPrincipal,
          role,
          granted_by: userId,
        })
        .returning();
      shareRecord = inserted;
    }

    // Append-only audit record (DEF-08 / Invariant 3)
    await db.insert(schema.auditEvents).values({
      actor_id: userId,
      action: 'share_vault',
      target_id: vaultId,
      metadata: { principal_id: normalizedPrincipal, role, share_id: shareRecord.id }
    });

    res.json({
      success: true,
      share: {
        id: shareRecord.id,
        vault_id: shareRecord.vault_id,
        principal_id: shareRecord.principal_id,
        role: shareRecord.role,
        granted_by: shareRecord.granted_by,
        granted_at: shareRecord.granted_at.toISOString(),
      }
    });
    return;
  } catch (error) {
    console.error('Error creating vault share:', error);
    res.status(500).json({ error: 'Internal Server Error' });
    return;
  }
});

// DELETE /api/vaults/:vaultId/shares/:shareId: Revoke share access (Owner only)
app.delete('/api/vaults/:vaultId/shares/:shareId', requireRole(['owner']), async (req: Request, res: Response) => {
  try {
    const { vaultId, shareId } = req.params;
    const userId = (req as any).userId || 'usr_admin';

    const [updated] = await db.update(schema.shares)
      .set({ revoked_at: new Date() })
      .where(and(eq(schema.shares.id, shareId), eq(schema.shares.vault_id, vaultId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    // Append-only audit record (DEF-08 / Invariant 3)
    await db.insert(schema.auditEvents).values({
      actor_id: userId,
      action: 'revoke_vault',
      target_id: vaultId,
      metadata: { share_id: shareId, principal_id: updated.principal_id, role: updated.role }
    });

    res.json({ success: true, shareId });
    return;
  } catch (error) {
    console.error('Error revoking vault share:', error);
    res.status(500).json({ error: 'Internal Server Error' });
    return;
  }
});

// POST /api/vaults/:vaultId/import: Import full vault state
app.post('/api/vaults/:vaultId/import', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const { pages = [], links = [] } = req.body;
    const userId = (req as any).userId || 'usr_admin';

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      
      if (Array.isArray(pages) && pages.length > 0) {
        // Fetch DEK for this vault
        const vaultRec = await tx.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
        let dek: Buffer | null = null;
        if (vaultRec.length > 0 && vaultRec[0].data_key_id) {
          try {
            const kms = createKmsProvider();
            dek = await kms.unwrapKey(vaultRec[0].data_key_id);
          } catch (err) {
            console.error('Failed to unwrap DEK during import:', err);
          }
        }

        for (const p of pages) {
          const pageId = toValidUuid(p.id);
          const pageType = p.type || 'note';
          const rawContent = p.content || (p.front_matter as any)?.body || '';

          // Scrub body from front_matter before database insertion
          const cleanFrontMatter = { ...(p.front_matter || {}) };
          delete (cleanFrontMatter as any).body;

          await tx.insert(schema.pages).values({
            id: pageId, vault_id: vaultId, type: pageType, title: p.title || 'Untitled',
            aliases: Array.isArray(p.aliases) ? p.aliases : [], tags: Array.isArray(p.tags) ? p.tags : [],
            front_matter: cleanFrontMatter, created_at: p.created_at ? new Date(p.created_at) : new Date(),
            updated_at: new Date()
          }).onConflictDoUpdate({
            target: schema.pages.id,
            set: {
              title: p.title || 'Untitled', type: pageType, aliases: Array.isArray(p.aliases) ? p.aliases : [],
              tags: Array.isArray(p.tags) ? p.tags : [], front_matter: cleanFrontMatter, updated_at: new Date(),
            }
          });

          // Insert encrypted version into versions table
          if (dek && rawContent) {
            const encryptedBlob = EnvelopeEncryption.encrypt(rawContent, dek);
            const [v] = await tx.insert(schema.versions).values({
              page_id: pageId,
              number: 1,
              status: 'published',
              encrypted_blob: encryptedBlob,
              created_by: userId,
              created_at: new Date(),
            }).returning({ id: schema.versions.id });

            await tx.update(schema.pages).set({ current_version_id: v.id }).where(eq(schema.pages.id, pageId));
          }
        }
      }

      if (Array.isArray(links)) {
        // Collect all pages belonging to target vaultId
        const vaultPages = await tx
          .select({ id: schema.pages.id })
          .from(schema.pages)
          .where(eq(schema.pages.vault_id, vaultId));
        const vaultPageIdSet = new Set(vaultPages.map((p) => p.id));

        for (const l of links) {
          const fromId = toValidUuid(l.from_page_id);
          const toId = toValidUuid(l.to_page_id);
          // from_page MUST belong to this vault
          if (fromId && vaultPageIdSet.has(fromId)) {
            const isToInVault = Boolean(toId && vaultPageIdSet.has(toId) && fromId !== toId);
            await tx
              .insert(schema.links)
              .values({
                from_page_id: fromId,
                to_page_id: isToInVault ? toId : null,
                raw_target: l.raw_target || '',
                link_type: l.link_type || 'wiki',
                resolved: isToInVault,
              })
              .onConflictDoNothing();
          }
        }
      }
    });

    res.json({ success: true, count: pages.length });
  } catch (error) {
    console.error('Error importing:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/draft: Save a draft of a page
app.post('/api/pages/:id/draft', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content, updated_at } = req.body;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;
    const validId = toValidUuid(id);

    let wasAutoProvisioned = false;
    let pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      let found = await tx.select().from(schema.pages).where(and(eq(schema.pages.id, validId), eq(schema.pages.vault_id, vaultId))).limit(1);
      if (!found[0] && vaultId) {
        wasAutoProvisioned = true;
        // Auto-provision page record in PostgreSQL for authorized draft creation
        const pageTitle = (req.body.title || 'Untitled Document').trim();
        const pageType = req.body.type || 'note';
        const folder = req.body.folder || undefined;
        const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
        const aliases = Array.isArray(req.body.aliases) ? req.body.aliases : [];
        const frontMatter: any = { title: pageTitle, type: pageType };
        if (folder) frontMatter.folder = folder;

        await tx.insert(schema.pages).values({
          id: validId,
          vault_id: vaultId,
          type: pageType,
          title: pageTitle,
          tags,
          aliases,
          front_matter: frontMatter,
          created_at: new Date(),
          updated_at: new Date(),
        }).onConflictDoNothing();

        found = await tx.select().from(schema.pages).where(and(eq(schema.pages.id, validId), eq(schema.pages.vault_id, vaultId))).limit(1);
      }
      return found;
    });

    if (!pageRec[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    if (req.body.title || req.body.folder !== undefined || req.body.tags || req.body.aliases) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
        const updateData: any = {};
        if (req.body.title) {
          updateData.title = req.body.title.trim();
        }
        if (req.body.tags) updateData.tags = req.body.tags;
        if (req.body.aliases) updateData.aliases = req.body.aliases;
        if (req.body.type) updateData.type = req.body.type;
        if (req.body.folder !== undefined) {
          const currentFm = (pageRec[0].front_matter as any) || {};
          updateData.front_matter = { ...currentFm, folder: req.body.folder };
        }
        if (Object.keys(updateData).length > 0) {
          await tx.update(schema.pages).set(updateData).where(eq(schema.pages.id, validId));
        }
      });
    }

    const effectiveExpectedUpdatedAt = wasAutoProvisioned ? undefined : updated_at;
    const { draftId, updated_at: new_updated_at } = await saveDraft(validId, content, userId, effectiveExpectedUpdatedAt);
    res.json({ success: true, draftId, updated_at: new_updated_at, pageId: validId });
  } catch (error: any) {
    console.error('Error saving draft:', error);
    if (error.status === 409) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/publish: Publish a draft
app.post('/api/pages/:id/publish', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;

    const pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.vault_id, vaultId))).limit(1);
    });
    if (!pageRec[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const versionId = await publishVersion(id, userId);
    res.json({ success: true, versionId });
  } catch (error) {
    console.error('Error publishing version:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/pages/:id/versions: Get versions for diffing
app.get('/api/pages/:id/versions', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;

    const pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select().from(schema.pages).where(and(eq(schema.pages.id, id), eq(schema.pages.vault_id, vaultId))).limit(1);
    });
    if (!pageRec[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const allVersions = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await tx.select()
        .from(schema.versions)
        .where(eq(schema.versions.page_id, id))
        .orderBy(desc(schema.versions.number));
    });
      
    const draft = allVersions.find((v: any) => v.status === 'draft');
    const published = allVersions.find((v: any) => v.status === 'published');
    
    // Fetch Vault DEK for decryption
    const vaultRec = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
    if (!vaultRec[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const kms = createKmsProvider();
    const dek = await kms.unwrapKey(vaultRec[0].data_key_id);

    const decryptBlob = (blob: Buffer) => {
      try {
        return EnvelopeEncryption.decryptToString(blob, dek);
      } catch (err) {
        console.error('Decryption failed for blob:', err);
        return '[Encrypted Payload - Decryption Failed]';
      }
    };
    
    res.json({
      draft: draft ? decryptBlob(draft.encrypted_blob) : null,
      published: published ? decryptBlob(published.encrypted_blob) : null,
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/search: Full text search (Requires vault access)
app.get('/api/search', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const vaultId = (req.query.vaultId as string) || (req as any).vaultId;
    const userId = (req as any).userId;
    if (!q || !vaultId) {
      res.json({ results: [] });
      return;
    }
    const results = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      return await searchPages(vaultId, q);
    });
    res.json({ results });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// -------------------------------------------------------------
// Locked Skill Runner Handlers (Port 3002 & Port 3003)
// -------------------------------------------------------------
async function handleRunSkillEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const { vaultId, skillName, parameters = {} } = req.body;
    const userId = (req as any).userId || 'desktop-agent';

    if (!vaultId || !skillName) {
      res.status(400).json({ error: 'vaultId and skillName are required' });
      return;
    }

    const authorization = await  authorizeVaultOperation(userId, vaultId, 'execute_locked_skill');
    if (!authorization) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    const userRole = authorization.role;

    const safeParams = (parameters && typeof parameters === 'object' && !Array.isArray(parameters))
      ? parameters
      : {};
    const paramText = JSON.stringify(safeParams);
    const INJECTION_PATTERNS = [
      /ignore\s+(all\s+)?(previous\s+|prior\s+)?instructions/i,
      /reveal\s+(the\s+)?system\s+prompt/i,
      /output\s+(the\s+)?system\s+prompt/i,
      /repeat\s+(all\s+)?instructions/i,
      /you\s+are\s+now\s+in\s+DAN\s+mode/i,
    ];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(paramText)) {
        res.status(400).json({ error: 'Bad Request: Parameter payload contains prohibited prompt injection patterns.' });
        return;
      }
    }

    const requestBody = { vaultId, skillName, parameters: safeParams, role: userRole };
    const serviceToken = createServiceToken({
      caller: 'tkxel-vault-api-server',
      userId,
      vaultId,
      operation: 'run_skill',
      role: userRole,
      body: requestBody,
    });

    const runnerUrl = process.env.SKILL_RUNNER_URL || 'http://localhost:3003';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${runnerUrl}/api/run-skill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err: any) {
      clearTimeout(timeout);
      res.status(502).json({ error: `Skill runner service unavailable (${err.message || 'unreachable'})` });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Skill execution failed' });
  }
}

async function handleAskVaultEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const { vaultId, query } = req.body;
    const userId = (req as any).userId || 'desktop-agent';

    if (!vaultId) {
      res.status(400).json({ error: 'vaultId is required' });
      return;
    }

    const authorization = await authorizeVaultOperation(userId, vaultId, 'execute_locked_skill');
    if (!authorization) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    const userRole = authorization.role;

    const requestBody = { vaultId, query, role: userRole };
    const serviceToken = createServiceToken({
      caller: 'tkxel-vault-api-server',
      userId,
      vaultId,
      operation: 'ask_vault',
      role: userRole,
      body: requestBody,
    });

    const runnerUrl = process.env.SKILL_RUNNER_URL || 'http://localhost:3003';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${runnerUrl}/api/ask-vault`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err: any) {
      clearTimeout(timeout);
      res.status(502).json({ error: `Skill runner service unavailable (${err.message || 'unreachable'})` });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Ask vault failed' });
  }
}

async function handleListSkillsEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const vaultId = (req.query.vaultId as string) || req.body?.vaultId || req.body?.vault_id;
    const userId = (req as any).userId || 'desktop-agent';
    if (!vaultId) {
      res.status(400).json({ error: 'not_allowed' });
      return;
    }
    const authorization = await authorizeVaultOperation(userId, vaultId, 'list_locked_skills');
    if (!authorization) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    const userRole = authorization.role;

    const requestBody = { vaultId, role: userRole };
    const serviceToken = createServiceToken({
      caller: 'tkxel-vault-api-server',
      userId,
      vaultId,
      operation: 'list_skills',
      role: userRole,
      body: requestBody,
    });

    const runnerUrl = process.env.SKILL_RUNNER_URL || 'http://localhost:3003';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${runnerUrl}/api/list-skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err: any) {
      clearTimeout(timeout);
      res.status(502).json({ error: `Skill runner service unavailable (${err.message || 'unreachable'})` });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list skills' });
  }
}

// Mount on main API server (port 3002)
app.post('/api/run-skill', handleRunSkillEndpoint);
app.post('/api/ask-vault', handleAskVaultEndpoint);
app.get('/api/skills', handleListSkillsEndpoint);
app.post('/api/list-skills', handleListSkillsEndpoint);

export function createApiApp(): Express {
  const instance = express();
  instance.use(app);
  return instance;
}

export { app };

if (process.env.NODE_ENV !== 'test' && process.env.SKIP_SERVER_LISTEN !== 'true') {
  (async () => {
    try {
      console.log('[API Server] Ensuring database migrations are applied...');
      await runMigrations();
      console.log('[API Server] Database migrations verified.');
    } catch (err) {
      console.error('[API Server] Failed to run database migrations on startup:', err);
      process.exit(1);
    }
    app.listen(port, () => {
      console.log(`[API Server] Running on http://localhost:${port}`);
    });
  })();
}
