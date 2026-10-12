// Must stay the first import: fills process.env from the secrets manager before other modules read it (NFR-09)
import '@tkxel-vault/vault-core/secrets-preload';
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
import { eq, and, isNull, sql, desc, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  authorizeVaultOperation,
  getUserRoleForVault,
  isVaultOperationAllowed,
  Role,
  VaultOperation,
} from '@tkxel-vault/vault-core/auth';
import { saveDraft, publishVersion, getPageContent } from '@tkxel-vault/vault-core/versions';
import { createKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core/crypto';
import { movePage, createVault, VaultValidationError, runMigrations, MarkdownChunker, renamePage, PageTitleConflictError, appendTimelineEntry, listTimelineEntries, listPageVersions, rollbackPageToVersion, unpublishPage, getUserAccessibleVaults, exportVaultArchive, ExportNotAllowedError, changeVaultMode, rekeyVault, cryptoShredVault, reindexVault, EmbeddingConfigurationError, createOidcVerifierFromEnv, recordUserGroups, normalizeSharePrincipal, resolveCrossVaultLinks, storeVaultAsset, readVaultAsset, getAssetVaultId, MAX_ASSET_BYTES, getVaultRateLimits, setVaultRateLimits, requestBreakGlass, decideBreakGlass, revokeBreakGlass, listBreakGlassRequests, getConfiguredGlobalOwners, recordAccessDenial } from '@tkxel-vault/vault-core';
import crypto from 'node:crypto';
import { aiRouter } from './routes/ai.js';
import { isDevAuthBypassEnabled, getSsoAudience } from './auth/dev-bypass.js';
import { upsertSkill, publishSkill, deleteSkill, listSkills, readSkillSource, SkillValidationError } from './skills/skill-store.js';
import { createServiceToken } from '@tkxel-vault/skill-runner';
import { getRevocationRedis, revokedUserKey } from './auth/revocation.js';
import { listPageTemplates, renderPageTemplate } from './templates/page-templates.js';

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

// PostgreSQL text cannot hold a NUL character, so one in a URL or a JSON body can never be valid
// input. Refusing it here keeps it from surfacing as a database error (500) further down.
const containsNul = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'string') return value.includes('\u0000');
  if (!value || typeof value !== 'object' || depth > 8) return false;
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => k.includes('\u0000') || containsNul(v, depth + 1));
};
app.use((req: Request, res: Response, next) => {
  let url = req.originalUrl;
  try {
    url = decodeURIComponent(req.originalUrl);
  } catch {
    res.status(400).json({ error: 'Bad Request' });
    return;
  }
  if (url.includes('\u0000') || containsNul(req.body)) {
    res.status(400).json({ error: 'Bad Request' });
    return;
  }
  next();
});

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


const oidcVerifier = createOidcVerifierFromEnv();

// Mock Auth for Local Development Testing
if (isDevAuthBypassEnabled()) {
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

  // Dev bypass: strictly forbidden in production and requires an explicit opt-in flag elsewhere
  const allowDevBypass = isDevAuthBypassEnabled();
  if (token === 'dev_admin_token') {
    if (allowDevBypass) {
      (req as any).userId = process.env.VITE_VAULT_OWNER_EMAIL || process.env.VAULT_OWNER_EMAIL || 'mubashir.ali@camp1.tkxel.com';
      (req as any).isDevAdmin = true;
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

  // Corporate OIDC provider (e.g. Microsoft Entra ID), when configured
  if (oidcVerifier) {
    try {
      const identity = await oidcVerifier(token);
      (req as any).userId = identity.userId;
      // Group shares follow the identity provider on every authenticated request (FR-52)
      await recordUserGroups(identity.userId, identity.groups);
      return next();
    } catch {
      if (!getSsoAudience()) {
        res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
        return;
      }
      // Otherwise fall through to Google Workspace verification
    }
  }

  const ssoAudience = getSsoAudience();
  if (!ssoAudience) {
    // Fail closed: never verify an ID token without an audience check
    res.status(401).json({ error: 'Unauthorized: SSO is not configured' });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
        idToken: token,
        audience: ssoAudience,
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

// Revocation and SSO deprovisioning (FR-54, FR-55): every authenticated request is checked against the
// revocation list shared with the MCP gateway. Production fails closed when the list cannot be read.
app.use(async (req: Request, res: Response, next) => {
  const redis = getRevocationRedis();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'revocation_unavailable' });
      return;
    }
    return next();
  }
  try {
    if (await redis.get(revokedUserKey((req as any).userId || ''))) {
      res.status(401).json({ error: 'Unauthorized: access has been revoked' });
      return;
    }
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'revocation_unavailable' });
      return;
    }
    console.warn('Revocation check skipped (non-production):', err?.message);
  }
  next();
});

// AI Plugin Routes (Protected by Authentication)
app.use('/api/ai', aiRouter);

// Helper middleware generator for AuthZ
/**
 * True when decryption failed because the vault's data key could not be unwrapped or does not match
 * the stored ciphertext: the vault was created under a different master key (for example by a test
 * run or another environment). Nothing about the content is revealed by saying so.
 */
