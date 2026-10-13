/** At most this many notes carry a label in the "hubs" setting before the user zooms in. */
export const MAX_HUB_LABELS = 40;

/**
 * The notes that count as hubs: three or more connections, and when a graph has more of those than
 * fit on screen, only the most connected MAX_HUB_LABELS (ties keep their original order).
 */
export function pickHubIds(ids: string[], degreeById: Map<string, number>, limit = MAX_HUB_LABELS): Set<string> {
  const hubs = ids.filter((id) => (degreeById.get(id) || 0) >= 3);
  if (hubs.length <= limit) return new Set(hubs);
  return new Set(
    hubs
      .map((id, index) => ({ id, index, degree: degreeById.get(id) || 0 }))
      .sort((a, b) => b.degree - a.degree || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.id)
  );
}
