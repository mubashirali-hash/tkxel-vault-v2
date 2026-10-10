export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export type RateLimitClass = 'open' | 'locked';

export interface RateLimitOptions {
  /** Separate budget per scope, normally the vault the call targets. */
  scope?: string;
  /** Overrides the default request ceiling for this check (a vault Owner's configured limit). */
  maxRequests?: number;
}

/** A per-user limiter. Implementations may be synchronous (in-process) or asynchronous (shared store). */
export interface RateLimiter {
  checkLimit(userId: string, type: RateLimitClass, options?: RateLimitOptions): void | Promise<void>;
}

/** FR-67 defaults: 300 retrieval calls and 60 locked calls per user per hour. */
export const DEFAULT_RATE_LIMITS: Record<RateLimitClass, RateLimitConfig> = {
  open: { maxRequests: 300, windowMs: 60 * 60 * 1000 },
  locked: { maxRequests: 60, windowMs: 60 * 60 * 1000 },
};

function limitMessage(type: RateLimitClass, max: number, windowMs: number, resetInSeconds: number): string {
  return `Rate limit exceeded for '${type}' tools. Maximum ${max} requests per ${windowMs / 1000 / 60} minutes. Try again in ${resetInSeconds} seconds.`;
}

function bucketKey(userId: string, type: RateLimitClass, scope?: string): string {
  return `${userId.toLowerCase()}:${type}${scope ? `:${scope}` : ''}`;
}

/**
 * Sliding Window Rate Limiter (FR-67), in process memory.
 * Suitable for a single gateway process and for tests; use RedisRateLimiter when running replicas.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private requestLog = new Map<string, number[]>();
  private limits: Record<RateLimitClass, RateLimitConfig>;

  constructor(customLimits?: Partial<Record<RateLimitClass, RateLimitConfig>>) {
    this.limits = {
      open: customLimits?.open ?? DEFAULT_RATE_LIMITS.open,
      locked: customLimits?.locked ?? DEFAULT_RATE_LIMITS.locked,
    };
  }

  /**
   * Evaluates request timestamp against sliding window.
   * Throws RateLimitExceededError if limit is breached.
   */
  public checkLimit(userId: string, type: RateLimitClass, options?: RateLimitOptions): void {
    const key = options?.scope ? bucketKey(userId, type, options.scope) : `${userId}:${type}`;
    const now = Date.now();
    const config = this.limits[type];
    const maxRequests = options?.maxRequests ?? config.maxRequests;

    const timestamps = this.requestLog.get(key) || [];
    // Filter out timestamps outside window
    const windowStart = now - config.windowMs;
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= maxRequests) {
      const oldestValid = validTimestamps[0] ?? now;
      const resetInSeconds = Math.ceil((oldestValid + config.windowMs - now) / 1000);
      throw new RateLimitExceededError(limitMessage(type, maxRequests, config.windowMs, resetInSeconds));
    }

    validTimestamps.push(now);
    this.requestLog.set(key, validTimestamps);
  }

  public clear(): void {
    this.requestLog.clear();
  }
}

/** The subset of a Redis client this limiter needs (satisfied by ioredis). */
export interface RedisScriptClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/**
 * Atomic sliding window in one round trip: drop entries older than the window, and admit the call only
 * if the remaining count is under the limit. Returns {admitted, oldest timestamp in the window}.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) or now}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

/**
 * Redis-backed sliding window limiter (FR-67): one budget per user shared by every gateway replica,
 * surviving restarts. If Redis cannot be reached the call is refused, so an outage can never be used to
 * exceed a limit.
 */
export class RedisRateLimiter implements RateLimiter {
  private limits: Record<RateLimitClass, RateLimitConfig>;
  private sequence = 0;

  constructor(private redis: RedisScriptClient, customLimits?: Partial<Record<RateLimitClass, RateLimitConfig>>) {
    this.limits = {
      open: customLimits?.open ?? DEFAULT_RATE_LIMITS.open,
      locked: customLimits?.locked ?? DEFAULT_RATE_LIMITS.locked,
    };
  }

  public async checkLimit(userId: string, type: RateLimitClass, options?: RateLimitOptions): Promise<void> {
    const config = this.limits[type];
    const maxRequests = options?.maxRequests ?? config.maxRequests;
    const now = Date.now();
    const member = `${now}:${process.pid}:${this.sequence++}`;

    let result: unknown;
    try {
      result = await this.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        `ratelimit:${bucketKey(userId, type, options?.scope)}`,
        now,
        config.windowMs,
        maxRequests,
        member
      );
    } catch {
      throw new RateLimitExceededError('Rate limiting is temporarily unavailable. Try again shortly.');
    }

    const [admitted, oldest] = Array.isArray(result) ? (result as number[]) : [0, now];
    if (Number(admitted) !== 1) {
      const resetInSeconds = Math.max(1, Math.ceil((Number(oldest) + config.windowMs - now) / 1000));
      throw new RateLimitExceededError(limitMessage(type, maxRequests, config.windowMs, resetInSeconds));
    }
  }
}
