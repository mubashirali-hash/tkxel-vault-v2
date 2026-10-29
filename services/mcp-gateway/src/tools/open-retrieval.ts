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
      vaults: {
        type: 'array',
        items: { type: 'string' },
        description: 'Authorized open vault IDs to search together. Use instead of vault_id to search several vaults.',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only return pages of these types (note, person, client, project, decision, meeting, skill, other).',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only return pages carrying at least one of these tags.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10).',
      },
    },
    required: ['query'],
  },
};

export const GET_PAGE_TOOL: McpToolDefinition = {
  name: 'get_page',
  description:
    'Retrieve the full Markdown content, front matter metadata, backlinks, and timeline history of a specific page by title or slug in an authorized open vault.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to retrieve, as returned by search.',
      },
      title: {
        type: 'string',
        description: 'Title or alias of the page. Use when the page ID is not known.',
      },
      vault_id: {
        type: 'string',
        description: 'Authorized open vault ID where the page is stored.',
      },
    },
    required: ['vault_id'],
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
      depth: {
        type: 'number',
        description: 'Graph traversal depth: 1 or 2 hops (default 1).',
      },
      max_hops: {
        type: 'number',
        description: 'Alias of depth.',
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
    'Append a dated timeline entry to an existing page (pass page_id), or save a new draft page to /inbox (pass title). Use this to record facts, decisions or meeting notes the user asks you to remember. Restricted to Editors and Owners; drafts are published by an Owner.',
  inputSchema: {
    type: 'object',
    properties: {
      vault_id: {
        type: 'string',
        description: 'The destination open vault ID.',
      },
      page_id: {
        type: 'string',
        description: 'ID of an existing page. When given, the entry is appended to that page\'s timeline.',
      },
      title: {
        type: 'string',
        description: 'Title for a new draft page in /inbox. Required when page_id is not given.',
      },
      entry: {
        type: 'string',
        description: 'The timeline entry text, or the Markdown body of the new draft page.',
      },
      content: {
        type: 'string',
        description: 'Alias of entry.',
      },
      tags: {
        type: 'array',
        description: 'Optional list of tag labels (e.g. ["client", "q3"]).',
      },
    },
    required: ['vault_id'],
  },
};

/**
 * Mock data store interface for Open Vault retrieval tools.
 */
