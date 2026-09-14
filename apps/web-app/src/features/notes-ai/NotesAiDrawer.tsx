import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Link2,
  MessageSquare,
  Wand2,
  Check,
  Plus,
  ShieldCheck,
  Layers,
  FolderPlus,
  FolderInput,
  FileEdit,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { NotesAiClient } from './ai-client.js';
import {
  SuggestedLink,
  AiCategorySuggestion,
  AiChatMessage,
  VaultNoteFull,
  AiAction,
} from './types.js';

export interface NotesAiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeNoteId?: string;
  activeNoteTitle: string;
  activeNoteContent: string;
  vaultNotes: VaultNoteFull[];
  folders?: string[];
  onInsertLink: (targetTitle: string, relationType?: string) => void;
  onAddTag: (tag: string) => void;
  onApplyCategory?: (category: string) => void;
  onInsertSummary?: (summaryMarkdown: string) => void;
  onCreateFolder?: (folderName: string) => void;
  onMoveNoteToFolder?: (noteId: string, folderName?: string) => void;
  onEditNoteContent?: (noteId: string | undefined, content: string, mode: 'replace' | 'append' | 'insert') => void;
}

export const NotesAiDrawer: React.FC<NotesAiDrawerProps> = ({
  isOpen,
  onClose,
  activeNoteId,
  activeNoteTitle,
  activeNoteContent,
  vaultNotes,
  folders = [],
  onInsertLink,
  onAddTag,
  onApplyCategory,
  onInsertSummary,
  onCreateFolder,
  onMoveNoteToFolder,
  onEditNoteContent,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [activeTab, setActiveTab] = useState<'connect' | 'ask' | 'transform'>('connect');
  const [providerName, setProviderName] = useState<string>('Local Heuristic AI');
  
  // Tab 1: Connect & Sorter state
  const [suggestedLinks, setSuggestedLinks] = useState<SuggestedLink[]>([]);
  const [categorySuggestion, setCategorySuggestion] = useState<AiCategorySuggestion | null>(null);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [linkedTitles, setLinkedTitles] = useState<Set<string>>(new Set());
  const [appliedTags, setAppliedTags] = useState<Set<string>>(new Set());

  // Tab 2: Ask Note state
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `Hello! I'm your AI Co-Pilot for [[${activeNoteTitle}]]. You can ask me to summarize this note, identify dependencies, or find missing context.`,
      timestamp: new Date(),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  // Tab 3: Transform state
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformSuccess, setTransformSuccess] = useState<string | null>(null);

  useEffect(() => {
    NotesAiClient.getStatus().then((res) => {
      setProviderName(res.provider);
    });
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const lastNoteIdRef = useRef<string | undefined>(undefined);

  // Reset suggestions and chat ONLY when switching to a different note ID
  useEffect(() => {
    const noteKey = activeNoteId || activeNoteTitle;
    if (lastNoteIdRef.current === noteKey) {
      return;
    }
    lastNoteIdRef.current = noteKey;

    setSuggestedLinks([]);
    setCategorySuggestion(null);
    setLinkedTitles(new Set());
    setAppliedTags(new Set());
    setChatMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: `Hello! I'm your AI Co-Pilot for [[${activeNoteTitle}]]. You can ask me to summarize this note, identify dependencies, or find missing context.`,
        timestamp: new Date(),
      },
    ]);
  }, [activeNoteId, activeNoteTitle]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawer || !window.matchMedia('(max-width: 899px)').matches) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'),
      );
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
    document.addEventListener('keydown', handleKeyboard);
    requestAnimationFrame(() => drawer?.querySelector<HTMLElement>('button')?.focus());
    return () => {
      document.removeEventListener('keydown', handleKeyboard);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAnalyzeAndConnect = async () => {
    setIsLoadingLinks(true);
    try {
      const [links, cat] = await Promise.all([
        NotesAiClient.suggestLinks({
          activeNoteTitle,
          activeNoteContent,
          vaultNotes,
        }),
        NotesAiClient.sortAndCategorize({
          title: activeNoteTitle,
          content: activeNoteContent,
        }),
      ]);
      setSuggestedLinks(links);
      setCategorySuggestion(cat);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingLinks(false);
    }
  };

  const handleConnectNote = (link: SuggestedLink) => {
    onInsertLink(link.targetTitle, link.relationType);
    setLinkedTitles((prev) => new Set([...prev, link.targetTitle]));
  };

  const handleApplyTag = (tag: string) => {
    onAddTag(tag);
    setAppliedTags((prev) => new Set([...prev, tag]));
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isAsking) return;

    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: query,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsAsking(true);

    try {
      const res = await NotesAiClient.ask({
        question: query,
        activeNoteTitle,
        activeNoteContent,
        vaultNotes,
        folders,
      });

      const assistantMsg: AiChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: res.answer,
        citations: res.citations,
        actions: res.actions,
        actionStatuses: {},
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: AiChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: 'Sorry, I encountered an issue analyzing this note.',
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleExecuteAction = (msgId: string, actionIndex: number, action: AiAction) => {
    if (action.type === 'create_folder') {
      onCreateFolder?.(action.folderName);
    } else if (action.type === 'move_note') {
      onMoveNoteToFolder?.(action.noteId, action.targetFolder);
    } else if (action.type === 'edit_note') {
      onEditNoteContent?.(action.noteId, action.content, action.mode || 'append');
    }

    setChatMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== msgId) return msg;
        return {
          ...msg,
          actionStatuses: {
            ...(msg.actionStatuses || {}),
            [actionIndex]: 'applied',
          },
        };
      })
    );
  };

  const handleApplyAllActions = (msgId: string, actions: AiAction[]) => {
    const statusesToUpdate: Record<number, 'applied'> = {};
    actions.forEach((action, idx) => {
      if (action.type === 'create_folder') {
        onCreateFolder?.(action.folderName);
      } else if (action.type === 'move_note') {
        onMoveNoteToFolder?.(action.noteId, action.targetFolder);
      } else if (action.type === 'edit_note') {
        onEditNoteContent?.(action.noteId, action.content, action.mode || 'append');
      }
      statusesToUpdate[idx] = 'applied';
    });

    setChatMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== msgId) return msg;
        return {
          ...msg,
          actionStatuses: {
            ...(msg.actionStatuses || {}),
            ...statusesToUpdate,
          },
        };
      })
    );
  };

  const handleGenerateSummary = async () => {
    setIsTransforming(true);
    try {
      const res = await NotesAiClient.ask({
        question: 'Generate a structured 3-bullet executive summary of this note.',
        activeNoteTitle,
        activeNoteContent,
      });
      if (onInsertSummary) {
        onInsertSummary(`\n\n> [!NOTE]\n> **Executive Summary:**\n> ${res.answer.replace(/\n/g, '\n> ')}\n`);
        setTransformSuccess('Executive Summary appended to note!');
        setTimeout(() => setTransformSuccess(null), 4000);
      }
    } finally {
      setIsTransforming(false);
    }
  };

  return (
    <div
      ref={drawerRef}
      className="notes-ai-inspector"
      role="dialog"
      aria-modal="true"
      aria-label={`AI Co-Pilot for ${activeNoteTitle}`}
      style={{
        width: 'var(--inspector-width)',
        flexShrink: 0,
        height: '100%',
        backgroundColor: '#FFFFFF',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.04)',
        zIndex: 40,
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#F8FAFC',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              backgroundColor: '#EFF6FF',
              color: '#0755E9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              AI Co-Pilot
            </div>
            <div style={{ 
              fontSize: '0.68rem', 
              color: providerName.includes('Gemini') || providerName.includes('Anthropic') || providerName.includes('OpenAI') ? '#16A34A' : '#64748B', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px',
              fontWeight: 600
            }}>
              <span style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                backgroundColor: providerName.includes('Gemini') || providerName.includes('Anthropic') || providerName.includes('OpenAI') ? '#16A34A' : '#94A3B8' 
              }}></span>
              {providerName.includes('Gemini') 
                ? 'Google Gemini (gemini-3.6-flash)' 
                : providerName.includes('Anthropic') 
                ? 'Claude 3.5 Sonnet' 
                : providerName.includes('OpenAI') 
                ? 'OpenAI' 
                : 'Local Heuristic Engine'}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: 'var(--text-muted)',
            borderRadius: '4px',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Tab Switcher */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: '#F8FAFC',
          padding: '4px',
          gap: '4px',
        }}
      >
        <button
          onClick={() => setActiveTab('connect')}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: '0.78rem',
            fontWeight: activeTab === 'connect' ? 700 : 500,
            color: activeTab === 'connect' ? '#0755E9' : 'var(--text-secondary)',
            backgroundColor: activeTab === 'connect' ? '#FFFFFF' : 'transparent',
            border: activeTab === 'connect' ? '1px solid var(--border-subtle)' : 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
          }}
        >
          <Link2 size={13} />
          <span>Connect</span>
        </button>
        <button
          onClick={() => setActiveTab('ask')}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: '0.78rem',
            fontWeight: activeTab === 'ask' ? 700 : 500,
            color: activeTab === 'ask' ? '#0755E9' : 'var(--text-secondary)',
            backgroundColor: activeTab === 'ask' ? '#FFFFFF' : 'transparent',
            border: activeTab === 'ask' ? '1px solid var(--border-subtle)' : 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
          }}
        >
          <MessageSquare size={13} />
          <span>Ask</span>
        </button>
        <button
          onClick={() => setActiveTab('transform')}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: '0.78rem',
            fontWeight: activeTab === 'transform' ? 700 : 500,
            color: activeTab === 'transform' ? '#0755E9' : 'var(--text-secondary)',
            backgroundColor: activeTab === 'transform' ? '#FFFFFF' : 'transparent',
            border: activeTab === 'transform' ? '1px solid var(--border-subtle)' : 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
          }}
        >
          <Wand2 size={13} />
          <span>Actions</span>
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* TAB 1: CONNECT & SORTER */}
        {activeTab === 'connect' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Semantic Graph Discovery
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {vaultNotes.length} candidates
                </span>
              </div>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0 }}>
                Scan this note against all vault notes to discover unlinked relationships and categorize tags.
              </p>
              <button
                onClick={handleAnalyzeAndConnect}
                disabled={isLoadingLinks}
                style={{
                  marginTop: '6px',
                  padding: '8px 12px',
                  backgroundColor: '#0755E9',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isLoadingLinks ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Sparkles size={14} />
                <span>{isLoadingLinks ? 'Analyzing Graph...' : 'Find Connections & Sort'}</span>
              </button>
            </div>

            {/* Smart Categorization Card */}
            {categorySuggestion && (
              <div
                style={{
                  backgroundColor: '#F8FAFC',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <Layers size={13} color="#0755E9" />
                    <span>Suggested Taxonomy</span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      backgroundColor: '#EFF6FF',
                      color: '#1D4ED8',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {categorySuggestion.category}
                  </span>
                </div>

                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Cluster: <strong>{categorySuggestion.clusterName}</strong>
                </div>

                {/* Suggested Tags */}
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Recommended Tags:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {categorySuggestion.suggestedTags.map((tag) => {
                      const isApplied = appliedTags.has(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => handleApplyTag(tag)}
                          disabled={isApplied}
                          style={{
                            padding: '3px 7px',
                            backgroundColor: isApplied ? '#DCFCE7' : '#FFFFFF',
                            color: isApplied ? '#15803D' : '#334155',
                            border: `1px solid ${isApplied ? '#86EFAC' : '#CBD5E1'}`,
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            cursor: isApplied ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          {isApplied ? <Check size={10} /> : <Plus size={10} />}
                          <span>#{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Suggested Links List */}
            {suggestedLinks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Suggested Connections ({suggestedLinks.length})
                </div>
                {suggestedLinks.map((link) => {
                  const isConnected = linkedTitles.has(link.targetTitle);
                  return (
                    <div
                      key={link.targetTitle}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: `1px solid ${isConnected ? '#BBF7D0' : 'var(--border-subtle)'}`,
                        backgroundColor: isConnected ? '#F0FDF4' : '#FFFFFF',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0755E9' }}>
                          [[{link.targetTitle}]]
                        </span>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: '#F1F5F9',
                            color: '#475569',
                          }}
                        >
                          {link.relationType.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                        {link.rationale}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {Math.round(link.confidence * 100)}% match
                        </span>
                        <button
                          onClick={() => handleConnectNote(link)}
                          disabled={isConnected}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: isConnected ? '#16A34A' : '#EFF6FF',
                            color: isConnected ? '#FFFFFF' : '#0755E9',
                            border: `1px solid ${isConnected ? '#16A34A' : '#BFDBFE'}`,
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            cursor: isConnected ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {isConnected ? (
                            <>
                              <Check size={11} />
                              <span>Connected</span>
                            </>
                          ) : (
                            <>
                              <Plus size={11} />
                              <span>+ Link Note</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* TAB 2: ASK NOTE */}
        {activeTab === 'ask' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '10px' }}>
            {/* Quick Prompt Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {[
                'Organize notes into folders',
                'Summarize all notes',
                'Create folder Architecture',
                'Add Mermaid chart',
              ].map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleSendMessage(chip)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '12px',
                    backgroundColor: '#F1F5F9',
                    border: '1px solid #E2E8F0',
                    fontSize: '0.68rem',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Messages Feed */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingRight: '4px',
              }}
            >
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: msg.actions && msg.actions.length > 0 ? '94%' : '88%',
                    padding: '8px 11px',
                    borderRadius: '8px',
                    backgroundColor: msg.sender === 'user' ? '#0755E9' : '#F1F5F9',
                    color: msg.sender === 'user' ? '#FFFFFF' : '#0F172A',
                    fontSize: '0.75rem',
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  
                  {/* Interactive Action Cards */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Suggested Actions ({msg.actions.length})
                        </span>
                        {msg.actions.length > 1 && (
                          <button
                            onClick={() => handleApplyAllActions(msg.id, msg.actions!)}
                            style={{
                              padding: '2px 8px',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              backgroundColor: '#EFF6FF',
                              color: '#0755E9',
                              border: '1px solid #BFDBFE',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            Apply All ({msg.actions.length})
                          </button>
                        )}
                      </div>

                      {msg.actions.map((act, idx) => {
                        const isApplied = msg.actionStatuses?.[idx] === 'applied';
                        return (
                          <div
                            key={idx}
                            style={{
                              backgroundColor: isApplied ? '#F0FDF4' : '#FFFFFF',
                              border: `1px solid ${isApplied ? '#BBF7D0' : '#CBD5E1'}`,
                              borderRadius: '6px',
                              padding: '8px 10px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                {act.type === 'create_folder' && <FolderPlus size={14} color="#0755E9" style={{ flexShrink: 0 }} />}
                                {act.type === 'move_note' && <FolderInput size={14} color="#0755E9" style={{ flexShrink: 0 }} />}
                                {act.type === 'edit_note' && <FileEdit size={14} color="#0755E9" style={{ flexShrink: 0 }} />}
                                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {act.type === 'create_folder' && `Folder: "${act.folderName}"`}
                                  {act.type === 'move_note' && (
                                    <>
                                      Move <strong>{act.noteTitle}</strong> <ArrowRight size={10} style={{ display: 'inline' }} /> {act.targetFolder || 'Root'}
                                    </>
                                  )}
                                  {act.type === 'edit_note' && (
                                    <>
                                      Edit: <strong>{act.noteTitle || activeNoteTitle}</strong>
                                    </>
                                  )}
                                </span>
                              </div>

                              <button
                                onClick={() => handleExecuteAction(msg.id, idx, act)}
                                disabled={isApplied}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  backgroundColor: isApplied ? '#DCFCE7' : '#0755E9',
                                  color: isApplied ? '#16A34A' : '#FFFFFF',
                                  border: `1px solid ${isApplied ? '#86EFAC' : '#0755E9'}`,
                                  borderRadius: '4px',
                                  cursor: isApplied ? 'default' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  flexShrink: 0,
                                }}
                              >
                                {isApplied ? (
                                  <>
                                    <CheckCircle2 size={11} />
                                    <span>Done</span>
                                  </>
                                ) : (
                                  <>
                                    <span>Apply</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {act.type === 'edit_note' && act.diffSummary && (
                              <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
                                {act.diffSummary}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {msg.citations && msg.citations.length > 0 && (
                    <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                      {msg.citations.map((c) => (
                        <span
                          key={c}
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            backgroundColor: '#E2E8F0',
                            color: '#1E293B',
                            padding: '1px 4px',
                            borderRadius: '3px',
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isAsking && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  AI Co-Pilot is thinking...
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
              <input
                type="text"
                placeholder="Ask about this note..."
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-medium)',
                  fontSize: '0.75rem',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputQuery.trim() || isAsking}
                style={{
                  padding: '7px 12px',
                  backgroundColor: '#0755E9',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: !inputQuery.trim() || isAsking ? 'not-allowed' : 'pointer',
                }}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: TRANSFORM & ACTIONS */}
        {activeTab === 'transform' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              In-Editor Transformations
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0 }}>
              One-click AI workflows to structure, summarize, or promote notes into locked skills.
            </p>

            {transformSuccess && (
              <div
                style={{
                  padding: '8px 10px',
                  backgroundColor: '#DCFCE7',
                  border: '1px solid #86EFAC',
                  borderRadius: '6px',
                  color: '#15803D',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Check size={14} />
                <span>{transformSuccess}</span>
              </div>
            )}

            {/* Action 1: Executive Summary */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                📋 Executive Summary
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
                Synthesizes a 3-bullet callout block directly into the note content.
              </p>
              <button
                onClick={handleGenerateSummary}
                disabled={isTransforming}
                style={{
                  alignSelf: 'flex-start',
                  padding: '5px 10px',
                  backgroundColor: '#FFFFFF',
                  color: '#0755E9',
                  border: '1px solid #BFDBFE',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: isTransforming ? 'not-allowed' : 'pointer',
                }}
              >
                {isTransforming ? 'Generating...' : '+ Insert Summary Block'}
              </button>
            </div>

            {/* Action 2: Organize Taxonomy */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                🏷️ Auto-Categorize Note
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
                Analyzes content to recommend the best matching category (e.g. Architecture, Decision, Meeting).
              </p>
              <button
                onClick={async () => {
                  const res = await NotesAiClient.sortAndCategorize({
                    title: activeNoteTitle,
                    content: activeNoteContent,
                  });
                  if (onApplyCategory) onApplyCategory(res.category);
                  setTransformSuccess(`Category set to "${res.category}"!`);
                  setTimeout(() => setTransformSuccess(null), 3000);
                }}
                style={{
                  alignSelf: 'flex-start',
                  padding: '5px 10px',
                  backgroundColor: '#FFFFFF',
                  color: '#0755E9',
                  border: '1px solid #BFDBFE',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Auto-Detect Category
              </button>
            </div>

            {/* Action 3: Auto-Organize Vault into Folders */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                📁 Auto-Organize Vault Notes
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
                Scans all notes across the vault and groups unfiled documents into thematic folders.
              </p>
              <button
                onClick={() => {
                  setActiveTab('ask');
                  handleSendMessage('Organize all unfiled notes in this vault into folders');
                }}
                style={{
                  alignSelf: 'flex-start',
                  padding: '5px 10px',
                  backgroundColor: '#FFFFFF',
                  color: '#0755E9',
                  border: '1px solid #BFDBFE',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Organize Vault
              </button>
            </div>

            {/* Action 4: Mermaid Flowchart Diagram */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                📊 Architecture Flowchart
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
                Synthesizes a Mermaid visual workflow diagram directly into the document.
              </p>
              <button
                onClick={() => {
                  setActiveTab('ask');
                  handleSendMessage('Add a mermaid flowchart architecture diagram to this note');
                }}
                style={{
                  alignSelf: 'flex-start',
                  padding: '5px 10px',
                  backgroundColor: '#FFFFFF',
                  color: '#0755E9',
                  border: '1px solid #BFDBFE',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Generate Diagram
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer Footer */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <ShieldCheck size={13} color="#16A34A" />
          <span>Zero-Read Boundary Enforced</span>
        </div>
      </div>
    </div>
  );
};
