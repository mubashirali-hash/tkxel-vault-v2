# tkxel Vault: AI Agent MCP Connection Guide

This guide explains how to connect external AI agents (Anthropic Claude Desktop, Cursor, Antigravity IDE, Cline, or custom agents) to **tkxel Vault** using the Model Context Protocol (MCP 2025-11-25).

---

## 1. Connection Modes Overview

tkxel Vault provides two modes for agents to connect:

| Mode | Use Case | Protocol | Endpoint / Command |
| :--- | :--- | :--- | :--- |
| **Stdio Sub-process** | Claude Desktop, Cursor, Antigravity, local CLI agents | JSON-RPC over `stdio` | `node services/mcp-gateway/dist/stdio.js` |
| **Streamable HTTP Gateway** | Cloud AI connectors, Claude.ai Custom Connectors | MCP HTTP Streamable | `http://localhost:3001/mcp` |

---

## 2. Option A: Connecting Anthropic Claude Desktop (Recommended for Local)

To give Claude Desktop access to your entire markdown knowledge hub and locked skills:

1. Open your Claude Desktop configuration file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the `tkxel-vault` server entry:

```json
{
  "mcpServers": {
    "tkxel-vault": {
      "command": "node",
      "args": [
        "c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/services/mcp-gateway/dist/stdio.js"
      ],
      "env": {
        "DATABASE_URL": "postgres://postgres:postgrespassword@localhost:5432/tkxel_vault"
      }
    }
  }
}
```

3. Restart Claude Desktop.
4. You will see a hammer/tool icon in the bottom right corner with the following 8 tools available:
   - `search`: Search the entire Markdown knowledge graph with multi-keyword ILIKE matching.
   - `get_page`: Fetch full markdown notes, front matter, tags, and backlinks by title.
   - `get_links`: Inspect 1-hop and 2-hop bidirectional graph links and connected nodes.
   - `get_context`: Assemble token-budgeted context packages with target pages and related backlinks.
   - `add_note`: Allow Claude to take notes and create draft pages in the vault.
   - `list_skills`: Discover all proprietary locked skills with their `vaultId`, name, description, and parameters.
   - `run_skill`: Execute locked skills in zero-read sandbox without leaking raw proprietary IP (`vaultId` is optional and auto-resolved).
   - `ask_vault`: Query locked proprietary vaults without exposing raw markdown.

---

## 3. Option B: Connecting via Remote Streamable HTTP (`:3001/mcp`)

If your agent connects via HTTP (such as Claude.ai Custom Connector or remote agent runtime):

1. Start the Remote MCP Gateway:
   ```bash
   npm --prefix services/mcp-gateway run start
   ```
   The gateway listens on `http://localhost:3001` with the MCP endpoint at `http://localhost:3001/mcp`.
2. Provide Bearer Authentication header (OAuth 2.1 JWT / corporate SSO token).
3. The gateway dynamically evaluates the token claims and restricts tools based on user roles (`reader`, `editor`, `consumer`).

---

## 4. Testing Your MCP Connection

You can verify the MCP connection at any time using this command:

```powershell
node -e "
const { spawn } = require('child_process');
const proc = spawn('node', ['services/mcp-gateway/dist/stdio.js'], { cwd: process.cwd() });
proc.stdout.on('data', (d) => console.log('MCP Response:', d.toString()));
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
setTimeout(() => proc.kill(), 1000);
"
```

---

## 5. Security & Invariant Guarantees

1. **Zero-Read Protection:** For locked vaults (`mode = 'locked'`), agents are strictly denied raw markdown access. Only `run_skill` and `ask_vault` are permitted.
2. **Audit Logging:** Every tool call (searches, page reads, note creations, skill runs) creates an immutable append-only record in the `audit_events` PostgreSQL table.
3. **Envelope Encryption:** Decryption keys are loaded ephemerally in-memory and never cached or logged.
