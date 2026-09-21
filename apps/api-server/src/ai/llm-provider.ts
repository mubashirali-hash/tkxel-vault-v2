export interface LlmCompletionRequest {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  name: string;
  generateText(request: LlmCompletionRequest): Promise<string>;
  generateJson<T = unknown>(request: LlmCompletionRequest): Promise<T>;
}

/**
 * Mock LLM Provider for local development, offline mode, and deterministic testing.
 * Implements intelligent heuristic generation based on semantic matching.
 */
export class MockLlmProvider implements LlmProvider {
  public readonly name = 'tkxel Vault Heuristic AI Engine (Local / Mock)';

  async generateText(request: LlmCompletionRequest): Promise<string> {
    const prompt = (request.userPrompt || '').toLowerCase();

    if (prompt.includes('summarize')) {
      return '### Executive Summary\n- **Core Objective:** Centralized knowledge and skill management.\n- **Architecture:** Encrypted storage with bidirectional link graph.\n- **Integration:** Anthropic Model Context Protocol (MCP) Streamable HTTP gateway.';
    }

    if (prompt.includes('draft skill') || prompt.includes('skill.md')) {
      return `---
name: Generated Skill
description: Extracted from note instructions for zero-read execution.
tools:
  - run_analysis
---

# Instructions
Execute the analytical workflow as defined in the source specifications.`;
    }

    return `Synthesized answer based on provided note context:\nThe note defines key operational procedures and architectural invariants conforming to tkxel Vault standards.`;
  }

  async generateJson<T = unknown>(request: LlmCompletionRequest): Promise<T> {
    const prompt = request.userPrompt;
    
    // Check if the prompt asks for links
    if (prompt.includes('suggest-links') || prompt.includes('potential connections')) {
      return {
        suggestions: [
          {
            targetTitle: 'Security Model',
            relationType: 'implements',
            confidence: 0.94,
            rationale: 'Note discusses AES-256-GCM encryption and KMS key envelopes which are defined in the Security Model.',
            snippet: 'Envelope encryption with AES-256-GCM',
          },
          {
            targetTitle: 'Database Schema',
            relationType: 'architecture_for',
            confidence: 0.88,
            rationale: 'Discusses page persistence, revisions, and graph links matching the PostgreSQL schema.',
            snippet: 'Storing bidirectional links and page metadata',
          },
        ]
      } as unknown as T;
    }

    // Default JSON
    return {
      category: 'architecture',
      suggestedTags: ['architecture', 'backend', 'core'],
      suggestedAliases: ['arch-overview'],
      clusterName: 'Core Infrastructure',
      summary: 'Architectural overview of system components and cryptographic boundaries.'
    } as unknown as T;
  }
}

/**
 * Anthropic Claude API Provider using Claude Messages API.
 */
export class AnthropicLlmProvider implements LlmProvider {
  public readonly name = 'Anthropic Claude (claude-3-5-sonnet)';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(request: LlmCompletionRequest): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        system: request.systemPrompt || 'You are an expert AI assistant embedded inside tkxel Vault context hub.',
        messages: [{ role: 'user', content: request.userPrompt }],
        max_tokens: request.maxTokens || 2048,
        temperature: request.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API Error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    return data.content?.[0]?.text || '';
  }

  async generateJson<T = unknown>(request: LlmCompletionRequest): Promise<T> {
    const jsonPrompt = `${request.userPrompt}\n\nIMPORTANT: Respond ONLY with a valid, parseable JSON object. Do not include markdown code block formatting or backticks.`;
    const raw = await this.generateText({
      ...request,
      userPrompt: jsonPrompt,
    });

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
}

/**
 * Google Gemini API Provider.
 */
export class GeminiLlmProvider implements LlmProvider {
  public readonly name = 'Google Gemini (gemini-3.6-flash)';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(request: LlmCompletionRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.apiKey}`;
    const body: any = {
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
    };
    if (request.systemPrompt) {
      body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async generateJson<T = unknown>(request: LlmCompletionRequest): Promise<T> {
    const jsonPrompt = `${request.userPrompt}\n\nIMPORTANT: Respond ONLY with a valid, parseable JSON object. Do not include markdown code block formatting or backticks.`;
    const raw = await this.generateText({ ...request, userPrompt: jsonPrompt });
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
}

/**
 * OpenAI API Provider.
 */
export class OpenAiLlmProvider implements LlmProvider {
  public readonly name = 'OpenAI (gpt-4o)';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateText(request: LlmCompletionRequest): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.userPrompt },
        ],
        temperature: request.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateJson<T = unknown>(request: LlmCompletionRequest): Promise<T> {
    const jsonPrompt = `${request.userPrompt}\n\nIMPORTANT: Respond ONLY with a valid, parseable JSON object. Do not include markdown code block formatting or backticks.`;
    const raw = await this.generateText({ ...request, userPrompt: jsonPrompt });
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
}

/**
 * Factory that returns the configured LLM provider.
 */
export function getLlmProvider(): LlmProvider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey && anthropicKey.startsWith('sk-ant-') && anthropicKey !== 'sk-ant-dummy_key') {
    return new AnthropicLlmProvider(anthropicKey);
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey.length > 10 && geminiKey !== 'dummy_key') {
    return new GeminiLlmProvider(geminiKey);
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey && openAiKey.startsWith('sk-') && openAiKey !== 'sk-dummy_key') {
    return new OpenAiLlmProvider(openAiKey);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Approved LLM provider API key (ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY) must be configured in production mode. Mock LLM is disallowed.');
  }

  return new MockLlmProvider();
}
