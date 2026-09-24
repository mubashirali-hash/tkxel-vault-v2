/**
 * Pluggable Embedding Provider for tkxel Vault
 * Supports OpenAI text-embedding-3-small and a local deterministic engine for offline test execution.
 * Enforces fail-closed configuration, zero-disclosure of secrets, bounded retries, timeouts, batching,
 * and strict 1536-dimensional vector validation.
 */

export const EMBEDDING_DIMENSION = 1536;
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_BATCH_SIZE = 100;

export class EmbeddingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingConfigurationError';
  }
}

export class EmbeddingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingTimeoutError';
  }
}

export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingValidationError';
  }
}

/**
 * Centralized runtime validator for embedding batches.
 * Enforces strict fail-closed validation on any provider output prior to database mutations:
 * - result-count mismatch
 * - missing vectors (null, undefined, non-array)
 * - dimensions other than 1536
 * - non-numeric, NaN, or infinite values
 */
export function validateEmbeddingBatch(
  embeddings: unknown,
  expectedCount: number
): number[][] {
  if (!Array.isArray(embeddings)) {
    throw new EmbeddingValidationError(
      `Malformed embedding batch: expected array of vectors, got ${typeof embeddings}.`
    );
  }

  if (embeddings.length !== expectedCount) {
    throw new EmbeddingValidationError(
      `Embedding count mismatch: generated ${embeddings.length}, expected exactly ${expectedCount}.`
    );
  }

  const validated: number[][] = [];

  for (let i = 0; i < embeddings.length; i++) {
    const vec = embeddings[i];
    if (!Array.isArray(vec)) {
      throw new EmbeddingValidationError(
        `Missing or malformed vector at index ${i}: vector must be an array, got ${typeof vec}.`
      );
    }

    if (vec.length !== EMBEDDING_DIMENSION) {
      throw new EmbeddingValidationError(
        `Wrong vector dimension at index ${i}: expected ${EMBEDDING_DIMENSION}, got ${vec.length}.`
      );
    }

    for (let d = 0; d < vec.length; d++) {
      const val = vec[d];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new EmbeddingValidationError(
          `Non-finite numerical value detected in vector at index ${i}, dimension ${d}.`
        );
      }
    }

    validated.push(vec);
  }

  return validated;
}

export class EmbeddingApiError extends Error {
  public readonly status?: number;
  public readonly retryable: boolean;

  constructor(message: string, status?: number, retryable: boolean = false) {
    super(message);
    this.name = 'EmbeddingApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

/**
 * Local Deterministic Embedding Provider (1536 dimensions)
 * Computes L2-normalized feature embeddings from text tokens without network calls.
 * STRICTLY TEST-ONLY: Never authorized in production environments.
 */
export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'tkxel-vault-local-deterministic-1536';
  public readonly dimension = EMBEDDING_DIMENSION;

  async generateEmbedding(text: string): Promise<number[]> {
    const dim = this.dimension;
    const vec = new Array(dim).fill(0);
    const words = (text || '').toLowerCase().match(/\w+/g) || [];

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) % dim;
      }
      vec[Math.abs(hash)] += 1;
    }

    // L2 normalize vector for cosine similarity
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }
}

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxBatchSize?: number;
  fetch?: typeof fetch;
  delayFn?: (ms: number) => Promise<void>;
}

