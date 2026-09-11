import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen, Bot, Check, ChevronDown, Download, FileText, History, Lock, LogOut, Menu,
  Network, PanelLeftClose, PanelLeftOpen, Share2, Upload, UserRound,
} from 'lucide-react';
import { Vault, VaultRole } from '@tkxel-vault/types';
import { ActionMenu, Badge, Button, IconButton } from '../ui/index.js';

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
  onSelectTab: (tab: AppTab) => void;
  onOpenShareModal: () => void;
  onOpenExportModal: () => void;
  onOpenImportModal: () => void;
  onOpenMcpModal?: () => void;
  onLogout?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentVault, vaults, currentRole, currentTab, userInfo,
  navigationOpen, navigationCollapsed, navigationAvailable, onToggleNavigation, onCloseNavigation,
  onSelectVault, onSelectTab, onOpenShareModal, onOpenExportModal,
  onOpenImportModal, onOpenMcpModal, onLogout, children,
}) => {
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const isOpenVault = currentVault.mode === 'open';

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (!vaultMenuRef.current?.contains(event.target as Node)) setVaultDropdownOpen(false);
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVaultDropdownOpen(false);
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
  ];

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
                <span className="app-popover__label">Workspace vault</span>
                {vaults.map((vault) => {
                  const selected = vault.id === currentVault.id;
                  return (
                    <button
                      key={vault.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className="app-popover__item"
                      onClick={() => {
                        onSelectVault(vault);
                        setVaultDropdownOpen(false);
                        onCloseNavigation();
                      }}
                    >
                      {vault.mode === 'open' ? <BookOpen size={16} /> : <Lock size={16} />}
                      <span>{vault.name}</span>
                      {selected && <Check size={16} className="app-popover__check" />}
                    </button>
                  );
                })}
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
    </div>
  );
};
