import React, { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RotateCcw } from 'lucide-react';
import { VaultRole } from '@tkxel-vault/types';
import { Button, Dialog } from '../ui/index.js';
import { getAuthToken } from '../../utils/storage.js';

interface DiffViewerProps {
  pageId: string;
  vaultId: string;
  currentRole: VaultRole;
  onClose: () => void;
  onRollback: (publishedContent: string) => void;
}

type DiffLine = { kind: 'added' | 'removed' | 'unchanged'; value: string; oldLine?: number; newLine?: number };

export function buildLineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const rows: DiffLine[] = [];
  const length = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < length; index += 1) {
    const oldValue = oldLines[index];
    const newValue = newLines[index];
    if (oldValue === newValue) {
      rows.push({ kind: 'unchanged', value: oldValue ?? '', oldLine: index + 1, newLine: index + 1 });
    } else {
      if (oldValue !== undefined) rows.push({ kind: 'removed', value: oldValue, oldLine: index + 1 });
      if (newValue !== undefined) rows.push({ kind: 'added', value: newValue, newLine: index + 1 });
    }
  }
  return rows;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ pageId, vaultId, currentRole, onClose, onRollback }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRollback, setConfirmRollback] = useState(false);

  useEffect(() => {
    const fetchVersions = async () => {
      const userIds: Record<VaultRole, string> = {
        owner: 'usr_admin', editor: 'sarah.lead@tkxel.com', reader: 'engineering-team@tkxel.com', consumer: 'external.auditor@client.com',
      };
      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {
          'x-user-id': userIds[currentRole] || 'usr_admin',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const apiUrl = import.meta.env?.VITE_API_URL || 'http://localhost:3002/api';
        const response = await fetch(`${apiUrl}/pages/${pageId}/versions?vaultId=${vaultId}`, {
          headers,
        });
        if (response.ok) {
          const data = await response.json();
          setDraft(data.draft);
          setPublished(data.published);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchVersions().catch(() => setLoading(false));
  }, [pageId, vaultId, currentRole]);

  const rows = useMemo(() => buildLineDiff(published || '', draft || ''), [draft, published]);

  return (
    <>
      <Dialog
        open={!confirmRollback}
        title="Version comparison"
        description="Compare the latest published version with the current draft."
        onClose={onClose}
        footer={published && currentRole !== 'reader' ? (
          <Button variant="danger" leadingIcon={<RotateCcw size={16} />} onClick={() => setConfirmRollback(true)}>
            Restore published version
          </Button>
        ) : undefined}
      >
        {loading ? (
          <div className="version-diff__loading">Loading versions…</div>
        ) : (
          <div className="version-diff">
            <div className="version-diff__legend">
              <span><i data-kind="removed" />Published</span>
              <span><i data-kind="added" />Draft</span>
            </div>
            <div className="version-diff__lines" aria-label="Line-by-line changes">
              {rows.map((row, index) => (
                <div key={`${row.kind}-${index}`} className="version-diff__line" data-kind={row.kind}>
                  <span>{row.oldLine ?? ''}</span><span>{row.newLine ?? ''}</span>
                  <b>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</b>
                  <code>{row.value || ' '}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmRollback}
        title="Restore the published version?"
        description="Your current draft content will be replaced."
        onClose={() => setConfirmRollback(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmRollback(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { if (published) onRollback(published); setConfirmRollback(false); }}>
              Restore version
            </Button>
          </>
        )}
      >
        <p><GitCompareArrows size={18} aria-hidden="true" /> This keeps the published content but discards draft-only changes.</p>
      </Dialog>
    </>
  );
};
