import { getEditorMarkdown } from '../../utils/editor-markdown.js';
import { extractCustomFields } from '../../utils/front-matter-fields.js';
import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  ArrowUpRight,
  ArrowRight,
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
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { Page, PageType, TimelineEntry, VaultRole } from '@tkxel-vault/types';
import { WikiLinkPicker, formatLinkTarget } from './WikiLinkPicker.js';
import { DiffViewer } from './DiffViewer.js';
import { NotesAiDrawer } from '../../features/notes-ai/NotesAiDrawer.js';
import { ActionMenu, Button, Dialog, IconButton } from '../ui/index.js';
import { NoteInspector } from './NoteInspector.js';
import { CustomCodeBlock } from './CodeBlockComponent.js';
import { VaultImage, uploadVaultImage, ACCEPTED_IMAGE_TYPES } from './VaultImage.js';
import { UnresolvedLinks, unresolvedLinksKey } from './UnresolvedLinks.js';
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
  onSave: (updated: { title: string; content: string; tags: string[]; type: PageType; aliases?: string[]; folder?: string; frontMatter?: Record<string, unknown> }, isDraft?: boolean) => Promise<boolean | void> | void;
  onDelete?: () => void;
  onOpenConvertToSkill?: () => void;
  onOpenMoveToVault?: () => void;
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
  onOpenMoveToVault,
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
    page.content ||
    `# ${page.title}\n\nStart writing notes. Use [[wiki-links]] to connect concepts across the vault.\n\n## Overview\nDocument key decisions and system notes.`;

  const [content, setContent] = useState(initialBody);
  const [tags, setTags] = useState<string[]>(page.tags);
  const [aliases, setAliases] = useState<string[]>(page.aliases || []);
  const [pageType, setPageType] = useState<PageType>(page.type);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(() => extractCustomFields(page.front_matter));
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const insertImageFileRef = useRef<(file: File) => Promise<void>>(async () => {});
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

  // Autosave state and tracking
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('tkxel_vault_autosave_enabled');
      return stored !== null ? stored !== 'false' : true;
    } catch {
      return true;
    }
  });
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState(false);

  const prevPageIdRef = useRef(page.id);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDirtyRef = useRef(false);
  const activePageIdRef = useRef(page.id);
  const isSavingRef = useRef(false);
  // Markdown of the note as loaded or last saved. An editor update that still produces exactly this
  // Markdown is not an edit (TipTap normalises the document on the first transaction after loading).
  const baselineMarkdownRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<{ isDraft: boolean; isAuto: boolean } | null>(null);

  isDirtyRef.current = isDirty;
  activePageIdRef.current = page.id;

  const latestDocRef = useRef({
    title,
    content,
    tags,
    aliases,
    type: pageType,
    folder,
    frontMatter: customFields,
  });
  latestDocRef.current = {
    title,
    content,
    tags,
    aliases,
    type: pageType,
    folder,
    frontMatter: customFields,
  };

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
      const md = getEditorMarkdown(editor);
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
      const md = getEditorMarkdown(editor);
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
        const md = getEditorMarkdown(editor);
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
      const md = getEditorMarkdown(editor);
      setContent(md);
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
      const md = getEditorMarkdown(editor);
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

  insertImageFileRef.current = async (file: File) => {
    if (!canEdit || !editor || editor.isDestroyed) return;
    setImageError(null);
    try {
      const src = await uploadVaultImage(page.vault_id, file);
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, '') }).run();
    } catch (err: any) {
      setImageError(err?.message || 'The image could not be saved.');
    }
  };

  const defaultCategories = ['note', 'person', 'client', 'project', 'decision', 'meeting', 'skill', 'other'];
  const allKnownCategories = Array.from(new Set(availablePages.map((p) => p.type).concat(defaultCategories)));

  // Titles and aliases that a [[wiki-link]] can resolve to, kept in a ref so the editor reads the current list
  const knownLinkTargetsRef = useRef<Set<string>>(new Set());
  knownLinkTargetsRef.current = new Set(
    availablePages.flatMap((p) => [p.title, ...(p.aliases || [])]).map((value) => value.toLowerCase())
  );
  const knownLinkTargetsSignature = Array.from(knownLinkTargetsRef.current).sort().join('\n');

  // Setup TipTap Live WYSIWYG Editor with In-Place Tables and Mermaid CustomCodeBlock
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      CustomCodeBlock,
      VaultImage.configure({ inline: false, allowBase64: false }),
      UnresolvedLinks.configure({ isResolved: (linkTitle) => knownLinkTargetsRef.current.has(linkTitle.toLowerCase()) }),
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
    editorProps: {
      attributes: {
        'aria-label': 'Document Markdown Editor',
        role: 'textbox',
      },
      // Pasted or dropped image files are stored in the vault and inserted by reference (FR-02)
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files || []).find((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
        if (!file) return false;
        event.preventDefault();
        void insertImageFileRef.current(file);
        return true;
      },
      handleDrop: (_view, event) => {
        const file = Array.from((event as DragEvent).dataTransfer?.files || []).find((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
        if (!file) return false;
        event.preventDefault();
        void insertImageFileRef.current(file);
        return true;
      },
    },
    onCreate: ({ editor }) => {
      baselineMarkdownRef.current = getEditorMarkdown(editor);
    },
    onUpdate: ({ editor }) => {
      const md = getEditorMarkdown(editor);
      setContent(md);
      if (md !== baselineMarkdownRef.current || isDirtyRef.current) setIsDirty(true);
      checkAndPositionPicker(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      checkAndPositionPicker(editor);
    },
  });

  // Re-check which links are unresolved when pages are created, renamed or removed. The transaction
  // carries no document change, so it does not mark the note as edited.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(unresolvedLinksKey, true).setMeta('preventUpdate', true));
    }
  }, [knownLinkTargetsSignature, editor]);

  // Sync state if active page changes
  useEffect(() => {
    const isDifferentNote = prevPageIdRef.current !== page.id;
    if (isDifferentNote) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      prevPageIdRef.current = page.id;

      setTitle(page.title);
      setFolder(page.folder);
      const newBody =
        page.content ||
        `# ${page.title}\n\nStart writing notes. Use [[wiki-links]] to connect concepts across the vault.`;
      setContent(newBody);
      setTags(page.tags);
      setAliases(page.aliases || []);
      setPageType(page.type);
      setCustomFields(extractCustomFields(page.front_matter));
      setIsDirty(false);
      isDirtyRef.current = false;
      setIsAutoSaving(false);
      setLastSavedAt(null);
      setSyncError(false);

      // Only update editor content if switching to a different note (prevents cursor jump during autosave)
      if (editor && !editor.isDestroyed) {
        queueMicrotask(() => {
          if (editor && !editor.isDestroyed) {
            editor.commands.setContent(newBody, { emitUpdate: false });
            baselineMarkdownRef.current = getEditorMarkdown(editor);
          }
        });
      }
    }
  }, [page.id, editor]);

  // Sync canEdit with editor
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      queueMicrotask(() => {
        if (editor && !editor.isDestroyed) {
          // Without the second argument TipTap reports an update, which marked every opened note
          // as edited and autosaved an unchanged draft
          editor.setEditable(canEdit, false);
        }
      });
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

  const handleSelectWikiLink = (linkTitle: string, relation?: string) => {
    // A plain link is [[Title]]; a typed link is [[relation::Title]] (FR-15)
    const linkText = relation ? `[[${formatLinkTarget(linkTitle, relation)}]]` : `[[${linkTitle}]]`;
    if (editor && !editor.isDestroyed) {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 50), from, ' ');
      const lastOpen = textBefore.lastIndexOf('[[');
      if (lastOpen !== -1) {
        const deleteCount = textBefore.length - lastOpen;
        editor
          .chain()
          .focus()
          .deleteRange({ from: from - deleteCount, to: from })
          .insertContent(`${linkText} `)
          .run();
      } else {
        editor.chain().focus().insertContent(`${linkText} `).run();
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
    setContent(getEditorMarkdown(editor));
    setIsDirty(true);
  };

  const handleSaveDocument = async (isDraft: boolean = true, isAuto: boolean = false) => {
    if (!canEdit) return;
    if (isSavingRef.current) {
      pendingSaveRef.current = { isDraft, isAuto };
      return;
    }
    isSavingRef.current = true;
    const currentMd = editor && !editor.isDestroyed ? getEditorMarkdown(editor) : latestDocRef.current.content;
    const dataToSave = {
      ...latestDocRef.current,
      content: currentMd,
    };
    if (isAuto) {
      setIsAutoSaving(true);
    }
    let saveSuccess = false;
    try {
      const result = await onSave(dataToSave, isDraft);
      if (result === false) {
        setSyncError(true);
        saveSuccess = false;
      } else {
        setSyncError(false);
        setLastSavedAt(new Date());
        saveSuccess = true;
        baselineMarkdownRef.current = currentMd;
      }
    } catch {
      setSyncError(true);
      saveSuccess = false;
    } finally {
      isSavingRef.current = false;
      if (isAuto) {
        setIsAutoSaving(false);
      }
      if (saveSuccess) {
        setIsDirty(false);
        isDirtyRef.current = false;
        setSavedFeedback(true);
        setTimeout(() => {
          setSavedFeedback(false);
        }, 1500);
      }
      if (pendingSaveRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        queueMicrotask(() => {
          handleSaveDocument(pending.isDraft, pending.isAuto);
        });
      }
    }
  };

  // Debounced Autosave (1500ms after last edit)
  useEffect(() => {
    if (!isDirty || !autoSaveEnabled || !canEdit || !isOnline) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      if (isDirtyRef.current && activePageIdRef.current === page.id) {
        handleSaveDocument(true, true);
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [isDirty, autoSaveEnabled, canEdit, isOnline, title, content, tags, aliases, pageType, folder, page.id]);

  // Keyboard shortcut: Ctrl+S / Cmd+S to save immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (canEdit && isOnline) {
          handleSaveDocument(true, false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, isOnline]);

  return (
    <div className="markdown-editor">
      {/* Top Document Header Bar */}
      <div className="markdown-editor__header">
        <div className="markdown-editor__title-row">
          {/* Folder & Document Title Input */}
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: '8px' }}>
            <input
              id="markdown-note-title"
              name="markdown-note-title"
              aria-label="Document Title"
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
            {/* Save status and the autosave switch are one control */}
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                const next = !autoSaveEnabled;
                setAutoSaveEnabled(next);
                try {
                  localStorage.setItem('tkxel_vault_autosave_enabled', String(next));
                } catch {}
              }}
              className="markdown-editor__save-state"
              data-state={
                syncError
                  ? 'error'
                  : !isOnline
                  ? 'offline'
                  : isAutoSaving
                  ? 'saving'
                  : savedFeedback || !isDirty
                  ? 'saved'
                  : 'draft'
              }
              title={
                syncError
                  ? 'Save failed — server error or offline'
                  : `${lastSavedAt ? `Last saved at ${lastSavedAt.toLocaleTimeString()} · ` : ''}${autoSaveEnabled ? 'Autosave is on — click to turn it off' : 'Autosave is off — click to turn it on'}`
              }
            >
              {isAutoSaving ? (
                <>
                  <Clock size={14} className="spin-animate" /> Saving...
                </>
              ) : syncError ? (
                <>
                  <AlertTriangle size={14} /> Save failed
                </>
              ) : (
                <>
                  <Check size={14} /> {!isOnline ? 'Offline — changes stay here' : savedFeedback || !isDirty ? (lastSavedAt ? `Draft saved (${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : 'Draft saved') : 'Unsaved draft'}
                </>
              )}
              {canEdit && <span className="markdown-editor__autosave" data-on={autoSaveEnabled}>{autoSaveEnabled ? 'Autosave on' : 'Autosave off'}</span>}
            </button>

            {canEdit && (
              <>
                {(!autoSaveEnabled || syncError) && (
                  <button
                    onClick={() => handleSaveDocument(true, false)}
                    disabled={!isOnline}
                    className="btn btn-secondary-white"
                    style={{ padding: '4px 12px', fontSize: '0.78rem', height: '30px', border: '1px solid var(--tk-primary)', color: 'var(--tk-primary)' }}
                  >
                    <Save size={14} />
                    Save Draft
                  </button>
                )}
                {currentRole === 'owner' && (
                  <button disabled={!isOnline} onClick={() => handleSaveDocument(false, false)} className="btn btn-primary-blue" style={{ padding: '4px 14px', fontSize: '0.78rem', height: '30px' }}>
                    <Check size={14} />
                    Publish
                  </button>
                )}
                {isAiEnabled && (
                  <IconButton
                    label="AI Co-Pilot"
                    icon={<Sparkles size={16} color="#0755E9" />}
                    aria-pressed={isAiDrawerOpen}
                    onClick={() => {
                      setIsAiDrawerOpen((prev) => !prev);
                      setIsInspectorOpen(false);
                    }}
                  />
                )}
                <ActionMenu
                  label="More note actions"
                  compact
                  items={[
                    ...(autoSaveEnabled && !syncError ? [{
                      id: 'save-now',
                      label: 'Save draft now (Ctrl+S)',
                      icon: <Save size={15} />,
                      onSelect: () => { void handleSaveDocument(true, false); },
                    }] : []),
                    {
                      id: 'autosave',
                      label: autoSaveEnabled ? 'Disable Autosave' : 'Enable Autosave',
                      icon: <Clock size={15} />,
                      onSelect: () => {
                        const next = !autoSaveEnabled;
                        setAutoSaveEnabled(next);
                        try {
                          localStorage.setItem('tkxel_vault_autosave_enabled', String(next));
                        } catch {}
                      },
                    },
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
                    ...(onOpenMoveToVault ? [{
                      id: 'move-to-vault',
                      label: 'Move to another vault...',
                      icon: <ArrowRight size={15} />,
                      onSelect: onOpenMoveToVault,
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
          {canEdit && (
            <>
              <input
                ref={imageInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                aria-label="Choose an image to insert"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void insertImageFileRef.current(file);
                }}
              />
              {imageError && (
                <span role="alert" style={{ fontSize: '0.74rem', color: '#B91C1C' }}>{imageError}</span>
              )}
            </>
          )}
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
              ...(canEdit ? [{
                id: 'image',
                label: 'Image',
                icon: <ImageIcon size={15} />,
                onSelect: () => imageInputRef.current?.click(),
              }] : []),
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
              ...(isAiEnabled ? [{
                id: 'auto-link',
                label: isAutoLinking ? 'Auto-linking…' : 'Auto-link known notes',
                icon: <Sparkles size={15} />,
                onSelect: () => { if (!isAutoLinking) void handleMagicAutoLink(); },
              }] : []),
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
            customFields={customFields}
            currentContent={content}
            canPublish={currentRole === 'owner'}
            onChangeCustomFields={(value) => { setCustomFields(value); setIsDirty(true); }}
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
              content: p.content || '',
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
