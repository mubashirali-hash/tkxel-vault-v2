import React, { useState } from 'react';
import { Download, X, AlertTriangle, ShieldAlert, CheckCircle } from 'lucide-react';
import { Vault, VaultRole } from '@tkxel-vault/types';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface ExportModalProps {
  isOpen: boolean;
  vault: Vault;
  currentRole: VaultRole;
  onClose: () => void;
  onConfirmExport: (justification: string) => Promise<void>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  vault,
  currentRole,
  onClose,
  onConfirmExport,
}) => {
  const [justification, setJustification] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const dialogRef = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const isLockedVault = vault.mode === 'locked';
  const isOwner = currentRole === 'owner';
  const canExport = !isLockedVault && isOwner;

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canExport || !justification.trim()) return;

    setExporting(true);
    try {
      await onConfirmExport(justification.trim());
      setExported(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
    >
      <div
        ref={dialogRef}
        className="clean-panel modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Export vault notes"
        tabIndex={-1}
        style={{
          width: '500px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          backgroundColor: '#FFFFFF',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} color={canExport ? 'var(--tk-primary)' : 'var(--locked-accent)'} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Export Vault Notes
            </h3>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ padding: '4px' }} aria-label="Close export dialog">
            <X size={16} />
          </button>
        </div>

        {/* LOCKED VAULT: STRICT DENIAL */}
        {isLockedVault ? (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#DC2626', fontWeight: 700, fontSize: '0.88rem' }}>
              <ShieldAlert size={16} />
              <span>Export Prohibited on Locked Vaults</span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#7F1D1D', lineHeight: 1.5 }}>
              Vault <strong>'{vault.name}'</strong> is a zero-read intellectual property store. Bulk export is disabled across all interfaces to protect sensitive proprietary code.
            </p>
          </div>
        ) : !isOwner ? (
          /* OPEN VAULT: ROLE DENIAL */
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#FFFBEB',
              border: '1px solid #FDE68A',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D97706', fontWeight: 700, fontSize: '0.88rem' }}>
              <AlertTriangle size={16} />
              <span>Owner Access Required</span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#92400E', lineHeight: 1.5 }}>
              Your current role is <strong>'{currentRole}'</strong>. In Open Vaults, bulk exports can only be downloaded by the designated <strong>Vault Owner</strong>.
            </p>
          </div>
        ) : (
          /* OPEN VAULT: OWNER-AUTHORIZED EXPORT */
          <form onSubmit={handleExport} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Download a complete ZIP archive containing all Markdown notes, formatting, front matter, and images from <strong>'{vault.name}'</strong>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                REASON FOR EXPORT (AUDITED):
              </label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Offline backup, team compliance audit..."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                style={{
                  backgroundColor: '#F8FAFC',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none',
                }}
              />
            </div>

            {exported && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--tk-success)', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle size={16} />
                <span>Export generated & recorded in audit history.</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button type="button" onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!justification.trim() || exporting}
                className="btn btn-primary-blue"
              >
                {exporting ? 'Creating ZIP...' : 'Download ZIP Archive'}
              </button>
            </div>
          </form>
        )}

        {!canExport && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="btn btn-ghost">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
