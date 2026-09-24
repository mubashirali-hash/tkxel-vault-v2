import crypto from 'node:crypto';
import { Redis } from 'ioredis';

export const ALLOWED_SERVICE_CALLERS = [
  'tkxel-vault-mcp-gateway',
  'tkxel-vault-api-server',
] as const;

export type AllowedServiceCaller = (typeof ALLOWED_SERVICE_CALLERS)[number];

export const MAX_SERVICE_TOKEN_TTL_MS = 120_000; // 120 seconds maximum TTL ceiling
export const DEFAULT_SERVICE_TOKEN_TTL_MS = 60_000; // 60 seconds default TTL

export const CALLER_KEY_IDS: Record<AllowedServiceCaller, string> = {
  'tkxel-vault-mcp-gateway': 'kid-mcp-gateway-01',
  'tkxel-vault-api-server': 'kid-api-server-01',
};

export interface ServiceTokenHeader {
  alg: 'HS256';
  typ: 'JWT';
  kid: string;
}

export interface ServiceTokenPayload {
  caller: string; // iss
  aud: string; // 'tkxel-vault-skill-runner'
  userId: string; // sub
  vaultId: string;
  operation: 'run_skill' | 'ask_vault' | 'list_skills';
  role?: string;
  iat: number; // issued at ms
  exp: number; // expiration ms
  nonce: string; // unique jti
  bodyHash?: string; // sha256 hex of canonical request body
}

export interface CreateServiceTokenOptions {
  caller: AllowedServiceCaller | string;
  userId: string;
  vaultId: string;
  operation: 'run_skill' | 'ask_vault' | 'list_skills';
  role?: string;
  body?: unknown;
  bodyHash?: string;
  ttlMs?: number; // Default 60,000 ms, maximum 120,000 ms
  kid?: string;
  secret?: string;
  iat?: number;
  aud?: string;
}

export interface RequestBindingExpectations {
  vaultId: string;
  operation: 'run_skill' | 'ask_vault' | 'list_skills';
  body?: unknown;
  requiredRole?: string;
}

/**
 * Deterministic JSON serialization for canonical hashing.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/**
 * Computes a SHA-256 hash of the request body.
 */
export function computeBodyHash(body: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(body ?? {})).digest('hex');
}

/**
 * Redis client management for distributed nonce replay cache.
 */
let redisClientInstance: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!redisClientInstance && process.env.REDIS_URL) {
    try {
      redisClientInstance = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        enableOfflineQueue: false,
      });
      redisClientInstance.on('error', () => {
        // Handled silently
      });
    } catch {
      // Ignored
    }
  }
  return redisClientInstance;
}

export function setRedisClientForTesting(client: Redis | null): void {
  redisClientInstance = client;
}

/**
 * Nonce replay cache with fallback for non-production unit testing.
 */
const seenNonces = new Map<string, number>();

export async function recordAndVerifyNonce(
  nonce: string,
  exp: number,
  customRedis?: Redis | null
): Promise<void> {
  const now = Date.now();
  const ttlMs = Math.max(exp - now, 1000);
  const client = customRedis !== undefined ? customRedis : getRedisClient();

  if (client) {
    try {
      // Atomic Redis SET key value NX PX <ttlMs>
      const result = await client.set(`token_nonce:${nonce}`, '1', 'PX', ttlMs, 'NX');
      if (result !== 'OK') {
        throw new Error(`Service token replay detected: nonce '${nonce}' has already been used.`);
      }
      return;
    } catch (err: any) {
      if (err.message.includes('replay detected')) throw err;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`FATAL: Distributed Redis replay cache failed in production: ${err.message}`);
      }
    }
  }

  // In production mode, Redis is strictly mandatory
  if (process.env.NODE_ENV === 'production' && process.env.SKIP_SERVER_LISTEN !== 'true') {
    throw new Error('FATAL: Shared Redis store is mandatory for service token replay protection in production.');
  }

  // Non-production in-memory fallback
  for (const [n, expiry] of seenNonces.entries()) {
    if (now > expiry) {
      seenNonces.delete(n);
    }
  }

  if (seenNonces.has(nonce)) {
    throw new Error(`Service token replay detected: nonce '${nonce}' has already been used.`);
  }

  seenNonces.set(nonce, exp);
}

