import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SlidingWindowRateLimiter,
  RateLimitExceededError,
} from '../dist/rate-limiting/index.js';

test('Rate Limiter: allows requests within quota', () => {
  const limiter = new SlidingWindowRateLimiter({
    open: { maxRequests: 5, windowMs: 1000 },
  });

  const userId = 'usr_norm';
  for (let i = 0; i < 5; i++) {
    assert.doesNotThrow(() => limiter.checkLimit(userId, 'open'));
  }
});

test('Rate Limiter: throws RateLimitExceededError when quota is exceeded', () => {
  const limiter = new SlidingWindowRateLimiter({
    locked: { maxRequests: 3, windowMs: 2000 },
  });

  const userId = 'usr_heavy';
  limiter.checkLimit(userId, 'locked');
  limiter.checkLimit(userId, 'locked');
  limiter.checkLimit(userId, 'locked');

  assert.throws(
    () => {
      limiter.checkLimit(userId, 'locked');
    },
    (err) => {
      assert.ok(err instanceof RateLimitExceededError);
      assert.match(err.message, /Rate limit exceeded for 'locked' tools/);
      return true;
    }
  );
});