/**
 * OpenAI text-embedding-3-small provider (1536 dimensions)
 * Production-ready with timeout, bounded retries, batching, and strict shape/dimension validation.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'OpenAI text-embedding-3-small';
  public readonly dimension = EMBEDDING_DIMENSION;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxBatchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    const key = options.apiKey?.trim();
    if (!key) {
      throw new EmbeddingConfigurationError('Missing required OPENAI_API_KEY for openai embedding provider.');
    }
    this.apiKey = key;
    this.model = options.model ?? 'text-embedding-3-small';
    this.baseUrl = (options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) {
      throw new EmbeddingConfigurationError(
        `Invalid timeoutMs: expected positive number <= 300000, got ${timeoutMs}.`
      );
    }
    this.timeoutMs = timeoutMs;

    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new EmbeddingConfigurationError(
        `Invalid maxRetries: expected integer between 0 and 10, got ${maxRetries}.`
      );
    }
    this.maxRetries = maxRetries;

    const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    if (typeof maxBatchSize !== 'number' || !Number.isInteger(maxBatchSize) || maxBatchSize <= 0 || maxBatchSize > 2048) {
      throw new EmbeddingConfigurationError(
        `Invalid maxBatchSize: expected integer between 1 and 2048, got ${maxBatchSize}.`
      );
    }
    this.maxBatchSize = maxBatchSize;

    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.delayFn = options.delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const allResults: number[][] = [];

    // Process in batches according to maxBatchSize
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchVectors = await this.executeBatchWithRetry(batch);
      allResults.push(...batchVectors);
    }

    return allResults;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateEmbeddings([text]);
    if (!results[0] || results[0].length !== EMBEDDING_DIMENSION) {
      throw new EmbeddingValidationError('Provider failed to return a valid 1536-dimensional vector for input.');
    }
    return results[0];
  }

  private async executeBatchWithRetry(batchTexts: string[]): Promise<number[][]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: batchTexts.map((t) => (typeof t === 'string' ? t.slice(0, 8000) : '')),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const status = response.status;
          const isRetryable = status === 429 || (status >= 500 && status <= 599);
          let safeSnippet = '';
          try {
            const rawBody = await response.text();
            safeSnippet = rawBody.slice(0, 200).replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
          } catch {
            safeSnippet = response.statusText || 'Unknown error';
          }
          throw new EmbeddingApiError(
            `OpenAI Embedding API error (${status}): ${safeSnippet}`,
            status,
            isRetryable
          );
        }

        let jsonPayload: any;
        try {
          jsonPayload = await response.json();
        } catch (parseErr: any) {
          throw new EmbeddingValidationError(`Malformed response: failed to parse JSON from provider: ${parseErr?.message}`);
        }

        // Validate structure
        if (!jsonPayload || typeof jsonPayload !== 'object' || !Array.isArray(jsonPayload.data)) {
          throw new EmbeddingValidationError('Malformed response: missing "data" array in provider response.');
        }

        const dataArr = jsonPayload.data;
        if (dataArr.length !== batchTexts.length) {
          throw new EmbeddingValidationError(
            `Provider returned ${dataArr.length} items, expected exactly ${batchTexts.length} items for batch.`
          );
        }

        // Strict index validation: DO NOT SORT.
        // Validate each item at its exact index position.
        const validatedVectors: number[][] = [];

        for (let idx = 0; idx < dataArr.length; idx++) {
          const item = dataArr[idx];
          if (!item || typeof item !== 'object') {
            throw new EmbeddingValidationError(
              `Malformed response: item at position ${idx} must be an object.`
            );
          }

          if (typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0) {
            throw new EmbeddingValidationError(
              `Malformed response: missing or invalid integer index at position ${idx}, got ${item?.index}.`
            );
          }

          if (item.index !== idx) {
            throw new EmbeddingValidationError(
              `Out-of-order, duplicate, or mismatched index received at position ${idx}: expected index ${idx}, got ${item.index}.`
            );
          }

          if (!Array.isArray(item.embedding)) {
            throw new EmbeddingValidationError(`Malformed embedding at index ${idx}: "embedding" must be an array.`);
          }

          if (item.embedding.length !== EMBEDDING_DIMENSION) {
            throw new EmbeddingValidationError(
              `Wrong vector dimension at index ${idx}: expected ${EMBEDDING_DIMENSION}, got ${item.embedding.length}.`
            );
          }

          for (let d = 0; d < item.embedding.length; d++) {
            const val = item.embedding[d];
            if (typeof val !== 'number' || !Number.isFinite(val)) {
              throw new EmbeddingValidationError(
                `Non-finite numerical value detected in vector at index ${idx}, dimension ${d}.`
              );
            }
          }

          validatedVectors.push(item.embedding);
        }

        return validatedVectors;
      } catch (err: any) {
        if (timedOut || err.name === 'AbortError') {
          lastError = new EmbeddingTimeoutError(`OpenAI embedding request timed out after ${this.timeoutMs}ms.`);
        } else {
          lastError = err;
        }

        const isRetryable =
          lastError instanceof EmbeddingTimeoutError ||
          (lastError instanceof EmbeddingApiError && lastError.retryable) ||
          (lastError instanceof TypeError && !('status' in lastError)); // Network error

        if (isRetryable && attempt < this.maxRetries) {
          const backoff = Math.min(2000, 50 * Math.pow(2, attempt));
          await this.delayFn(backoff);
          continue;
        }

        // Non-retryable failure or exhausted retries: fail closed immediately.
        // NEVER silently fall back to deterministic vectors!
        throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new EmbeddingApiError('Exhausted retry limit for embedding request.', undefined, false);
  }
}

export interface EmbeddingProviderOptions {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  nodeEnv?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxBatchSize?: number;
  fetch?: typeof fetch;
  delayFn?: (ms: number) => Promise<void>;
}

/**
 * Factory function returning configured embedding provider.
 * Fail-closed:
 * 1. Missing EMBEDDING_PROVIDER throws EmbeddingConfigurationError.
 * 2. Deterministic provider strictly rejected in production.
 * 3. Deterministic provider permitted only in test environment (NODE_ENV=test).
 * 4. OpenAI provider requires valid non-empty OPENAI_API_KEY.
 * 5. Unknown provider names fail closed.
 * 6. Never logs secrets or interpolates API keys into error messages.
 */
