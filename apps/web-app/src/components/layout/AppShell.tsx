import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen, Bot, Check, ChevronDown, Download, FileText, History, Lock, LogOut, Menu,
  Network, PanelLeftClose, PanelLeftOpen, Share2, Upload, UserRound, Sparkles, Plus,
  Search, Trash2, X,
} from 'lucide-react';
import { Vault, VaultRole } from '@tkxel-vault/types';
import { ActionMenu, Badge, Button, Dialog, IconButton } from '../ui/index.js';
import { NotesAiClient } from '../../features/notes-ai/ai-client.js';

export type AppTab = 'editor' | 'graph' | 'audit';

export interface AppShellProps {
  currentVault: Vault;
  vaults: Vault[];
  currentRole: VaultRole;
  currentTab: AppTab;
  userInfo?: { email: string; name: string; picture?: string };
  navigationOpen: boolean;
  navigationCollapsed: boolean;
  navigationAvailable: boolean;
  onToggleNavigation: () => void;
  onCloseNavigation: () => void;
  onSelectVault: (vault: Vault) => void;
  onDeleteVault?: (vaultId: string) => Promise<void> | void;
  onSelectTab: (tab: AppTab) => void;
  onOpenShareModal: () => void;
  onOpenExportModal: () => void;
  onOpenImportModal: () => void;
  onOpenMcpModal?: () => void;
  onOpenCreateVault?: () => void;
  onLogout?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentVault, vaults, currentRole, currentTab, userInfo,
  navigationOpen, navigationCollapsed, navigationAvailable, onToggleNavigation, onCloseNavigation,
  onSelectVault, onDeleteVault, onSelectTab, onOpenShareModal, onOpenExportModal,
  onOpenImportModal, onOpenMcpModal, onOpenCreateVault, onLogout, children,
}) => {
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultToDelete, setVaultToDelete] = useState<Vault | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isAiEnabled, setIsAiEnabled] = useState(() => NotesAiClient.isAiPluginEnabled());
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const isOpenVault = currentVault.mode === 'open';

  const handleToggleAi = () => {
    const next = !isAiEnabled;
    NotesAiClient.setAiPluginEnabled(next);
    setIsAiEnabled(next);
  };

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (!vaultMenuRef.current?.contains(event.target as Node)) {
        setVaultDropdownOpen(false);
        setVaultSearch('');
      }
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVaultDropdownOpen(false);
        setVaultSearch('');
        setUserMenuOpen(false);
        onCloseNavigation();
      }
    };
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onCloseNavigation]);

  const selectTab = (tab: AppTab) => {
    onSelectTab(tab);
    onCloseNavigation();
  };

  const overflowItems = [
    ...(isOpenVault && currentRole !== 'reader'
      ? [{ id: 'import', label: 'Import notes', icon: <Upload size={16} />, onSelect: onOpenImportModal }]
      : []),
    ...(currentRole === 'owner'
      ? [{ id: 'share', label: 'Share and access', icon: <Share2 size={16} />, onSelect: onOpenShareModal }]
      : []),
    ...(onOpenMcpModal
      ? [{ id: 'mcp', label: 'Integrations', icon: <Bot size={16} />, onSelect: onOpenMcpModal }]
      : []),
    ...(isOpenVault && currentRole === 'owner'
      ? [{ id: 'export', label: 'Export vault', icon: <Download size={16} />, onSelect: onOpenExportModal }]
      : []),
    {
      id: 'ai-toggle',
      label: isAiEnabled ? 'Disable AI Plugin' : 'Enable AI Plugin',
      icon: <Sparkles size={16} color={isAiEnabled ? '#7C3AED' : undefined} />,
      onSelect: handleToggleAi,
    },
  ];

  const filteredVaults = vaults.filter((v) =>
    v.name.toLowerCase().includes(vaultSearch.toLowerCase().trim())
  );

  return (
    <div className="app-shell" data-navigation-open={navigationOpen} data-navigation-collapsed={navigationCollapsed}>
      <header className="app-header">
        <div className="app-header__identity">
          {navigationAvailable && (
            <IconButton
              className="app-header__nav-toggle"
              size="sm"
              variant="quiet"
              label={navigationOpen || !navigationCollapsed ? 'Close notes navigation' : 'Open notes navigation'}
              icon={navigationOpen || !navigationCollapsed ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              onClick={onToggleNavigation}
            />
          )}

          <div className="app-brand" aria-label="tkxel Vault">
            <span className="app-brand__mark" aria-hidden="true">t</span>
            <span className="app-brand__name"><strong>tkxel</strong> Vault</span>
          </div>

          <div ref={vaultMenuRef} className="app-vault-switcher">
            <Button
              variant="secondary"
              size="sm"
              className="app-vault-switcher__trigger"
              aria-haspopup="menu"
              aria-expanded={vaultDropdownOpen}
              leadingIcon={isOpenVault ? <BookOpen size={15} /> : <Lock size={15} />}
              trailingIcon={<ChevronDown size={14} />}
              onClick={() => setVaultDropdownOpen((open) => !open)}
            >
              <span className="app-vault-switcher__name">{currentVault.name}</span>
              <Badge tone={isOpenVault ? 'open' : 'locked'} className="app-vault-switcher__badge">
                {isOpenVault ? 'Open' : 'Locked'}
              </Badge>
            </Button>

            {vaultDropdownOpen && (
              <div className="app-popover app-vault-menu" role="menu" aria-label="Select workspace vault">
                <div className="app-vault-menu__header">
                  <span className="app-popover__label">Workspace vault ({vaults.length})</span>
                </div>
                {vaults.length > 5 && (
                  <div className="app-vault-menu__search">
                    <Search size={14} className="app-vault-menu__search-icon" />
                    <input
                      type="text"
                      className="app-vault-menu__search-input"
                      placeholder="Search vaults..."
                      value={vaultSearch}
                      onChange={(e) => setVaultSearch(e.target.value)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                    {vaultSearch && (
                      <button
                        type="button"
                        className="app-vault-menu__search-clear"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVaultSearch('');
                        }}
                        aria-label="Clear search"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
                <div className="app-vault-menu__list">
                  {filteredVaults.length === 0 ? (
                    <div className="app-vault-menu__empty">No vaults match "{vaultSearch}"</div>
                  ) : (
                    filteredVaults.map((vault) => {
                      const selected = vault.id === currentVault.id;
                      return (
                        <div
                          key={vault.id}
                          className={`app-vault-menu__row ${selected ? 'app-vault-menu__row--selected' : ''}`}
                        >
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className="app-popover__item app-vault-menu__item-btn"
                            onClick={() => {
                              onSelectVault(vault);
                              setVaultDropdownOpen(false);
                              setVaultSearch('');
                              onCloseNavigation();
                            }}
                          >
                            {vault.mode === 'open' ? <BookOpen size={16} /> : <Lock size={16} />}
                            <span className="app-vault-menu__item-name" title={vault.name}>
                              {vault.name}
                            </span>
                            {selected && <Check size={16} className="app-popover__check" />}
                          </button>
                          {onDeleteVault && (
                            <button
                              type="button"
                              className="app-vault-menu__delete-btn"
                              title={`Delete vault "${vault.name}"`}
                              aria-label={`Delete vault ${vault.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteError(null);
                                setVaultToDelete(vault);
                                setVaultDropdownOpen(false);
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {onOpenCreateVault && (
                  <>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-subtle, #E2E8F0)', margin: '4px 0' }} />
                    <button
                      type="button"
                      className="app-popover__item"
                      style={{ color: 'var(--tk-primary, #0755E9)', fontWeight: 600 }}
                      onClick={() => {
                        setVaultDropdownOpen(false);
                        setVaultSearch('');
                        onOpenCreateVault();
                      }}
                    >
                      <Plus size={16} />
                      <span>Create New Vault...</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="app-view-tabs" aria-label="Workspace views">
          <button type="button" className="app-view-tab" aria-current={currentTab === 'editor' ? 'page' : undefined} onClick={() => selectTab('editor')}>
            {isOpenVault ? <FileText size={16} /> : <Lock size={16} />}
            <span>{isOpenVault ? 'Notes' : 'Skills'}</span>
          </button>
          {isOpenVault && (
            <button type="button" className="app-view-tab" aria-current={currentTab === 'graph' ? 'page' : undefined} onClick={() => selectTab('graph')}>
              <Network size={16} /><span>Graph</span>
            </button>
          )}
          <button type="button" className="app-view-tab" aria-current={currentTab === 'audit' ? 'page' : undefined} onClick={() => selectTab('audit')}>
            <History size={16} /><span>Activity &amp; Audit</span>
          </button>
        </nav>

        <div className="app-header__actions">
          <button
            type="button"
            className={`app-ai-pill ${isAiEnabled ? 'app-ai-pill--enabled' : 'app-ai-pill--disabled'}`}
            onClick={handleToggleAi}
            title={isAiEnabled ? 'AI Plugin is ACTIVE. Click to disable (zero overhead).' : 'AI Plugin is DISABLED. Click to enable.'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 500,
              borderRadius: '9999px',
              border: isAiEnabled ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid var(--color-border-subtle, #e2e8f0)',
              backgroundColor: isAiEnabled ? 'rgba(124, 58, 237, 0.08)' : 'transparent',
              color: isAiEnabled ? '#7c3aed' : 'var(--color-text-muted, #64748b)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Sparkles size={13} />
            <span>{isAiEnabled ? 'AI Active' : 'AI Off'}</span>
          </button>

          {overflowItems.length > 0 && <ActionMenu label="Workspace actions" items={overflowItems} compact />}

          <div ref={userMenuRef} className="app-user-menu">
            <button
              type="button"
              className="app-user-menu__trigger"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label="Open account menu"
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="app-user-menu__avatar" aria-hidden="true">
                {userInfo?.picture
                  ? <img src={userInfo.picture} alt="" referrerPolicy="no-referrer" />
                  : (userInfo?.name?.charAt(0).toUpperCase() || <UserRound size={16} />)}
              </span>
              <span className="app-user-menu__copy">
                <strong title={userInfo?.email}>{userInfo?.name || userInfo?.email || 'Account'}</strong>
                <span>{currentRole === 'owner' ? 'Administrator' : currentRole.charAt(0).toUpperCase() + currentRole.slice(1)}</span>
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>

            {userMenuOpen && (
              <div className="app-popover app-account-popover" role="menu" aria-label="Account">
                <div className="app-account-popover__identity">
                  <strong>{userInfo?.name || 'Account'}</strong>
                  <span>{userInfo?.email}</span>
                </div>
                {currentRole === 'owner' && (
                  <button type="button" role="menuitem" className="app-popover__item" onClick={() => { onOpenShareModal(); setUserMenuOpen(false); }}>
                    <Share2 size={16} /> Manage access
                  </button>
                )}
                {onLogout && (
                  <button type="button" role="menuitem" className="app-popover__item" onClick={() => { onLogout(); setUserMenuOpen(false); }}>
                    <LogOut size={16} /> Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-workspace">{children}</main>

      <nav className="app-mobile-nav" aria-label="Primary workspace navigation">
        <button type="button" aria-current={currentTab === 'editor' ? 'page' : undefined} onClick={() => selectTab('editor')}>
          {isOpenVault ? <FileText size={20} /> : <Lock size={20} />}
          <span>{isOpenVault ? 'Notes' : 'Skills'}</span>
        </button>
        {isOpenVault && (
          <button type="button" aria-current={currentTab === 'graph' ? 'page' : undefined} onClick={() => selectTab('graph')}>
            <Network size={20} /><span>Graph</span>
          </button>
        )}
        <button type="button" aria-current={currentTab === 'audit' ? 'page' : undefined} onClick={() => selectTab('audit')}>
          <History size={20} /><span>Activity</span>
        </button>
        {navigationAvailable && (
          <button type="button" aria-expanded={navigationOpen} onClick={onToggleNavigation}>
            <Menu size={20} /><span>Browse</span>
          </button>
        )}
      </nav>

      {vaultToDelete && (
        <Dialog
          open={Boolean(vaultToDelete)}
          title={`Delete Vault "${vaultToDelete.name}"?`}
          onClose={() => {
            if (!isDeleting) {
              setVaultToDelete(null);
              setDeleteError(null);
            }
          }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => {
                  setVaultToDelete(null);
                  setDeleteError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isDeleting}
                onClick={async () => {
                  if (!onDeleteVault) return;
                  try {
                    setIsDeleting(true);
                    setDeleteError(null);
                    await onDeleteVault(vaultToDelete.id);
                    setVaultToDelete(null);
                  } catch (err: any) {
                    setDeleteError(err?.message || 'Failed to delete vault');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
              >
                {isDeleting ? 'Deleting...' : 'Delete Vault'}
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: 'var(--color-text-default, #1e293b)' }}>
            <p>
              Are you sure you want to permanently delete <strong>{vaultToDelete.name}</strong>?
            </p>
            <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '13px' }}>
              This action cannot be undone. All notes, skills, links, and draft histories within this vault will be permanently purged.
            </p>
            {deleteError && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: '13px' }}>
                {deleteError}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
};
