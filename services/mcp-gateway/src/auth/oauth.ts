import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { recordUserGroups, type OidcIdentity } from '@tkxel-vault/vault-core';

export type OidcTokenVerifier = (token: string) => Promise<OidcIdentity>;

export interface SsoUserClaims {
  userId: string;
  email: string;
  name?: string;
  groups: string[];
  tokenId: string; // jti
  expiresAt: number; // unix timestamp in seconds
}

/** Revocation keys are case-insensitive on identity so every service agrees on them. */
export function revokedUserKey(userId: string): string {
  return `revoked:user:${String(userId).trim().toLowerCase()}`;
}

export interface RevocationStore {
  isRevoked(userId: string, tokenId: string): Promise<boolean>;
  revokeToken(tokenId: string, ttlSeconds?: number): Promise<void>;
  revokeUser(userId: string, ttlSeconds?: number): Promise<void>;
}

/**
 * In-Memory Revocation Store for local testing and fast fallback.
 */
export class InMemoryRevocationStore implements RevocationStore {
  private revokedTokens = new Set<string>();
  private revokedUsers = new Set<string>();

  public async isRevoked(userId: string, tokenId: string): Promise<boolean> {
    return this.revokedUsers.has(revokedUserKey(userId)) || this.revokedTokens.has(tokenId);
  }

  public async revokeToken(tokenId: string): Promise<void> {
    this.revokedTokens.add(tokenId);
  }

  public async revokeUser(userId: string): Promise<void> {
    this.revokedUsers.add(revokedUserKey(userId));
  }

  public clear(): void {
    this.revokedTokens.clear();
    this.revokedUsers.clear();
  }
}

/**
 * Production Redis Revocation Store for sub-60-second distributed revocation SLA (FR-54, FR-65).
 */
export class RedisRevocationStore implements RevocationStore {
  private redis: any;

  constructor(redisClient: any) {
    this.redis = redisClient;
  }

  public async isRevoked(userId: string, tokenId: string): Promise<boolean> {
    const userRevoked = await this.redis.get(revokedUserKey(userId));
    if (userRevoked) return true;
    if (tokenId) {
      const tokenRevoked = await this.redis.get(`revoked:token:${tokenId}`);
      if (tokenRevoked) return true;
    }
    return false;
  }

  public async revokeToken(tokenId: string, ttlSeconds = 86400): Promise<void> {
    await this.redis.set(`revoked:token:${tokenId}`, '1', 'EX', ttlSeconds);
  }

  public async revokeUser(userId: string, ttlSeconds = 86400): Promise<void> {
    await this.redis.set(revokedUserKey(userId), '1', 'EX', ttlSeconds);
  }
}

function isGoogleClientConfigured(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  return Boolean(clientId) && clientId !== 'replace_with_your_client_id_here';
}

/**
 * OAuth 2.1 PKCE & Corporate SSO Token Validator (FR-61, FR-65, FR-91).
 * Verifies JWT tokens, extracts claims, and enforces sub-60-second revocation SLA via RevocationStore.
 */
export class OAuthValidator {
  private secretKey?: string;
  private revocationStore: RevocationStore;
  private oidcVerifier?: OidcTokenVerifier;
  private recordGroups: (userId: string, groups: string[]) => Promise<void>;

  /**
   * @param secretKey Optional HMAC secret for locally signed tokens (tests and explicit local dev only).
   *                  When omitted, locally signed tokens are rejected and only SSO ID tokens are accepted.
   */
  constructor(
    secretKey?: string,
    revocationStore?: RevocationStore,
    options?: {
      /** Verifier for a corporate OIDC provider such as Microsoft Entra ID. */
      oidcVerifier?: OidcTokenVerifier;
      /** Persists the SSO groups asserted by a verified token; defaults to the shared store. */
      recordGroups?: (userId: string, groups: string[]) => Promise<void>;
    }
  ) {
    if (secretKey !== undefined && secretKey.length === 0) {
      throw new Error('OAuthValidator HMAC secret must not be empty.');
    }
    this.secretKey = secretKey;
    this.revocationStore = revocationStore || new InMemoryRevocationStore();
    this.oidcVerifier = options?.oidcVerifier;
    this.recordGroups = options?.recordGroups ?? recordUserGroups;
  }