export function clearNonceCache(): void {
  seenNonces.clear();
}

/**
 * Resolves the root runner secret from the environment.
 */
export function getRunnerSecret(): string {
  const secret = process.env.RUNNER_SHARED_SECRET || process.env.RUNNER_SERVICE_SECRET;
  if (!secret) {
    throw new Error('FATAL: RUNNER_SHARED_SECRET must be externally supplied in environment.');
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('FATAL: RUNNER_SHARED_SECRET must be at least 32 characters in production.');
  }
  return secret;
}

/**
 * Resolves or derives a distinct cryptographic key and key ID per approved caller.
 */
export function getCallerSigningKey(caller: string, customSecret?: string): { kid: string; key: string } {
  const isApproved = ALLOWED_SERVICE_CALLERS.includes(caller as AllowedServiceCaller);
  const kid = isApproved
    ? CALLER_KEY_IDS[caller as AllowedServiceCaller]
    : `kid-${caller}-v1`;

  // Caller-specific environment key override if present
  const envVar = caller === 'tkxel-vault-mcp-gateway' ? 'RUNNER_KEY_MCP_GATEWAY' : 'RUNNER_KEY_API_SERVER';
  const specificKey = process.env[envVar];
  if (specificKey) {
    return { kid, key: specificKey };
  }

  // Derive caller-specific key using HMAC-SHA256 from root secret
  const rootSecret = customSecret || getRunnerSecret();
  const derivedKey = crypto
    .createHmac('sha256', rootSecret)
    .update(`tkxel-vault:caller-key:${caller}`)
    .digest('hex');

  return { kid, key: derivedKey };
}

export function resolveCallerVerificationKey(caller: string, kid: string, customSecret?: string): string {
  const expected = getCallerSigningKey(caller, customSecret);
  if (kid !== expected.kid) {
    throw new Error(`Invalid or retired key ID '${kid}' for caller '${caller}'`);
  }
  return expected.key;
}

/**
 * Mints an authenticated, request-bound service token.
 */
