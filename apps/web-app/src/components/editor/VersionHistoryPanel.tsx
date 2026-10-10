import React, { useEffect, useState } from 'react';
import { ArrowUpRight, History, RotateCcw, EyeOff } from 'lucide-react';
import { Button, Dialog } from '../ui/index.js';
import { API_URL } from '../../utils/api-base.js';
import { getAuthToken } from '../../utils/storage.js';

interface VersionSummary {
  id: string;
  number: number;
  status: 'draft' | 'published' | 'unpublished';
  created_by: string;
  created_at: string;
  is_current: boolean;
}

interface CrossVaultLink {
  raw_target: string;
  link_type: string;
  available: boolean;
  target?: { page_id: string; vault_id: string; vault_name: string; title: string };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

const STATUS_LABEL: Record<VersionSummary['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  unpublished: 'Withdrawn',
};

/** Splits two texts into aligned rows for a side-by-side comparison (longest common subsequence of lines). */
export function alignLines(left: string, right: string): Array<{ left: string | null; right: string | null; changed: boolean }> {
  const a = left.split('\n');
  const b = right.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: Array<{ left: string | null; right: string | null; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ left: a[i++], right: b[j++], changed: false });
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // Removals are listed before the additions that replace them
      rows.push({ left: a[i++], right: null, changed: true });
    } else {
      rows.push({ left: null, right: b[j++], changed: true });
    }
  }
  return rows;
}

export interface VersionHistoryPanelProps {
  pageId: string;
  /** The content currently in the editor, compared against the selected version. */
  currentContent: string;
  /** Only Owners can restore a version or withdraw a page (FR-41, FR-44). */
  canPublish: boolean;
}

/**
 * Version history with side-by-side comparison, restore and unpublish (FR-42, FR-44).
 * Every action is performed by the server; the page reloads afterwards so the editor shows server state.
 */
export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({ pageId, currentContent, canPublish }) => {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ version: VersionSummary; content: string } | null>(null);
  const [confirm, setConfirm] = useState<'restore' | 'unpublish' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setVersions(null);
    setSelected(null);
    setError(null);
    api(`/pages/${pageId}/history`)
      .then(async (res) => {
        if (!current) return;
        if (!res.ok) {
          setError(res.status === 404 ? 'Save this note to start its history.' : 'Version history could not be loaded.');
          setVersions([]);
          return;
        }
        setVersions((await res.json()).versions || []);
      })
      .catch(() => current && setError('Version history could not be loaded.'));
    return () => {
      current = false;
    };
  }, [pageId]);

  const openVersion = async (version: VersionSummary) => {
    setError(null);
    const res = await api(`/pages/${pageId}/versions/${version.id}`);
    if (!res.ok) {
      setError('That version could not be loaded.');
      return;
    }
    setSelected({ version, content: (await res.json()).content || '' });
  };

  const runAction = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = confirm === 'restore'
        ? await api(`/pages/${pageId}/rollback`, { method: 'POST', body: JSON.stringify({ version_id: selected?.version.id }) })
        : await api(`/pages/${pageId}/unpublish`, { method: 'POST', body: '{}' });
      if (!res.ok) {
        setError(confirm === 'restore' ? 'The version could not be restored.' : 'The note could not be unpublished.');
        return;
      }
      // Reload so the editor, lists and graph all reflect what the server now holds
      window.location.reload();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const isPublished = (versions || []).some((v) => v.status === 'published');
  const rows = selected ? alignLines(selected.content, currentContent) : [];

  return (
    <div className="note-links">
      <section>
        <h3><History size={14} /> Versions <span>{versions?.length ?? 0}</span></h3>
        {error && <p role="alert">{error}</p>}
        {versions === null && !error && <p>Loading…</p>}
        {versions?.map((v) => (
          <button type="button" key={v.id} aria-pressed={selected?.version.id === v.id} onClick={() => openVersion(v)}>
            <ArrowUpRight size={14} />
            v{v.number} · {STATUS_LABEL[v.status]}{v.is_current ? ' (live)' : ''} · {new Date(v.created_at).toLocaleString()} · {v.created_by}
          </button>
        ))}
        {canPublish && isPublished && (
          <Button variant="secondary" leadingIcon={<EyeOff size={14} />} onClick={() => setConfirm('unpublish')}>
            Unpublish this note
          </Button>
        )}
      </section>

      {selected && (
        <section>
          <h3>v{selected.version.number} compared with the editor</h3>
          <div
            role="table"
            aria-label="Side-by-side comparison"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.74rem', maxHeight: 320, overflow: 'auto' }}
          >
            <strong role="columnheader">v{selected.version.number}</strong>
            <strong role="columnheader">Editor</strong>
            {rows.map((row, index) => (
              <React.Fragment key={index}>
                <span role="cell" style={{ whiteSpace: 'pre-wrap', background: row.changed && row.left !== null ? 'rgba(220, 38, 38, 0.12)' : undefined }}>
                  {row.left ?? ''}
                </span>
                <span role="cell" style={{ whiteSpace: 'pre-wrap', background: row.changed && row.right !== null ? 'rgba(22, 163, 74, 0.14)' : undefined }}>
                  {row.right ?? ''}
                </span>
              </React.Fragment>
            ))}
          </div>
          {canPublish && selected.version.status !== 'draft' && (
            <Button variant="primary" leadingIcon={<RotateCcw size={14} />} onClick={() => setConfirm('restore')}>
              Restore v{selected.version.number}
            </Button>
          )}
        </section>
      )}

      <Dialog
        open={confirm !== null}
        title={confirm === 'restore' ? `Restore v${selected?.version.number}?` : 'Unpublish this note?'}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={runAction}>{confirm === 'restore' ? 'Restore and publish' : 'Unpublish'}</Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {confirm === 'restore'
            ? 'Its content is published again as a new version. Nothing in the history is removed, but an unsaved draft in the editor is replaced.'
            : 'Readers and Claude lose access to this note immediately. Owners and Editors keep it, with its full history.'}
        </p>
      </Dialog>
    </div>
  );
};

/** Unresolved links checked against the reader's other vaults (FR-16). */
export const CrossVaultLinks: React.FC<{ pageId: string }> = ({ pageId }) => {
  const [links, setLinks] = useState<CrossVaultLink[]>([]);

  useEffect(() => {
    let current = true;
    setLinks([]);
    api(`/pages/${pageId}/cross-vault-links`)
      .then(async (res) => {
        if (current && res.ok) setLinks((await res.json()).links || []);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [pageId]);

  if (links.length === 0) return null;
  return (
    <section>
      <h3>Unresolved links <span>{links.length}</span></h3>
      {links.map((link) => (
        <p key={`${link.link_type}:${link.raw_target}`}>
          [[{link.raw_target}]] — {link.available && link.target ? `in vault "${link.target.vault_name}"` : 'unavailable'}
        </p>
      ))}
    </section>
  );
};