  /**
   * True when at least one token verifier (SSO client id or explicit HMAC secret) is configured.
   */
  public hasVerifier(): boolean {
    return Boolean(this.secretKey) || Boolean(this.oidcVerifier) || isGoogleClientConfigured();
  }

  /**
   * Helper to create a signed mock JWT token for testing and local authentication.
   */
  public createToken(payload: {
    userId: string;
    email: string;
    groups?: string[];
    expiresInSeconds?: number;
    tokenId?: string;
  }): string {
    if (!this.secretKey) {
      throw new Error('Local token signing is disabled: no HMAC secret configured.');
    }
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (payload.expiresInSeconds ?? 3600);
    const jti = payload.tokenId || `tok_${Math.random().toString(36).slice(2, 11)}`;

    const body = Buffer.from(
      JSON.stringify({
        sub: payload.userId,
        email: payload.email,
        groups: payload.groups || [],
        jti,
        exp,
        iat: now,
      })
    ).toString('base64url');

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  /**
   * Validates a Bearer token using Google Auth Library or fallback (FR-54, FR-55).
   */
  public async validateToken(authHeader?: string): Promise<SsoUserClaims> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or malformed Authorization Bearer header.');
    }

    const token = authHeader.slice(7).trim();
    const clientId = process.env.GOOGLE_CLIENT_ID;

    let payload: any;
    
    // Corporate OIDC provider (e.g. Microsoft Entra ID): signature, issuer, audience and expiry verified
    if (this.oidcVerifier) {
      try {
        const identity = await this.oidcVerifier(token);
        payload = {
          sub: identity.userId,
          email: identity.email,
          groups: identity.groups,
          jti: identity.tokenId,
          exp: identity.expiresAt,
        };
        // Group shares follow the identity provider on every authenticated request
        await this.recordGroups(identity.userId, identity.groups);
      } catch {
        if (!this.secretKey && !isGoogleClientConfigured()) {
          throw new Error('Token verification failed.');
        }
      }
    }

    // Google Workspace ID tokens
    if (!payload && clientId && isGoogleClientConfigured()) {
      try {
        const oauthClient = new OAuth2Client(clientId);
        const ticket = await oauthClient.verifyIdToken({
            idToken: token,
            audience: clientId,
        });
        const googlePayload = ticket.getPayload();
        if (googlePayload && googlePayload.email) {
          // Check Domain Restrictions
          const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS;
          if (allowedDomainsStr) {
            const allowedDomains = allowedDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean);
            const domain = googlePayload.email.split('@')[1];
            if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
              throw new Error(`Unauthorized domain: ${domain}`);
            }
          }
          
          payload = {
            sub: googlePayload.email, // Identity maps to email
            email: googlePayload.email,
            groups: [],
            jti: (googlePayload as any).jti || `tok_${Math.random()}`,
            exp: googlePayload.exp
          };
        }
      } catch (err) {
        // Without an explicitly configured HMAC secret there is no fallback verifier: fail closed.
        if (!this.secretKey) {
          throw new Error('Token verification failed.');
        }
      }
    }

    // Locally signed tokens are accepted only when an HMAC secret was explicitly configured (tests, local dev)
    if (!payload) {
      if (!this.secretKey) {
        throw new Error('Token verification failed.');
      }
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format.');
      }

      const [headerB64, bodyB64, signatureB64] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(`${headerB64}.${bodyB64}`)
        .digest('base64url');

      const actual = Buffer.from(signatureB64);
      const expected = Buffer.from(expectedSignature);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        throw new Error('Invalid token signature.');
      }

      const payloadJson = Buffer.from(bodyB64, 'base64url').toString('utf-8');
      payload = JSON.parse(payloadJson);
      
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== 'number' || payload.exp < now) {
        throw new Error('Token has expired.');
      }
    }

    const userId = payload.sub;
    const tokenId = payload.jti || '';

    // Fast sub-60-second revocation check (FR-54)
    const isRevoked = await this.revocationStore.isRevoked(userId, tokenId);
    if (isRevoked) {
      throw new Error('Token or user access has been revoked.');
    }

    return {
      userId,
      email: payload.email,
      groups: payload.groups || [],
      tokenId,
      expiresAt: payload.exp,
    };
  }

  public getRevocationStore(): RevocationStore {
    return this.revocationStore;
  }
}
