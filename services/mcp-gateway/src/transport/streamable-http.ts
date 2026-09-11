export const MCP_PROTOCOL_VERSION = '2025-11-25';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: { userId: string; roles: Map<string, string> }
) => Promise<ToolCallResult>;

/**
 * Streamable HTTP Transport Engine (Anthropic MCP 2025-11-25).
 * Dispatches JSON-RPC 2.0 frames over Streamable HTTP and SSE streams.
 */
export class StreamableHttpTransport {
  private toolRegistry = new Map<string, { definition: McpToolDefinition; handler: ToolHandler }>();
  private serverInfo = {
    name: 'tkxel-vault-mcp',
    version: '0.1.0',
  };

  public registerTool(definition: McpToolDefinition, handler: ToolHandler): void {
    this.toolRegistry.set(definition.name, { definition, handler });
  }

  public getRegisteredTools(): McpToolDefinition[] {
    return Array.from(this.toolRegistry.values()).map((t) => t.definition);
  }

  /**
   * Processes an incoming JSON-RPC 2.0 frame from an authenticated caller.
   */
  public async handleMessage(
    message: JsonRpcRequest,
    callerContext: {
      userId: string;
      roles: Map<string, string>;
      authorizedTools: Set<string>;
    }
  ): Promise<JsonRpcResponse | null> {
    if (message.jsonrpc !== '2.0' || !message.method) {
      return {
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc must be "2.0" with a valid method.',
        },
      };
    }

    // Handle notifications (no response required if no id)
    if (message.method === 'notifications/initialized') {
      return null;
    }

    // Standard MCP protocol handshake
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: this.serverInfo,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        },
      };
    }

    if (message.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {},
      };
    }

    // tools/list: return authorized tools dynamically per caller claims
    if (message.method === 'tools/list') {
      const filteredTools = Array.from(this.toolRegistry.values())
        .filter((t) => callerContext.authorizedTools.has(t.definition.name))
        .map((t) => t.definition);

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: filteredTools,
        },
      };
    }

    // tools/call: invoke specified tool
    if (message.method === 'tools/call') {
      const toolName = (message.params?.name as string) || '';
      const toolArguments = (message.params?.arguments as Record<string, unknown>) || {};

      // Check if caller is authorized for this tool
      if (!callerContext.authorizedTools.has(toolName) || !this.toolRegistry.has(toolName)) {
        // Enforce generic denial response without disclosing resource state (FR-68)
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: 'Method not found or access not allowed.',
          },
        };
      }

      const tool = this.toolRegistry.get(toolName)!;
      try {
        const result = await tool.handler(toolArguments, {
          userId: callerContext.userId,
          roles: callerContext.roles,
        });

        return {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing tool: ${err?.message || 'Internal failure'}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32601,
        message: `Method '${message.method}' not found.`,
      },
    };
  }
}
