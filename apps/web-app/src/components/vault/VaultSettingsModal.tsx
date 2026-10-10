import React, { useEffect, useState } from 'react';
import { Vault } from '@tkxel-vault/types';
import { Button, Dialog } from '../ui/index.js';
import {
  BreakGlassRequest,
  VaultRateLimits,
  cryptoShredVaultApi,
  decideBreakGlassApi,
  getVaultRateLimitsApi,
  listBreakGlassApi,
  rekeyVaultApi,
  requestBreakGlassApi,
  setVaultRateLimitsApi,
} from '../../operations/vault-admin-actions.js';

export interface VaultSettingsModalProps {
  isOpen: boolean;
  vault: Vault;
  /** The signed-in user owns this vault. Administrators who are not the Owner see emergency access only. */
  isOwner: boolean;
  currentUserEmail: string;
  token: string | null;
  onClose: () => void;
  /** Called after the vault's content was destroyed, so the app can leave it. */
  onVaultShredded: (vault: Vault) => void;
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '14px', borderBottom: '1px solid var(--border-subtle)' };
const headingStyle: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 };
const helpStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 };
const inputStyle: React.CSSProperties = { padding: '6px 8px', fontSize: '0.82rem', width: '100%' };

const limitValue = (text: string): number | undefined => {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
};

/**
 * Owner controls that have no other home: per-vault rate limits (FR-67), key rotation and
 * crypto-shredding (NFR-05), and emergency administrator access to a locked vault (NFR-06).
 * Every action is carried out and checked by the server; this only collects the input.
 */
