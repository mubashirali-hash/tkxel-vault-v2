import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface OidcIdentity {
  /** Lower-cased email (or UPN) used as the vault identity. */
  userId: string;
  email: string;
  name?: string;
  /** Group identifiers from the token's `groups` (or `roles`) claim. Empty when the IdP sends none. */
  groups: string[];
  tokenId: string;
  expiresAt: number;
}

export interface OidcVerifierOptions {
  issuer: string;
  audience: string | string[];
  /** Defaults to `<issuer>/.well-known/jwks.json` style discovery via the standard OIDC document. */
  jwksUri?: string;
  /** Restrict sign-in to these email domains. */
  allowedEmailDomains?: string[];
  /** Test seam: a key resolver used instead of fetching the issuer's JWKS. */
  keyResolver?: JWTVerifyGetKey;
}

const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384'];

/**
 * Verifies JWTs issued by a corporate OIDC provider such as Microsoft Entra ID (FR-50, FR-61).
 * Signature, issuer, audience and expiry are all checked; only asymmetric algorithms are accepted.
 */
export function createOidcVerifier(options: OidcVerifierOptions) {
  const issuer = options.issuer.replace(/\/+$/, '');
  let keys: JWTVerifyGetKey | undefined = options.keyResolver;
  let discovery: Promise<JWTVerifyGetKey> | undefined;

  const resolveKeys = async (): Promise<JWTVerifyGetKey> => {
    if (keys) return keys;
    if (options.jwksUri) {
      keys = createRemoteJWKSet(new URL(options.jwksUri));
      return keys;
    }
    // Standard OIDC discovery; cached for the life of the process
    discovery ??= (async () => {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
      const doc = (await res.json()) as { jwks_uri?: string };
      if (!doc.jwks_uri) throw new Error('OIDC discovery document has no jwks_uri');
      return createRemoteJWKSet(new URL(doc.jwks_uri));
    })();
    try {
      keys = await discovery;
    } catch (err) {
      discovery = undefined; // allow a retry on the next request
      throw err;
    }
    return keys;
  };

  return async function verify(token: string): Promise<OidcIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, await resolveKeys(), {
        // Entra tokens carry the issuer with or without a trailing slash depending on version
        issuer: [issuer, `${issuer}/`],
        audience: options.audience,
        algorithms: ALLOWED_ALGORITHMS,
      }));
    } catch {
      // One message for every failure: nothing about why a token was rejected is disclosed
      throw new Error('Token verification failed.');
    }

    const claim = (name: string) => (typeof payload[name] === 'string' ? (payload[name] as string).trim() : '');
    const email = (claim('email') || claim('preferred_username') || claim('upn')).toLowerCase();
    if (!email || !email.includes('@') || typeof payload.exp !== 'number') {
      throw new Error('Token verification failed.');
    }

    const allowed = (options.allowedEmailDomains || []).map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(email.split('@')[1])) {
      throw new Error('Token verification failed.');
    }

    const rawGroups = Array.isArray(payload.groups) ? payload.groups : Array.isArray(payload.roles) ? payload.roles : [];
    const groups = Array.from(
      new Set(rawGroups.filter((g): g is string => typeof g === 'string' && Boolean(g.trim())).map((g) => g.trim().toLowerCase()))
    ).slice(0, 500);

    return {
      userId: email,
      email,
      name: claim('name') || undefined,
      groups,
      tokenId: typeof payload.jti === 'string' ? payload.jti : `${payload.sub ?? email}:${payload.iat ?? payload.exp}`,
      expiresAt: payload.exp,
    };
  };
}

/** Builds a verifier from OIDC_ISSUER / OIDC_AUDIENCE (and optional OIDC_JWKS_URI), or null when unset. */
export function createOidcVerifierFromEnv(
  env: { OIDC_ISSUER?: string; OIDC_AUDIENCE?: string; OIDC_JWKS_URI?: string; ALLOWED_EMAIL_DOMAINS?: string } = process.env
) {
  const issuer = (env.OIDC_ISSUER || '').trim();
  const audience = (env.OIDC_AUDIENCE || '').split(',').map((a) => a.trim()).filter(Boolean);
  if (!issuer || audience.length === 0) return null;
  return createOidcVerifier({
    issuer,
    audience,
    jwksUri: (env.OIDC_JWKS_URI || '').trim() || undefined,
    allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS || '').split(',').map((d) => d.trim()).filter(Boolean),
  });
}
