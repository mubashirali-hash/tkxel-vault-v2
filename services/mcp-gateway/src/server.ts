import http, { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { StreamableHttpTransport, JsonRpcRequest } from './transport/streamable-http.js';
import { OAuthValidator, SsoUserClaims } from './auth/oauth.js';
import { ToolPalettePolicy, UserVaultAccess } from './auth/policy.js';
import { SlidingWindowRateLimiter, type RateLimiter } from './rate-limiting/index.js';
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
import { ToolAuditSink, describeToolCall } from './audit/tool-audit.js';
import { LIST_VAULTS_TOOL, createVaultDiscoveryHandler, VaultNameResolver } from './tools/vault-discovery.js';
import { isSupportedProtocolVersion } from './transport/streamable-http.js';

const LOCKED_TOOL_NAMES = new Set(['list_skills', 'run_skill', 'ask_vault']);

const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ['https://claude.ai', 'https://claude.com'];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

class RequestTooLargeError extends Error {}

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
  /** Receives one event per tools/call (FR-80). When set, a failed audit write fails the call. */
  toolAuditSink?: ToolAuditSink;
  rateLimiter?: RateLimiter;
  /** Returns the Owner-configured limits of a vault (FR-67). Defaults to none (platform defaults). */
  vaultRateLimitResolver?: (vaultId: string) => Promise<{ locked_per_hour?: number; retrieval_per_hour?: number }>;
  /** Resolves vault names for the list_vaults tool. Defaults to PostgreSQL. */
  vaultNameResolver?: VaultNameResolver;
  /** Public base URL of this gateway (e.g. https://vault-mcp.example.com). Defaults to MCP_PUBLIC_URL, then the Host header. */
  publicUrl?: string;
  /** OAuth authorization server issuer URLs advertised to clients (RFC 9728). */
  authorizationServers?: string[];
  /** Browser origins allowed to call the gateway, in addition to Claude's. */
  allowedOrigins?: string[];
  /** Secret used to sign session ids. Set MCP_SESSION_SECRET when running more than one replica. */
  sessionSecret?: string;
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
  private rateLimiter: RateLimiter;
  private vaultRateLimitResolver?: (vaultId: string) => Promise<{ locked_per_hour?: number; retrieval_per_hour?: number }>;
  private accessResolver: (userId: string) => Promise<UserVaultAccess[]>;
  private ssoWebhookSecret?: string;
  private toolAuditSink?: ToolAuditSink;
  private publicUrl?: string;
  private authorizationServers: string[];
  private allowedOrigins: Set<string>;
  private sessionSecret: string;
  private server?: http.Server;
  private port: number;

  constructor(options?: GatewayServerOptions) {
    this.port = options?.port ?? 3001;
    this.transport = new StreamableHttpTransport();
    this.oauthValidator = options?.oauthValidator ?? new OAuthValidator();
    this.policy = new ToolPalettePolicy();
    this.toolAuditSink = options?.toolAuditSink;
    this.publicUrl = (options?.publicUrl || process.env.MCP_PUBLIC_URL || '').replace(/\/+$/, '') || undefined;
    const csv = (value?: string) => (value || '').split(',').map((v) => v.trim().replace(/\/+$/, '')).filter(Boolean);
    this.authorizationServers = options?.authorizationServers
      ?? [
        ...csv(process.env.OAUTH_AUTHORIZATION_SERVERS),
        ...csv(process.env.OIDC_ISSUER),
        ...(process.env.GOOGLE_CLIENT_ID ? ['https://accounts.google.com'] : []),
      ].filter((v, i, all) => all.indexOf(v) === i);
    this.allowedOrigins = new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...csv(process.env.MCP_ALLOWED_ORIGINS),
      ...(options?.allowedOrigins || []).map((o) => o.replace(/\/+$/, '')),
    ]);
    this.sessionSecret = options?.sessionSecret || process.env.MCP_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    this.rateLimiter = options?.rateLimiter ?? new SlidingWindowRateLimiter();
    this.vaultRateLimitResolver = options?.vaultRateLimitResolver;
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

    // Vault discovery (list_vaults)
    this.transport.registerTool(LIST_VAULTS_TOOL, createVaultDiscoveryHandler(options?.vaultNameResolver));
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

  public getRateLimiter(): RateLimiter {
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

    // Origin validation (MCP Streamable HTTP: protects against DNS rebinding). Requests without an Origin
    // header are non-browser clients and are authenticated by their bearer token alone.
    const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : undefined;
    const originAllowed =
      !reqOrigin ||
      this.allowedOrigins.has(reqOrigin) ||
      (process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(reqOrigin));
    if (!originAllowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'origin_not_allowed' }));
      return;
    }
    if (reqOrigin) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = url.split('?')[0];

    // OAuth 2.0 Protected Resource Metadata (RFC 9728): tells MCP clients where to obtain a token
    if (method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' });
      res.end(
        JSON.stringify({
          resource: `${this.resolvePublicUrl(req)}/mcp`,
          authorization_servers: this.authorizationServers,
          bearer_methods_supported: ['header'],
          resource_name: 'tkxel Vault',
        })
      );
      return;
    }

    // This server answers every request with a single JSON response and opens no server-initiated
    // streams, so GET and DELETE on the MCP endpoint are not offered (Streamable HTTP allows 405 here).
    if ((method === 'GET' || method === 'DELETE') && (path === '/mcp' || path === '/')) {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' } }));
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
        res.writeHead(401, {
          'Content-Type': 'application/json',
          // RFC 9728 section 5.1: point the client at the protected-resource metadata
          'WWW-Authenticate': `Bearer resource_metadata="${this.resolvePublicUrl(req)}/.well-known/oauth-protected-resource"`,
        });
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

      // Resolve caller vault permissions & dynamic tools
      const vaultAccess = await this.accessResolver(claims.userId);
      const authorizedTools = this.policy.computeAuthorizedTools(vaultAccess);

      const rolesMap = new Map<string, string>();
      const vaultModesMap = new Map<string, 'open' | 'locked'>();
      vaultAccess.forEach((v) => {
        rolesMap.set(v.vaultId, v.role);
        vaultModesMap.set(v.vaultId, v.mode);
      });

      // MCP-Protocol-Version: when the client states a version it must be one this server speaks
      const versionHeader = req.headers['mcp-protocol-version'];
      if (versionHeader !== undefined && !isSupportedProtocolVersion(versionHeader)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Unsupported MCP-Protocol-Version' } }));
        return;
      }

      // Mcp-Session-Id: a presented session must be one this gateway issued to this caller
      const sessionHeader = req.headers['mcp-session-id'];
      if (sessionHeader !== undefined && !this.verifySessionId(String(sessionHeader), claims.userId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' } }));
        return;
      }

      let rawBody: string;
      try {
        rawBody = await this.readRequestBody(req);
      } catch (bodyErr) {
        if (bodyErr instanceof RequestTooLargeError) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Request body too large' } }));
          return;
        }
        throw bodyErr;
      }
      let jsonRpcMessage: JsonRpcRequest;
      try {
        jsonRpcMessage = JSON.parse(rawBody);
        if (Array.isArray(jsonRpcMessage) || jsonRpcMessage === null || typeof jsonRpcMessage !== 'object') {
          // JSON-RPC batching is not part of the supported protocol revisions
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: a single JSON-RPC message is required.' } }));
          return;
        }
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

      // Per-user rate limits apply to tool invocations: 60/hr for locked tools, 300/hr for retrieval (FR-67)
      if (jsonRpcMessage?.method === 'tools/call') {
        const calledTool = String((jsonRpcMessage.params as any)?.name || '');
        try {
          const limitClass = LOCKED_TOOL_NAMES.has(calledTool) ? 'locked' : 'open';
          // A call that names a vault the caller holds a role on is counted against that vault's budget,
          // at the ceiling its Owner configured. Anything else falls into the caller's general budget.
          const namedVault = describeToolCall(((jsonRpcMessage.params as any)?.arguments as Record<string, unknown>) || {}).vaultId;
          const scope = namedVault && rolesMap.has(namedVault) ? namedVault : undefined;
          let maxRequests: number | undefined;
          if (scope && this.vaultRateLimitResolver) {
            const configured = await this.vaultRateLimitResolver(scope);
            maxRequests = limitClass === 'locked' ? configured.locked_per_hour : configured.retrieval_per_hour;
          }
          await this.rateLimiter.checkLimit(claims.userId, limitClass, { scope, maxRequests });
        } catch (rlErr: any) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcMessage.id ?? null,
              error: { code: -32000, message: 'rate_limited', data: { detail: rlErr?.message } },
            })
          );
          return;
        }
      }

      const response = await this.transport.handleMessage(jsonRpcMessage, {
        userId: claims.userId,
        roles: rolesMap,
        vaultModes: vaultModesMap,
        authorizedTools,
      });

      // Every tool invocation is audited with caller, tool, vault, sizes and outcome (FR-80).
      if (this.toolAuditSink && jsonRpcMessage?.method === 'tools/call' && response) {
        const toolArgs = ((jsonRpcMessage.params as any)?.arguments as Record<string, unknown>) || {};
        const resultText = JSON.stringify((response as any).result ?? (response as any).error ?? null);
        const isError = Boolean((response as any).result?.isError);
        const denied = Boolean((response as any).error) || (isError && /not_allowed|not allowed/i.test(resultText));
        try {
          await this.toolAuditSink({
            userId: claims.userId,
            tool: String((jsonRpcMessage.params as any)?.name || ''),
            ...describeToolCall(toolArgs),
            status: denied ? 'denied' : isError ? 'error' : 'success',
            requestBytes: Buffer.byteLength(rawBody, 'utf-8'),
            responseBytes: Buffer.byteLength(resultText, 'utf-8'),
          });
        } catch (auditErr: any) {
          // Fail closed: a tool result is never returned without its audit record
          console.error('CRITICAL: tool-call audit write failed:', auditErr?.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: jsonRpcMessage.id ?? null, error: { code: -32603, message: 'audit_write_failed' } }));
          return;
        }
      }

      if (response === null) {
        // Notification accepted: Streamable HTTP specifies 202 with no body
        res.writeHead(202);
        res.end();
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (jsonRpcMessage.method === 'initialize' && !(response as any).error) {
        headers['Mcp-Session-Id'] = this.issueSessionId(claims.userId);
      }
      res.writeHead(200, headers);
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

  private resolvePublicUrl(req: IncomingMessage): string {
    if (this.publicUrl) return this.publicUrl;
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : 'http';
    return `${proto}://${req.headers.host || `localhost:${this.port}`}`;
  }

  /** Stateless session id: bound to the caller and signed, so any replica can verify it. */
  private issueSessionId(userId: string): string {
    const body = Buffer.from(JSON.stringify({ u: userId.toLowerCase(), n: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    const signature = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifySessionId(sessionId: string, userId: string): boolean {
    const [body, signature] = sessionId.split('.');
    if (!body || !signature) return false;
    const expected = crypto.createHmac('sha256', this.sessionSecret).update(body).digest('base64url');
    if (!constantTimeEquals(signature, expected)) return false;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')).u === userId.toLowerCase();
    } catch {
      return false;
    }
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
          reject(new RequestTooLargeError('Request body too large'));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
