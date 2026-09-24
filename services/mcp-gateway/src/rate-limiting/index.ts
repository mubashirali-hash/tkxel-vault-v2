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

/**
 * Sliding Window Rate Limiter (FR-67).
 * Prevents denial of service and enforces usage quotas per user and tool type.
 */
export class SlidingWindowRateLimiter {
  private requestLog = new Map<string, number[]>();
  private limits: Record<'open' | 'locked', RateLimitConfig>;

  constructor(customLimits?: Partial<Record<'open' | 'locked', RateLimitConfig>>) {
    this.limits = {
      open: customLimits?.open ?? { maxRequests: 300, windowMs: 60 * 60 * 1000 }, // 300 req / hour
      locked: customLimits?.locked ?? { maxRequests: 60, windowMs: 60 * 60 * 1000 }, // 60 req / hour
    };
  }

  /**
   * Evaluates request timestamp against sliding window.
   * Throws RateLimitExceededError if limit is breached.
   */
  public checkLimit(userId: string, type: 'open' | 'locked'): void {
    const key = `${userId}:${type}`;
    const now = Date.now();
    const config = this.limits[type];

    const timestamps = this.requestLog.get(key) || [];
    // Filter out timestamps outside window
    const windowStart = now - config.windowMs;
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= config.maxRequests) {
      const oldestValid = validTimestamps[0];
      const resetInSeconds = Math.ceil((oldestValid + config.windowMs - now) / 1000);
      throw new RateLimitExceededError(
        `Rate limit exceeded for '${type}' tools. Maximum ${config.maxRequests} requests per ${
          config.windowMs / 1000 / 60
        } minutes. Try again in ${resetInSeconds} seconds.`
      );
    }

    validTimestamps.push(now);
    this.requestLog.set(key, validTimestamps);
  }

  public clear(): void {
    this.requestLog.clear();
  }
}
