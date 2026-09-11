import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export interface SsoUserClaims {
  userId: string;
  email: string;
  name?: string;
  groups: string[];
  tokenId: string; // jti
  expiresAt: number; // unix timestamp in seconds
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
    return this.revokedUsers.has(userId) || this.revokedTokens.has(tokenId);
  }

  public async revokeToken(tokenId: string): Promise<void> {
    this.revokedTokens.add(tokenId);
  }

  public async revokeUser(userId: string): Promise<void> {
    this.revokedUsers.add(userId);
  }

  public clear(): void {
    this.revokedTokens.clear();
    this.revokedUsers.clear();
  }
}

/**
 * OAuth 2.1 PKCE & Corporate SSO Token Validator (FR-61, FR-65, FR-91).
 * Verifies JWT tokens, extracts claims, and enforces sub-60-second revocation SLA via RevocationStore.
 */
export class OAuthValidator {
  private secretKey: string;
  private revocationStore: RevocationStore;

  constructor(secretKey: string = 'tkxel-vault-dev-sso-jwt-secret-key-32b', revocationStore?: RevocationStore) {
    this.secretKey = secretKey;
    this.revocationStore = revocationStore || new InMemoryRevocationStore();
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
    
    // Try Google Token Validation first
    if (clientId && clientId !== 'replace_with_your_client_id_here') {
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
        console.error('Google token verification failed, falling back to HMAC:', err);
      }
    }

    // Fallback to local HMAC if Google failed or not configured (useful for tests)
    if (!payload) {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format.');
      }

      const [headerB64, bodyB64, signatureB64] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(`${headerB64}.${bodyB64}`)
        .digest('base64url');

      if (signatureB64 !== expectedSignature) {
        throw new Error('Invalid token signature.');
      }

      const payloadJson = Buffer.from(bodyB64, 'base64url').toString('utf-8');
      payload = JSON.parse(payloadJson);
      
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
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
