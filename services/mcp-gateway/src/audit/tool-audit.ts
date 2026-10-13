import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';

/** One record per MCP tool invocation (FR-80). Carries sizes and identifiers only, never arguments or results. */
export interface ToolAuditEvent {
  userId: string;
  tool: string;
  vaultId: string | null;
  targetId: string | null;
  status: 'success' | 'error' | 'denied';
  requestBytes: number;
  responseBytes: number;
}

export type ToolAuditSink = (event: ToolAuditEvent) => Promise<void>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i;

/** Extracts identifiers from tool arguments without retaining free-text values such as queries or titles. */
export function describeToolCall(args: Record<string, unknown>): { vaultId: string | null; targetId: string | null } {
  const asUuid = (value: unknown): string | null => (typeof value === 'string' && UUID_REGEX.test(value) ? value : null);
  return {
    vaultId: asUuid(args.vault_id) ?? asUuid(args.vaultId) ?? asUuid(args.vault),
    targetId: asUuid(args.page_id) ?? asUuid(args.pageId),
  };
}

/** Appends tool-call audit events to PostgreSQL. A failed write rejects, so the caller can fail closed. */
export function createPostgresToolAuditSink(): ToolAuditSink {
  return async (event) => {
    await db.insert(schema.auditEvents).values({
      actor_id: event.userId,
      action: event.status === 'denied' ? 'tool_denied' : 'tool_call',
      target_id: event.targetId || event.vaultId || 'none',
      metadata: {
        source: 'mcp_gateway',
        tool: event.tool,
        vault_id: event.vaultId,
        status: event.status,
        request_bytes: event.requestBytes,
        response_bytes: event.responseBytes,
      },
    });
  };
}
