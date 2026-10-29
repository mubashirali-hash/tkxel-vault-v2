import { McpToolDefinition, ToolCallContext, ToolCallResult } from '../transport/streamable-http.js';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { inArray } from 'drizzle-orm';
import { OPEN_RETRIEVAL_TOOLS, OPEN_EDITOR_TOOLS, LOCKED_TOOLS } from '../auth/policy.js';

export const LIST_VAULTS_TOOL: McpToolDefinition = {
  name: 'list_vaults',
  description:
    'List the vaults you can use and their IDs. Call this first: every other tool needs a vault ID. Open vaults can be searched and read; locked vaults only run skills and answer questions.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export type VaultNameResolver = (vaultIds: string[]) => Promise<Map<string, string>>;

/** Looks vault names up in PostgreSQL. Only ever called with IDs the caller already holds a role on. */
export const postgresVaultNameResolver: VaultNameResolver = async (vaultIds) => {
  if (vaultIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.vaults.id, name: schema.vaults.name })
    .from(schema.vaults)
    .where(inArray(schema.vaults.id, vaultIds));
  return new Map(rows.map((r) => [r.id, r.name]));
};

/**
 * Vault discovery for MCP clients. The list is built purely from the caller's own resolved access, so it
 * can only ever name vaults the caller is already entitled to use, and it lists which tools apply to each.
 */
export function createVaultDiscoveryHandler(resolveNames: VaultNameResolver = postgresVaultNameResolver) {
  return async (_params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
    const entries: Array<{ vault_id: string; mode: 'open' | 'locked'; role: string; tools: string[] }> = [];

    for (const [vaultId, role] of context.roles) {
      const mode = context.vaultModes?.get(vaultId);
      if (mode === 'open' && ['owner', 'editor', 'reader'].includes(role)) {
        entries.push({
          vault_id: vaultId,
          mode,
          role,
          tools: [...OPEN_RETRIEVAL_TOOLS, ...(role === 'reader' ? [] : OPEN_EDITOR_TOOLS)],
        });
      } else if (mode === 'locked' && ['owner', 'editor', 'consumer'].includes(role)) {
        entries.push({ vault_id: vaultId, mode, role, tools: [...LOCKED_TOOLS] });
      }
    }

    const names = await resolveNames(entries.map((e) => e.vault_id));
    const vaults = entries
      .map((e) => ({ vault_id: e.vault_id, name: names.get(e.vault_id) ?? '', mode: e.mode, role: e.role, tools: e.tools }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      content: [{ type: 'text', text: JSON.stringify(vaults, null, 2) }],
      structuredContent: { vaults },
    };
  };
}
