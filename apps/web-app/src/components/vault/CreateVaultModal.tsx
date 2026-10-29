import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog.js';
import { Button } from '../ui/Button.js';
import { BookOpen, Lock, ShieldAlert } from 'lucide-react';

export interface CreateVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateVault: (data: { name: string; mode: 'open' | 'locked'; export_policy?: string }) => Promise<void>;
}

export const CreateVaultModal: React.FC<CreateVaultModalProps> = ({
  isOpen,
  onClose,
  onCreateVault,
}) => {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'open' | 'locked'>('open');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onCreateVault({
        name: name.trim(),
        mode,
        export_policy: mode === 'locked' ? 'strictly_forbidden' : 'allowed_for_owner',
      });
      setName('');
      setMode('open');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create vault');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      title="Create New Vault"
      description="Create an isolated context hub or proprietary locked skill store."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Vault'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
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

        <div>
          <label
            htmlFor="create-vault-name"
            style={{
              display: 'block',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '6px',
            }}
          >
            Vault Name
          </label>
          <input
            id="create-vault-name"
            name="vaultName"
            type="text"
            required
            autoFocus
            placeholder="e.g. Healthcare Clinical Notes or AI Agents Store"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.9rem',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            Vault Security Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              onClick={() => setMode('open')}
              style={{
                border: mode === 'open' ? '2px solid var(--tk-primary)' : '1px solid var(--border-subtle)',
                backgroundColor: mode === 'open' ? 'rgba(7, 85, 233, 0.04)' : '#FFFFFF',
                borderRadius: '8px',
                padding: '14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <BookOpen size={18} color="var(--tk-primary)" />
                <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Open Hub</strong>
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Markdown knowledge graph with bidirectional links and hybrid RAG search for assigned readers.
              </p>
            </div>

            <div
              onClick={() => setMode('locked')}
              style={{
                border: mode === 'locked' ? '2px solid var(--locked-accent)' : '1px solid var(--border-subtle)',
                backgroundColor: mode === 'locked' ? 'rgba(255, 87, 34, 0.04)' : '#FFFFFF',
                borderRadius: '8px',
                padding: '14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <Lock size={18} color="var(--locked-accent)" />
                <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Locked Skills</strong>
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Zero-read sandbox store. Consumers execute approved capabilities without seeing code or instructions.
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--bg-muted, #F8FAFC)',
            borderRadius: '6px',
            fontSize: '0.76rem',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          🔐 <strong>Cryptographic Isolation:</strong> A dedicated, unique AES-256-GCM data encryption key (DEK) wrapped by Cloud KMS will be provisioned for this vault.
        </div>
      </form>
    </Dialog>
  );
};
