import test from 'node:test';
import assert from 'node:assert/strict';
import { isLlmProviderAvailable } from '../dist/ai/llm-provider.js';

test('note assistant: available with an approved key, or outside production', () => {
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-real-looking-key' }), true);
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-real-looking-key' }), true);
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', GEMINI_API_KEY: 'a-long-enough-gemini-key' }), true);
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'development' }), true, 'the stand-in is allowed in development');
});

test('note assistant: a production server with no model key runs without it', () => {
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production' }), false);
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-dummy_key' }), false, 'placeholder keys do not count');
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-dummy_key' }), false);
  assert.equal(isLlmProviderAvailable({ NODE_ENV: 'production', ANTHROPIC_API_KEY: '   ' }), false);
});
