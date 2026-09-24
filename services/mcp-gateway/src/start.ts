import { McpGatewayServer } from './server.js';
import { PostgresOpenVaultStore } from './tools/postgres-store.js';
import { getUserAccessibleVaults } from '@tkxel-vault/vault-core';

const port = Number(process.env.PORT || 3001);
const vaultStore = new PostgresOpenVaultStore();

const server = new McpGatewayServer({
  port,
  vaultStore,
  accessResolver: async (userId: string) => {
    try {
      const dbAccess = await getUserAccessibleVaults(userId);
      if (dbAccess.length > 0) {
        return dbAccess;
      }
      // Fallback for dev mode only if explicitly enabled
      if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_AUTH_BYPASS === 'true') {
        return [
          { vaultId: '11111111-1111-1111-1111-111111111111', mode: 'open', role: 'editor' },
          { vaultId: '22222222-2222-2222-2222-222222222222', mode: 'locked', role: 'consumer' },
        ];
      }
      return [];
    } catch (err) {
      console.error('Error resolving vault access for user:', userId, err);
      return [];
    }
  },
});

async function main() {
  await server.listen();
  console.log(`\n======================================================`);
  console.log(`🚀 tkxel Vault MCP Gateway listening on http://localhost:${port}`);
  console.log(`📡 Transport: Anthropic Streamable HTTP (MCP 2025-11-25) & Stdio`);
  console.log(`🔒 Endpoints:`);
  console.log(`   - GET  http://localhost:${port}/health`);
  console.log(`   - POST http://localhost:${port}/mcp (Streamable HTTP JSON-RPC 2.0)`);
  console.log(`   - POST http://localhost:${port}/webhooks/sso-deprovision`);
  console.log(`🛠️ Active Tools: search, get_page, get_links, get_context, add_note, run_skill, ask_vault`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Failed to start MCP Gateway:', err);
  process.exit(1);
});
