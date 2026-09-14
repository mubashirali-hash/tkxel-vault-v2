import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  ArrowUpRight,
  Bold,
  Italic,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  Eye,
  Check,
  Trash2,
  Sparkles,
  Clock,
  Heading2,
  ListTodo,
  Table as TableIcon,
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { Page, PageType, TimelineEntry, VaultRole } from '@tkxel-vault/types';
import { WikiLinkPicker } from './WikiLinkPicker.js';
import { DiffViewer } from './DiffViewer.js';
import { NotesAiDrawer } from '../../features/notes-ai/NotesAiDrawer.js';
import { ActionMenu, Button, Dialog } from '../ui/index.js';
import { NoteInspector } from './NoteInspector.js';
import { CustomCodeBlock } from './CodeBlockComponent.js';
import { SmartLinkBanner } from './SmartLinkBanner.js';
import { NotesAiClient } from '../../features/notes-ai/ai-client.js';
import { SuggestedLink } from '../../features/notes-ai/types.js';

export interface MarkdownEditorProps {
  page: Page;
  availablePages: Page[];
  timelineEntries: TimelineEntry[];
  backlinks: string[];
  allLinks?: Array<{ from_page_id: string; to_page_id: string }>;
  canEdit: boolean;
  currentRole: VaultRole;
  isOpenVault?: boolean;
  folders?: string[];
  onSave: (updated: { title: string; content: string; tags: string[]; type: PageType; aliases?: string[]; folder?: string }, isDraft?: boolean) => void;
  onDelete?: () => void;
  onOpenConvertToSkill?: () => void;
  onAddTimelineEntry: (text: string) => void;
  onNavigateToPage: (title: string) => void;
  onCreateGhostPage?: (title: string) => void;
  onCreateFolder?: (folderName: string) => void;
  onMoveNoteToFolder?: (noteId: string, folderName?: string) => void;
  onEditNoteContent?: (noteId: string | undefined, content: string, mode: 'replace' | 'append' | 'insert') => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  page,
  availablePages,
  timelineEntries,
  backlinks,
  allLinks: _allLinks = [],
  canEdit,
  currentRole,
  isOpenVault = true,
  folders = [],
  onSave,
  onDelete,
  onOpenConvertToSkill,
  onAddTimelineEntry,
  onNavigateToPage,
  onCreateGhostPage,
  onCreateFolder,
  onMoveNoteToFolder,
  onEditNoteContent,
}) => {
  const [title, setTitle] = useState(page.title);
  const [folder, setFolder] = useState<string | undefined>(page.folder);
  const initialBody =
    (page.front_matter?.body as string) ||
    `# ${page.title}\n\nStart writing notes. Use [[wiki-links]] to connect concepts across the vault.\n\n## Overview\nDocument key decisions and system notes.`;

  const [content, setContent] = useState(initialBody);
  const [tags, setTags] = useState<string[]>(page.tags);
  const [aliases, setAliases] = useState<string[]>(page.aliases || []);
  const [pageType, setPageType] = useState<PageType>(page.type);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [showDiff, setShowDiff] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectorInitialTab, setInspectorInitialTab] = useState<'properties' | 'timeline'>('properties');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingGhostTitle, setPendingGhostTitle] = useState<string | null>(null);
  const [isAiEnabled, setIsAiEnabled] = useState(() => NotesAiClient.isAiPluginEnabled());
  const [smartSuggestions, setSmartSuggestions] = useState<SuggestedLink[]>([]);
  const [isAutoLinking, setIsAutoLinking] = useState(false);

  // Synchronize with global AI plugin toggle
  useEffect(() => {
    const handleToggle = (e: any) => {
      const enabled = e?.detail?.enabled ?? NotesAiClient.isAiPluginEnabled();
      setIsAiEnabled(enabled);
      if (!enabled) {
        setSmartSuggestions([]);
        setIsAiDrawerOpen(false);
      }
    };
    window.addEventListener('tkxel-vault:ai-toggle', handleToggle);
    return () => window.removeEventListener('tkxel-vault:ai-toggle', handleToggle);
  }, []);

  // Proactively scan for link suggestions when AI plugin is active
  useEffect(() => {
    if (!isAiEnabled || !canEdit || isAutoLinking || content.trim().length < 25) {
      setSmartSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const otherPages = availablePages.filter((p) => p.id !== page.id);
        const suggestions = await NotesAiClient.suggestLinks({
          activeNoteTitle: title,
          activeNoteContent: content,
          vaultNotes: otherPages.map((p) => ({
            id: p.id,
            title: p.title,
            aliases: p.aliases,
            tags: p.tags,
            snippet: p.title,
          })),
        });
        setSmartSuggestions(suggestions);
      } catch {
        setSmartSuggestions([]);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [isAiEnabled, canEdit, isAutoLinking, content, title, page.id, availablePages]);

  const handleAcceptSmartLink = (sug: SuggestedLink) => {
    const res = NotesAiClient.localAutoApplyWikiLinks({
      content,
      availableEntities: [{ title: sug.targetTitle }],
    });
    if (res.count > 0 && editor && !editor.isDestroyed) {
      editor.commands.setContent(res.modifiedContent);
      const md = (editor.storage as any).markdown.getMarkdown();
      setContent(md);
      setIsDirty(true);
    }
    setSmartSuggestions((prev) => prev.filter((s) => s.targetTitle !== sug.targetTitle));
  };

  const handleAcceptAllSmartLinks = () => {
    if (smartSuggestions.length === 0) return;
    const res = NotesAiClient.localAutoApplyWikiLinks({
      content,
      availableEntities: smartSuggestions.map((s) => ({ title: s.targetTitle })),
    });
    if (res.count > 0 && editor && !editor.isDestroyed) {
      editor.commands.setContent(res.modifiedContent);
      const md = (editor.storage as any).markdown.getMarkdown();
      setContent(md);
      setIsDirty(true);
    }
    setSmartSuggestions([]);
  };

  const handleMagicAutoLink = async () => {
    if (!isAiEnabled) return;
    setIsAutoLinking(true);
    try {
      const otherPages = availablePages.filter((p) => p.id !== page.id);
      const res = await NotesAiClient.autoApplyWikiLinks({
        content,
        availableEntities: otherPages.map((p) => ({ id: p.id, title: p.title, aliases: p.aliases })),
      });
      if (res.count > 0 && editor && !editor.isDestroyed) {
        editor.commands.setContent(res.modifiedContent);
        const md = (editor.storage as any).markdown.getMarkdown();
        setContent(md);
        setIsDirty(true);
      }
      setSmartSuggestions([]);
    } finally {
      setIsAutoLinking(false);
    }
  };

  const handleInsertAiLink = (targetTitle: string, relationType?: string) => {
    const linkSyntax = relationType && relationType !== 'references'
      ? `[[${relationType}::${targetTitle}]]`
      : `[[${targetTitle}]]`;

    if (editor && !editor.isDestroyed) {
      editor.commands.insertContent(` ${linkSyntax} `);
      const md = (editor.storage as any).markdown.getMarkdown();
      setContent(md);
      if (editor.isFocused) setIsDirty(true);
      if (editor.isFocused) setIsDirty(true);
    } else {
      setContent((prev) => `${prev} ${linkSyntax}`);
    }
    setIsDirty(true);
  };

  const handleAddAiTag = (tagToAdd: string) => {
    if (!tags.includes(tagToAdd)) {
      setTags((prev) => [...prev, tagToAdd]);
      setIsDirty(true);
    }
  };

  const handleApplyAiCategory = (categoryToApply: string) => {
    setPageType(categoryToApply as PageType);
    setIsDirty(true);
  };

  const handleInsertAiSummary = (summaryMarkdown: string) => {
    if (editor && !editor.isDestroyed) {
      editor.commands.insertContent(summaryMarkdown);
      const md = (editor.storage as any).markdown.getMarkdown();
      setContent(md);
    } else {
      setContent((prev) => `${prev}${summaryMarkdown}`);
    }
    setIsDirty(true);
  };

  const handleAiEditNoteContent = (
    noteId: string | undefined,
    newContent: string,
    mode: 'replace' | 'append' | 'insert' = 'append'
  ) => {
    if (!noteId || noteId === page.id) {
      let updatedText = newContent;
      if (mode === 'append') {
        updatedText = content ? `${content}\n\n${newContent}` : newContent;
      } else if (mode === 'insert') {
        updatedText = content ? `${newContent}\n\n${content}` : newContent;
      }
      setContent(updatedText);
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(updatedText);
      }
      setIsDirty(true);
      onSave(
        {
          title,
          content: updatedText,
          tags,
          aliases,
          type: pageType,
          folder,
        },
        true
      );
    } else {
      onEditNoteContent?.(noteId, newContent, mode);
    }
  };

  const handleAiMoveNote = (noteId: string, targetFolder?: string) => {
    if (noteId === page.id) {
      setFolder(targetFolder);
      setIsDirty(true);
    }
    onMoveNoteToFolder?.(noteId, targetFolder);
  };

  // WikiLink picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerPosition, setPickerPosition] = useState({ left: 24, top: 180 });
  const editorRef = useRef<HTMLDivElement>(null);

  const checkAndPositionPicker = (editorInstance: any) => {
    if (!editorInstance || editorInstance.isDestroyed) return;
    const { from } = editorInstance.state.selection;
    const textBefore = editorInstance.state.doc.textBetween(Math.max(0, from - 50), from, ' ');
    const lastOpen = textBefore.lastIndexOf('[[');
    if (lastOpen !== -1 && !textBefore.slice(lastOpen).includes(']]')) {
      const query = textBefore.slice(lastOpen + 2);
      setShowPicker(true);
      setPickerQuery(query);
      try {
        const coordinates = editorInstance.view.coordsAtPos(from);
        const pickerHeight = 280;
        const fitsBelow = coordinates.bottom + pickerHeight <= window.innerHeight - 10;
        const topPos = fitsBelow
          ? coordinates.bottom + 6
          : Math.max(12, coordinates.top - pickerHeight - 6);
        setPickerPosition({
          left: Math.max(12, Math.min(coordinates.left, window.innerWidth - 360)),
          top: topPos,
        });
      } catch {
        setPickerPosition({ left: 24, top: 120 });
      }
    } else {
      setShowPicker(false);
    }
  };

  const defaultCategories = ['note', 'decision', 'meeting', 'project', 'client', 'person'];
  const allKnownCategories = Array.from(new Set(availablePages.map((p) => p.type).concat(defaultCategories)));

  // Setup TipTap Live WYSIWYG Editor with In-Place Tables and Mermaid CustomCodeBlock
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      CustomCodeBlock,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Placeholder.configure({
        placeholder: "Start writing notes in live WYSIWYG... Type '# ' for heading, '-' for list, or '[[' to link notes.",
      }),
    ],
    content: initialBody,
    editable: canEdit,
    onUpdate: ({ editor }) => {
      const md = (editor.storage as any).markdown.getMarkdown();
      setContent(md);
      checkAndPositionPicker(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      checkAndPositionPicker(editor);
    },
  });

  // Sync state if active page changes
  useEffect(() => {
    setTitle(page.title);
    setFolder(page.folder);
    const newBody =
      (page.front_matter?.body as string) ||
      `# ${page.title}\n\nStart writing notes. Use [[wiki-links]] to connect concepts across the vault.`;
    setContent(newBody);
    setTags(page.tags);
    setAliases(page.aliases || []);
    setPageType(page.type);
    setIsDirty(false);

    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(newBody);
    }
  }, [page.id, page.folder, editor]);

  // Sync canEdit with editor
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(canEdit);
    }
  }, [canEdit, editor]);

  useEffect(() => {
    const updateConnectionState = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateConnectionState);
    window.addEventListener('offline', updateConnectionState);
    return () => {
      window.removeEventListener('online', updateConnectionState);
      window.removeEventListener('offline', updateConnectionState);
    };
  }, []);

  const handleSelectWikiLink = (linkTitle: string) => {
    if (editor && !editor.isDestroyed) {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 40), from);
      const lastOpen = textBefore.lastIndexOf('[[');
      if (lastOpen !== -1) {
        const deleteCount = textBefore.length - lastOpen;
        editor
          .chain()
          .focus()
          .deleteRange({ from: from - deleteCount, to: from })
          .insertContent(`[[${linkTitle}]] `)
          .run();
      } else {
        editor.chain().focus().insertContent(`[[${linkTitle}]] `).run();
      }
    }
    const isKnown = availablePages.some(
      (candidate) => candidate.title.toLowerCase() === linkTitle.toLowerCase()
        || candidate.aliases?.some((alias) => alias.toLowerCase() === linkTitle.toLowerCase())
    );
    if (!isKnown && onCreateGhostPage) setPendingGhostTitle(linkTitle);
    setShowPicker(false);
  };

  const handleToolbarLinkClick = () => {
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().insertContent('[[').run();
      checkAndPositionPicker(editor);
    }
  };

  const handleInsertTemplate = (markdown: string) => {
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().insertContent(markdown).run();
    setContent((editor.storage as any).markdown.getMarkdown());
    setIsDirty(true);
  };

  const handleSaveDocument = (isDraft: boolean = true) => {
    const currentMd = editor && !editor.isDestroyed ? (editor.storage as any).markdown.getMarkdown() : content;
    onSave(
      {
        title,
        content: currentMd,
        tags,
        aliases,
        type: pageType,
        folder,
      },
      isDraft
    );
    setSavedFeedback(true);
    setIsDirty(false);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  return (
    <div className="markdown-editor">
      {/* Top Document Header Bar */}
      <div className="markdown-editor__header">
        <div className="markdown-editor__title-row">
          {/* Folder & Document Title Input */}
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                fontSize: '0.74rem',
                fontWeight: 650,
                color: 'var(--tk-primary, #0755e9)',
                background: '#eff6ff',
                borderRadius: '4px',
                border: '1px solid #bfdbfe',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={folder ? `Folder: ${folder}` : 'Unfiled note'}
            >
              📁 {folder || 'Unfiled'}
            </span>
            <input
              type="text"
              value={title}
              disabled={!canEdit}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
              }}
              className="markdown-editor__title"
              placeholder="Untitled Document"
              style={{ flex: 1 }}
            />
          </div>

          {/* Action Buttons */}
          <div className="markdown-editor__actions">
            <span className="markdown-editor__save-state" data-state={!isOnline ? 'offline' : savedFeedback || !isDirty ? 'saved' : 'draft'}>
              <Check size={14} /> {!isOnline ? 'Offline — changes stay here' : savedFeedback || !isDirty ? 'Draft saved' : 'Unsaved draft'}
            </span>

            {canEdit && (
              <>
                <button
                  onClick={() => handleSaveDocument(true)}
                  disabled={!isOnline}
                  className="btn btn-secondary-white"
                  style={{ padding: '4px 12px', fontSize: '0.78rem', height: '30px', border: '1px solid var(--tk-primary)', color: 'var(--tk-primary)' }}
                >
                  <Save size={14} />
                  Save Draft
                </button>
                <button disabled={!isOnline} onClick={() => handleSaveDocument(false)} className="btn btn-primary-blue" style={{ padding: '4px 14px', fontSize: '0.78rem', height: '30px' }}>
                  <Check size={14} />
                  Publish
                </button>
                {isAiEnabled && (
                  <button
                    onClick={() => {
                      setIsAiDrawerOpen((prev) => !prev);
                      setIsInspectorOpen(false);
                    }}
                    className="btn btn-secondary-white"
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.78rem',
                      height: '30px',
                      borderColor: isAiDrawerOpen ? '#0755E9' : '#BFDBFE',
                      backgroundColor: isAiDrawerOpen ? '#EFF6FF' : '#FFFFFF',
                      color: '#0755E9',
                      fontWeight: 600,
                      gap: '5px',
                    }}
                    title="Toggle AI Co-Pilot drawer to discover graph connections, auto-sort, and chat with note"
                  >
                    <Sparkles size={14} color="#0755E9" />
                    AI Co-Pilot
                  </button>
                )}
                <ActionMenu
                  label="More note actions"
                  compact
                  items={[
                    {
                      id: 'diff',
                      label: 'View changes',
                      icon: <Eye size={15} />,
                      onSelect: () => setShowDiff(true),
                    },
                    {
                      id: 'details',
                      label: 'Note details',
                      icon: <ArrowUpRight size={15} />,
                      onSelect: () => {
                        setIsAiDrawerOpen(false);
                        setInspectorInitialTab('properties');
                        setIsInspectorOpen(true);
                      },
                    },
                    ...(isOpenVault && onOpenConvertToSkill ? [{
                      id: 'protect',
                      label: 'Create protected skill',
                      icon: <Sparkles size={15} />,
                      onSelect: onOpenConvertToSkill,
                    }] : []),
                    ...(onDelete ? [{
                      id: 'delete',
                      label: 'Delete note',
                      icon: <Trash2 size={15} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => {
                        setConfirmDeleteOpen(true);
                      },
                    }] : []),
                  ]}
                />
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className="note-summary"
          aria-expanded={isInspectorOpen}
          onClick={() => {
            setIsAiDrawerOpen(false);
            setInspectorInitialTab('properties');
            setIsInspectorOpen((open) => !open);
          }}
        >
          <span>📁 {folder || 'Unfiled'}</span>
          <span>{String(pageType)}</span>
          <span>{tags.length} tags</span>
          <span>{aliases.length} aliases</span>
          <span>{backlinks.length} backlinks</span>
        </button>

      </div>

      {/* Document Body Area with Optional AI Drawer */}
      <div className="markdown-editor__workspace">
        {/* Editor Main Surface */}
        <div className="markdown-editor__main">
          {/* Formatting Toolbar: Live WYSIWYG Actions */}
          <div className="markdown-editor__toolbar">
            {/* Formatting Buttons */}
            <div className="markdown-editor__toolbar-group">
          <button
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('bold') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('bold') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Bold (**text**)"
          >
            <Bold size={13} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('italic') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('italic') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Italic (*text*)"
          >
            <Italic size={13} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('heading', { level: 1 }) ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('heading', { level: 1 }) ? 'var(--tk-primary)' : 'inherit',
              fontWeight: 800,
              fontSize: '0.75rem',
            }}
            title="Heading 1 (# Heading)"
          >
            H1
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('heading', { level: 2 }) ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('heading', { level: 2 }) ? 'var(--tk-primary)' : 'inherit',
              fontWeight: 700,
              fontSize: '0.75rem',
            }}
            title="Heading 2 (## Heading)"
          >
            H2
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('heading', { level: 3 }) ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('heading', { level: 3 }) ? 'var(--tk-primary)' : 'inherit',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
            title="Heading 3 (### Heading)"
          >
            H3
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('bulletList') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('bulletList') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Bullet List (- item)"
          >
            <List size={13} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('orderedList') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('orderedList') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Numbered List (1. item)"
          >
            <ListOrdered size={13} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('blockquote') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('blockquote') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Blockquote (> quote)"
          >
            <Quote size={13} />
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            className="btn btn-ghost"
            style={{
              padding: '4px 6px',
              backgroundColor: editor?.isActive('codeBlock') ? '#E2E8F0' : 'transparent',
              color: editor?.isActive('codeBlock') ? 'var(--tk-primary)' : 'inherit',
            }}
            title="Code block (``` code ```)"
          >
            <Code size={13} />
          </button>
          <button
            onClick={handleToolbarLinkClick}
            className="btn btn-ghost"
            style={{ padding: '4px 6px', color: 'var(--tk-primary)', fontWeight: 600, gap: '4px' }}
            title="Insert [[wiki-link]] (opens autocomplete)"
          >
            <Link size={13} />
            <span style={{ fontSize: '0.74rem' }}>[[Link]]</span>
          </button>
          {isAiEnabled && (
            <button
              onClick={handleMagicAutoLink}
              disabled={isAutoLinking}
              className="btn btn-ghost"
              style={{ padding: '4px 6px', color: '#7C3AED', fontWeight: 600, gap: '4px' }}
              title="Magic Auto-Link: Automatically discover and insert [[wiki-links]] for known concepts"
            >
              <Sparkles size={13} className={isAutoLinking ? 'animate-spin' : 'animate-pulse'} />
              <span style={{ fontSize: '0.74rem' }}>Auto-Link</span>
            </button>
          )}
          <button
            onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            className="btn btn-ghost"
            style={{ padding: '4px 6px', color: 'inherit', gap: '4px' }}
            title="Insert table"
          >
            <TableIcon size={13} />
            <span style={{ fontSize: '0.74rem' }}>Table</span>
          </button>
          <ActionMenu
            label="Insert"
            items={[
              {
                id: 'section',
                label: 'Section heading',
                icon: <Heading2 size={15} />,
                onSelect: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              },
              {
                id: 'table',
                label: 'Data table',
                icon: <TableIcon size={15} />,
                onSelect: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
              },
              {
                id: 'callout',
                label: 'Callout',
                icon: <Quote size={15} />,
                onSelect: () => handleInsertTemplate('\n> **Note:** Add important context here.\n'),
              },
              {
                id: 'tasks',
                label: 'Task checklist',
                icon: <ListTodo size={15} />,
                onSelect: () => handleInsertTemplate('\n- [ ] Add next step\n'),
              },
              {
                id: 'mermaid',
                label: 'Mermaid diagram',
                icon: <Code size={15} />,
                separatorBefore: true,
                onSelect: () =>
                  handleInsertTemplate(
                    '\n```mermaid\nflowchart TD\n  A[Start] --> B[Process]\n  B --> C[End]\n```\n'
                  ),
              },
              {
                id: 'timeline',
                label: 'Timeline entry',
                icon: <Clock size={15} />,
                separatorBefore: true,
                onSelect: () => {
                  setIsAiDrawerOpen(false);
                  setInspectorInitialTab('timeline');
                  setIsInspectorOpen(true);
                },
              },
            ]}
          />
        </div>
      </div>

      {/* Editor Body: Unified Live Surface (Scrollbar on Right Edge, Content Centered) */}
      <div
        ref={editorRef}
        className="markdown-editor__scroll"
      >
        <div className="markdown-editor__page">
          {/* Smart Link Suggestion Banner */}
          {isAiEnabled && (
            <SmartLinkBanner
              suggestions={smartSuggestions}
              onAccept={handleAcceptSmartLink}
              onAcceptAll={handleAcceptAllSmartLinks}
              onDismiss={() => setSmartSuggestions([])}
              isProcessing={isAutoLinking}
            />
          )}

          {/* Floating WikiLink Autocomplete Popover */}
          {showPicker && (
            <div className="wiki-link-picker-anchor" style={{ left: pickerPosition.left, top: pickerPosition.top }}>
              <WikiLinkPicker
                availablePages={availablePages}
                query={pickerQuery}
                onSelectLink={handleSelectWikiLink}
                onClose={() => setShowPicker(false)}
              />
            </div>
          )}

          <div style={{ minHeight: '350px' }}>
            <EditorContent editor={editor} />
          </div>

        </div>
      </div>
    </div>

        {isInspectorOpen && (
          <NoteInspector
            page={page}
            pages={availablePages}
            links={_allLinks}
            backlinks={backlinks}
            folder={folder}
            folders={folders}
            onChangeFolder={(newFolder) => {
              setFolder(newFolder);
              setIsDirty(true);
            }}
            timelineEntries={timelineEntries}
            canEdit={canEdit}
            pageType={pageType}
            categories={allKnownCategories}
            aliases={aliases}
            tags={tags}
            onChangePageType={(value) => { setPageType(value); setIsDirty(true); }}
            onChangeAliases={(value) => { setAliases(value); setIsDirty(true); }}
            onChangeTags={(value) => { setTags(value); setIsDirty(true); }}
            onNavigateToPage={onNavigateToPage}
            onAddTimelineEntry={onAddTimelineEntry}
            onClose={() => setIsInspectorOpen(false)}
            initialTab={inspectorInitialTab}
          />
        )}

        {/* AI Co-Pilot Drawer */}
        {isAiEnabled && isAiDrawerOpen && (
          <NotesAiDrawer
            isOpen={isAiDrawerOpen}
            onClose={() => setIsAiDrawerOpen(false)}
            activeNoteId={page.id}
            activeNoteTitle={title}
            activeNoteContent={content}
            vaultNotes={availablePages.map((p) => ({
              id: p.id,
              title: p.title,
              folder: p.folder,
              tags: p.tags,
              aliases: p.aliases,
              type: p.type,
              content: (p.front_matter?.body as string) || '',
            }))}
            folders={folders}
            onInsertLink={handleInsertAiLink}
            onAddTag={handleAddAiTag}
            onApplyCategory={handleApplyAiCategory}
            onInsertSummary={handleInsertAiSummary}
            onCreateFolder={onCreateFolder}
            onMoveNoteToFolder={handleAiMoveNote}
            onEditNoteContent={handleAiEditNoteContent}
          />
        )}
      </div>

      {/* Version Diff Viewer Modal */}
      {showDiff && (
        <DiffViewer
          pageId={page.id}
          vaultId={page.vault_id}
          currentRole={currentRole}
          onClose={() => setShowDiff(false)}
          onRollback={(publishedContent) => {
            setContent(publishedContent);
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(publishedContent);
            }
            setIsDirty(true);
            setShowDiff(false);
          }}
        />
      )}

      <Dialog
        open={confirmDeleteOpen}
        title="Delete this note?"
        description="This removes the note and its graph links. This action cannot be undone."
        onClose={() => setConfirmDeleteOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDeleteOpen(false);
                onDelete?.();
              }}
            >
              Delete note
            </Button>
          </>
        )}
      >
        <p><strong>{title || 'Untitled note'}</strong> will no longer be available in this vault.</p>
      </Dialog>

      <Dialog
        open={Boolean(pendingGhostTitle)}
        title="Create linked note?"
        description="This link points to a note that does not exist yet."
        onClose={() => setPendingGhostTitle(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPendingGhostTitle(null)}>Keep as uncreated link</Button>
            <Button
              onClick={() => {
                if (!pendingGhostTitle) return;
                const ghostTitle = pendingGhostTitle;
                handleSaveDocument(true);
                setPendingGhostTitle(null);
                onCreateGhostPage?.(ghostTitle);
              }}
            >
              Create note
            </Button>
          </>
        )}
      >
        <p>Create <strong>{pendingGhostTitle}</strong> and keep this note connected to it.</p>
      </Dialog>
    </div>
  );
};
