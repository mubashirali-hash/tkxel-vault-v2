import readline from 'node:readline';
import { StreamableHttpTransport, JsonRpcRequest } from './transport/streamable-http.js';
import {
  SEARCH_TOOL,
  GET_PAGE_TOOL,
  GET_LINKS_TOOL,
  GET_CONTEXT_TOOL,
  ADD_NOTE_TOOL,
  createOpenRetrievalHandlers,
} from './tools/open-retrieval.js';
import {
  LIST_SKILLS_TOOL,
  ASK_VAULT_TOOL,
  RUN_SKILL_TOOL,
  createLockedRetrievalHandlers,
} from './tools/locked-tools.js';
import { PostgresOpenVaultStore } from './tools/postgres-store.js';
import { ToolPalettePolicy } from './auth/policy.js';
import { getUserAccessibleVaults } from '@tkxel-vault/vault-core';

/**
 * Standard Stdio JSON-RPC MCP Server.
 * Enables Claude Desktop, Cursor, Antigravity IDE, Cline, and other agents
 * to connect directly via stdio sub-process command.
 */
async function runStdioMcpServer() {
  const transport = new StreamableHttpTransport();
  const store = new PostgresOpenVaultStore();

  // Register all 5 Open Retrieval Tools
  const openHandlers = createOpenRetrievalHandlers(store);
  transport.registerTool(SEARCH_TOOL, openHandlers.handleSearch);
  transport.registerTool(GET_PAGE_TOOL, openHandlers.handleGetPage);
  transport.registerTool(GET_LINKS_TOOL, openHandlers.handleGetLinks);
  transport.registerTool(GET_CONTEXT_TOOL, openHandlers.handleGetContext);
  transport.registerTool(ADD_NOTE_TOOL, openHandlers.handleAddNote);

  // Register all 3 Locked Vault Tools (list_skills, run_skill, ask_vault)
  const lockedHandlers = createLockedRetrievalHandlers();
  transport.registerTool(LIST_SKILLS_TOOL, lockedHandlers.handleListSkills);
  transport.registerTool(RUN_SKILL_TOOL, lockedHandlers.handleRunSkill);
  transport.registerTool(ASK_VAULT_TOOL, lockedHandlers.handleAskVault);

  const userId = process.env.DESKTOP_USER_ID || process.env.USER_ID || 'desktop-agent';
  let userVaults: Array<{ vaultId: string; mode: 'open' | 'locked'; role: string }> = [];
  try {
    userVaults = await getUserAccessibleVaults(userId);
  } catch (err) {
    console.error('Error fetching vault access for stdio user:', err);
  }

  // Fallback for dev mode only if explicitly enabled
  if (userVaults.length === 0 && process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true') {
    userVaults = [
      { vaultId: '11111111-1111-1111-1111-111111111111', mode: 'open', role: 'editor' },
      { vaultId: '22222222-2222-2222-2222-222222222222', mode: 'locked', role: 'consumer' },
    ];
  }

  const policy = new ToolPalettePolicy();
  const authorizedTools = policy.computeAuthorizedTools(userVaults as any);
  const roles = new Map<string, string>();
  const vaultModes = new Map<string, 'open' | 'locked'>();
  for (const v of userVaults) {
    roles.set(v.vaultId, v.role);
    vaultModes.set(v.vaultId, v.mode);
  }

  const callerContext = {
    userId,
    roles,
    vaultModes,
    authorizedTools,
  };

  // Log to stderr only (stdout is reserved exclusively for JSON-RPC messages)
  console.error('🚀 tkxel Vault Stdio MCP Server running for desktop agent...');
  console.error('Available Tools: search, get_page, get_links, get_context, add_note, list_skills, run_skill, ask_vault');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await transport.handleMessage(parsed, callerContext);

      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err: any) {
      console.error('Error processing JSON-RPC message:', err);
      const errResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`,
        },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
    }
  });

  process.on('SIGINT', () => {
    console.error('Shutting down tkxel Vault Stdio MCP Server.');
    process.exit(0);
  });
}

runStdioMcpServer().catch((err) => {
  console.error('Fatal error starting stdio MCP server:', err);
  process.exit(1);
});