export interface OpenVaultStore {
  search(
    query: string,
    vaultId: string,
    limit?: number,
    filters?: { types?: string[]; tags?: string[] }
  ): Promise<Array<{ id: string; title: string; snippet: string; type?: string; score?: number }>>;
  getPage(title: string, vaultId: string): Promise<{
    title: string;
    content: string;
    tags: string[];
    backlinks: string[];
    id?: string;
    type?: string;
    front_matter?: Record<string, unknown>;
    links_out?: string[];
    timeline?: Array<{ date: string; entry: string }>;
  } | null>;
  getLinks(pageId: string, vaultId: string, maxHops?: number): Promise<{
    nodes: Array<{ id: string; label: string; title?: string; type?: string }>;
    edges: Array<{ from: string; to: string; type?: string }>;
  }>;
  getContext(query: string, vaultId: string, targetPage?: string, maxTokens?: number): Promise<{
    markdown: string;
    tokenEstimate: number;
    pages?: Array<{ title: string; body_markdown: string }>;
  }>;
  addNote(params: { vaultId: string; title: string; content: string; tags?: string[]; authorId: string }): Promise<{ noteId: string; status: string }>;
  /** Appends a dated entry to an existing page's timeline. Optional so read-only stores need not implement it. */
  appendTimelineEntry?(params: { vaultId: string; pageId: string; entry: string; authorId: string }): Promise<{ pageId: string; entryId: string }>;
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
 * Resolves the vaults a retrieval call targets: `vault_id` or the SRS `vaults` list.
 * Every named vault must be an open vault the caller holds a read role on; one failure denies the call.
 * There is no default vault: a call that names none is denied.
 */
function requireAuthorizedOpenVaults(
  params: Record<string, unknown>,
  context: ToolCallContext | undefined,
  allowedRoles: Set<string>,
): string[] {
  const listed = Array.isArray(params.vaults)
    ? params.vaults.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map((v) => v.trim())
    : [];
  if (listed.length === 0) {
    return [requireAuthorizedOpenVault(params, context, allowedRoles)];
  }
  return Array.from(new Set(listed)).map((vaultId) =>
    requireAuthorizedOpenVault({ vault_id: vaultId }, context, allowedRoles)
  );
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map((v) => v.trim());
  return items.length > 0 ? items : undefined;
}

/**
 * Creates standard tool handlers for open vault retrieval.
 */
export function createOpenRetrievalHandlers(store: OpenVaultStore) {
  return {
    handleSearch: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const query = String(params.query || '');
      const vaultIds = requireAuthorizedOpenVaults(params, context, OPEN_READ_ROLES);
      const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
      const filters = { types: stringList(params.types), tags: stringList(params.tags) };

      const perVault = await Promise.all(
        vaultIds.map(async (vaultId) =>
          (await store.search(query, vaultId, limit, filters)).map((r) => ({
            // Store fields pass through; the SRS 5.1 fields below are always present
            ...r,
            page_id: r.id,
            id: r.id,
            title: r.title,
            vault: vaultId,
            type: r.type || 'note',
            snippet: r.snippet,
            score: typeof r.score === 'number' ? r.score : 0,
          }))
        )
      );
      // Stable merge: best score first, original order otherwise
      const results = perVault.flat().sort((a, b) => b.score - a.score).slice(0, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
        structuredContent: { results },
      };
    },

    handleGetPage: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      // The store resolves a page by ID, title or alias; page_id is the SRS name
      const reference = String(params.page_id || params.title || '').trim();
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      if (!reference) {
        throw new Error('invalid_input: page_id is required');
      }

      const page = await store.getPage(reference, vaultId);
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
        structuredContent: {
          title: page.title,
          type: page.type || 'note',
          front_matter: page.front_matter || { title: page.title, tags: page.tags },
          body_markdown: page.content,
          links_out: page.links_out || [],
          backlinks: page.backlinks,
          timeline: page.timeline || [],
        },
      };
    },

    handleGetLinks: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const pageId = String(params.page_id || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      const maxHops = Number(params.depth ?? params.max_hops ?? 1) >= 2 ? 2 : 1;

      const raw = await store.getLinks(pageId, vaultId, maxHops);
      const graph = {
        nodes: raw.nodes.map((n) => ({ id: n.id, title: n.title ?? n.label, type: n.type || 'note', label: n.label })),
        edges: raw.edges.map((e) => ({ from: e.from, to: e.to, type: e.type || 'wiki' })),
      };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(graph, null, 2),
          },
        ],
        structuredContent: graph,
      };
    },

    handleGetContext: async (params: Record<string, unknown>, context: ToolCallContext): Promise<ToolCallResult> => {
      const query = String(params.query || '');
      const vaultId = requireAuthorizedOpenVault(params, context, OPEN_READ_ROLES);
      const targetPage = params.target_page ? String(params.target_page) : undefined;
      const maxTokens = Math.min(Math.max(Number(params.max_tokens) || 4000, 200), 32000);

      const contextResult = await store.getContext(query, vaultId, targetPage, maxTokens);
      // Hard budget (about 4 characters per token), applied whatever the store returned
      const budgetChars = maxTokens * 4;
      const markdown = contextResult.markdown.length > budgetChars
        ? `${contextResult.markdown.slice(0, budgetChars)}\n\n[Context truncated to fit max_tokens]`
        : contextResult.markdown;

      let remaining = budgetChars;
      const pages: Array<{ title: string; body_markdown: string }> = [];
      for (const page of contextResult.pages || []) {
        if (remaining <= 0) break;
        const body = page.body_markdown.slice(0, remaining);
        pages.push({ title: page.title, body_markdown: body });
        remaining -= body.length;
      }

      return {
        content: [
          {
            type: 'text',
            text: markdown,
          },
        ],
        structuredContent: { pages },
      };
    },

    handleAddNote: async (
      params: Record<string, unknown>,
      ctx: ToolCallContext
    ): Promise<ToolCallResult> => {
      const vaultId = requireAuthorizedOpenVault(params, ctx, OPEN_WRITE_ROLES);
      const title = String(params.title || '').trim();
      const content = String(params.entry ?? params.content ?? '').trim();
      const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;
      const pageId = typeof params.page_id === 'string' ? params.page_id.trim() : '';

      if (!content) {
        throw new Error('invalid_input: entry is required');
      }

      if (pageId) {
        if (!store.appendTimelineEntry) {
          throw new Error('not_allowed');
        }
        const appended = await store.appendTimelineEntry({ vaultId, pageId, entry: content, authorId: ctx.userId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ page_id: appended.pageId, entry_id: appended.entryId, status: 'timeline_entry_added' }),
            },
          ],
          structuredContent: { page_id: appended.pageId, entry_id: appended.entryId },
        };
      }

      if (!title) {
        throw new Error('invalid_input: title is required when page_id is not given');
      }

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
            text: `Draft note saved to /inbox with ID: ${res.noteId}. A vault Owner must publish it before Readers can see it.`,
          },
        ],
        structuredContent: { page_id: res.noteId, version: 1 },
      };
    },
  };
}
