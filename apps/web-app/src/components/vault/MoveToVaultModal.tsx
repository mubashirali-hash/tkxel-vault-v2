import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog.js';
import { Button } from '../ui/Button.js';
import { Vault } from '@tkxel-vault/types';
import { ArrowRight, BookOpen, Lock, ShieldAlert } from 'lucide-react';

export interface MoveToVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageTitle: string;
  pageId: string;
  currentVault: Vault;
  availableVaults: Vault[];
  onMovePage: (destinationVaultId: string) => Promise<void>;
}

export const MoveToVaultModal: React.FC<MoveToVaultModalProps> = ({
  isOpen,
  onClose,
  pageTitle,
  currentVault,
  availableVaults,
  onMovePage,
}) => {
  const eligibleVaults = availableVaults.filter((v) => v.id !== currentVault.id);
  const [selectedVaultId, setSelectedVaultId] = useState<string>(eligibleVaults[0]?.id || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetVault = eligibleVaults.find((v) => v.id === selectedVaultId);

  const handleMove = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedVaultId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onMovePage(selectedVaultId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to move note to target vault');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      title="Move Note to Another Vault"
      description={`Transfer "${pageTitle}" to an isolated destination vault with automatic cross-KMS re-encryption.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleMove}
            disabled={!selectedVaultId || isSubmitting || eligibleVaults.length === 0}
          >
            {isSubmitting ? 'Re-encrypting & Moving...' : 'Confirm Move'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && (
          <div
            role="alert"
            className="ui-alert ui-alert--error text-red-700 bg-red-50"
            style={{
              padding: '10px 14px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: '6px',
              color: '#B91C1C',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Visual Migration Pathway */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: '#F8FAFC',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentVault.mode === 'open' ? <BookOpen size={16} color="var(--tk-primary)" /> : <Lock size={16} color="var(--locked-accent)" />}
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{currentVault.name}</span>
          </div>
          <ArrowRight size={16} color="var(--text-muted)" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {targetVault?.mode === 'open' ? <BookOpen size={16} color="var(--tk-primary)" /> : <Lock size={16} color="var(--locked-accent)" />}
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {targetVault?.name || 'Select destination'}
            </span>
          </div>
        </div>

        <div>
          <label
            htmlFor="destination-vault-select"
            style={{
              display: 'block',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '6px',
            }}
          >
            Destination Vault
          </label>
          {eligibleVaults.length === 0 ? (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              No other accessible vaults available. Create a second vault to enable transfers.
            </p>
          ) : (
            <select
              id="destination-vault-select"
              name="destinationVault"
              value={selectedVaultId}
              onChange={(e) => setSelectedVaultId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.88rem',
                fontFamily: 'inherit',
                outline: 'none',
                backgroundColor: '#FFFFFF',
              }}
            >
              {eligibleVaults.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.mode === 'open' ? 'Open Knowledge Hub' : 'Locked Skills Store'})
                </option>
              ))}
            </select>
          )}
        </div>

        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'rgba(7, 85, 233, 0.04)',
            border: '1px solid rgba(7, 85, 233, 0.15)',
            borderRadius: '6px',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
          }}
        >
          🔐 <strong>KMS Cross-Encryption Guarantee:</strong> All historic document versions and search chunks are decrypted using the source vault’s key and immediately re-encrypted under the destination vault’s unique KMS DEK inside an ACID transaction.
        </div>
      </div>
    </Dialog>
  );
};
