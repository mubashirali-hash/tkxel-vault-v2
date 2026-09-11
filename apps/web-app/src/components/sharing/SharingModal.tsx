import React, { useState } from 'react';
import { Share2, X, Plus, Trash2, Users, Shield, Crown } from 'lucide-react';
import { Vault, VaultRole, Share } from '@tkxel-vault/types';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface SharingModalProps {
  isOpen: boolean;
  vault: Vault;
  currentRole: VaultRole;
  shares: Share[];
  onClose: () => void;
  onAddShare: (principalId: string, role: VaultRole) => void;
  onRevokeShare: (shareId: string) => void;
}

export const SharingModal: React.FC<SharingModalProps> = ({
  isOpen,
  vault,
  currentRole,
  shares,
  onClose,
  onAddShare,
  onRevokeShare,
}) => {
  const [newPrincipal, setNewPrincipal] = useState('');
  const [newRole, setNewRole] = useState<VaultRole>(vault.mode === 'locked' ? 'consumer' : 'reader');
  const dialogOpen = isOpen && currentRole === 'owner';
  const dialogRef = useModalAccessibility<HTMLDivElement>(dialogOpen, onClose);

  if (!dialogOpen) return null;

  const canManage = currentRole === 'owner';
  const isOpenVault = vault.mode === 'open';

  // Filter shares specifically for this vault
  const vaultShares = shares.filter((s) => s.vault_id === vault.id);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrincipal.trim()) return;
    onAddShare(newPrincipal.trim(), newRole);
    setNewPrincipal('');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
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
        aria-label="Manage vault access"
        tabIndex={-1}
        style={{
          width: '540px',
          maxWidth: '92vw',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0, 102, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Share2 size={18} color="var(--tk-primary)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Manage Vault Access
              </h3>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {vault.name} ({isOpenVault ? 'Open Knowledge Vault' : 'Zero-Read Locked Vault'})
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }} aria-label="Close sharing dialog">
            <X size={18} />
          </button>
        </div>

        {/* Vault Owner Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            backgroundColor: '#F0F7FF',
            borderRadius: '8px',
            border: '1px solid #BAE6FD',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                backgroundColor: 'var(--tk-primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Crown size={15} />
            </div>
            <div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {vault.owner_id}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--tk-primary)', fontWeight: 500 }}>
                Administrator
              </div>
            </div>
          </div>
          <span className="badge badge-open" style={{ fontWeight: 600 }}>
            Administrator
          </span>
        </div>

        {/* Add Share Form */}
        {canManage ? (
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
              INVITE OR ALLOW USER
            </div>
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="User email (e.g. user@tkxel.com)"
                value={newPrincipal}
                onChange={(e) => setNewPrincipal(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: '#F8FAFC',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />

              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as VaultRole)}
                style={{
                  backgroundColor: '#F8FAFC',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 12px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                }}
              >
                {isOpenVault ? (
                  <>
                    <option value="reader">Reader (View Only)</option>
                    <option value="editor">Editor (Read & Edit)</option>
                  </>
                ) : (
                  <>
                    <option value="consumer">Consumer (Run Skills)</option>
                    <option value="editor">Editor (Author Prompts)</option>
                  </>
                )}
              </select>

              <button type="submit" className="btn btn-primary-blue" style={{ padding: '0 16px', gap: '6px' }}>
                <Plus size={16} />
                Allow
              </button>
            </form>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Enter any authorized Google SSO email. Permissions apply immediately upon sign-in.
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: '#F8FAFC',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Shield size={16} color="var(--tk-primary)" />
            <span>You are viewing access as a <strong>{currentRole === 'owner' ? 'Administrator' : currentRole}</strong>. Only the Vault Administrator can grant or revoke access.</span>
          </div>
        )}

        {/* Members List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              AUTHORIZED TEAM MEMBERS ({vaultShares.length})
            </div>
            {isOpenVault && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Readers can browse • Editors can modify
              </span>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '220px',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '6px',
              backgroundColor: '#FAFAFA',
            }}
          >
            {vaultShares.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No additional team members shared yet.
              </div>
            ) : (
              vaultShares.map((share) => (
                <div
                  key={share.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Users size={15} color="var(--tk-primary)" />
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {share.principal_id}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      className={isOpenVault ? 'badge badge-open' : 'badge badge-locked'}
                      style={{ textTransform: 'capitalize', fontSize: '0.72rem' }}
                    >
                      {share.role}
                    </span>

                    {canManage && (
                      <button
                        onClick={() => onRevokeShare(share.id)}
                        className="btn btn-ghost"
                        style={{ padding: '4px 6px', color: '#DC2626' }}
                        title="Revoke access"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button onClick={onClose} className="btn btn-primary-blue" style={{ minWidth: '80px' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
