import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAiEmbeddingProvider,
  EmbeddingTimeoutError,
  EmbeddingValidationError,
  EmbeddingConfigurationError,
  EmbeddingApiError,
  EMBEDDING_DIMENSION,
} from '../dist/search/embedding-provider.js';

function createDummyVector(dim = EMBEDDING_DIMENSION, fillValue = 0.05) {
  return new Array(dim).fill(fillValue);
}

test('Epic 5 Chunk 5.2B & 5.2C: Provider Timeout, Bounded Retries, Batching, and Dimension Validation', async (t) => {
  await t.test('10. Requests time out within the configured bound', async () => {
    let receivedSignal = null;
    const hangingFetch = async (_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((_, reject) => {
        if (receivedSignal) {
          receivedSignal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test-key-timeout',
      timeoutMs: 40,
      maxRetries: 0,
      fetch: hangingFetch,
    });

    await assert.rejects(
      async () => provider.generateEmbedding('test timeout content'),
      (err) => {
        assert.ok(err instanceof EmbeddingTimeoutError);
        assert.match(err.message, /timed out after 40ms/);
        return true;
      }
    );
  });

  await t.test('11. Retryable failures retry only within the configured limit', async () => {
    let callCount = 0;
    const recordedDelays = [];

    // Fails with 429 twice, then succeeds on 3rd attempt
    const mockFetch = async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' });
      }
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: createDummyVector() }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test-retryable',
      maxRetries: 2,
      fetch: mockFetch,
      delayFn: async (ms) => {
        recordedDelays.push(ms);
      },
    });

    const vec = await provider.generateEmbedding('hello retry');
    assert.equal(callCount, 3, 'Expected 1 initial attempt + 2 retries');
    assert.equal(recordedDelays.length, 2);
    assert.equal(vec.length, EMBEDDING_DIMENSION);

    // If retry limit is exceeded, it must fail closed
    let callCountExhaust = 0;
    const failingFetch = async () => {
      callCountExhaust++;
      return new Response('Gateway timeout', { status: 504, statusText: 'Gateway Timeout' });
    };

    const failingProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-test-retry-exhaust',
      maxRetries: 2,
      fetch: failingFetch,
      delayFn: async () => {},
    });

    await assert.rejects(
      async () => failingProvider.generateEmbedding('exhaust retry'),
      (err) => {
        assert.ok(err instanceof EmbeddingApiError);
        assert.equal(err.status, 504);
        return true;
      }
    );
    assert.equal(callCountExhaust, 3, 'Must not retry beyond maxRetries + 1');
  });

  await t.test('12. Non-retryable failures are not retried', async () => {
    let authCallCount = 0;
    const authFailFetch = async () => {
      authCallCount++;
      return new Response('Invalid Authentication', { status: 401, statusText: 'Unauthorized' });
    };

    const authProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-invalid-auth',
      maxRetries: 3,
      fetch: authFailFetch,
      delayFn: async () => assert.fail('Should not backoff on non-retryable 401'),
    });

    await assert.rejects(
      async () => authProvider.generateEmbedding('auth check'),
      (err) => {
        assert.ok(err instanceof EmbeddingApiError);
        assert.equal(err.status, 401);
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(authCallCount, 1, 'Must fail immediately on 401 without retry');

    // 400 Bad Request
    let badRequestCount = 0;
    const badRequestFetch = async () => {
      badRequestCount++;
      return new Response('Bad Request', { status: 400, statusText: 'Bad Request' });
    };

    const badRequestProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-bad-req',
      maxRetries: 3,
      fetch: badRequestFetch,
    });

    await assert.rejects(
      async () => badRequestProvider.generateEmbedding('bad request'),
      (err) => {
        assert.ok(err instanceof EmbeddingApiError);
        assert.equal(err.status, 400);
        return true;
      }
    );
    assert.equal(badRequestCount, 1, 'Must fail immediately on 400 without retry');
  });

  await t.test('13. Backoff is bounded and testable without real delays', async () => {
    const delays = [];
    let attempts = 0;
    const serviceUnavailableFetch = async () => {
      attempts++;
      return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-backoff-test',
      maxRetries: 4,
      fetch: serviceUnavailableFetch,
      delayFn: async (ms) => {
        delays.push(ms);
      },
    });

    await assert.rejects(async () => provider.generateEmbedding('backoff test'));
    assert.equal(attempts, 5); // 1 initial + 4 retries
    assert.equal(delays.length, 4);
    // Backoff formula: min(2000, 50 * 2^attempt) -> 50, 100, 200, 400
    assert.deepEqual(delays, [50, 100, 200, 400]);
    assert.ok(delays.every((d) => d <= 2000), 'Backoff must remain bounded');
  });

  await t.test('14. Inputs are batched according to the configured maximum', async () => {
    const batchRequests = [];

    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const input = body.input;
      batchRequests.push(input);
      return new Response(
        JSON.stringify({
          data: input.map((_, idx) => ({
            index: idx,
            embedding: createDummyVector(EMBEDDING_DIMENSION, idx * 0.1),
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-batching-test',
      maxBatchSize: 2, // explicit max batch size of 2
      fetch: mockFetch,
    });

    const inputs = ['item 1', 'item 2', 'item 3', 'item 4', 'item 5'];
    const results = await provider.generateEmbeddings(inputs);

    assert.equal(batchRequests.length, 3, '5 items with maxBatchSize 2 should require 3 batches');
    assert.deepEqual(batchRequests[0], ['item 1', 'item 2']);
    assert.deepEqual(batchRequests[1], ['item 3', 'item 4']);
    assert.deepEqual(batchRequests[2], ['item 5']);
    assert.equal(results.length, 5);
  });

  await t.test('15. Batch results preserve input ordering', async () => {
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const input = body.input;
      const data = input.map((text, idx) => ({
        index: idx,
        embedding: createDummyVector(EMBEDDING_DIMENSION, Number(text.split(' ')[1])),
      }));

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-order-test',
      maxBatchSize: 10,
      fetch: mockFetch,
    });

    const inputs = ['doc 0', 'doc 1', 'doc 2', 'doc 3'];
    const results = await provider.generateEmbeddings(inputs);

    assert.equal(results.length, 4);
    assert.equal(results[0][0], 0);
    assert.equal(results[1][0], 1);
    assert.equal(results[2][0], 2);
    assert.equal(results[3][0], 3);
  });

  await t.test('15b. Out-of-order provider indices are rejected fail-closed without sorting', async () => {
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const input = body.input;
      // Intentionally return in reverse index order
      const data = input
        .map((_, idx) => ({
          index: idx,
          embedding: createDummyVector(EMBEDDING_DIMENSION, 0.1),
        }))
        .reverse();

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-no-sort-test',
      maxRetries: 0,
      fetch: mockFetch,
    });

    await assert.rejects(
      async () => provider.generateEmbeddings(['doc 0', 'doc 1']),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /Out-of-order, duplicate, or mismatched index/);
        return true;
      }
    );
  });

  await t.test('15c. Duplicate or missing indices are rejected fail-closed', async () => {
    // Duplicate indices [0, 0]
    const duplicateFetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: createDummyVector() },
            { index: 0, embedding: createDummyVector() },
          ],
        }),
        { status: 200 }
      );

    const dupProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-dup-test',
      maxRetries: 0,
      fetch: duplicateFetch,
    });

    await assert.rejects(
      async () => dupProvider.generateEmbeddings(['a', 'b']),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /Out-of-order, duplicate, or mismatched index/);
        return true;
      }
    );

    // Missing index property
    const missingIndexFetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: createDummyVector() }],
        }),
        { status: 200 }
      );

    const missingIndexProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-missing-index',
      maxRetries: 0,
      fetch: missingIndexFetch,
    });

    await assert.rejects(
      async () => missingIndexProvider.generateEmbeddings(['a']),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /missing or invalid integer index/);
        return true;
      }
    );

    // Negative index
    const negativeIndexFetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ index: -1, embedding: createDummyVector() }],
        }),
        { status: 200 }
      );

    const negProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-neg-index',
      maxRetries: 0,
      fetch: negativeIndexFetch,
    });

    await assert.rejects(
      async () => negProvider.generateEmbeddings(['a']),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /missing or invalid integer index/);
        return true;
      }
    );
  });

  await t.test('15d. Provider configuration boundaries validate timeoutMs, maxRetries, maxBatchSize', async () => {
    // timeoutMs <= 0 or > 300000
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', timeoutMs: 0 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid timeoutMs/.test(err.message)
    );
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', timeoutMs: 300001 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid timeoutMs/.test(err.message)
    );

    // maxRetries < 0 or > 10 or non-integer
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', maxRetries: -1 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid maxRetries/.test(err.message)
    );
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', maxRetries: 11 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid maxRetries/.test(err.message)
    );
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', maxRetries: 2.5 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid maxRetries/.test(err.message)
    );

    // maxBatchSize <= 0 or > 2048 or non-integer
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', maxBatchSize: 0 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid maxBatchSize/.test(err.message)
    );
    assert.throws(
      () => new OpenAiEmbeddingProvider({ apiKey: 'sk-cfg', maxBatchSize: 2049 }),
      (err) => err instanceof EmbeddingConfigurationError && /Invalid maxBatchSize/.test(err.message)
    );
  });

  await t.test('16. Empty input is handled consistently', async () => {
    let networkCalls = 0;
    const mockFetch = async () => {
      networkCalls++;
      return new Response('{}');
    };

    const provider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-empty-test',
      fetch: mockFetch,
    });

    const emptyResults = await provider.generateEmbeddings([]);
    assert.deepEqual(emptyResults, []);
    assert.equal(networkCalls, 0, 'Empty input array must make zero network calls');
  });

  await t.test('17. Malformed provider responses fail closed', async () => {
    // Non-JSON response
    const invalidJsonProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-invalid-json',
      maxRetries: 0,
      fetch: async () => new Response('Not valid JSON', { status: 200 }),
    });

    await assert.rejects(
      async () => invalidJsonProvider.generateEmbedding('test'),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /failed to parse JSON/);
        return true;
      }
    );

    // Missing data array
    const missingDataProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-missing-data',
      maxRetries: 0,
      fetch: async () => new Response(JSON.stringify({ wrong: [] }), { status: 200 }),
    });

    await assert.rejects(
      async () => missingDataProvider.generateEmbedding('test'),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /missing "data" array/);
        return true;
      }
    );

    // Returned item count mismatch
    const countMismatchProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-count-mismatch',
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 0, embedding: createDummyVector() },
              { index: 1, embedding: createDummyVector() },
            ],
          }),
          { status: 200 }
        ),
    });

    await assert.rejects(
      async () => countMismatchProvider.generateEmbeddings(['single item input']),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /expected exactly 1 items for batch/);
        return true;
      }
    );
  });

  await t.test('18. Wrong vector dimensions fail closed', async () => {
    // Vector with 512 dimensions instead of 1536
    const wrongDimProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-wrong-dim',
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: createDummyVector(512) }],
          }),
          { status: 200 }
        ),
    });

    await assert.rejects(
      async () => wrongDimProvider.generateEmbedding('test wrong dim'),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /expected 1536, got 512/);
        return true;
      }
    );
  });

  await t.test('19. Invalid vectors are never persisted (non-finite numerical validation)', async () => {
    // Vector containing NaN and Infinity
    const corruptedVector = createDummyVector(1536);
    corruptedVector[10] = NaN;

    const corruptedProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-corrupted-vector',
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: corruptedVector }],
          }),
          { status: 200 }
        ),
    });

    await assert.rejects(
      async () => corruptedProvider.generateEmbedding('corrupted'),
      (err) => {
        assert.ok(err instanceof EmbeddingValidationError);
        assert.match(err.message, /Non-finite numerical value detected/);
        return true;
      }
    );
  });

  await t.test('20. Provider failures never fall back to deterministic vectors', async () => {
    const failingProvider = new OpenAiEmbeddingProvider({
      apiKey: 'sk-fail-never-fallback',
      maxRetries: 0,
      fetch: async () => new Response('Internal error', { status: 500 }),
    });

    await assert.rejects(
      async () => failingProvider.generateEmbedding('do not fallback'),
      (err) => {
        assert.ok(err instanceof EmbeddingApiError);
        assert.equal(err.status, 500);
        return true;
      }
    );
  });
});
