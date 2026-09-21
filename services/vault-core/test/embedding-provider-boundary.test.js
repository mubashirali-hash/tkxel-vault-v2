import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEmbeddingProvider,
  EmbeddingConfigurationError,
  LocalDeterministicEmbeddingProvider,
  OpenAiEmbeddingProvider,
  EMBEDDING_DIMENSION,
} from '../dist/search/embedding-provider.js';

test('Epic 5 Chunk 5.2A: Embedding Provider Configuration Boundary & Fail-Closed Security', async (t) => {
  await t.test('1. Production with no provider configured fails closed', () => {
    assert.throws(
      () => getEmbeddingProvider({ env: { NODE_ENV: 'production' } }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Missing required EMBEDDING_PROVIDER in production/);
        return true;
      }
    );
  });

  await t.test('2. Production rejects the deterministic provider', () => {
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: { NODE_ENV: 'production', EMBEDDING_PROVIDER: 'deterministic' },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /strictly prohibited in production/);
        return true;
      }
    );
  });

  await t.test('3. Production OpenAI configuration without an API key fails closed', () => {
    // Missing key
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: { NODE_ENV: 'production', EMBEDDING_PROVIDER: 'openai' },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Missing required OPENAI_API_KEY/);
        return true;
      }
    );

    // Empty or whitespace key
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: {
            NODE_ENV: 'production',
            EMBEDDING_PROVIDER: 'openai',
            OPENAI_API_KEY: '   ',
          },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Missing required OPENAI_API_KEY/);
        return true;
      }
    );
  });

  await t.test('4. Unknown provider names fail closed', () => {
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: { NODE_ENV: 'test', EMBEDDING_PROVIDER: 'cohere' },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Unknown embedding provider "cohere"/);
        return true;
      }
    );
  });

  await t.test('5. Explicit deterministic provider works only in the authorized test environment', () => {
    // Authorized test environment
    const provider = getEmbeddingProvider({
      env: { NODE_ENV: 'test', EMBEDDING_PROVIDER: 'deterministic' },
    });
    assert.ok(provider instanceof LocalDeterministicEmbeddingProvider);
    assert.equal(provider.dimension, 1536);

    // Rejected in development environment
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: { NODE_ENV: 'development', EMBEDDING_PROVIDER: 'deterministic' },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /authorized only in test environments/);
        return true;
      }
    );

    // Rejected in staging environment
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: { NODE_ENV: 'staging', EMBEDDING_PROVIDER: 'deterministic' },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /authorized only in test environments/);
        return true;
      }
    );
  });

  await t.test('6. Deterministic vectors remain exactly 1536 dimensions', async () => {
    const provider = new LocalDeterministicEmbeddingProvider();
    assert.equal(provider.dimension, EMBEDDING_DIMENSION);

    const vector = await provider.generateEmbedding('tkxel Vault cryptographic architecture');
    assert.equal(vector.length, 1536);
    assert.ok(vector.every((n) => typeof n === 'number' && Number.isFinite(n)));

    // Verify L2 normalization
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 1e-4, 'Deterministic vector must be L2 normalized');

    // Batch generation
    const batch = await provider.generateEmbeddings([
      'chunk zero',
      'chunk one',
      'chunk two',
    ]);
    assert.equal(batch.length, 3);
    for (const v of batch) {
      assert.equal(v.length, 1536);
    }
  });

  await t.test('7. Valid OpenAI configuration selects the OpenAI provider without making a network call', () => {
    const provider = getEmbeddingProvider({
      env: {
        NODE_ENV: 'production',
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-live-simulated-key-sample-123456789',
      },
    });

    assert.ok(provider instanceof OpenAiEmbeddingProvider);
    assert.equal(provider.name, 'OpenAI text-embedding-3-small');
    assert.equal(provider.dimension, 1536);
  });

  await t.test('8. Error messages never contain an API key', () => {
    const secretKey = 'sk-SUPER_SECRET_KEY_NEVER_PRINT_OR_LEAK_999';

    // Invalid provider name with secret key present in options
    try {
      getEmbeddingProvider({
        provider: 'invalid-provider-name',
        apiKey: secretKey,
        env: { NODE_ENV: 'production' },
      });
      assert.fail('Should have thrown EmbeddingConfigurationError');
    } catch (err) {
      assert.ok(!err.message.includes(secretKey), 'API key was leaked in error message');
      assert.ok(!JSON.stringify(err).includes(secretKey), 'API key was leaked in error serialization');
    }

    // Missing key error with secret key
    try {
      getEmbeddingProvider({
        provider: 'openai',
        apiKey: '   ',
        env: { NODE_ENV: 'production', OPENAI_API_KEY: secretKey },
      });
    } catch (err) {
      assert.ok(!err.message.includes(secretKey), 'API key was leaked in error message');
    }
  });

  await t.test('9. Provider configuration is not selected implicitly from API-key presence or absence', () => {
    // API key present, but EMBEDDING_PROVIDER unset -> MUST FAIL CLOSED, not assume openai
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: {
            NODE_ENV: 'test',
            OPENAI_API_KEY: 'sk-present-key-12345',
          },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Missing required EMBEDDING_PROVIDER/);
        return true;
      }
    );

    // API key absent, EMBEDDING_PROVIDER unset in test -> MUST FAIL CLOSED, not assume deterministic
    assert.throws(
      () =>
        getEmbeddingProvider({
          env: {
            NODE_ENV: 'test',
          },
        }),
      (err) => {
        assert.ok(err instanceof EmbeddingConfigurationError);
        assert.match(err.message, /Missing required EMBEDDING_PROVIDER/);
        return true;
      }
    );
  });
});
