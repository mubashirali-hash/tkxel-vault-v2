/**
 * Model Context Protocol (MCP) Tool Schemas & Payloads
 * Authoritative reference: tkxel_vault_SRS.md (Section 3.7, Section 5.1, Section 5.2)
 * Standard: Anthropic MCP Specification (2025-11-25) over Streamable HTTP
 */

import { LinkGraph } from './link.js';
import { PageType } from './page.js';

// Common MCP Error Codes
export type McpErrorCode =
  | 'not_allowed'
  | 'not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'timeout'
  | 'internal_error';

export interface McpError {
  code: McpErrorCode;
  message: string;
}

// -----------------------------------------------------------------------------
// Open Vault Retrieval Tools
// -----------------------------------------------------------------------------

// 1. search
export interface SearchToolInput {
  query: string;
  vaults?: string[];
  types?: PageType[];
  tags?: string[];
  limit?: number;
}

export interface SearchResultItem {
  page_id: string;
  title: string;
  vault: string;
  type: PageType;
  snippet: string;
  score: number;
}

// 2. get_page
export interface GetPageToolInput {
  page_id: string;
}

export interface GetPageToolOutput {
  title: string;
  type: PageType;
  front_matter: Record<string, unknown>;
  body_markdown: string;
  links_out: string[];
  backlinks: string[];
  timeline: Array<{ date: string; entry_text: string; created_by: string }>;
}

// 3. get_links
export interface GetLinksToolInput {
  page_id: string;
  depth?: 1 | 2;
}

export type GetLinksToolOutput = LinkGraph;

// 4. get_context
export interface GetContextToolInput {
  query: string;
  max_tokens?: number; // default: 4000
}

export interface GetContextToolOutput {
  pages: Array<{
    title: string;
    body_markdown: string;
  }>;
}

// 5. add_note (Editor Role Only)
export interface AddNoteToolInput {
  page_id?: string;
  title?: string;
  entry: string;
}

export interface AddNoteToolOutput {
  page_id: string;
  version: number;
}

// -----------------------------------------------------------------------------
// Locked Vault Execution Tools
// -----------------------------------------------------------------------------

// 1. list_skills
export interface SkillSummary {
  name: string;
  description: string;
}

export type ListSkillsToolOutput = SkillSummary[];

// 2. run_skill
export interface RunSkillToolInput {
  skill: string;
  inputs: Record<string, unknown>;
}

export interface RunSkillToolOutput {
  result: string;
  format: 'markdown' | 'text';
}

// 3. ask_vault
export interface AskVaultToolInput {
  vault: string;
  question: string;
}

export interface AskVaultToolOutput {
  answer: string; // Max 1,500 characters
}