function isVaultKeyUnavailable(error: any): boolean {
  return /unable to authenticate data|Unsupported state|bad decrypt|Invalid key length|unwrap/i.test(String(error?.message || ''));
}
const VAULT_KEY_UNAVAILABLE = {
  error: 'vault_key_unavailable',
  message: "This vault's encryption key is not available on this server, so its content cannot be read or changed here.",
};

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireRole = (allowedRoles: Role[], operation?: VaultOperation) => {
  return async (req: Request, res: Response, next: any): Promise<void> => {
    const userId = (req as any).userId;
    // Vault ID might be in query, body, or path params
    let vaultId = (req.query.vaultId as string) || req.body?.vault_id || req.body?.vaultId || req.params.vaultId;
    const isPageLookupWithoutVault = !vaultId && Boolean(req.params.id);

    // Identifiers that are not UUIDs cannot name anything: answer as for a missing resource instead
    // of letting the database reject the value (which surfaced as a 500)
    if (isPageLookupWithoutVault && !UUID_SHAPE.test(String(req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (vaultId && !UUID_SHAPE.test(String(vaultId))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

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
      let userRole = authorization?.role || (!operation ? await getUserRoleForVault(userId, vaultId) : null);
      if (!userRole && (req as any).isDevAdmin) {
        // Dev admin is treated as owner, but never past the vault-mode boundary (e.g. open-content
        // operations on a locked vault stay denied).
        let modeAllowsOwner = !operation;
        if (operation) {
          const modeRows = await db.select({ mode: schema.vaults.mode })
            .from(schema.vaults)
            .where(eq(schema.vaults.id, vaultId))
            .limit(1);
          const mode = modeRows[0]?.mode;
          modeAllowsOwner = (mode === 'open' || mode === 'locked') && isVaultOperationAllowed(mode, 'owner', operation);
        }
        if (modeAllowsOwner) {
          userRole = 'owner';
        }
      }
      if (!userRole || !allowedRoles.includes(userRole)) {
        // Refusals are audited and feed the repeated-denial alert (FR-81, FR-83). The route pattern is
        // recorded, never the request content. A failure to record must not change the response.
        try {
          await recordAccessDenial({
            userId,
            vaultId,
            operation: `${req.method} ${req.baseUrl || ''}${req.route?.path || ''}`,
            source: 'web_api',
          });
        } catch (err: any) {
          console.error('Failed to record access denial:', err?.message);
        }
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

    // One resolver for every surface: direct ownership, personal shares, SSO group shares and org-wide shares
    const allVaults = await db.select().from(schema.vaults);
    const access = new Map((await getUserAccessibleVaults(userId)).map((a) => [a.vaultId, a.role as string]));
    const isDevAdmin = Boolean((req as any).isDevAdmin);

    const accessibleVaults = allVaults
      .filter((v) => isDevAdmin || access.has(v.id))
      .map((v) => ({
        id: v.id,
        name: v.name,
        mode: v.mode,
        owner_id: v.owner_id,
        // The wrapped data key never leaves the server (NFR-04); clients only learn that one exists
        encrypted: Boolean(v.data_key_id),
        export_policy: v.export_policy,
        role: isDevAdmin ? 'owner' : access.get(v.id)!,
        created_at: v.created_at.toISOString(),
      }))
      // Consumers use locked vaults through Claude only and have zero web app access (SRS 2.3)
      .filter((v) => v.role !== 'consumer');

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

// DELETE /api/vaults/:vaultId: Delete a vault and all its dependent resources (Owner only)
app.delete('/api/vaults/:vaultId', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const vaultId = req.params.vaultId;
    const userId = (req as any).userId;

    const [existing] = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    await db.transaction(async (tx) => {
      // 1. Audit event
      await tx.insert(schema.auditEvents).values({
        id: crypto.randomUUID(),
        actor_id: userId,
        action: 'delete_vault',
        target_id: vaultId,
        metadata: { vault_name: existing.name, mode: existing.mode },
        timestamp: new Date(),
      }).catch(() => {});

      // 2. Cascade delete will remove pages, versions, chunks, links, skills, shares
      await tx.delete(schema.vaults).where(eq(schema.vaults.id, vaultId));
    });

    res.json({ success: true, deletedVaultId: vaultId });
  } catch (error) {
    console.error('Error deleting vault:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/pages
app.get('/api/vaults/:vaultId/pages', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    // Readers only ever see published snapshots (FR-43); never-published pages are hidden from them
    const publishedOnly = (req as any).userRole === 'reader';

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
        number: schema.versions.number,
        encrypted_blob: schema.versions.encrypted_blob,
        status: schema.versions.status,
      }).from(schema.versions)
        .where(sql`${schema.versions.page_id} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`)
        .orderBy(desc(schema.versions.number));
    }

    try {
      const versionFor = (p: any) => {
        const published =
          pageVersions.find((ver) => ver.page_id === p.id && ver.id === p.current_version_id && ver.status === 'published')
          || pageVersions.find((ver) => ver.page_id === p.id && ver.status === 'published');
        if (publishedOnly) return published;
        const current = pageVersions.find((ver) => ver.page_id === p.id && ver.id === p.current_version_id)
          || published
          || pageVersions.find((ver) => ver.page_id === p.id);
        // Owners and Editors get their working copy back: a draft saved after the current version
        const newest = pageVersions.find((ver) => ver.page_id === p.id);
        return newest && newest.status === 'draft' && (!current || newest.number > current.number) ? newest : current;
      };
      const visiblePages = publishedOnly ? result.filter((p: any) => Boolean(versionFor(p))) : result;

      res.json({
        pages: visiblePages.map((p: any) => {
          const v = versionFor(p);
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
            has_unpublished_draft: !publishedOnly && Boolean(v) && v.status === 'draft' && v.id !== p.current_version_id,
            current_version_id: p.current_version_id,
            created_at: p.created_at.toISOString(),
            updated_at: p.updated_at.toISOString(),
          };
        })
      });
    } finally {
      dek?.fill(0);
    }
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
    const publishedOnly = (req as any).userRole === 'reader';
    const pageContent = await getPageContent(page.id, undefined, { publishedOnly, preferNewerDraft: !publishedOnly });
    if (publishedOnly && !pageContent) {
      // Never-published pages do not exist as far as Readers are concerned
      res.status(404).json({ error: 'not_found' });
      return;
    }
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
        has_unpublished_draft: !publishedOnly && Boolean(pageContent?.isDraft) && pageContent?.versionId !== page.current_version_id,
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

// DELETE /api/pages/:id: Delete a page and cascade its versions/links/chunks
app.delete('/api/pages/:id', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;
    const validId = toValidUuid(id);

    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      const rows = await tx.delete(schema.pages)
        .where(and(eq(schema.pages.id, validId), eq(schema.pages.vault_id, vaultId)))
        .returning({ id: schema.pages.id });
      if (rows.length > 0) {
        await tx.insert(schema.auditEvents).values({
          actor_id: userId,
          action: 'delete_page',
          target_id: validId,
          metadata: { vault_id: vaultId },
        });
      }
      return rows;
    });

    if (deleted.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json({ success: true, id: validId });
  } catch (err: any) {
    console.error('Error deleting page:', err);
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

// GET /api/pages/:id/cross-vault-links: resolve a page's unresolved links against the caller's other
// readable vaults (FR-16). Targets the caller cannot read are reported as unavailable, with no detail.
app.get('/api/pages/:id/cross-vault-links', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const vaultId = (req as any).vaultId;
    const pageRows = await db.select({ id: schema.pages.id, current_version_id: schema.pages.current_version_id })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, req.params.id), eq(schema.pages.vault_id, vaultId)))
      .limit(1);
    if (!pageRows[0] || ((req as any).userRole === 'reader' && !pageRows[0].current_version_id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const linksOut = await resolveCrossVaultLinks({ userId: (req as any).userId, vaultId, pageId: req.params.id });
    res.json({ links: linksOut });
  } catch (error: any) {
    console.error('Error resolving cross-vault links:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---- Locked-vault reference pages (FR-53): administered by Owners and Editors only ----
// These pages are never searchable, listable or readable by Consumers. `ask_vault` draws on the
// published ones to synthesize answers. Every read of content here is audited.

// GET /api/vaults/:vaultId/locked-pages: titles and status only
app.get('/api/vaults/:vaultId/locked-pages', requireRole(['owner', 'editor'], 'manage_locked_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const rows = await db.select().from(schema.pages).where(eq(schema.pages.vault_id, vaultId));
    const drafts = rows.length > 0
      ? await db.select({ page_id: schema.versions.page_id }).from(schema.versions)
          .where(and(inArray(schema.versions.page_id, rows.map((p) => p.id)), eq(schema.versions.status, 'draft')))
      : [];
    const withDraft = new Set(drafts.map((d) => d.page_id));
    res.json({
      pages: rows.map((p) => ({
        id: p.id,
        title: p.title,
        type: p.type,
        tags: p.tags,
        published: Boolean(p.current_version_id),
        has_draft: withDraft.has(p.id),
        updated_at: p.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/locked-pages/:pageId: working copy for editing (audited)
app.get('/api/vaults/:vaultId/locked-pages/:pageId', requireRole(['owner', 'editor'], 'manage_locked_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId, pageId } = req.params;
    const rows = UUID_REGEX.test(pageId)
      ? await db.select().from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.vault_id, vaultId))).limit(1)
      : [];
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const latest = await db.select({ id: schema.versions.id }).from(schema.versions)
      .where(eq(schema.versions.page_id, pageId)).orderBy(desc(schema.versions.number)).limit(1);
    const content = latest[0] ? await getPageContent(pageId, latest[0].id) : null;
    await db.insert(schema.auditEvents).values({
      actor_id: (req as any).userId,
      action: 'view_locked_page',
      target_id: pageId,
      metadata: { vault_id: vaultId },
    });
    res.json({
      page: {
        id: rows[0].id,
        title: rows[0].title,
        type: rows[0].type,
        tags: rows[0].tags,
        content: content?.content || '',
        published: Boolean(rows[0].current_version_id),
        updated_at: rows[0].updated_at.toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT /api/vaults/:vaultId/locked-pages/:pageId: create or update the draft of a reference page
app.put('/api/vaults/:vaultId/locked-pages/:pageId', requireRole(['owner', 'editor'], 'manage_locked_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId, pageId } = req.params;
    const userId = (req as any).userId;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (!UUID_REGEX.test(pageId) || !title || title.length > 255 || content === null) {
      res.status(400).json({ error: 'A page id, a title (255 characters or fewer) and content are required' });
      return;
    }
    const existing = await db.select({ vault_id: schema.pages.vault_id }).from(schema.pages).where(eq(schema.pages.id, pageId)).limit(1);
    if (existing[0] && existing[0].vault_id !== vaultId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.filter((t: unknown) => typeof t === 'string').slice(0, 50) : [];
    const type = typeof req.body?.type === 'string' && req.body.type.trim() ? req.body.type.trim() : 'note';
    if (existing[0]) {
      await db.update(schema.pages).set({ title, tags, type: type as typeof schema.pages.$inferInsert.type }).where(eq(schema.pages.id, pageId));
    } else {
      await db.insert(schema.pages).values({
        id: pageId, vault_id: vaultId, title, tags, aliases: [],
        type: type as typeof schema.pages.$inferInsert.type,
        front_matter: { title, type },
      });
    }
    // saveDraft encrypts under the vault key and, for a locked vault, writes no search index or link rows
    const draft = await saveDraft(pageId, content, userId);
    res.json({ success: true, page_id: pageId, draft_id: draft.draftId, updated_at: draft.updated_at });
  } catch (error: any) {
    console.error('Error saving locked page:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/locked-pages/:pageId/publish: Owners only (FR-41)
app.post('/api/vaults/:vaultId/locked-pages/:pageId/publish', requireRole(['owner'], 'manage_locked_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId, pageId } = req.params;
    const rows = UUID_REGEX.test(pageId)
      ? await db.select({ id: schema.pages.id }).from(schema.pages).where(and(eq(schema.pages.id, pageId), eq(schema.pages.vault_id, vaultId))).limit(1)
      : [];
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const versionId = await publishVersion(pageId, (req as any).userId);
    res.json({ success: true, version_id: versionId });
  } catch (error: any) {
    if (String(error?.message).includes('No draft to publish')) {
      res.status(400).json({ error: 'There is no draft to publish' });
      return;
    }
    if (isVaultKeyUnavailable(error)) {
      res.status(503).json(VAULT_KEY_UNAVAILABLE);
      return;
    }
    console.error('Error publishing locked page:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /api/vaults/:vaultId/locked-pages/:pageId
app.delete('/api/vaults/:vaultId/locked-pages/:pageId', requireRole(['owner', 'editor'], 'manage_locked_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId, pageId } = req.params;
    const removed = UUID_REGEX.test(pageId)
      ? await db.transaction(async (tx) => {
          const rows = await tx.delete(schema.pages)
            .where(and(eq(schema.pages.id, pageId), eq(schema.pages.vault_id, vaultId)))
            .returning({ id: schema.pages.id });
          if (rows.length > 0) {
            await tx.insert(schema.auditEvents).values({
              actor_id: (req as any).userId, action: 'delete_page', target_id: pageId, metadata: { vault_id: vaultId },
            });
          }
          return rows;
        })
      : [];
    if (removed.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/assets: upload an image into an open vault (FR-02). Body: { file_name, data_base64 }
app.post('/api/vaults/:vaultId/assets', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const encoded = typeof req.body?.data_base64 === 'string' ? req.body.data_base64.replace(/^data:[^,]*,/, '') : '';
    // Reject oversized uploads before decoding them
    if (!encoded || encoded.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/=\s]+$/.test(encoded)) {
      res.status(400).json({ error: 'A base64-encoded image of 5 MB or less is required' });
      return;
    }
    const asset = await storeVaultAsset({
      vaultId: req.params.vaultId,
      fileName: typeof req.body?.file_name === 'string' ? req.body.file_name : 'image',
      data: Buffer.from(encoded, 'base64'),
      actorId: (req as any).userId,
    });
    res.status(201).json({ success: true, asset });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error storing asset:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/assets/:assetId: decrypt and serve a vault-hosted image to a caller who can read its vault
app.get('/api/assets/:assetId', async (req: Request, res: Response) => {
  try {
    const { assetId } = req.params;
    const vaultId = UUID_REGEX.test(assetId) ? await getAssetVaultId(assetId) : null;
    // Unknown asset and unreadable vault are indistinguishable (FR-68)
    const authorization = vaultId ? await authorizeVaultOperation((req as any).userId, vaultId, 'read_open_content') : null;
    const allowed = Boolean(authorization) || Boolean(vaultId && (req as any).isDevAdmin);
    const asset = allowed && vaultId ? await readVaultAsset({ vaultId, assetId }) : null;
    if (!asset) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.data.length));
    res.setHeader('Content-Disposition', `inline; filename="${asset.fileName.replace(/[^\w .()-]/g, '_')}"`);
    // Decrypted vault content must not be stored by shared caches
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(asset.data);
  } catch (error: any) {
    console.error('Error serving asset:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/skills: administrative skill catalog (metadata only; source stays encrypted)
app.get('/api/vaults/:vaultId/skills', requireRole(['owner', 'editor', 'reader']), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const userRole = (req as any).userRole;
    const canManage = userRole === 'owner' || userRole === 'editor';
    const entries = await listSkills(vaultId);

    res.json({
      lockedSkills: entries
        // Readers (open vaults only) see published skills; drafts are for Owners and Editors
        .filter(({ summary }) => canManage || summary.status === 'published')
        .map(({ summary }) => ({
          id: summary.id,
          name: summary.name,
          version: summary.version,
          description: summary.description,
          runtime: summary.runtime,
          timeout_seconds: summary.timeout_seconds,
          status: summary.status,
          tool_schema: JSON.stringify(summary.tool_schema, null, 2),
          created_at: summary.created_at,
          updated_at: summary.updated_at,
        })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/skills: validate, encrypt and store a skill (FR-30, FR-32)
app.post('/api/vaults/:vaultId/skills', requireRole(['owner', 'editor']), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const userId = (req as any).userId;
    // Only Owners publish (FR-41): an Editor's upload is stored as a draft until an Owner publishes it
    const status = (req as any).userRole === 'owner' ? 'published' : 'draft';
    const { skill, created } = await upsertSkill({ vaultId, actorId: userId, status, input: req.body });
    res.status(created ? 201 : 200).json({ success: true, skill: { ...skill, tool_schema: JSON.stringify(skill.tool_schema, null, 2) } });
  } catch (error: any) {
    if (error instanceof SkillValidationError) {
      if (error.findings) {
        // A rejected upload is a security-relevant event (NFR-07, FR-81)
        await db.insert(schema.auditEvents).values({
          actor_id: (req as any).userId,
          action: 'skill_scan_rejected',
          target_id: req.params.vaultId,
          metadata: { vault_id: req.params.vaultId, rules: Array.from(new Set(error.findings.map((f) => f.rule))) },
        }).catch(() => {});
      }
      res.status(400).json({ error: 'invalid_skill', message: error.message, findings: error.findings });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error storing skill:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/skills/:skillId/publish: Owners only (FR-41)
app.post('/api/vaults/:vaultId/skills/:skillId/publish', requireRole(['owner']), async (req: Request, res: Response) => {
  try {
    const { vaultId, skillId } = req.params;
    if (!UUID_REGEX.test(skillId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const skill = await publishSkill({ vaultId, skillId, actorId: (req as any).userId });
    if (!skill) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ success: true, skill: { ...skill, tool_schema: JSON.stringify(skill.tool_schema, null, 2) } });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/skills/:skillId/source: decrypted source for administrative editing (FR-31).
// Locked vaults: Owners and Editors only. Open vaults: Readers may read published reference skills (FR-33).
app.get('/api/vaults/:vaultId/skills/:skillId/source', requireRole(['owner', 'editor', 'reader']), async (req: Request, res: Response) => {
  try {
    const { vaultId, skillId } = req.params;
    const userRole = (req as any).userRole;
    if (!UUID_REGEX.test(skillId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (userRole === 'reader') {
      const entries = await listSkills(vaultId);
      const entry = entries.find(({ summary }) => summary.id === skillId);
      const vaultRows = await db.select({ mode: schema.vaults.mode }).from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
      if (!entry || entry.summary.status !== 'published' || vaultRows[0]?.mode !== 'open') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
    }
    const source = await readSkillSource({ vaultId, skillId, actorId: (req as any).userId });
    if (!source) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(source);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /api/vaults/:vaultId/skills/:skillId
app.delete('/api/vaults/:vaultId/skills/:skillId', requireRole(['owner', 'editor']), async (req: Request, res: Response) => {
  try {
    const { vaultId, skillId } = req.params;
    if (!UUID_REGEX.test(skillId) || !(await deleteSkill({ vaultId, skillId, actorId: (req as any).userId }))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/timeline: decrypted timeline entries for an open vault
app.get('/api/vaults/:vaultId/timeline', requireRole(['owner', 'editor', 'reader'], 'read_open_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    let entries = await listTimelineEntries(vaultId);
    if ((req as any).userRole === 'reader') {
      // Readers never learn about pages that have not been published (FR-43)
      const published = await db.select({ id: schema.pages.id })
        .from(schema.pages)
        .where(and(eq(schema.pages.vault_id, vaultId), sql`${schema.pages.current_version_id} IS NOT NULL`));
      const visible = new Set(published.map((p) => p.id));
      entries = entries.filter((e) => visible.has(e.page_id));
    }
    res.json({ timelineEntries: entries });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/timeline: append a dated entry (FR-06). There is no update or delete route.
app.post('/api/pages/:id/timeline', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const entry = await appendTimelineEntry({
      vaultId: (req as any).vaultId,
      pageId: req.params.id,
      entry: typeof req.body?.entry === 'string' ? req.body.entry : req.body?.entry_text,
      date: typeof req.body?.date === 'string' ? req.body.date : undefined,
      actorId: (req as any).userId,
    });
    res.status(201).json({ success: true, entry });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error appending timeline entry:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/mode: switch a vault between open and locked (Owners only, FR-51)
app.post('/api/vaults/:vaultId/mode', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const result = await changeVaultMode({
      vaultId: req.params.vaultId,
      mode: req.body?.mode,
      actorId: (req as any).userId,
    });
    res.json({
      success: true,
      changed: result.changed,
      vault: { id: result.vaultId, mode: result.mode, export_policy: result.export_policy },
      revoked_shares: result.revokedShares,
      unpublished_skills: result.unpublishedSkills,
    });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error changing vault mode:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/templates: reusable page structures per type (FR-09)
app.get('/api/templates', (_req: Request, res: Response) => {
  res.json({ templates: listPageTemplates() });
});

// POST /api/vaults/:vaultId/pages/from-template: create a draft page from a type template (FR-09)
app.post('/api/vaults/:vaultId/pages/from-template', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const userId = (req as any).userId;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : 'note';
    if (!title || title.length > 255) {
      res.status(400).json({ error: 'title is required (255 characters or fewer)' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const rendered = renderPageTemplate(type, title, today);
    const pageId = crypto.randomUUID();

    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: rendered.type as typeof schema.pages.$inferInsert.type,
      title,
      aliases: [],
      tags: rendered.tags,
      front_matter: { title, type: rendered.type, ...(typeof req.body?.folder === 'string' && req.body.folder ? { folder: req.body.folder } : {}) },
    });
    const draft = await saveDraft(pageId, rendered.body, userId);
    res.status(201).json({ success: true, page: { id: pageId, vault_id: vaultId, title, type: rendered.type, tags: rendered.tags, content: rendered.body, updated_at: draft.updated_at } });
  } catch (error: any) {
    console.error('Error creating page from template:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/daily-note: open today's daily note, creating it on first use (FR-08)
app.post('/api/vaults/:vaultId/daily-note', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const userId = (req as any).userId;
    const requested = typeof req.body?.date === 'string' ? req.body.date : '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !isNaN(new Date(`${requested}T00:00:00Z`).getTime())
      ? requested
      : new Date().toISOString().slice(0, 10);

    const existing = await db.select().from(schema.pages)
      .where(and(eq(schema.pages.vault_id, vaultId), eq(schema.pages.title, date), sql`${schema.pages.front_matter}->>'folder' = 'Daily'`))
      .limit(1);
    if (existing[0]) {
      const current = await getPageContent(existing[0].id);
      res.json({ success: true, created: false, page: { id: existing[0].id, vault_id: vaultId, title: date, type: existing[0].type, tags: existing[0].tags, content: current?.content || '' } });
      return;
    }

    const rendered = renderPageTemplate('daily', date, date);
    const pageId = crypto.randomUUID();
    await db.insert(schema.pages).values({
      id: pageId,
      vault_id: vaultId,
      type: rendered.type as typeof schema.pages.$inferInsert.type,
      title: date,
      aliases: [],
      tags: rendered.tags,
      front_matter: { title: date, type: rendered.type, folder: 'Daily' },
    });
    await saveDraft(pageId, rendered.body, userId);
    res.status(201).json({ success: true, created: true, page: { id: pageId, vault_id: vaultId, title: date, type: rendered.type, tags: rendered.tags, content: rendered.body } });
  } catch (error: any) {
    console.error('Error opening daily note:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/reindex: rebuild the search index for a vault on demand (Owners only, FR-24)
app.post('/api/vaults/:vaultId/reindex', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const results = await reindexVault(vaultId);
    const indexed = results.filter((r) => r.status === 'indexed');
    await db.insert(schema.auditEvents).values({
      actor_id: (req as any).userId,
      action: 'reindex_vault',
      target_id: vaultId,
      metadata: { vault_id: vaultId, pages: results.length, indexed: indexed.length },
    });
    res.json({
      success: true,
      pages: results.length,
      indexed: indexed.length,
      chunks: indexed.reduce((n, r) => n + r.chunkCount, 0),
    });
  } catch (error: any) {
    if (error instanceof EmbeddingConfigurationError) {
      res.status(503).json({ error: 'embedding_provider_not_configured' });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error reindexing vault:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET / PUT /api/vaults/:vaultId/rate-limits: per-user hourly limits for this vault (Owners only, FR-67)
app.get('/api/vaults/:vaultId/rate-limits', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    res.json({
      rate_limits: await getVaultRateLimits(req.params.vaultId),
      defaults: { locked_per_hour: 60, retrieval_per_hour: 300 },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/vaults/:vaultId/rate-limits', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const limits = await setVaultRateLimits({ vaultId: req.params.vaultId, actorId: (req as any).userId, limits: req.body });
    res.json({ success: true, rate_limits: limits });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---- Break-glass (NFR-06): dual-authorized, time-limited administrator access to a locked vault ----
const breakGlassError = (res: Response, error: any) => {
  if (error instanceof VaultValidationError) return void res.status(400).json({ error: error.message });
  // Unknown vault, unknown request and "not an administrator" are one generic denial (FR-68)
  if (error?.message === 'not_found' || error?.message === 'not_allowed') return void res.status(403).json({ error: 'not_allowed' });
  console.error('Break-glass error:', error?.message);
  res.status(500).json({ error: 'Internal Server Error' });
};

// POST /api/vaults/:vaultId/break-glass: an administrator requests emergency access, with a reason
app.post('/api/vaults/:vaultId/break-glass', async (req: Request, res: Response) => {
  try {
    if (!UUID_REGEX.test(req.params.vaultId)) throw new Error('not_allowed');
    const request = await requestBreakGlass({
      vaultId: req.params.vaultId,
      requesterId: (req as any).userId,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : '',
    });
    res.status(201).json({ success: true, request });
  } catch (error) {
    breakGlassError(res, error);
  }
});

// GET /api/vaults/:vaultId/break-glass: requests for a vault, visible to its Owner and to administrators
app.get('/api/vaults/:vaultId/break-glass', async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    const userId = String((req as any).userId || '').toLowerCase().trim();
    if (!UUID_REGEX.test(vaultId)) throw new Error('not_allowed');
    const owner = await db.select({ owner_id: schema.vaults.owner_id }).from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
    const permitted = owner[0] && (owner[0].owner_id.toLowerCase().trim() === userId || getConfiguredGlobalOwners().includes(userId));
    if (!permitted) throw new Error('not_allowed');
    res.json({ requests: await listBreakGlassRequests(vaultId) });
  } catch (error) {
    breakGlassError(res, error);
  }
});

// POST /api/break-glass/:requestId/approve | deny | revoke: decided by a second person
for (const decision of ['approve', 'deny', 'revoke'] as const) {
  app.post(`/api/break-glass/:requestId/${decision}`, async (req: Request, res: Response) => {
    try {
      if (!UUID_REGEX.test(req.params.requestId)) throw new Error('not_allowed');
      const actorId = (req as any).userId;
      const request = decision === 'revoke'
        ? await revokeBreakGlass({ requestId: req.params.requestId, actorId })
        : await decideBreakGlass({
            requestId: req.params.requestId,
            approverId: actorId,
            approve: decision === 'approve',
            minutes: typeof req.body?.minutes === 'number' ? req.body.minutes : undefined,
          });
      res.json({ success: true, request });
    } catch (error) {
      breakGlassError(res, error);
    }
  });
}

// POST /api/vaults/:vaultId/rekey: rotate the vault data key and re-encrypt its content (Owners only, NFR-05)
app.post('/api/vaults/:vaultId/rekey', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const result = await rekeyVault({ vaultId: req.params.vaultId, actorId: (req as any).userId });
    res.json({
      success: true,
      reencrypted: {
        versions: result.versions,
        chunks: result.chunks,
        timeline_entries: result.timelineEntries,
        skills: result.skills,
      },
    });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error re-keying vault:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/crypto-shred: irreversibly destroy the vault key and its content (Owners only, NFR-05).
// The body must repeat the vault name as `confirm_name`.
app.post('/api/vaults/:vaultId/crypto-shred', requireRole(['owner'], 'manage_vault'), async (req: Request, res: Response) => {
  try {
    const result = await cryptoShredVault({
      vaultId: req.params.vaultId,
      actorId: (req as any).userId,
      confirmName: typeof req.body?.confirm_name === 'string' ? req.body.confirm_name : '',
    });
    res.json({
      success: true,
      pages_removed: result.pagesRemoved,
      skills_removed: result.skillsRemoved,
      shares_revoked: result.sharesRevoked,
    });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error crypto-shredding vault:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/vaults/:vaultId/export: audited ZIP export of an open vault, Owner only (FR-56).
// Locked vaults have no export path: every attempt is refused with the generic denial and audited.
app.post('/api/vaults/:vaultId/export', async (req: Request, res: Response) => {
  try {
    const { vaultId } = req.params;
    if (!UUID_REGEX.test(vaultId)) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    const archive = await exportVaultArchive({
      vaultId,
      actorId: (req as any).userId,
      justification: typeof req.body?.justification === 'string' ? req.body.justification : undefined,
      treatAsOwner: Boolean((req as any).isDevAdmin),
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.fileName.replace(/[^\w .()-]/g, '_')}"`);
    res.setHeader('X-Export-Page-Count', String(archive.pageCount));
    res.send(archive.zipBuffer);
  } catch (error: any) {
    if (error instanceof ExportNotAllowedError) {
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    console.error('Error exporting vault:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/vaults/:vaultId/audits: Owner-only audit trail with filters and CSV export (FR-82)
app.get('/api/vaults/:vaultId/audits', requireRole(['owner']), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { vaultId } = req.params;
    const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    const asDate = (value: unknown) => {
      const text = asString(value);
      if (!text) return undefined;
      const parsed = new Date(text);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const action = asString(req.query.action);
    const actor = asString(req.query.actor);
    const from = asDate(req.query.from);
    const to = asDate(req.query.to);
    const wantsCsv = req.query.format === 'csv';
    const limit = Math.min(Math.max(Number(req.query.limit) || (wantsCsv ? 10000 : 200), 1), wantsCsv ? 50000 : 1000);

    // An event belongs to the vault when it targets the vault, one of its pages or skills,
    // or records the vault in its metadata (which keeps events for deleted pages and skills visible).
    const conditions = [
      sql`(
        ${schema.auditEvents.target_id} = ${vaultId}
        OR ${schema.auditEvents.metadata}->>'vault_id' = ${vaultId}
        OR ${schema.auditEvents.target_id} IN (SELECT id::text FROM ${schema.pages} WHERE vault_id = ${vaultId}::uuid)
        OR ${schema.auditEvents.target_id} IN (SELECT id::text FROM ${schema.skills} WHERE vault_id = ${vaultId}::uuid)
      )`,
    ];
    if (action) conditions.push(sql`${schema.auditEvents.action} = ${action}`);
    if (actor) conditions.push(sql`lower(${schema.auditEvents.actor_id}) = ${actor.toLowerCase()}`);
    if (from) conditions.push(sql`${schema.auditEvents.timestamp} >= ${from.toISOString()}::timestamptz`);
    if (to) conditions.push(sql`${schema.auditEvents.timestamp} <= ${to.toISOString()}::timestamptz`);

    const rows = await db.select()
      .from(schema.auditEvents)
      .where(sql.join(conditions, sql` AND `))
      .orderBy(desc(schema.auditEvents.timestamp))
      .limit(limit);

    if (wantsCsv) {
      // Neutralize spreadsheet formula injection and quote every cell
      const cell = (value: unknown) => {
        let text = value === null || value === undefined ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const lines = [
        ['timestamp', 'actor', 'action', 'target_id', 'metadata'].map(cell).join(','),
        ...rows.map((a) =>
          [a.timestamp.toISOString(), a.actor_id, a.action, a.target_id, JSON.stringify(a.metadata ?? {})].map(cell).join(',')
        ),
      ];

      await db.insert(schema.auditEvents).values({
        actor_id: userId,
        action: 'export_audit_log',
        target_id: vaultId,
        metadata: { vault_id: vaultId, rows: rows.length },
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${vaultId}.csv"`);
      res.send(lines.join('\r\n'));
      return;
    }

    res.json({
      auditEvents: rows.map((a: any) => ({
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
    if (typeof principal_id !== 'string' || typeof role !== 'string') {
      res.status(400).json({ error: 'invalid_input' });
      return;
    }
    // A share goes to one person (email), one SSO group (`group:<id>`) or the whole organization (`org:all`)
    const validPrincipal = normalizeSharePrincipal(principal_id);
    if (!validPrincipal) {
      res.status(400).json({ error: 'invalid_principal' });
      return;
    }

    // Shareable roles depend on vault mode (FR-52, FR-53): ownership is never granted through a share,
    // locked vaults have no Reader role, and Consumers exist only on locked vaults.
    const shareVault = await db.select({ mode: schema.vaults.mode })
      .from(schema.vaults)
      .where(eq(schema.vaults.id, vaultId))
      .limit(1);
    const allowedShareRoles = shareVault[0]?.mode === 'locked'
      ? ['editor', 'consumer']
      : shareVault[0]?.mode === 'open'
        ? ['editor', 'reader']
        : [];
    if (!allowedShareRoles.includes(role)) {
      res.status(400).json({ error: 'invalid_role', allowed_roles: allowedShareRoles });
      return;
    }

    const normalizedPrincipal = validPrincipal;
    const shareRole = role as Role;

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
        .set({ role: shareRole, granted_by: userId, granted_at: new Date() })
        .where(eq(schema.shares.id, existing[0].id))
        .returning();
      shareRecord = updated;
    } else {
      const [inserted] = await db.insert(schema.shares)
        .values({
          vault_id: vaultId,
          principal_id: normalizedPrincipal,
          role: shareRole,
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
      metadata: { principal_id: normalizedPrincipal, role: shareRole, share_id: shareRecord.id }
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
    // Only Owners may publish (FR-41): content imported by an Editor lands as a draft
    const importStatus: 'published' | 'draft' = (req as any).userRole === 'owner' ? 'published' : 'draft';
    let importedCount = 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      
      if (Array.isArray(pages) && pages.length > 0) {
        // Fetch DEK for this vault
        const vaultRec = await tx.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
        let dek: Buffer | null = null;
        try {
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

            // Vault isolation: an import may never touch a page that lives in another vault
            const existingPage = await tx.select({ vault_id: schema.pages.vault_id })
              .from(schema.pages)
              .where(eq(schema.pages.id, pageId))
              .limit(1);
            if (existingPage[0] && existingPage[0].vault_id !== vaultId) {
              continue;
            }
            importedCount++;

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
              const existingVers = await tx.select({ number: schema.versions.number })
                .from(schema.versions)
                .where(eq(schema.versions.page_id, pageId))
                .orderBy(desc(schema.versions.number))
                .limit(1);
              const nextNumber = existingVers.length > 0 ? existingVers[0].number + 1 : 1;

              const [v] = await tx.insert(schema.versions).values({
                page_id: pageId,
                number: nextNumber,
                status: importStatus,
                encrypted_blob: encryptedBlob,
                created_by: userId,
                created_at: new Date(),
              }).returning({ id: schema.versions.id });

              // current_version_id always points at a published snapshot
              if (importStatus === 'published') {
                await tx.update(schema.pages).set({ current_version_id: v.id }).where(eq(schema.pages.id, pageId));
              }

              // If open vault, chunk content and insert chunks for searchability
              if (vaultRec[0]?.mode === 'open') {
                const chunker = new MarkdownChunker({ maxTokensPerChunk: 400, overlapTokens: 50 });
                const docChunks = chunker.chunk(rawContent);
                if (docChunks.length > 0) {
                  // A draft import leaves the published version's index entries in place (FR-43);
                  // a published import replaces everything
                  await tx.delete(schema.chunks).where(importStatus === 'published'
                    ? eq(schema.chunks.page_id, pageId)
                    : and(
                        eq(schema.chunks.page_id, pageId),
                        sql`${schema.chunks.version_id} IS DISTINCT FROM (SELECT current_version_id FROM pages WHERE id = ${pageId}::uuid)`
                      ));
                  for (const c of docChunks) {
                    await tx.insert(schema.chunks).values({
                      page_id: pageId,
                      version_id: v.id,
                      position: c.chunkIndex,
                      encrypted_text: EnvelopeEncryption.encrypt(c.content, dek),
                      tsv_content: sql`to_tsvector('english', ${c.content})`,
                    });
                  }
                }
              }
            }
          }
        } finally {
          dek?.fill(0);
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

      await tx.insert(schema.auditEvents).values({
        actor_id: userId,
        action: 'import_pages',
        target_id: vaultId,
        metadata: { vault_id: vaultId, pages: importedCount, status: importStatus },
      });
    });

    // A bulk import changes table sizes faster than autovacuum re-analyses them. Refreshing the planner's
    // statistics here keeps search and page lookups on good query plans straight after a large import.
    if (importedCount >= 50) {
      for (const table of ['pages', 'versions', 'chunks', 'links']) {
        await db.execute(sql.raw(`ANALYZE ${table}`)).catch((err) => console.warn(`ANALYZE ${table} failed:`, err?.message));
      }
    }

    res.json({ success: true, count: importedCount, status: importStatus });
  } catch (error) {
    console.error('Error importing:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const RESERVED_FRONT_MATTER_KEYS = new Set(['title', 'type', 'tags', 'aliases', 'folder', 'body']);
const MAX_FRONT_MATTER_BYTES = 32 * 1024;

/**
 * Replaces a page's user-defined front matter fields with the supplied set (FR-05), keeping the reserved
 * keys, which live in dedicated columns or are managed separately.
 */
function mergeFrontMatter(current: Record<string, unknown>, incoming: unknown, folder: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const custom = incoming === undefined
    ? Object.fromEntries(Object.entries(current).filter(([key]) => !RESERVED_FRONT_MATTER_KEYS.has(key)))
    : incoming;
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new VaultValidationError('front_matter must be an object of key/value fields');
  }
  for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
    if (RESERVED_FRONT_MATTER_KEYS.has(key)) continue;
    if (!/^[A-Za-z_][\w .-]{0,63}$/.test(key)) {
      throw new VaultValidationError(`front_matter key "${key.slice(0, 40)}" is not allowed`);
    }
    next[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(next), 'utf-8') > MAX_FRONT_MATTER_BYTES) {
    throw new VaultValidationError('front_matter is too large');
  }
  for (const key of ['title', 'type']) {
    if (key in current) next[key] = current[key];
  }
  const resolvedFolder = folder !== undefined ? folder : current.folder;
  if (typeof resolvedFolder === 'string' && resolvedFolder) next.folder = resolvedFolder;
  return next;
}

/** Union of the explicit tag list and the #tags written in the Markdown body (code is ignored). */
function mergeTags(explicit: unknown, body: unknown): string[] {
  const tags = new Map<string, string>();
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const tag = raw.trim().replace(/^#/, '').slice(0, 64);
    if (tag && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  };
  (Array.isArray(explicit) ? explicit : []).forEach(add);
  if (typeof body === 'string') {
    const prose = body.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
    for (const match of prose.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) add(match[1]);
  }
  return Array.from(tags.values()).slice(0, 100);
}

// POST /api/pages/:id/draft: Save a draft of a page
app.post('/api/pages/:id/draft', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content, updated_at } = req.body;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;
    const validId = toValidUuid(id);

    let effectiveDbUser = userId;
    if ((req as any).isDevAdmin && vaultId) {
      const v = await db.select({ owner_id: schema.vaults.owner_id }).from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
      if (v[0]?.owner_id) effectiveDbUser = v[0].owner_id;
    }

    let wasAutoProvisioned = false;
    let pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${effectiveDbUser}, true)`);
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

    if (req.body.title || req.body.folder !== undefined || req.body.tags || req.body.aliases || req.body.front_matter !== undefined || typeof content === 'string') {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${effectiveDbUser}, true)`);
        const updateData: any = {};
        // Title changes are applied by renamePage below (atomic link refactor, FR-12)
        // Tags are the editor's tag list plus every #tag written in the body (FR-05)
        if (req.body.tags || typeof content === 'string') {
          updateData.tags = mergeTags(Array.isArray(req.body.tags) ? req.body.tags : pageRec[0].tags, content);
        }
        if (req.body.aliases) updateData.aliases = req.body.aliases;
        if (req.body.type) updateData.type = req.body.type;
        if (req.body.folder !== undefined || req.body.front_matter !== undefined) {
          updateData.front_matter = mergeFrontMatter(
            (pageRec[0].front_matter as Record<string, unknown>) || {},
            req.body.front_matter,
            req.body.folder
          );
        }
        if (Object.keys(updateData).length > 0) {
          await tx.update(schema.pages).set(updateData).where(eq(schema.pages.id, validId));
        }
      });
    }

    let effectiveExpectedUpdatedAt = wasAutoProvisioned ? undefined : updated_at;

    // Rename first, atomically with the rewrite of every referencing page
    let refactoredPages: Array<{ id: string; updated_at: string }> = [];
    const requestedTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!wasAutoProvisioned && requestedTitle && requestedTitle !== pageRec[0].title) {
      const renameResult = await renamePage({
        vaultId,
        pageId: validId,
        newTitle: requestedTitle,
        actorId: userId,
        expectedUpdatedAt: effectiveExpectedUpdatedAt,
      });
      refactoredPages = renameResult.refactoredPages;
      effectiveExpectedUpdatedAt = renameResult.updated_at;
    }

    const { draftId, updated_at: new_updated_at } = await saveDraft(validId, content, effectiveDbUser, effectiveExpectedUpdatedAt);
    res.json({ success: true, draftId, updated_at: new_updated_at, pageId: validId, refactored_pages: refactoredPages });
  } catch (error: any) {
    if (error instanceof PageTitleConflictError) {
      res.status(409).json({ error: 'title_conflict' });
      return;
    }
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error.status === 409 || error.code === 'CONCURRENT_MODIFICATION') {
      res.status(409).json({ error: error.message });
      return;
    }
    if (isVaultKeyUnavailable(error)) {
      res.status(503).json(VAULT_KEY_UNAVAILABLE);
      return;
    }
    console.error('Error saving draft:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/publish: Publish a draft (Owners only, FR-41)
app.post('/api/pages/:id/publish', requireRole(['owner'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).userId;
    const vaultId = (req as any).vaultId;
    const validId = toValidUuid(id);
    const content = req.body?.content;

    let effectiveDbUser = userId;
    if ((req as any).isDevAdmin && vaultId) {
      const v = await db.select({ owner_id: schema.vaults.owner_id }).from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
      if (v[0]?.owner_id) effectiveDbUser = v[0].owner_id;
    }

    let pageRec = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${effectiveDbUser}, true)`);
      let found = await tx.select().from(schema.pages).where(and(eq(schema.pages.id, validId), eq(schema.pages.vault_id, vaultId))).limit(1);
      if (!found[0] && vaultId) {
        // Auto-provision page record in PostgreSQL for authorized publish
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

    // A title change sent with the publish request is an atomic rename (FR-12)
    let refactoredPages: Array<{ id: string; updated_at: string }> = [];
    const requestedTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (requestedTitle && requestedTitle !== pageRec[0].title) {
      const renameResult = await renamePage({ vaultId, pageId: validId, newTitle: requestedTitle, actorId: userId });
      refactoredPages = renameResult.refactoredPages;
    }

    // If content was sent with the publish request, save draft first so publish has the latest content
    if (typeof content === 'string') {
      await saveDraft(validId, content, effectiveDbUser);
    } else {
      // Check if a draft exists. If no draft exists, save an initial draft from current version or empty
      const existingDraft = await db.select({ id: schema.versions.id })
        .from(schema.versions)
        .where(and(eq(schema.versions.page_id, validId), eq(schema.versions.status, 'draft')))
        .limit(1);
      if (existingDraft.length === 0) {
        let currentContent = '';
        if (pageRec[0].current_version_id) {
          try {
            const pageData = await getPageContent(validId);
            if (pageData?.content) {
              currentContent = pageData.content;
            }
          } catch {}
        }
        await saveDraft(validId, currentContent, effectiveDbUser);
      }
    }

    const versionId = await publishVersion(validId, effectiveDbUser);

    // Fetch updated page timestamp
    const [updatedPage] = await db.select({ updated_at: schema.pages.updated_at })
      .from(schema.pages)
      .where(eq(schema.pages.id, validId))
      .limit(1);

    res.json({
      success: true,
      versionId,
      updated_at: updatedPage?.updated_at?.toISOString() || new Date().toISOString(),
      pageId: validId,
      refactored_pages: refactoredPages,
    });
  } catch (error) {
    if (error instanceof PageTitleConflictError) {
      res.status(409).json({ error: 'title_conflict' });
      return;
    }
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
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

    try {
      const decryptBlob = (blob: Buffer) => {
        try {
          return EnvelopeEncryption.decryptToString(blob, dek);
        } catch (err) {
          console.error('Decryption failed for blob:', err);
          return '[Encrypted Payload - Decryption Failed]';
        }
      };
      
      // Drafts are never exposed to Readers (FR-43)
      const canSeeDraft = (req as any).userRole === 'owner' || (req as any).userRole === 'editor';
      res.json({
        draft: draft && canSeeDraft ? decryptBlob(draft.encrypted_blob) : null,
        published: published ? decryptBlob(published.encrypted_blob) : null,
      });
    } finally {
      dek?.fill(0);
    }
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/pages/:id/history: full version history, newest first (FR-42). Owners and Editors only.
app.get('/api/pages/:id/history', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    res.json({ versions: await listPageVersions(req.params.id) });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/pages/:id/versions/:versionId: content of one historical version, for side-by-side diff (FR-42)
app.get('/api/pages/:id/versions/:versionId', requireRole(['owner', 'editor'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const { id, versionId } = req.params;
    if (!UUID_REGEX.test(versionId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const history = await listPageVersions(id);
    if (!history.some((v) => v.id === versionId)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const version = await getPageContent(id, versionId);
    if (!version || version.versionId !== versionId) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ version_id: version.versionId, number: version.versionNumber, content: version.content });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/rollback: republish an earlier snapshot as a new version (Owners only, FR-41/FR-42)
app.post('/api/pages/:id/rollback', requireRole(['owner'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const versionId = req.body?.version_id;
    if (typeof versionId !== 'string' || !UUID_REGEX.test(versionId)) {
      res.status(400).json({ error: 'version_id is required' });
      return;
    }
    const result = await rollbackPageToVersion({ pageId: req.params.id, versionId, actorId: (req as any).userId });
    res.json({ success: true, version_id: result.versionId, restored_from: result.restoredFromNumber });
  } catch (error: any) {
    if (error instanceof VaultValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error rolling back page:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/pages/:id/unpublish: withdraw a page from Readers and retrieval tools immediately (Owners only, FR-44)
app.post('/api/pages/:id/unpublish', requireRole(['owner'], 'write_open_content'), async (req: Request, res: Response) => {
  try {
    const result = await unpublishPage({ pageId: req.params.id, actorId: (req as any).userId });
    res.json({ success: true, withdrawn_versions: result.withdrawn });
  } catch (error: any) {
    if (error?.message === 'not_found') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    console.error('Error unpublishing page:', error?.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/search: hybrid search with type, tag, vault and date-range filters (FR-20, FR-23).
// Without vaultId it searches every open vault the caller can read.
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const list = (value: unknown): string[] =>
      (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
        .map((v) => String(v).trim())
        .filter(Boolean);
    const asDate = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const requestedVaults = [...list(req.query.vaultId), ...list(req.query.vaults)];
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

    // Access is resolved server-side on every request; unknown, locked and unauthorized vaults are simply not searched
    let accessible = await getUserAccessibleVaults(userId);
    if ((req as any).isDevAdmin) {
      // Local dev admin (never enabled in production) is treated as owner of every vault
      const all = await db.select({ id: schema.vaults.id, mode: schema.vaults.mode }).from(schema.vaults);
      accessible = all.map((v) => ({ vaultId: v.id, mode: v.mode as 'open' | 'locked', role: 'owner' as Role }));
    }
    const readable = accessible.filter(
      (v) => v.mode === 'open' && (v.role === 'owner' || v.role === 'editor' || v.role === 'reader')
    );
    if (requestedVaults.length === 1 && !readable.some((v) => v.vaultId === requestedVaults[0])) {
      // Explicit single-vault search keeps the uniform denial contract (FR-68)
      res.status(403).json({ error: 'not_allowed' });
      return;
    }
    const targets = requestedVaults.length > 0 ? readable.filter((v) => requestedVaults.includes(v.vaultId)) : readable;

    if (!q.trim() || targets.length === 0) {
      res.json({ results: [] });
      return;
    }

    const perVault = await Promise.all(
      targets.map(async (v) => {
        const hits = await searchPages(v.vaultId, q, limit, {
          publishedOnly: v.role === 'reader',
          types: list(req.query.types),
          tags: list(req.query.tags),
          updatedFrom: asDate(req.query.from),
          updatedTo: asDate(req.query.to),
        });
        return hits.map((h) => ({ ...h, vault: v.vaultId }));
      })
    );

    const results = perVault.flat().sort((a, b) => b.score - a.score).slice(0, limit);
    res.json({ results });
  } catch (error) {
    console.error('Search error:', (error as any)?.message);
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
      // Deployments that run the migration job set RUN_MIGRATIONS_ON_START=false: there the API
      // connects as a role that cannot change the schema
      if (process.env.RUN_MIGRATIONS_ON_START !== 'false') {
        console.log('[API Server] Ensuring database migrations are applied...');
        await runMigrations();
        console.log('[API Server] Database migrations verified.');
      }
    } catch (err) {
      console.error('[API Server] Failed to run database migrations on startup:', err);
      process.exit(1);
    }
    app.listen(port, () => {
      console.log(`[API Server] Running on http://localhost:${port}`);
    });
  })();
}
