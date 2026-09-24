import React, { useState } from 'react';
import { ArrowUpRight, Clock, Network, SlidersHorizontal, X } from 'lucide-react';
import { Page, PageType, TimelineEntry } from '@tkxel-vault/types';
import { IconButton } from '../ui/index.js';
import { LocalGraphView } from '../graph/LocalGraphView.js';
import { TimelineView } from './TimelineView.js';

type InspectorTab = 'properties' | 'links' | 'graph' | 'timeline';

export interface NoteInspectorProps {
  page: Page;
  pages: Page[];
  links: Array<{ from_page_id: string; to_page_id: string }>;
  backlinks: string[];
  folder?: string;
  folders?: string[];
  onChangeFolder?: (folder: string | undefined) => void;
  timelineEntries: TimelineEntry[];
  canEdit: boolean;
  pageType: PageType;
  categories: string[];
  aliases: string[];
  tags: string[];
  onChangePageType: (type: PageType) => void;
  onChangeAliases: (aliases: string[]) => void;
  onChangeTags: (tags: string[]) => void;
  onNavigateToPage: (title: string) => void;
  onAddTimelineEntry: (text: string) => void;
  onClose: () => void;
  initialTab?: InspectorTab;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: React.ReactNode }> = [
  { id: 'properties', label: 'Properties', icon: <SlidersHorizontal size={15} /> },
  { id: 'links', label: 'Links', icon: <ArrowUpRight size={15} /> },
  { id: 'graph', label: 'Local graph', icon: <Network size={15} /> },
  { id: 'timeline', label: 'Timeline', icon: <Clock size={15} /> },
];

export const NoteInspector: React.FC<NoteInspectorProps> = ({
  page, pages, links, backlinks, timelineEntries, canEdit, pageType, categories, aliases, tags,
  folder, folders = [], onChangeFolder,
  onChangePageType, onChangeAliases, onChangeTags, onNavigateToPage, onAddTimelineEntry, onClose,
  initialTab = 'properties',
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderNameInput, setNewFolderNameInput] = useState('');
  const [aliasesInput, setAliasesInput] = useState(() => aliases.join(', '));
  const [tagsInput, setTagsInput] = useState(() => tags.join(', '));

  React.useEffect(() => {
    setAliasesInput(aliases.join(', '));
  }, [page.id]);

  React.useEffect(() => {
    setTagsInput(tags.join(', '));
  }, [page.id]);

  const outgoing = links
    .filter((link) => link.from_page_id === page.id)
    .map((link) => pages.find((candidate) => candidate.id === link.to_page_id))
    .filter((candidate): candidate is Page => Boolean(candidate));

  const handleCreateFolder = () => {
    const trimmed = newFolderNameInput.trim();
    if (trimmed) {
      onChangeFolder?.(trimmed);
      setNewFolderNameInput('');
      setIsCreatingFolder(false);
    }
  };

  return (
    <aside className="note-inspector" aria-label="Note details">
      <div className="note-inspector__header">
        <div><strong>Note details</strong><span>Organize and connect this note</span></div>
        <IconButton variant="quiet" label="Close note details" icon={<X size={18} />} onClick={onClose} />
      </div>
      <div className="note-inspector__tabs" role="tablist" aria-label="Note detail sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}<span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="note-inspector__body" role="tabpanel">
        {activeTab === 'properties' && (
          <div className="note-properties">
            <label>Folder
              {!isCreatingFolder ? (
                <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                  <select
                    value={folder || ''}
                    disabled={!canEdit}
                    style={{ flex: 1 }}
                    onChange={(event) => onChangeFolder?.(event.target.value || undefined)}
                  >
                    <option value="">(None / Unfiled)</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingFolder(true)}
                      className="btn btn-secondary-white"
                      style={{ padding: '3px 8px', fontSize: '0.74rem', height: '34px', whiteSpace: 'nowrap' }}
                      title="Create a new folder"
                    >
                      + New
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                  <input
                    type="text"
                    autoFocus
                    placeholder="New folder name..."
                    value={newFolderNameInput}
                    onChange={(e) => setNewFolderNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder();
                      if (e.key === 'Escape') setIsCreatingFolder(false);
                    }}
                    style={{ flex: 1, padding: '4px 8px', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    className="btn btn-primary-blue"
                    style={{ padding: '3px 8px', fontSize: '0.74rem', height: '34px' }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingFolder(false)}
                    className="btn btn-secondary-white"
                    style={{ padding: '3px 8px', fontSize: '0.74rem', height: '34px' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </label>
            <label>Category
              <select value={pageType} disabled={!canEdit} onChange={(event) => onChangePageType(event.target.value as PageType)}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>Aliases
              <input
                value={aliasesInput}
                disabled={!canEdit}
                placeholder="Alternative names, separated by commas"
                onChange={(event) => {
                  setAliasesInput(event.target.value);
                  onChangeAliases(event.target.value.split(',').map((value) => value.trim()).filter(Boolean));
                }}
                onBlur={() => {
                  setAliasesInput(aliases.join(', '));
                }}
              />
            </label>
            <label>Tags
              <input
                value={tagsInput}
                disabled={!canEdit}
                placeholder="Tags, separated by commas"
                onChange={(event) => {
                  setTagsInput(event.target.value);
                  onChangeTags(event.target.value.split(',').map((value) => value.trim().replace(/^#/, '')).filter(Boolean));
                }}
                onBlur={() => {
                  setTagsInput(tags.join(', '));
                }}
              />
            </label>
          </div>
        )}

        {activeTab === 'links' && (
          <div className="note-links">
            <section>
              <h3>Links to this note <span>{backlinks.length}</span></h3>
              {backlinks.length > 0
                ? backlinks.map((title) => <button type="button" key={title} onClick={() => onNavigateToPage(title)}><ArrowUpRight size={14} />{title}</button>)
                : <p>No notes link here yet.</p>}
            </section>
            <section>
              <h3>Links from this note <span>{outgoing.length}</span></h3>
              {outgoing.length > 0
                ? outgoing.map((target) => <button type="button" key={target.id} onClick={() => onNavigateToPage(target.title)}><ArrowUpRight size={14} />{target.title}</button>)
                : <p>Add a [[wiki-link]] to connect another note.</p>}
            </section>
          </div>
        )}

        {activeTab === 'graph' && (
          <LocalGraphView
            focalPage={page}
            allPages={pages}
            allLinks={links}
            onSelectPage={(id) => {
              const target = pages.find((candidate) => candidate.id === id);
              if (target) onNavigateToPage(target.title);
            }}
          />
        )}

        {activeTab === 'timeline' && (
          <TimelineView entries={timelineEntries} onAddEntry={onAddTimelineEntry} canEdit={canEdit} />
        )}
      </div>
    </aside>
  );
};
