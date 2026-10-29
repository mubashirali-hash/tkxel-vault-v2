/** Sidebar search filters (FR-20): page type, tag, and "updated on or after". Empty means no filter. */
export interface SearchFilters {
  type: string;
  tag: string;
  /** ISO date, yyyy-mm-dd, as produced by a date input. */
  updatedFrom: string;
}

export const NO_FILTERS: SearchFilters = { type: '', tag: '', updatedFrom: '' };

export function hasActiveFilters(filters: SearchFilters): boolean {
  return Boolean(filters.type || filters.tag || filters.updatedFrom);
}

/** Query string for GET /api/search, in the parameter names the server reads. */
export function buildSearchQuery(vaultId: string, query: string, filters: SearchFilters): string {
  const params = new URLSearchParams({ vaultId, q: query });
  if (filters.type) params.set('types', filters.type);
  if (filters.tag) params.set('tags', filters.tag);
  if (filters.updatedFrom) params.set('from', filters.updatedFrom);
  return params.toString();
}

interface FilterablePage {
  type?: string;
  tags?: string[];
  updated_at?: Date | string;
  created_at?: Date | string;
}

/** The same filters applied to pages already in the browser (used with no search text, and offline). */
export function matchesFilters(page: FilterablePage, filters: SearchFilters): boolean {
  if (filters.type && (page.type || 'note') !== filters.type) return false;
  if (filters.tag && !(page.tags || []).some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) return false;
  if (filters.updatedFrom) {
    const from = new Date(`${filters.updatedFrom}T00:00:00`);
    const changed = page.updated_at ?? page.created_at;
    if (Number.isNaN(from.getTime()) || !changed || new Date(changed) < from) return false;
  }
  return true;
}
