import { AuditEvent, AuditAction } from '@tkxel-vault/types';

export interface AuditSink {
  recordEvent(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  public events: AuditEvent[] = [];

  public async recordEvent(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  public getEventsByTarget(targetId: string): AuditEvent[] {
    return this.events.filter((e) => e.target_id === targetId);
  }

  public clear(): void {
    this.events = [];
  }
}

/**
 * Append-only Audit Service (FR-80 to FR-84).
 * Records security-sensitive operations, export requests, role modifications, and MCP queries.
 */
export class AuditService {
  private sink: AuditSink;

  constructor(sink: AuditSink) {
    this.sink = sink;
  }

  public async log(params: {
    actorId: string;
    action: AuditAction;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      actor_id: params.actorId,
      action: params.action,
      target_id: params.targetId,
      timestamp: new Date(),
      metadata: params.metadata || {},
    };

    await this.sink.recordEvent(event);
    return event;
  }
}
