import { getRedisClient } from '@tkxel-vault/skill-runner';

const unrefApplied = new WeakSet<object>();

/**
 * Redis client for the revocation list shared with the MCP gateway (FR-54, FR-55).
 * The connection is unref'd so it never keeps the process alive on its own: the HTTP listener does that
 * in a running server, while short-lived processes (tests, scripts) can still exit.
 */
export function getRevocationRedis(): { get(key: string): Promise<string | null> } | null {
  const client: any = getRedisClient();
  if (!client) return null;
  if (typeof client.on === 'function' && !unrefApplied.has(client)) {
    unrefApplied.add(client);
    const unref = () => client.stream?.unref?.();
    client.on('connect', unref);
    unref();
  }
  return client;
}

export function revokedUserKey(userId: string): string {
  return `revoked:user:${String(userId).trim().toLowerCase()}`;
}