export function getEmbeddingProvider(options?: EmbeddingProviderOptions): EmbeddingProvider {
  const env = options?.env ?? process.env;
  const nodeEnv = (options?.nodeEnv ?? env.NODE_ENV ?? process.env.NODE_ENV ?? 'development').toLowerCase();
  const provider = (options?.provider ?? env.EMBEDDING_PROVIDER ?? process.env.EMBEDDING_PROVIDER)?.trim().toLowerCase();

  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  if (!provider) {
    throw new EmbeddingConfigurationError(
      isProduction
        ? 'Missing required EMBEDDING_PROVIDER in production environment. Production must explicitly configure an authorized provider.'
        : 'Missing required EMBEDDING_PROVIDER. Provider must be explicitly configured as "openai" or "deterministic" (test-only).'
    );
  }

  if (provider === 'deterministic') {
    if (isProduction) {
      throw new EmbeddingConfigurationError(
        'Deterministic embedding provider is strictly prohibited in production environments.'
      );
    }
    if (!isTest) {
      throw new EmbeddingConfigurationError(
        'Deterministic embedding provider is authorized only in test environments (NODE_ENV=test).'
      );
    }
    return new LocalDeterministicEmbeddingProvider();
  }

  if (provider === 'openai') {
    const rawApiKey = options?.apiKey ?? env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    const apiKey = rawApiKey?.trim();
    if (!apiKey || apiKey.length === 0) {
      throw new EmbeddingConfigurationError(
        'Missing required OPENAI_API_KEY for openai embedding provider.'
      );
    }
    return new OpenAiEmbeddingProvider({
      apiKey,
      baseUrl: options?.baseUrl ?? env.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL,
      timeoutMs: options?.timeoutMs,
      maxRetries: options?.maxRetries,
      maxBatchSize: options?.maxBatchSize,
      fetch: options?.fetch,
      delayFn: options?.delayFn,
    });
  }

  throw new EmbeddingConfigurationError(
    `Unknown embedding provider "${provider}". Supported providers are "openai" or "deterministic" (test-only).`
  );
}