export const VaultSettingsModal: React.FC<VaultSettingsModalProps> = ({
  isOpen, vault, isOwner, currentUserEmail, token, onClose, onVaultShredded,
}) => {
  const options = { token };
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [defaults, setDefaults] = useState<Required<VaultRateLimits>>({ locked_per_hour: 60, retrieval_per_hour: 300 });
  const [lockedLimit, setLockedLimit] = useState('');
  const [retrievalLimit, setRetrievalLimit] = useState('');
  const [shredName, setShredName] = useState('');
  const [requests, setRequests] = useState<BreakGlassRequest[] | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    setMessage(null);
    setShredName('');
    setReason('');
    setRequests(null);
    if (isOwner) {
      getVaultRateLimitsApi(vault.id, options)
        .then((data) => {
          if (!current) return;
          setDefaults(data.defaults);
          setLockedLimit(data.rate_limits.locked_per_hour?.toString() ?? '');
          setRetrievalLimit(data.rate_limits.retrieval_per_hour?.toString() ?? '');
        })
        .catch(() => current && setMessage({ kind: 'error', text: 'The current rate limits could not be loaded.' }));
    }
    if (vault.mode === 'locked') {
      // Refused for anyone who is neither the Owner nor an administrator; the section then stays hidden
      listBreakGlassApi(vault.id, options).then((list) => current && setRequests(list)).catch(() => current && setRequests(null));
    }
    return () => {
      current = false;
    };
  }, [isOpen, vault.id, vault.mode, isOwner, token]);

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

  const saveLimits = () => run('limits', async () => {
    const limits: VaultRateLimits = { locked_per_hour: limitValue(lockedLimit), retrieval_per_hour: limitValue(retrievalLimit) };
    for (const value of Object.values(limits)) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 10000)) {
        throw new Error('Limits must be whole numbers between 1 and 10,000, or empty for the default.');
      }
    }
    await setVaultRateLimitsApi(vault.id, limits, options);
    return 'Rate limits saved. They apply to the next request.';
  });

  const rekey = () => run('rekey', async () => {
    const { reencrypted } = await rekeyVaultApi(vault.id, options);
    return `Key rotated. Re-encrypted ${reencrypted.versions} versions, ${reencrypted.chunks} index entries, ${reencrypted.timeline_entries} timeline entries and ${reencrypted.skills} skills.`;
  });

  const shred = () => run('shred', async () => {
    const result = await cryptoShredVaultApi(vault.id, shredName, options);
    onVaultShredded(vault);
    return `Vault destroyed: ${result.pages_removed} pages and ${result.skills_removed} skills removed, ${result.shares_revoked} shares revoked.`;
  });

  const refreshRequests = async () => setRequests(await listBreakGlassApi(vault.id, options));
  const requestAccess = () => run('request', async () => {
    await requestBreakGlassApi(vault.id, reason, options);
    setReason('');
    await refreshRequests();
    return 'Request recorded. A second person has to approve it.';
  });
  const decide = (request: BreakGlassRequest, decision: 'approve' | 'deny' | 'revoke') => run(`${decision}-${request.id}`, async () => {
    await decideBreakGlassApi(request.id, decision, options);
    await refreshRequests();
    return decision === 'approve' ? 'Access approved for a limited time.' : decision === 'deny' ? 'Request denied.' : 'Access revoked.';
  });

  const me = currentUserEmail.toLowerCase().trim();

  return (
    <Dialog
      open={isOpen}
      title="Vault settings"
      description={`${vault.name} · ${vault.mode === 'locked' ? 'Locked vault' : 'Open vault'}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {message && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} style={{
            padding: '8px 10px', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)',
            backgroundColor: message.kind === 'error' ? '#FEF2F2' : '#F0FDF4',
            color: message.kind === 'error' ? '#B91C1C' : '#166534',
            border: `1px solid ${message.kind === 'error' ? '#FECACA' : '#BBF7D0'}`,
          }}>
            {message.text}
          </div>
        )}

        {isOwner && (
          <section style={sectionStyle} aria-label="Rate limits">
            <h4 style={headingStyle}>Rate limits</h4>
            <p style={helpStyle}>Calls each person may make to this vault per hour through AI tools. Leave a field empty to use the default.</p>
            <label style={{ fontSize: '0.8rem' }}>
              Skill and question calls per hour (default {defaults.locked_per_hour})
              <input type="number" min={1} max={10000} inputMode="numeric" value={lockedLimit} placeholder={String(defaults.locked_per_hour)} onChange={(e) => setLockedLimit(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Search and page calls per hour (default {defaults.retrieval_per_hour})
              <input type="number" min={1} max={10000} inputMode="numeric" value={retrievalLimit} placeholder={String(defaults.retrieval_per_hour)} onChange={(e) => setRetrievalLimit(e.target.value)} style={inputStyle} />
            </label>
            <div><Button variant="secondary" disabled={busy !== null} onClick={saveLimits}>{busy === 'limits' ? 'Saving…' : 'Save limits'}</Button></div>
          </section>
        )}

        {isOwner && (
          <section style={sectionStyle} aria-label="Encryption key">
            <h4 style={headingStyle}>Encryption key</h4>
            <p style={helpStyle}>Rotating the key re-encrypts everything in this vault with a new key. Nothing changes for the people who use it.</p>
            <div><Button variant="secondary" disabled={busy !== null} onClick={rekey}>{busy === 'rekey' ? 'Rotating…' : 'Rotate key now'}</Button></div>
          </section>
        )}

        {vault.mode === 'locked' && requests !== null && (
          <section style={sectionStyle} aria-label="Emergency access">
            <h4 style={headingStyle}>Emergency access</h4>
            <p style={helpStyle}>Administrators have no standing access to a locked vault. Access is requested with a reason, approved by a second person, and expires on its own.</p>
            {requests.length === 0 && <p style={helpStyle}>No requests.</p>}
            {requests.map((request) => {
              const active = request.status === 'approved' && request.expires_at !== null && new Date(request.expires_at) > new Date();
              return (
                <div key={request.id} style={{ fontSize: '0.8rem', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                  <div><strong>{request.requester_id}</strong> · {active ? `approved until ${new Date(request.expires_at as string).toLocaleString()}` : request.status === 'approved' ? 'expired' : request.status}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>{request.reason}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    {request.status === 'pending' && request.requester_id.toLowerCase().trim() !== me && (
                      <>
                        <Button variant="secondary" disabled={busy !== null} onClick={() => decide(request, 'approve')}>Approve</Button>
                        <Button variant="secondary" disabled={busy !== null} onClick={() => decide(request, 'deny')}>Deny</Button>
                      </>
                    )}
                    {active && <Button variant="secondary" disabled={busy !== null} onClick={() => decide(request, 'revoke')}>Revoke now</Button>}
                  </div>
                </div>
              );
            })}
            {!isOwner && (
              <>
                <label style={{ fontSize: '0.8rem' }}>
                  Reason for access (recorded in the audit trail)
                  <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
                </label>
                <div><Button variant="secondary" disabled={busy !== null || reason.trim().length < 20} onClick={requestAccess}>{busy === 'request' ? 'Sending…' : 'Request access'}</Button></div>
              </>
            )}
          </section>
        )}

        {isOwner && (
          <section style={{ ...sectionStyle, borderBottom: 'none' }} aria-label="Destroy vault">
            <h4 style={{ ...headingStyle, color: '#B91C1C' }}>Destroy this vault</h4>
            <p style={helpStyle}>Destroys the encryption key and removes every page, skill and share. This cannot be undone, and backups of this vault become unreadable. Type the vault name to confirm.</p>
            <input type="text" aria-label="Type the vault name to confirm" value={shredName} placeholder={vault.name} onChange={(e) => setShredName(e.target.value)} style={inputStyle} />
            <div><Button variant="secondary" disabled={busy !== null || shredName !== vault.name} onClick={shred}>{busy === 'shred' ? 'Destroying…' : 'Destroy vault permanently'}</Button></div>
          </section>
        )}
      </div>
    </Dialog>
  );
};
