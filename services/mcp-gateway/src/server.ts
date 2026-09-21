import http, { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { StreamableHttpTransport, JsonRpcRequest } from './transport/streamable-http.js';
import { OAuthValidator, SsoUserClaims } from './auth/oauth.js';
import { ToolPalettePolicy, UserVaultAccess } from './auth/policy.js';
import { SlidingWindowRateLimiter } from './rate-limiting/index.js';
import {
  SEARCH_TOOL,
  GET_PAGE_TOOL,
  GET_LINKS_TOOL,
  GET_CONTEXT_TOOL,
  ADD_NOTE_TOOL,
  createOpenRetrievalHandlers,
  OpenVaultStore,
} from './tools/open-retrieval.js';
import {
  LIST_SKILLS_TOOL,
  ASK_VAULT_TOOL,
  RUN_SKILL_TOOL,
  createLockedRetrievalHandlers,
} from './tools/locked-tools.js';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { getUserAccessibleVaults } from '@tkxel-vault/vault-core';

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export interface GatewayServerOptions {
  port?: number;
  oauthValidator?: OAuthValidator;
  vaultStore?: OpenVaultStore;
  accessResolver?: (userId: string) => Promise<UserVaultAccess[]>;
  ssoWebhookSecret?: string;
}

export function createMcpGatewayServer(options?: GatewayServerOptions): McpGatewayServer {
  return new McpGatewayServer(options);
}

/**
 * Remote Model Context Protocol (MCP) Gateway HTTP Server.
 * Connects Claude.ai to tkxel Vault over Anthropic Streamable HTTP.
 */
export class McpGatewayServer {
  private transport: StreamableHttpTransport;
  private oauthValidator: OAuthValidator;
  private policy: ToolPalettePolicy;
  private rateLimiter: SlidingWindowRateLimiter;
  private accessResolver: (userId: string) => Promise<UserVaultAccess[]>;
  private ssoWebhookSecret?: string;
  private server?: http.Server;
  private port: number;

  constructor(options?: GatewayServerOptions) {
    this.port = options?.port ?? 3001;
    this.transport = new StreamableHttpTransport();
    this.oauthValidator = options?.oauthValidator ?? new OAuthValidator();
    this.policy = new ToolPalettePolicy();
    this.rateLimiter = new SlidingWindowRateLimiter();
    this.ssoWebhookSecret =
      options?.ssoWebhookSecret ||
      process.env.OKTA_WEBHOOK_SECRET ||
      process.env.SSO_WEBHOOK_SECRET;
    this.accessResolver =
      options?.accessResolver ??
      (async (userId: string) => {
        try {
          const accessible = await getUserAccessibleVaults(userId);
          if (accessible && accessible.length > 0) {
            return accessible;
          }
        } catch {}
        return [];
      });

    // Register Open Vault Tools
    if (options?.vaultStore) {
      const handlers = createOpenRetrievalHandlers(options.vaultStore);
      this.transport.registerTool(SEARCH_TOOL, handlers.handleSearch);
      this.transport.registerTool(GET_PAGE_TOOL, handlers.handleGetPage);
      this.transport.registerTool(GET_LINKS_TOOL, handlers.handleGetLinks);
      this.transport.registerTool(GET_CONTEXT_TOOL, handlers.handleGetContext);
      this.transport.registerTool(ADD_NOTE_TOOL, handlers.handleAddNote);
    }
    
    // Register Locked Vault Tools (list_skills, run_skill, ask_vault)
    const lockedHandlers = createLockedRetrievalHandlers();
    this.transport.registerTool(LIST_SKILLS_TOOL, lockedHandlers.handleListSkills);
    this.transport.registerTool(RUN_SKILL_TOOL, lockedHandlers.handleRunSkill);
    this.transport.registerTool(ASK_VAULT_TOOL, lockedHandlers.handleAskVault);
  }

  public getTransport(): StreamableHttpTransport {
    return this.transport;
  }

  public getOAuthValidator(): OAuthValidator {
    return this.oauthValidator;
  }

  public getPolicy(): ToolPalettePolicy {
    return this.policy;
  }

  public getRateLimiter(): SlidingWindowRateLimiter {
    return this.rateLimiter;
  }

  public getPort(): number {
    return this.port;
  }

  public getAccessResolver(): (userId: string) => Promise<UserVaultAccess[]> {
    return this.accessResolver;
  }

  /**
   * Dispatches incoming HTTP requests.
   */
  public async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // CORS & Streamable HTTP Headers
    const reqOrigin = req.headers.origin;
    const allowed = ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://claude.ai'];
    const originToSet = (reqOrigin && allowed.includes(reqOrigin)) ? reqOrigin : (process.env.NODE_ENV !== 'production' && reqOrigin ? reqOrigin : allowed[0]);
    res.setHeader('Access-Control-Allow-Origin', originToSet);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MCP-Protocol-Version');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'tkxel-vault-mcp-gateway' }));
      return;
    }

    // SSO Deprovisioning webhook (FR-55)
    if (url === '/api/sso/deprovision') {
      if (!this.ssoWebhookSecret) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SSO webhook secret not configured; failing closed' }));
        return;
      }

      // Handle Okta one-time verification challenge if requested
      const challenge = req.headers['x-okta-verification-challenge'];
      if (challenge) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ verification: challenge }));
        return;
      }

      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const body = await this.readRequestBody(req);

      // Verify webhook authentication (P0 Security Invariant: fail-closed if unauthenticated)
      const signatureHeader = (req.headers['x-okta-signature'] || req.headers['x-webhook-signature']) as string | undefined;
      let isAuthorized = false;

      if (signatureHeader) {
        const expectedHmac = crypto.createHmac('sha256', this.ssoWebhookSecret).update(body).digest('base64');
        const expectedHex = crypto.createHmac('sha256', this.ssoWebhookSecret).update(body).digest('hex');
        if (
          constantTimeEquals(signatureHeader, expectedHmac) ||
          constantTimeEquals(signatureHeader, expectedHex)
        ) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid SSO webhook signature' }));
        return;
      }

      try {
        const payload = JSON.parse(body);
        if (payload.userId) {
          await this.oauthValidator.getRevocationStore().revokeUser(payload.userId);
          try {
            await db.insert(schema.auditEvents).values({
              actor_id: 'sso_webhook',
              action: 'revoke_vault',
              target_id: payload.userId,
              metadata: { reason: payload.reason || 'sso_deprovision', provider: payload.provider || 'sso' },
            });
          } catch (auditErr) {
            console.error('Failed to log deprovision audit event:', auditErr);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ revoked: true, userId: payload.userId }));
          return;
        }
      } catch {
        // Fall through to 400
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid deprovisioning payload' }));
      return;
    }

    // Streamable HTTP Endpoint (/mcp)
    if (method === 'POST' && (url === '/mcp' || url === '/')) {
      let claims: SsoUserClaims;
      try {
        const authHeader = req.headers['authorization'];
        claims = await this.oauthValidator.validateToken(authHeader);
      } catch (authErr: any) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: `Authentication failed: ${authErr?.message || 'Unauthorized'}`,
            },
          })
        );
        return;
      }

      // Check rate limit for user (FR-67)
      try {
        this.rateLimiter.checkLimit(claims.userId, 'open');
      } catch (rlErr: any) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: rlErr?.message || 'Rate limit exceeded.',
            },
          })
        );
        return;
      }

      // Resolve caller vault permissions & dynamic tools
      const vaultAccess = await this.accessResolver(claims.userId);
      const authorizedTools = this.policy.computeAuthorizedTools(vaultAccess);

      const rolesMap = new Map<string, string>();
      const vaultModesMap = new Map<string, 'open' | 'locked'>();
      vaultAccess.forEach((v) => {
        rolesMap.set(v.vaultId, v.role);
        vaultModesMap.set(v.vaultId, v.mode);
      });

      const rawBody = await this.readRequestBody(req);
      let jsonRpcMessage: JsonRpcRequest;
      try {
        jsonRpcMessage = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error: Invalid JSON.',
            },
          })
        );
        return;
      }

      const response = await this.transport.handleMessage(jsonRpcMessage, {
        userId: claims.userId,
        roles: rolesMap,
        vaultModes: vaultModesMap,
        authorizedTools,
      });

      if (response === null) {
        // Notification handled; return 204 No Content
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  public listen(port?: number): Promise<number> {
    if (port !== undefined) this.port = port;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleHttpRequest(req, res));
      this.server.listen(this.port, () => {
        const addr = this.server?.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = boundPort;
        resolve(boundPort);
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
