import { McpToolDefinition, ToolCallContext, ToolCallResult } from '../transport/streamable-http.js';

export const SEARCH_TOOL: McpToolDefinition = {
  name: 'search',
  description:
    'Search company knowledge graph across authorized open vaults using keyword and hybrid semantic search. Use this whenever the user asks questions about company policies, technical architectures, projects, clients, meetings, or decisions.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string, keywords, or question.',
      },
      vault_id: {
        type: 'string',
        description: 'Authorized open vault ID to search.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10).',
      },
    },
    required: ['query', 'vault_id'],
  },
};

export const GET_PAGE_TOOL: McpToolDefinition = {
  name: 'get_page',
  description:
    'Retrieve the full Markdown content, front matter metadata, backlinks, and timeline history of a specific page by title or slug in an authorized open vault.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The title or slug of the page to retrieve.',
      },
      vault_id: {
        type: 'string',
        description: 'Authorized open vault ID where the page is stored.',
      },
    },
    required: ['title', 'vault_id'],
  },
};

export const GET_LINKS_TOOL: McpToolDefinition = {
  name: 'get_links',
  description:
    'Explore the bidirectional knowledge graph around a specific page. Returns outgoing links, backlinks, and connected document nodes up to 2 hops away.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The unique ID or title of the focal document node.',
      },
      vault_id: {
        type: 'string',
        description: 'Authorized open vault ID containing the page.',
      },
      max_hops: {
        type: 'number',
        description: 'Graph traversal depth (1 or 2 hops, default 1).',
      },
    },
    required: ['page_id', 'vault_id'],
  },
};

export const GET_CONTEXT_TOOL: McpToolDefinition = {
  name: 'get_context',
  description:
    'Assembles a high-density, token-budgeted Markdown context block containing the target page, its 1-hop outgoing links, incoming backlinks, and relevant connected snippets. Use this to prepare ground truth context for answering complex user questions.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The user inquiry or subject to synthesize context for.',
      },
      vault_id: {
        type: 'string',
        description: 'Authorized open vault ID used to assemble context.',
      },
      target_page: {
        type: 'string',
        description: 'Optional primary document title to anchor the context graph.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum token budget for the assembled context (default 4000).',
      },
    },
    required: ['query', 'vault_id'],
  },
};

export const ADD_NOTE_TOOL: McpToolDefinition = {
  name: 'add_note',
  description:
    'Append a timeline note or create a new draft page in an authorized open vault. Restricted to users with Editor or Owner roles.',
  inputSchema: {
    type: 'object',
    properties: {
      vault_id: {
        type: 'string',
        description: 'The destination open vault ID.',
      },
      title: {
        type: 'string',
        description: 'Title of the note or document.',
      },
      content: {
        type: 'string',
        description: 'Markdown body content or timeline observation.',
      },
      tags: {
        type: 'array',
        description: 'Optional list of tag labels (e.g. ["client", "q3"]).',
      },
    },
    required: ['vault_id', 'title', 'content'],
  },
};

/**
 * Mock data store interface for Open Vault retrieval tools.
 */
export interface OpenVaultStore {
  search(query: string, vaultId: string, limit?: number): Promise<Array<{ id: string; title: string; snippet: string }>>;
  getPage(title: string, vaultId: string): Promise<{ title: string; content: string; tags: string[]; backlinks: string[] } | null>;
  getLinks(pageId: string, vaultId: string, maxHops?: number): Promise<{ nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> }>;
  getContext(query: string, vaultId: string, targetPage?: string, maxTokens?: number): Promise<{ markdown: string; tokenEstimate: number }>;
  addNote(params: { vaultId: string; title: string; content: string; tags?: string[]; authorId: string }): Promise<{ noteId: string; status: string }>;
}

const OPEN_READ_ROLES = new Set(['owner', 'editor', 'reader']);
const OPEN_WRITE_ROLES = new Set(['owner', 'editor']);

function requireAuthorizedOpenVault(
  params: Record<string, unknown>,
  context: ToolCallContext | undefined,
  allowedRoles: Set<string>,
): string {
  const vaultId = typeof params.vault_id === 'string' ? params.vault_id.trim() : '';
  const role = vaultId ? context?.roles.get(vaultId) : undefined;
  const mode = vaultId ? context?.vaultModes?.get(vaultId) : undefined;

  if (!vaultId || mode !== 'open' || !role || !allowedRoles.has(role)) {
    throw new Error('not_allowed');
  }

  return vaultId;
}

/**
 * Creates standard tool handlers for open vault retrieval.
 */
export function createOpenRetrievalHandlers(store: OpenVaultStore) {
  return {
    handleSearch: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const query = String(params.query || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      const limit = Number(params.limit || 10);

      const results = await store.search(query, vaultId, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },

    handleGetPage: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const title = String(params.title || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);

      const page = await store.getPage(title, vaultId);
      if (!page) {
        throw new Error('not_found');
      }

      const formatted = `# ${page.title}\n\n${page.content}\n\n---\n**Tags:** ${page.tags.join(', ')}\n**Backlinks:** ${page.backlinks.join(', ')}`;
      return {
        content: [
          {
            type: 'text',
            text: formatted,
          },
        ],
      };
    },

    handleGetLinks: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const pageId = String(params.page_id || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      const maxHops = Number(params.max_hops || 1);

      const graph = await store.getLinks(pageId, vaultId, maxHops);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    },

    handleGetContext: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const query = String(params.query || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      const targetPage = params.target_page ? String(params.target_page) : undefined;
      const maxTokens = Number(params.max_tokens || 4000);

      const contextResult = await store.getContext(query, vaultId, targetPage, maxTokens);
      return {
        content: [
          {
            type: 'text',
            text: contextResult.markdown,
          },
        ],
      };
    },

    handleAddNote: async (
      params: Record<string, unknown>,
      ctx: ToolCallContext
    ): Promise<ToolCallResult> => {
      const vaultId = requireAuthorizedOpenVault(params, ctx, OPEN_WRITE_ROLES);
      const title = String(params.title || '');
      const content = String(params.content || '');
      const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;

      const res = await store.addNote({
        vaultId,
        title,
        content,
        tags,
        authorId: ctx.userId,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Note created successfully with ID: ${res.noteId}`,
          },
        ],
      };
    },
  };
}
