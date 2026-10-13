import { db } from '../db.js';
import * as schema from '../schema/index.js';
import { sql } from 'drizzle-orm';

/** Denials within the window that count as repeated authorization failure (FR-83). */
export const DENIAL_ALERT_THRESHOLD = 5;
export const DENIAL_WINDOW_MINUTES = 10;
/** Above this many denials in the window no further events are written for the user, to bound the audit volume. */
export const DENIAL_RECORD_CAP = 100;

export interface AccessDenial {
  userId: string;
  vaultId: string;
  /** What was attempted, e.g. "GET /api/vaults/:vaultId/pages". Never includes request content. */
  operation: string;
  /** Where the denial happened. */
  source: 'web_api' | 'mcp_gateway';
}

export interface AccessDenialResult {
  recorded: boolean;
  alerted: boolean;
}

/**
 * Records a refused request in the audit trail and raises a `security_alert` when the same user is
 * refused repeatedly (FR-81, FR-83). Denials from the MCP gateway (`tool_denied`) count towards the
 * same threshold, so probing across both surfaces is seen as one pattern.
 */
export async function recordAccessDenial(
  denial: AccessDenial,
  env: { SECURITY_ALERT_WEBHOOK_URL?: string } = process.env
): Promise<AccessDenialResult> {
  const actor = denial.userId.toLowerCase();
  const window = sql`now() - make_interval(mins => ${DENIAL_WINDOW_MINUTES})`;
  const countDenials = async (): Promise<number> => {
    const result: any = await db.execute(sql`
      SELECT count(*)::int AS n FROM ${schema.auditEvents}
      WHERE lower(${schema.auditEvents.actor_id}) = ${actor}
        AND ${schema.auditEvents.action} IN ('access_denied', 'tool_denied')
        AND ${schema.auditEvents.timestamp} > ${window}
    `);
    return Number(result.rows?.[0]?.n) || 0;
  };

  const before = await countDenials();
  if (before >= DENIAL_RECORD_CAP) return { recorded: false, alerted: false };

  await db.insert(schema.auditEvents).values({
    actor_id: denial.userId,
    action: 'access_denied',
    target_id: denial.vaultId,
    metadata: { vault_id: denial.vaultId, operation: denial.operation, source: denial.source },
  });

  const denials = before + 1;
  if (denials < DENIAL_ALERT_THRESHOLD) return { recorded: true, alerted: false };

  // One alert per user per hour, shared with the gateway's detector
  const recent: any = await db.execute(sql`
    SELECT 1 FROM ${schema.auditEvents}
    WHERE ${schema.auditEvents.action} = 'security_alert'
      AND ${schema.auditEvents.target_id} = ${actor}
      AND ${schema.auditEvents.metadata}->>'kind' = 'repeated_denials'
      AND ${schema.auditEvents.timestamp} > now() - interval '1 hour'
    LIMIT 1
  `);
  if ((recent.rows?.length || 0) > 0) return { recorded: true, alerted: false };

  const detail = { denials_last_10_min: denials, threshold: DENIAL_ALERT_THRESHOLD };
  await db.insert(schema.auditEvents).values({
    actor_id: 'system:anomaly-detector',
    action: 'security_alert',
    target_id: actor,
    metadata: { kind: 'repeated_denials', source: denial.source, ...detail },
  });
  console.warn(`SECURITY ALERT [repeated_denials] user=${denial.userId} ${JSON.stringify(detail)}`);

  const webhook = (env.SECURITY_ALERT_WEBHOOK_URL || '').trim();
  if (webhook) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    timer.unref();
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tkxel_vault_security_alert',
          kind: 'repeated_denials',
          userId: denial.userId,
          detail,
          raised_at: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      console.error('Security alert webhook delivery failed:', err?.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return { recorded: true, alerted: true };
}
