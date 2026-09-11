import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Page, Vault, VaultRole } from '@tkxel-vault/types';
import { ActionMenu, ActionMenuItem, Button, Dialog, EmptyState, IconButton } from '../ui/index.js';

export interface SidebarProps {
  currentVault: Vault;
  currentRole: VaultRole;
  pages: Page[];
  activePageId?: string;
  folders?: string[];
  onSelectPage: (page: Page) => void;
  onCreateNewPage: (folder?: string) => void;
  onCreateFolder?: (folderName: string) => void;
  onMoveNoteToFolder?: (pageId: string, folderName?: string) => void;
  onDeleteFolder?: (folderName: string) => void;
  onDeletePage?: (pageId: string) => void;
  onOpenConvertToSkill?: (page: Page) => void;
  onConvertFolderToSkill?: (folderName: string) => void;
  onCreateHubPage?: (folderName: string) => void;
  isNavigationOpen?: boolean;
  isNavigationCollapsed?: boolean;
  onCloseNavigation?: () => void;
}

const PRESET_FOLDERS = ['Agents', 'Projects', 'Clients', 'Decisions', 'Architecture'];

export const Sidebar: React.FC<SidebarProps> = ({
  currentVault,
  currentRole,
  pages,
  activePageId,
  folders = [],
  onSelectPage,
  onCreateNewPage,
  onCreateFolder,
  onMoveNoteToFolder,
  onDeleteFolder,
  onDeletePage,
  onOpenConvertToSkill,
  onConvertFolderToSkill,
  onCreateHubPage,
  isNavigationOpen = false,
  isNavigationCollapsed = false,
  onCloseNavigation,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Page[] | null>(null);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('tkxel_vault_collapsed_folders');
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const handleFolderDrop = (e: React.DragEvent, targetFolder?: string) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const droppedPageId =
      e.dataTransfer.getData('application/tkxel-page') || e.dataTransfer.getData('text/plain');
    if (droppedPageId && onMoveNoteToFolder) {
      onMoveNoteToFolder(droppedPageId, targetFolder);
      if (targetFolder) {
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          next.delete(targetFolder);
          try {
            localStorage.setItem('tkxel_vault_collapsed_folders', JSON.stringify(Array.from(next)));
          } catch {}
          return next;
        });
      }
    }
    setDragOverFolder(null);
    setDraggingPageId(null);
  };

  const sidebarRef = useRef<HTMLElement>(null);
  const canEdit = currentRole === 'owner' || currentRole === 'editor';
  const vaultPages = pages.filter((page) => page.vault_id === currentVault.id);

  // Compute union of defined folders and folders in existing pages
  const allFolders = Array.from(
    new Set([
      ...folders,
      ...(vaultPages.map((p) => p.folder).filter(Boolean) as string[]),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const toggleFolderCollapse = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      try {
        localStorage.setItem('tkxel_vault_collapsed_folders', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleCreateFolderSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    onCreateFolder?.(trimmed);
    setNewFolderName('');
    setIsNewFolderOpen(false);
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }

    const fallback = () => {
      const normalized = query.toLowerCase();
      setSearchResults(vaultPages.filter((page) =>
        page.title.toLowerCase().includes(normalized)
        || (page.folder && page.folder.toLowerCase().includes(normalized))
        || page.tags.some((tag) => tag.toLowerCase().includes(normalized)),
      ));
    };

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `http://localhost:3002/api/search?vaultId=${currentVault.id}&q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('Search unavailable');
        const data = await response.json();
        const foundIds = new Set<string>(data.results.map((result: { id: string }) => result.id));
        setSearchResults(vaultPages.filter((page) => foundIds.has(page.id)));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') fallback();
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentVault.id, pages, searchQuery]);

  useEffect(() => {
    if (!isNavigationOpen) return;
    const sidebar = sidebarRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sidebar?.querySelector<HTMLElement>('button, input')?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !sidebar) return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      previouslyFocused?.focus();
    };
  }, [isNavigationOpen]);

  const visiblePages = searchResults ?? vaultPages;
  const closeAfter = (action: () => void) => {
    action();
    onCloseNavigation?.();
  };

  // Group pages by folder
  const unfiledPages = visiblePages.filter((p) => !p.folder);
  const pagesByFolder = new Map<string, Page[]>();
  allFolders.forEach((folder) => {
    pagesByFolder.set(folder, visiblePages.filter((p) => p.folder === folder));
  });

  type FolderNode = {
    name: string;
    path: string;
    children: Map<string, FolderNode>;
  };

  const buildFolderTree = (folders: string[]): FolderNode[] => {
    const root = new Map<string, FolderNode>();
    folders.forEach(folder => {
      const parts = folder.split('/');
      let currentLevel = root;
      let currentPath = '';
      parts.forEach(part => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!currentLevel.has(part)) {
          currentLevel.set(part, { name: part, path: currentPath, children: new Map() });
        }
        currentLevel = currentLevel.get(part)!.children;
      });
    });
    
    const sortNodes = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.sort((a, b) => a.name.localeCompare(b.name)).map(n => ({
        ...n,
        children: new Map(sortNodes(Array.from(n.children.values())).map(cn => [cn.name, cn]))
      }));
    };
    
    return sortNodes(Array.from(root.values()));
  };

  const folderTree = buildFolderTree(allFolders);

  const renderFolderNode = (node: FolderNode, level: number = 0) => {
    const folderName = node.path;
    const folderNotes = pagesByFolder.get(folderName) || [];
    const isCollapsed = collapsedFolders.has(folderName) && !searchQuery;
    const childNodes = Array.from(node.children.values());

    return (
      <div
        key={folderName}
        className="notes-sidebar__folder-group"
        style={{ paddingLeft: level > 0 ? '12px' : '0', borderLeft: level > 0 ? '1px solid var(--border-subtle)' : 'none', marginLeft: level > 0 ? '6px' : '0' }}
        data-dragover={dragOverFolder === folderName}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverFolder !== folderName) setDragOverFolder(folderName);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          if (dragOverFolder === folderName) setDragOverFolder(null);
        }}
        onDrop={(e) => handleFolderDrop(e, folderName)}
      >
        <div
          className="notes-sidebar__folder-header"
          data-dragover={dragOverFolder === folderName}
        >
          <button
            type="button"
            className="notes-sidebar__folder-toggle"
            onClick={() => toggleFolderCollapse(folderName)}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            {isCollapsed ? <Folder size={14} className="notes-sidebar__folder-icon" /> : <FolderOpen size={14} className="notes-sidebar__folder-icon" />}
            <strong className="notes-sidebar__folder-name">{node.name}</strong>
            <span className="notes-sidebar__folder-badge">{folderNotes.length}</span>
          </button>

          {canEdit && (
            <div className="notes-sidebar__folder-actions">
              <button
                type="button"
                className="notes-sidebar__folder-action-btn"
                title={`Draft agent in ${node.name}`}
                aria-label={`Draft agent in ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeAfter(() => onCreateNewPage(folderName));
                }}
              >
                <Plus size={13} />
              </button>
              {onConvertFolderToSkill && (
                <button
                  type="button"
                  className="notes-sidebar__folder-action-btn"
                  title={`Deploy folder ${node.name} to Locked Skills`}
                  aria-label={`Deploy folder ${node.name} to Locked Skills`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConvertFolderToSkill(folderName);
                  }}
                >
                  <Sparkles size={13} />
                </button>
              )}
              {onCreateHubPage && (
                <button
                  type="button"
                  className="notes-sidebar__folder-action-btn"
                  title={`Generate Hub Page for ${node.name}`}
                  aria-label={`Generate Hub Page for ${node.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateHubPage(folderName);
                  }}
                >
                  <FileText size={13} />
                </button>
              )}
              {folderNotes.length === 0 && childNodes.length === 0 && onDeleteFolder && (
                <button
                  type="button"
                  className="notes-sidebar__folder-action-btn notes-sidebar__folder-action-btn--danger"
                  title={`Delete empty folder "${node.name}"`}
                  aria-label={`Delete empty folder "${node.name}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFolder(folderName);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="notes-sidebar__folder-contents">
            {childNodes.map(child => renderFolderNode(child, level + 1))}
            {folderNotes.length === 0 && childNodes.length === 0 ? (
              <div
                className="notes-sidebar__folder-empty"
                data-dragover={dragOverFolder === folderName}
              >
                {draggingPageId ? 'Drop agent here to add to folder' : 'No agents in this folder.'}
              </div>
            ) : (
              folderNotes.map((page) => renderNoteRow(page))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        className="workspace-sidebar-backdrop"
        aria-label="Close notes navigation"
        tabIndex={isNavigationOpen ? 0 : -1}
        onClick={onCloseNavigation}
      />
      <aside
        ref={sidebarRef}
        className="workspace-sidebar notes-sidebar"
        data-open={isNavigationOpen}
        data-collapsed={isNavigationCollapsed}
        aria-label="Notes navigation"
      >
        <div className="workspace-sidebar__mobile-header">
          <strong>Agent Workbench</strong>
          <IconButton variant="quiet" label="Close navigation" icon={<X size={20} />} onClick={onCloseNavigation} />
        </div>

        <div className="notes-sidebar__controls">
          {canEdit && (
            <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
              <Button
                variant="primary"
                leadingIcon={<Plus size={15} />}
                onClick={() => closeAfter(() => onCreateNewPage())}
                style={{ flex: 1, minWidth: 0 }}
              >
                Draft Agent
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<FolderPlus size={15} />}
                onClick={() => setIsNewFolderOpen(true)}
                title="Create a new folder to organize notes"
                style={{ flex: 1, minWidth: 0 }}
              >
                New folder
              </Button>
            </div>
          )}
          <label className="notes-sidebar__search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search agents and tags</span>
            <input
              type="search"
              placeholder="Search agents, skills, tags"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="notes-sidebar__list">
          <div className="notes-sidebar__count">
            Agent Drafts <span>{visiblePages.length}</span>
            {allFolders.length > 0 && <small style={{ marginLeft: 'auto', opacity: 0.7 }}>{allFolders.length} folders</small>}
          </div>

          {visiblePages.length === 0 && allFolders.length === 0 ? (
            <EmptyState
              compact
              icon={<FileText size={20} />}
              title={searchQuery ? 'No matching agents' : 'No drafts yet'}
              description={searchQuery ? 'Try a different title or tag.' : 'Start drafting your first agent.'}
              action={canEdit && !searchQuery ? <Button size="sm" onClick={() => closeAfter(() => onCreateNewPage())}>Draft Agent</Button> : undefined}
            />
          ) : (
            <div className="notes-sidebar__tree">
              {/* Folder Sections */}
              {folderTree.map((node) => renderFolderNode(node, 0))}

              {/* Unfiled / General Notes Section */}
              {unfiledPages.length > 0 && (
                <div
                  className="notes-sidebar__folder-group"
                  data-dragover={dragOverFolder === '__unfiled__'}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverFolder !== '__unfiled__') setDragOverFolder('__unfiled__');
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (dragOverFolder === '__unfiled__') setDragOverFolder(null);
                  }}
                  onDrop={(e) => handleFolderDrop(e, undefined)}
                >
                  {allFolders.length > 0 && (
                    <div
                      className="notes-sidebar__folder-header notes-sidebar__folder-header--unfiled"
                      data-dragover={dragOverFolder === '__unfiled__'}
                    >
                      <button
                        type="button"
                        className="notes-sidebar__folder-toggle"
                        onClick={() => toggleFolderCollapse('__unfiled__')}
                        aria-expanded={!collapsedFolders.has('__unfiled__')}
                      >
                        {collapsedFolders.has('__unfiled__') ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <FileText size={14} className="notes-sidebar__folder-icon" />
                        <strong className="notes-sidebar__folder-name">Unfiled Agents</strong>
                        <span className="notes-sidebar__folder-badge">{unfiledPages.length}</span>
                      </button>
                      {canEdit && (
                        <div className="notes-sidebar__folder-actions">
                          <button
                            type="button"
                            className="notes-sidebar__folder-action-btn"
                            title="Draft unfiled agent"
                            aria-label="Draft unfiled agent"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeAfter(() => onCreateNewPage());
                            }}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {(!allFolders.length || !collapsedFolders.has('__unfiled__')) && (
                    <div className={allFolders.length > 0 ? 'notes-sidebar__folder-contents' : ''}>
                      {unfiledPages.map((page) => renderNoteRow(page))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* New Folder Creation Modal */}
      <Dialog
        open={isNewFolderOpen}
        title="Create new folder"
        description="Organize your agents by domain, project, client, or team."
        onClose={() => setIsNewFolderOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setIsNewFolderOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => handleCreateFolderSubmit()} disabled={!newFolderName.trim()}>
              Create folder
            </Button>
          </>
        )}
      >
        <form onSubmit={handleCreateFolderSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label
              htmlFor="new-folder-input"
              style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}
            >
              Folder Name
            </label>
            <input
              id="new-folder-input"
              type="text"
              autoFocus
              placeholder="e.g. Agents, Clients, Projects, Architecture"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
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
            <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Suggested presets:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {PRESET_FOLDERS.filter((f) => !allFolders.includes(f)).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNewFolderName(preset)}
                  style={{
                    padding: '3px 8px',
                    fontSize: '0.74rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    background: '#f8fafc',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );

  function renderNoteRow(page: Page) {
    const selected = page.id === activePageId;
    const isDragging = draggingPageId === page.id;
    const moveMenuItems: ActionMenuItem[] = [
      ...allFolders
        .filter((f) => f !== page.folder)
        .map((f) => ({
          id: `move-to-${f}`,
          label: `Move to ${f}`,
          icon: <Folder size={13} />,
          onSelect: () => onMoveNoteToFolder?.(page.id, f),
        })),
      ...(page.folder ? [{
        id: 'remove-from-folder',
        label: 'Remove from folder',
        icon: <FileText size={13} />,
        separatorBefore: true,
        onSelect: () => onMoveNoteToFolder?.(page.id, undefined),
      }] : []),
    ];

    return (
      <div
        key={page.id}
        className="notes-sidebar__row"
        data-selected={selected}
        data-dragging={isDragging}
        draggable={canEdit}
        onDragStart={(e) => {
          if (!canEdit) return;
          e.dataTransfer.setData('application/tkxel-page', page.id);
          e.dataTransfer.setData('text/plain', page.id);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingPageId(page.id);
        }}
        onDragEnd={() => {
          setDraggingPageId(null);
          setDragOverFolder(null);
        }}
      >
        <button
          type="button"
          className="notes-sidebar__page"
          aria-current={selected ? 'page' : undefined}
          onClick={() => closeAfter(() => onSelectPage(page))}
        >
          {canEdit && (
            <GripVertical
              size={12}
              className="notes-sidebar__drag-handle"
              aria-hidden="true"
            />
          )}
          <FileText size={15} aria-hidden="true" />
          <span>
            <strong>{page.title}</strong>
            {page.tags.length > 0 && <small>{page.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</small>}
          </span>
        </button>
        {canEdit && (
          <div className="notes-sidebar__row-actions">
            {allFolders.length > 0 && onMoveNoteToFolder && moveMenuItems.length > 0 && (
              <ActionMenu
                compact
                label="Move agent"
                items={moveMenuItems}
              />
            )}
            {onOpenConvertToSkill && (
              <IconButton
                size="sm"
                variant="quiet"
                label={`Deploy ${page.title} to Locked Skills`}
                icon={<Sparkles size={14} />}
                onClick={() => onOpenConvertToSkill(page)}
              />
            )}
            {onDeletePage && (
              <IconButton
                size="sm"
                variant="quiet"
                label={`Delete ${page.title}`}
                icon={<Trash2 size={14} />}
                onClick={() => onDeletePage(page.id)}
              />
            )}
          </div>
        )}
      </div>
    );
  }
};
