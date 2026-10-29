---
name: tkxel-vault-mcp-gateway
description: >-
  Implement and maintain the Remote Model Context Protocol (MCP) Gateway connecting
  Claude.ai to tkxel Vault. Covers MCP 2025-11-25 over Streamable HTTP, OAuth 2.1 PKCE
  authentication with corporate SSO, dynamic role-based tool palettes, and prompt engineering
  for autonomous tool invocation. Use whenever working on MCP endpoints, tool definitions,
  or Claude custom connector integrations.
---

# tkxel Vault: Remote MCP Gateway & Claude Integration Skill

This skill guides the implementation of the **Remote Model Context Protocol (MCP) Gateway** as defined in the [SRS](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) ([FR-60 to FR-68, FR-90 to FR-93, Section 5]) and [PRD](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **Protocol Compliance (`FR-60`)**:
   - Implement the official **Model Context Protocol (MCP)** specification (version 2025-11-25).
   - Use **Streamable HTTP transport** (Server-Sent Events / SSE over HTTP) to support low-latency remote connections from Claude.ai custom connectors.

2. **Authentication & Identity Flow (`FR-61`, `FR-91`)**:
   - Integrate **OAuth 2.1 with PKCE** against tkxel SSO (Google Workspace / Entra ID).
   - Every incoming HTTP request carries a verified JWT bearer token conveying user claims (`sub`, `email`, `groups`).
   - Validate token expiration and revocation status on every single call (`FR-65`).

3. **Dynamic Role-Based Tool Palette (`FR-62` to `FR-64`)**:
   - When Claude initializes an MCP session or requests `tools/list`, compute the caller's active permissions across all vaults:
     * **If caller has Reader access to >= 1 Open Vault:** Expose:
       - `search`: Query accessible open vaults.
       - `get_page`: Retrieve page markdown, front matter, backlinks, and timeline.
       - `get_links`: Retrieve 1- or 2-hop local graph nodes and edges.
       - `get_context`: Assemble top hits + 1-hop links into token-budgeted context.
     * **If caller has Editor access:** Also expose:
       - `add_note`: Append timeline entry or draft to `/inbox`.
     * **If caller has Consumer access to >= 1 Locked Vault:** Expose:
       - `list_skills`: List names and descriptions of authorized locked skills.
       - `run_skill`: Execute a locked skill against the secure runner.
       - `ask_vault`: Query a locked repository for a synthesized answer.
     * **If caller lacks role:** Hide tools entirely.

4. **Semantic Tool Prompts & Descriptions (`FR-93`)**:
   - Tool descriptions must be engineered so that Claude's reasoning loop autonomously invokes `get_context` or `search` on user queries (e.g., *"What is our policy on X?"*) without requiring explicit slash commands or user instructions.

5. **Rate Limiting & Threat Shield (`FR-67`, `FR-68`)**:
   - Enforce sliding-window rate limits (default: 60 locked calls/hr, 300 retrieval calls/hr per user).
   - Mask authorization failures: Always return `not_allowed` without revealing if an unshared vault or skill exists (`FR-68`).

## Gateway Architecture

```
Claude.ai Client (Web / Desktop / Mobile)
               |
               | HTTPS (Streamable HTTP + OAuth 2.1 Bearer Token)
               v
+-------------------------------------------------------------+
|                     Remote MCP Gateway                      |
|                                                             |
|   [ OAuth 2.1 Token Validator & SSO Claims Resolver ]       |
|                               |                             |
|                               v                             |
|        [ Dynamic Role-Based Tool Palette Generator ]        |
|                               |                             |
|            +------------------+------------------+          |
|            |                                     |          |
|            v                                     v          |
|  [ Retrieval Handler ]                 [ Locked Tool Proxy ]|
|  - search                              - list_skills        |
|  - get_page / get_links                - run_skill          |
|  - get_context / add_note              - ask_vault          |
|            |                                     |          |
+------------+-------------------------------------+----------+
             |                                     |
             v                                     v
     [ Vault Service ]                  [ Skill Runner Sandbox ]
```
