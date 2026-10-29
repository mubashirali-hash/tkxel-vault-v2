import React, { useEffect, useState } from 'react';
import { Vault } from '@tkxel-vault/types';
import { Button, Dialog } from '../ui/index.js';
import {
  LockedPageSummary,
  deleteLockedPageApi,
  getLockedPageApi,
  listLockedPagesApi,
  publishLockedPageApi,
  saveLockedPageApi,
} from '../../operations/vault-admin-actions.js';

export interface LockedPagesModalProps {
  isOpen: boolean;
  vault: Vault;
  /** Owners publish; Editors can only save drafts. */
  canPublish: boolean;
  token: string | null;
  onClose: () => void;
}

interface Draft {
  id: string;
  title: string;
  content: string;
  isNew: boolean;
}

const inputStyle: React.CSSProperties = { padding: '6px 8px', fontSize: '0.82rem', width: '100%' };

/**
 * Reference pages of a locked vault (FR-53): the material `ask_vault` answers from. People who use
 * the vault never see these pages. Content is fetched only when a page is opened for editing (the
 * server audits that), is held in this dialog only, and is dropped when the dialog closes.
 */
export const LockedPagesModal: React.FC<LockedPagesModalProps> = ({ isOpen, vault, canPublish, token, onClose }) => {
  const options = { token };
  const [pages, setPages] = useState<LockedPageSummary[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = async () => setPages(await listLockedPagesApi(vault.id, options));

  useEffect(() => {
    if (!isOpen) {
      // Nothing protected stays in memory once the dialog is closed
      setDraft(null);
      setPages(null);
      return;
    }
    setMessage(null);
    setConfirmDeleteId(null);
    refresh().catch(() => setMessage({ kind: 'error', text: 'The reference pages could not be loaded.' }));
  }, [isOpen, vault.id, token]);

  const run = async (name: string, action: () => Promise<string>) => {
    setBusy(name);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err?.message || 'The server did not accept the request.' });
    } finally {
      setBusy(null);
    }
  };

  const open = (page: LockedPageSummary) => run(`open-${page.id}`, async () => {
    const full = await getLockedPageApi(vault.id, page.id, options);
    setDraft({ id: full.id, title: full.title, content: full.content, isNew: false });
    return 'Opened for editing. This access is recorded in the audit trail.';
  });

  const save = () => run('save', async () => {
    if (!draft) return '';
    await saveLockedPageApi(vault.id, draft.id, { title: draft.title, content: draft.content }, options);
    setDraft({ ...draft, isNew: false });
    await refresh();
    return canPublish ? 'Draft saved. Publish it to make it available to ask_vault.' : 'Draft saved. An Owner has to publish it.';
  });

  const publish = (pageId: string) => run(`publish-${pageId}`, async () => {
    await publishLockedPageApi(vault.id, pageId, options);
    await refresh();
    return 'Published. ask_vault now answers from this version.';
  });

  const remove = (pageId: string) => run(`delete-${pageId}`, async () => {
    await deleteLockedPageApi(vault.id, pageId, options);
    setConfirmDeleteId(null);
    if (draft?.id === pageId) setDraft(null);
    await refresh();
    return 'Reference page deleted.';
  });

  return (
    <Dialog
      open={isOpen}
      title="Reference pages"
      description={`${vault.name} · used by ask_vault, never shown to the people who use this vault`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {message && message.text && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} style={{
            padding: '8px 10px', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)',
            backgroundColor: message.kind === 'error' ? '#FEF2F2' : '#F0FDF4',
            color: message.kind === 'error' ? '#B91C1C' : '#166534',
            border: `1px solid ${message.kind === 'error' ? '#FECACA' : '#BBF7D0'}`,
          }}>
            {message.text}
          </div>
        )}

        {draft ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem' }}>
              Title
              <input type="text" value={draft.title} maxLength={255} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={inputStyle} />
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Content (Markdown)
              <textarea rows={12} spellCheck={false} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button disabled={busy !== null || !draft.title.trim()} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
              {canPublish && !draft.isNew && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => publish(draft.id)}>Publish</Button>
              )}
              <Button variant="secondary" disabled={busy !== null} onClick={() => setDraft(null)}>Back to list</Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <Button disabled={busy !== null} onClick={() => setDraft({ id: crypto.randomUUID(), title: '', content: '', isNew: true })}>New reference page</Button>
            </div>
            {pages === null && !message && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Loading…</p>}
            {pages !== null && pages.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No reference pages yet. Until one is published, ask_vault has nothing to answer from.</p>
            )}
            {(pages || []).map((page) => (
              <div key={page.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem' }}>
                    {page.published ? 'Published' : 'Not published'}{page.has_draft ? ' · unpublished draft' : ''}
                  </div>
                </div>
                {confirmDeleteId === page.id ? (
                  <>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => remove(page.id)}>Confirm delete</Button>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => open(page)}>Edit</Button>
                    {canPublish && page.has_draft && <Button variant="secondary" disabled={busy !== null} onClick={() => publish(page.id)}>Publish</Button>}
                    <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmDeleteId(page.id)}>Delete</Button>
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
};
