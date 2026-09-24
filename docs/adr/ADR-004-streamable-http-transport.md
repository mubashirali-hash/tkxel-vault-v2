# ADR-004: Anthropic Streamable HTTP Transport Specification (MCP 2025-11-25)

## Status
Accepted

## Context
Claude.ai requires a remote connection protocol to communicate with enterprise context platforms. While early iterations of the Model Context Protocol (MCP) relied primarily on local `stdio` processes or basic Server-Sent Events (SSE) with separate HTTP POST channels, Anthropic standardized on the **Streamable HTTP transport** specification (specification version: `2025-11-25`). 

The remote MCP gateway for tkxel Vault must:
1. Operate securely over standard HTTPS in cloud and containerized environments.
2. Provide low-latency, bidirectional JSON-RPC 2.0 streaming for tool listing, invocations, and session handshakes (`initialize`, `notifications/initialized`, `ping`).
3. Support long-running queries with streaming feedback.
4. Integrate with standard enterprise reverse proxies, load balancers, and corporate firewalls without requiring custom WebSocket upgrades or exotic ports.

## Decision
We implement the **Streamable HTTP transport** conforming to the Anthropic MCP specification (2025-11-25) for tkxel Vault's Remote MCP Gateway:
- **Endpoint:** Exposes a unified `/mcp` HTTP endpoint supporting POST requests carrying JSON-RPC 2.0 frames with optional streaming chunked responses (`application/json` or `text/event-stream`).
- **Session Handshake:** Enforces the standard MCP protocol lifecycle:
  - `initialize`: Client passes client capabilities, protocol version `2025-11-25`, and client information; server responds with capabilities (`tools`, `resources`, `prompts`) and server info.
  - `notifications/initialized`: Handshake completion acknowledgment.
  - `tools/list`: Dynamically returns active role-filtered tool palette for the authenticated principal.
  - `tools/call`: Executes specified tool with validated JSON arguments.
- **Connection Multiplexing:** Uses HTTP connection pooling with keep-alive headers, avoiding TCP handshake overhead per tool invocation.

## Consequences
- **Positive:** Direct, out-of-the-box compatibility with Claude.ai custom connectors and enterprise proxy infrastructure.
- **Positive:** Streaming chunks allow progressive token generation and status updates during intensive tool calls.
- **Negative:** Requires rigorous error handling to cleanly close streaming responses when clients disconnect unexpectedly.