export function createServiceToken(options: CreateServiceTokenOptions, customSecret?: string): string {
  const caller = options.caller;
  const { kid, key } = options.secret
    ? { kid: options.kid || 'custom-key-01', key: options.secret }
    : getCallerSigningKey(caller, customSecret);

  const requestedTtl = options.ttlMs ?? DEFAULT_SERVICE_TOKEN_TTL_MS;
  const effectiveTtl = requestedTtl < 0 ? requestedTtl : Math.min(requestedTtl, MAX_SERVICE_TOKEN_TTL_MS);
  const now = options.iat !== undefined ? options.iat : Date.now();

  const header: ServiceTokenHeader = {
    alg: 'HS256',
    typ: 'JWT',
    kid: options.kid || kid,
  };

  const bodyHash = options.bodyHash || (options.body !== undefined ? computeBodyHash(options.body) : undefined);

  const payload: ServiceTokenPayload = {
    caller,
    aud: options.aud || 'tkxel-vault-skill-runner',
    userId: options.userId,
    vaultId: options.vaultId,
    operation: options.operation,
    role: options.role,
    iat: now,
    exp: now + effectiveTtl,
    nonce: crypto.randomUUID(),
    bodyHash,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf-8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', key)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

export interface VerifyServiceTokenOptions {
  secret?: string;
  redis?: Redis | null;
  skipNonce?: boolean;
}

/**
 * Verifies service token authenticity, expiration, audience, and single-use nonce.
 */
export async function verifyServiceToken(
  token: string,
  options?: VerifyServiceTokenOptions | string
): Promise<ServiceTokenPayload> {
  const opts: VerifyServiceTokenOptions =
    typeof options === 'string' ? { secret: options } : options || {};

  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new Error('Malformed service token: expected format <header>.<payload>.<signature>');
  }

  const parts = token.split('.');
  let encodedHeader: string;
  let encodedPayload: string;
  let providedSignature: string;
  let header: ServiceTokenHeader;
  let payload: ServiceTokenPayload;

  if (parts.length === 3) {
    [encodedHeader, encodedPayload, providedSignature] = parts;
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf-8'));
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
    } catch {
      throw new Error('Service token header or payload is not valid JSON');
    }
  } else if (parts.length === 2) {
    // Legacy 2-part compatibility: <payload>.<signature>
    [encodedPayload, providedSignature] = parts;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
      header = {
        alg: 'HS256',
        typ: 'JWT',
        kid: CALLER_KEY_IDS[payload.caller as AllowedServiceCaller] || 'legacy-kid',
      };
      encodedHeader = Buffer.from(JSON.stringify(header), 'utf-8').toString('base64url');
    } catch {
      throw new Error('Service token payload is not valid JSON');
    }
  } else {
    throw new Error('Malformed service token parts.');
  }

  if (header.alg !== 'HS256') {
    throw new Error('Invalid token header: expected HS256 algorithm');
  }

  if (!payload.caller || !ALLOWED_SERVICE_CALLERS.includes(payload.caller as any)) {
    throw new Error(`Unauthorized service caller: '${payload.caller}' is not in the allowed caller list.`);
  }

  // Resolve key for caller and kid
  let verificationKey: string;
  try {
    verificationKey = opts.secret || resolveCallerVerificationKey(payload.caller, header.kid);
  } catch (err: any) {
    throw new Error(`Key verification failure: ${err.message}`);
  }

  const signingInput = parts.length === 3 ? `${encodedHeader}.${encodedPayload}` : encodedPayload;
  const expectedSignature = crypto
    .createHmac('sha256', verificationKey)
    .update(signingInput)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSignature, 'utf-8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf-8');

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    throw new Error('Service token signature verification failed');
  }

  const now = Date.now();

  // Validate issued-at (reject future-issued tokens beyond clock drift)
  if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat > now + 5000)) {
    throw new Error('Service token issued in the future (clock skew or replay attempt)');
  }

  // Validate expiration
  if (typeof payload.exp !== 'number' || now > payload.exp) {
    throw new Error('Service token has expired');
  }

  // Validate maximum TTL ceiling
  const iat = payload.iat || payload.exp - DEFAULT_SERVICE_TOKEN_TTL_MS;
  if (payload.exp - iat > MAX_SERVICE_TOKEN_TTL_MS + 5000) {
    throw new Error(`Service token TTL exceeds maximum permitted limit (${MAX_SERVICE_TOKEN_TTL_MS}ms)`);
  }

  // Validate audience
  if (payload.aud && payload.aud !== 'tkxel-vault-skill-runner') {
    throw new Error(`Invalid token audience: expected 'tkxel-vault-skill-runner', got '${payload.aud}'`);
  }

  // Validate mandatory claims
  if (!payload.caller || !payload.userId || !payload.vaultId || !payload.operation || !payload.nonce) {
    throw new Error('Service token is missing mandatory claims (caller, userId, vaultId, operation, nonce)');
  }

  // Enforce single-use nonce replay protection
  if (!opts.skipNonce) {
    await recordAndVerifyNonce(payload.nonce, payload.exp, opts.redis);
  }

  return payload;
}

/**
 * Validates that the claims inside a verified service token strictly bind to the incoming request.
 */
export function validateServiceTokenBinding(
  payload: ServiceTokenPayload,
  expected: RequestBindingExpectations
): void {
  if (!ALLOWED_SERVICE_CALLERS.includes(payload.caller as any)) {
    throw new Error(`Unauthorized service caller: '${payload.caller}'`);
  }

  if (payload.aud && payload.aud !== 'tkxel-vault-skill-runner') {
    throw new Error(`Invalid token audience: '${payload.aud}'`);
  }

  if (payload.vaultId !== expected.vaultId) {
    throw new Error(
      `Service token vault mismatch: token bound to vault '${payload.vaultId}', request targeted '${expected.vaultId}'`
    );
  }

  if (payload.operation !== expected.operation) {
    throw new Error(
      `Service token operation mismatch: token bound to operation '${payload.operation}', request targeted '${expected.operation}'`
    );
  }

  if (expected.body !== undefined && payload.bodyHash) {
    const expectedHash = computeBodyHash(expected.body);
    if (payload.bodyHash !== expectedHash) {
      throw new Error('Service token body hash mismatch: request payload was modified or tampered with');
    }
  }

  if (expected.requiredRole && payload.role && payload.role !== expected.requiredRole) {
    throw new Error(
      `Service token role mismatch: token bound to role '${payload.role}', required '${expected.requiredRole}'`
    );
  }
}
