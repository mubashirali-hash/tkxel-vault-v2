import React, { useEffect, useState } from 'react';
import { Button, Dialog } from '../ui/index.js';
import { EmergencyVault, listEmergencyVaultsApi, requestBreakGlassApi } from '../../operations/vault-admin-actions.js';

export interface EmergencyAccessModalProps {
  isOpen: boolean;
  token: string | null;
  onClose: () => void;
  /** Called when the list changes, so the app can refresh what it shows. */
  onChanged?: () => void;
}

const MIN_REASON = 20;
const helpStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 };
const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' };

function statusText(vault: EmergencyVault): string {
  const request = vault.request;
  if (!request) return 'No request yet';
  if (vault.access_active) return `Access approved until ${new Date(request.expires_at as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (request.status === 'pending') return 'Waiting for a second person to approve';
  if (request.status === 'denied') return 'Last request was denied';
  if (request.status === 'revoked') return 'Access was revoked';
  return 'Earlier access has expired';
}

/**
 * Emergency access for administrators (NFR-06). An administrator has no standing access to a locked
 * vault they do not own, and so cannot open its settings. This is where they ask: pick the vault,
 * give a reason, and wait for its Owner or another administrator to approve. The server decides
 * who may ask, records the request and alerts on it; this only collects the input.
 */
export const EmergencyAccessModal: React.FC<EmergencyAccessModalProps> = ({ isOpen, token, onClose, onChanged }) => {
  const [vaults, setVaults] = useState<EmergencyVault[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = async () => {
    try {
      setVaults(await listEmergencyVaultsApi({ token }));
    } catch {
      setVaults([]);
      setMessage({ kind: 'error', text: 'The list of locked vaults could not be loaded.' });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setMessage(null);
    setOpenFor(null);
    setReason('');
    setVaults(null);
    void load();
  }, [isOpen]);

  const send = async (vault: EmergencyVault) => {
    setBusy(true);
    setMessage(null);
    try {
      await requestBreakGlassApi(vault.vault_id, reason.trim(), { token });
      setMessage({ kind: 'ok', text: `Request sent for "${vault.name}". It needs approval from the vault's Owner or another administrator.` });
      setOpenFor(null);
      setReason('');
      await load();
      onChanged?.();
    } catch (error: any) {
      setMessage({ kind: 'error', text: error?.message && !/not_allowed/.test(error.message) ? error.message : 'The request could not be sent.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      title="Emergency access"
      description="Ask for time-limited access to a locked vault you do not own"
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={helpStyle}>
          Administrators have no standing access to locked vaults. A request needs a reason, is approved by a second person,
          expires on its own, and is recorded in the audit trail.
        </p>
        {message && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} style={{
            padding: '8px 10px', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)',
            color: message.kind === 'error' ? '#B91C1C' : '#047857', background: message.kind === 'error' ? '#FEF2F2' : '#ECFDF5',
          }}>
            {message.text}
          </div>
        )}
        {vaults === null && <p style={helpStyle}>Loading…</p>}
        {vaults !== null && vaults.length === 0 && <p style={helpStyle}>There are no locked vaults to request access to.</p>}
        {(vaults || []).map((vault) => {
          const waiting = vault.request?.status === 'pending';
          const canAsk = !waiting && !vault.access_active;
          return (
            <div key={vault.vault_id} style={rowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{vault.name}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Owner: {vault.owner_id} · {statusText(vault)}</div>
                </div>
                {canAsk && openFor !== vault.vault_id && (
                  <Button variant="secondary" onClick={() => { setOpenFor(vault.vault_id); setReason(''); setMessage(null); }}>Request access</Button>
                )}
              </div>
              {openFor === vault.vault_id && (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Reason (at least {MIN_REASON} characters; the Owner and the audit trail will see it)
                    <textarea
                      rows={3}
                      aria-label={`Reason for emergency access to ${vault.name}`}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      style={{ padding: '6px 8px', fontSize: '0.82rem', width: '100%', resize: 'vertical' }}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="primary" disabled={busy || reason.trim().length < MIN_REASON} onClick={() => send(vault)}>
                      {busy ? 'Sending…' : 'Send request'}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setOpenFor(null)}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
};
