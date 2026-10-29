import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { sql } from 'drizzle-orm';
import { ToolAuditEvent, ToolAuditSink } from './tool-audit.js';

/** Per-user activity figures the anomaly rules are evaluated against. */
export interface UserActivityStats {
  /** Tool calls in the last 60 minutes. */
  callsLastHour: number;
  /** Mean calls per active hour over the preceding baseline window (0 when the user has no history). */
  baselineHourlyCalls: number;
  /** Denied tool calls in the last 10 minutes. */
  denialsLast10Min: number;
}

export interface AnomalyConfig {
  /** Alert when the last hour exceeds this multiple of the user's normal hourly volume (FR-83: 3x). */
  volumeMultiplier: number;
  /** Baseline assumed for users with little or no history, so a first busy hour is not an alert. */
  minimumBaseline: number;
  /** Denials within 10 minutes that count as repeated authorization failure. */
  denialThreshold: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  volumeMultiplier: 3,
  minimumBaseline: 10,
  denialThreshold: 5,
};

export type AnomalyKind = 'volume_spike' | 'repeated_denials';

export interface SecurityAlert {
  kind: AnomalyKind;
  userId: string;
  detail: Record<string, number>;
}

/** Pure rule evaluation (FR-83). */
export function evaluateAnomalies(
  userId: string,
  stats: UserActivityStats,
  config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG
): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  const baseline = Math.max(stats.baselineHourlyCalls, config.minimumBaseline);
  if (stats.callsLastHour > baseline * config.volumeMultiplier) {
    alerts.push({
      kind: 'volume_spike',
      userId,
      detail: { calls_last_hour: stats.callsLastHour, normal_hourly: Math.round(baseline), multiplier: config.volumeMultiplier },
    });
  }
  if (stats.denialsLast10Min >= config.denialThreshold) {
    alerts.push({
      kind: 'repeated_denials',
      userId,
      detail: { denials_last_10_min: stats.denialsLast10Min, threshold: config.denialThreshold },
    });
  }
  return alerts;
}

export interface AnomalyBackend {
  getStats(userId: string): Promise<UserActivityStats>;
  /** True when an alert of this kind was already raised for the user within the last hour. */
  recentlyAlerted(userId: string, kind: AnomalyKind): Promise<boolean>;
  raise(alert: SecurityAlert): Promise<void>;
}

/**
 * Wraps a tool-audit sink so that every recorded call is also checked against the anomaly rules.
 * Detection never blocks or fails a tool call: the audit record is written first, and a detection
 * error is logged and swallowed.
 */
export function withAnomalyDetection(
  sink: ToolAuditSink,
  backend: AnomalyBackend,
  options?: { config?: AnomalyConfig; minIntervalMs?: number; now?: () => number }
): ToolAuditSink {
  const config = options?.config ?? DEFAULT_ANOMALY_CONFIG;
  const minIntervalMs = options?.minIntervalMs ?? 30_000;
  const now = options?.now ?? Date.now;
  const lastEvaluated = new Map<string, number>();

  return async (event: ToolAuditEvent) => {
    await sink(event);

    const userKey = event.userId.toLowerCase();
    // Denials are always evaluated; routine successful calls are sampled per user to bound the cost
    const last = lastEvaluated.get(userKey) ?? 0;
    if (event.status !== 'denied' && now() - last < minIntervalMs) return;
    lastEvaluated.set(userKey, now());

    try {
      const alerts = evaluateAnomalies(event.userId, await backend.getStats(event.userId), config);
      for (const alert of alerts) {
        if (await backend.recentlyAlerted(alert.userId, alert.kind)) continue;
        await backend.raise(alert);
      }
    } catch (err: any) {
      console.error('Anomaly detection failed:', err?.message);
    }
  };
}

/**
 * PostgreSQL backend: figures come from the append-only audit trail, so every gateway replica sees the
 * same picture and alerts survive restarts. Alerts are written as `security_alert` audit events and,
 * when SECURITY_ALERT_WEBHOOK_URL is set, posted to that endpoint.
 */
export function createPostgresAnomalyBackend(env: { SECURITY_ALERT_WEBHOOK_URL?: string } = process.env): AnomalyBackend {
  const isToolEvent = sql`${schema.auditEvents.action} IN ('tool_call', 'tool_denied')`;

  return {
    async getStats(userId) {
      const actor = sql`lower(${schema.auditEvents.actor_id}) = ${userId.toLowerCase()}`;
      const result: any = await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE ${schema.auditEvents.timestamp} > now() - interval '1 hour')::int AS calls_last_hour,
          count(*) FILTER (
            WHERE ${schema.auditEvents.action} = 'tool_denied'
              AND ${schema.auditEvents.timestamp} > now() - interval '10 minutes'
          )::int AS denials_last_10_min,
          count(*) FILTER (WHERE ${schema.auditEvents.timestamp} <= now() - interval '1 hour')::int AS baseline_calls,
          count(DISTINCT date_trunc('hour', ${schema.auditEvents.timestamp}))
            FILTER (WHERE ${schema.auditEvents.timestamp} <= now() - interval '1 hour')::int AS baseline_hours
        FROM ${schema.auditEvents}
        WHERE ${actor} AND ${isToolEvent} AND ${schema.auditEvents.timestamp} > now() - interval '14 days'
      `);
      const row = result.rows?.[0] || {};
      const baselineHours = Number(row.baseline_hours) || 0;
      return {
        callsLastHour: Number(row.calls_last_hour) || 0,
        denialsLast10Min: Number(row.denials_last_10_min) || 0,
        baselineHourlyCalls: baselineHours > 0 ? Number(row.baseline_calls) / baselineHours : 0,
      };
    },

    async recentlyAlerted(userId, kind) {
      const result: any = await db.execute(sql`
        SELECT 1 FROM ${schema.auditEvents}
        WHERE ${schema.auditEvents.action} = 'security_alert'
          AND ${schema.auditEvents.target_id} = ${userId.toLowerCase()}
          AND ${schema.auditEvents.metadata}->>'kind' = ${kind}
          AND ${schema.auditEvents.timestamp} > now() - interval '1 hour'
        LIMIT 1
      `);
      return (result.rows?.length || 0) > 0;
    },

    async raise(alert) {
      await db.insert(schema.auditEvents).values({
        actor_id: 'system:anomaly-detector',
        action: 'security_alert',
        target_id: alert.userId.toLowerCase(),
        metadata: { kind: alert.kind, source: 'mcp_gateway', ...alert.detail },
      });
      console.warn(`SECURITY ALERT [${alert.kind}] user=${alert.userId} ${JSON.stringify(alert.detail)}`);

      const webhook = (env.SECURITY_ALERT_WEBHOOK_URL || '').trim();
      if (webhook) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        timer.unref();
        try {
          await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'tkxel_vault_security_alert', ...alert, raised_at: new Date().toISOString() }),
            signal: controller.signal,
          });
        } catch (err: any) {
          console.error('Security alert webhook delivery failed:', err?.message);
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };
}
