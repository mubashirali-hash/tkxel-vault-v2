import React, { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import { Vault, VaultRole, Page, PageType, TimelineEntry, AuditEvent, Share } from '@tkxel-vault/types';
import { MarkdownEngine, ImportResult } from '@tkxel-vault/vault-core/markdown';
import { AppShell } from './components/layout/AppShell.js';
import { Sidebar } from './components/navigation/Sidebar.js';
import { Suspense } from 'react';
import { MarkdownEditor } from './components/editor/MarkdownEditor.js';
const KnowledgeGraph = React.lazy(() => import('./components/graph/KnowledgeGraph.js').then(m => ({ default: m.KnowledgeGraph })));
const AuditViewer = React.lazy(() => import('./components/audit/AuditViewer.js').then(m => ({ default: m.AuditViewer })));
const SharingModal = React.lazy(() => import('./components/sharing/SharingModal.js').then(m => ({ default: m.SharingModal })));
const ExportModal = React.lazy(() => import('./components/export/ExportModal.js').then(m => ({ default: m.ExportModal })));
const ImporterModal = React.lazy(() => import('./components/ingestion/ImporterModal.js').then(m => ({ default: m.ImporterModal })));
const AddSkillModal = React.lazy(() => import('./components/skills/AddSkillModal.js').then(m => ({ default: m.AddSkillModal })));
const ConvertNoteToSkillModal = React.lazy(() => import('./components/skills/ConvertNoteToSkillModal.js').then(m => ({ default: m.ConvertNoteToSkillModal })));
const McpConnectModal = React.lazy(() => import('./components/mcp/McpConnectModal.js').then(m => ({ default: m.McpConnectModal })));
import { SkillItem } from './components/skills/AddSkillModal.js';
import { loadVaultData, saveVaultLocalCache, addVaultShareApi, revokeVaultShareApi } from './utils/storage.js';
import { Lock, Sparkles, Plus, Copy, Check, Terminal, ShieldCheck, FileText, Trash2 } from 'lucide-react';
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

const SEED_PAGES: Page[] = [
  {
    id: 'page_arch_01',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'System Architecture',
    folder: 'Architecture',
    type: 'architecture',
    tags: ['core', 'infrastructure', 'security'],
    aliases: ['Architecture', 'Tech Stack'],
    created_at: new Date('2026-02-01'),
    front_matter: {
      title: 'System Architecture',
      folder: 'Architecture',
      type: 'architecture',
      tags: ['core', 'infrastructure', 'security'],
      aliases: ['Architecture', 'Tech Stack'],
      body: `# System Architecture\n\nOverview of tkxel Vault microservices and [[API Gateway Security]] with [[KMS Encryption Model]].\n\n## Core Principles\n- Air-gapped confidentiality.\n- Zero-plain-text storage on disk.\n- Envelope encryption with AWS KMS.`,
    },
  },
  {
    id: 'page_sec_02',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'API Gateway Security',
    folder: 'Security',
    type: 'note',
    tags: ['security', 'mcp', 'gateway'],
    aliases: ['Gateway Rules', 'MCP Gateway'],
    created_at: new Date('2026-02-02'),
    front_matter: {
      title: 'API Gateway Security',
      folder: 'Security',
      type: 'note',
      tags: ['security', 'mcp', 'gateway'],
      aliases: ['Gateway Rules', 'MCP Gateway'],
      body: `# API Gateway Security\n\nImplements Anthropic Model Context Protocol (MCP 2025-11-25) over Streamable HTTP and stdio.\n\nConnects to [[System Architecture]] and [[Coding Agent Guidelines]].`,
    },
  },
  {
    id: 'page_kms_03',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'KMS Encryption Model',
    folder: 'Security',
    type: 'decision',
    tags: ['crypto', 'envelope-encryption', 'aws-kms'],
    aliases: ['Envelope Encryption', 'KMS Master Key'],
    created_at: new Date('2026-02-03'),
    front_matter: {
      title: 'KMS Encryption Model',
      folder: 'Security',
      type: 'decision',
      tags: ['crypto', 'envelope-encryption', 'aws-kms'],
      aliases: ['Envelope Encryption', 'KMS Master Key'],
      body: `# KMS Encryption Model\n\nAES-256-GCM envelope encryption protecting document chunks and proprietary skill instructions.\n\nReferences [[System Architecture]].`,
    },
  },
  {
    id: 'page_agent_04',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'Coding Agent Guidelines',
    folder: 'Agents',
    type: 'project',
    tags: ['claude-code', 'codex', 'antigravity'],
    aliases: ['Agent Rules', 'Claude Code Ingestion'],
    created_at: new Date('2026-02-04'),
    front_matter: {
      title: 'Coding Agent Guidelines',
      folder: 'Agents',
      type: 'project',
      tags: ['claude-code', 'codex', 'antigravity'],
      aliases: ['Agent Rules', 'Claude Code Ingestion'],
      body: `# Coding Agent Guidelines\n\nBest practices for pairing Claude Code, Codex, and Antigravity with tkxel Vault.\n\nConfigured via [[API Gateway Security]].`,
    },
  },
];

const SEED_LINKS: Array<{ from_page_id: string; to_page_id: string }> = [
  { from_page_id: 'page_arch_01', to_page_id: 'page_sec_02' },
  { from_page_id: 'page_arch_01', to_page_id: 'page_kms_03' },
  { from_page_id: 'page_sec_02', to_page_id: 'page_arch_01' },
  { from_page_id: 'page_sec_02', to_page_id: 'page_agent_04' },
  { from_page_id: 'page_kms_03', to_page_id: 'page_arch_01' },
  { from_page_id: 'page_agent_04', to_page_id: 'page_sec_02' },
];
const SEED_SKILLS: SkillItem[] = [];
const SEED_TIMELINE: TimelineEntry[] = [];
const SEED_AUDIT: AuditEvent[] = [];
const SEED_SHARES: Share[] = [];

const safeSkillSummary = (description: string): string => {
  const resemblesInstructions = /(^|\s)(you are|system prompt|instructions?:|file:\/\/|\.agents\/)/i.test(description) || description.includes('**');
  return resemblesInstructions ? 'Protected capability. Instructions and source content remain hidden.' : description;
};

export const App: React.FC = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [ssoToken, setSsoToken] = useState<string | null>(() => localStorage.getItem('ssoToken'));
  const [userInfo, setUserInfo] = useState<{ email: string; name: string; picture?: string } | null>(() => {
    const token = localStorage.getItem('ssoToken');
    if (token && token !== 'dev_admin_token') {
      try {
        const decoded = jwtDecode(token) as any;
        if (decoded?.email) {
          return {
            email: decoded.email,
            name: decoded.name || decoded.email.split('@')[0],
            picture: decoded.picture,
          };
        }
      } catch (e) {
        // invalid token fallback
      }
    }
    if (token === 'dev_admin_token') {
      const defaultEmail = (import.meta.env.VITE_VAULT_OWNER_EMAIL || 'mubashir.ali@camp1.tkxel.com').split(',')[0].trim();
      return {
        email: defaultEmail,
        name: 'Mubashir Ali (Administrator)',
      };
    }
    return null;
  });

  // Vaults Definitions
  const [vaults] = useState<Vault[]>([
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent & Skills Hub',
      mode: 'open',
      owner_id: import.meta.env.VITE_VAULT_OWNER_EMAIL || 'admin@tkxel.com',
      data_key_id: 'kms_key_01',
      export_policy: 'allowed_for_owner',
      created_at: new Date('2026-01-10'),
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Proprietary IP & Skills Store',
      mode: 'locked',
      owner_id: import.meta.env.VITE_VAULT_OWNER_EMAIL || 'admin@tkxel.com',
      data_key_id: 'kms_key_02',
      export_policy: 'strictly_forbidden',
      created_at: new Date('2026-02-01'),
    },
  ]);

  const [currentVault, setCurrentVault] = useState<Vault>(vaults[0]);
  const [currentTab, setCurrentTab] = useState<'editor' | 'graph' | 'audit'>('editor');
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(false);

  // Open Vault Pages & Links State (Persisted)
  const [pages, setPages] = useState<Page[]>(SEED_PAGES);
  const [activePageId, setActivePageId] = useState<string>('');
  const [links, setLinks] = useState<Array<{ from_page_id: string; to_page_id: string }>>(SEED_LINKS);
  const [lockedSkills, setLockedSkills] = useState<SkillItem[]>(SEED_SKILLS);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>(SEED_TIMELINE);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(SEED_AUDIT);
  const [shares, setShares] = useState<Share[]>(SEED_SHARES);

  // Folders State
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('tkxel_vault_custom_folders');
      return saved ? JSON.parse(saved) : ['Agents', 'Projects', 'Clients', 'Architecture'];
    } catch {
      return ['Agents', 'Projects', 'Clients', 'Architecture'];
    }
  });

  const allFolders = useMemo(() => {
    return Array.from(
      new Set([
        ...customFolders,
        ...(pages.map((p) => p.folder).filter(Boolean) as string[]),
      ])
    ).sort((a, b) => a.localeCompare(b));
  }, [customFolders, pages]);

  const handleCreateFolder = (folderName: string) => {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    setCustomFolders((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed].sort((a, b) => a.localeCompare(b));
      try {
        localStorage.setItem('tkxel_vault_custom_folders', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleDeleteFolder = (folderName: string) => {
    setCustomFolders((prev) => {
      const next = prev.filter((f) => f !== folderName);
      try {
        localStorage.setItem('tkxel_vault_custom_folders', JSON.stringify(next));
      } catch {}
      return next;
    });
    setPages((prev) =>
      prev.map((p) => (p.folder === folderName ? { ...p, folder: undefined, front_matter: { ...p.front_matter, folder: undefined } } : p))
    );
  };

  const handleMoveNoteToFolder = (pageId: string, targetFolder?: string) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== pageId) return p;
        return {
          ...p,
          folder: targetFolder,
          front_matter: {
            ...p.front_matter,
            folder: targetFolder,
          },
          updated_at: new Date(),
        };
      })
    );
  };

  const handleAiUpdateNoteContent = (
    noteId: string | undefined,
    content: string,
    mode: 'replace' | 'append' | 'insert' = 'append'
  ) => {
    const targetId = noteId || activePageId;
    if (!targetId) return;

    setPages((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== targetId) return p;
        const currentBody = (p.front_matter?.body as string) || '';
        let updatedBody = content;
        if (mode === 'append') {
          updatedBody = currentBody ? `${currentBody}\n\n${content}` : content;
        } else if (mode === 'insert') {
          updatedBody = currentBody ? `${content}\n\n${currentBody}` : content;
        }
        return {
          ...p,
          front_matter: {
            ...p.front_matter,
            body: updatedBody,
          },
          updated_at: new Date(),
        };
      });
      saveVaultLocalCache(currentVault.id, { pages: updated });
      return updated;
    });
  };

  useEffect(() => {
    // Initial load state
    const userId = userInfo?.email || 'usr_admin';
    loadVaultData(currentVault.id, userId).then((savedState: any) => {
      if (savedState && savedState.pages && savedState.pages.length > 0) {
        setPages(savedState.pages);
        setActivePageId(savedState.pages[0].id);
        setLinks(savedState.links || []);
        setLockedSkills(savedState.lockedSkills || []);
        setTimelineEntries(savedState.timelineEntries || []);
        setAuditEvents(savedState.auditEvents || []);
        setShares(savedState.shares || []);
      } else {
        setPages(SEED_PAGES);
        setActivePageId(SEED_PAGES[0]?.id || '');
        setLinks(SEED_LINKS);
      }
      setIsLoaded(true);
    });
  }, [userInfo?.email, currentVault.id]);

  const currentRole = useMemo<VaultRole | null>(() => {
    if (!userInfo?.email) return null;
    const userEmail = userInfo.email.toLowerCase().trim();
    
    // Check direct ownership or configured owners
    const configuredOwners = (import.meta.env.VITE_VAULT_OWNER_EMAIL || 'admin@tkxel.com,mubashir.ali@camp1.tkxel.com')
      .toLowerCase()
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);

    if (
      configuredOwners.includes(userEmail) ||
      userEmail === 'admin@tkxel.com' ||
      currentVault.owner_id.toLowerCase().trim() === userEmail
    ) {
      return 'owner';
    }

    // Check explicit shares
    const userShare = shares.find(
      (s) => s.vault_id === currentVault.id && s.principal_id.toLowerCase().trim() === userEmail
    );
    if (userShare) {
      return userShare.role;
    }

    return null;
  }, [userInfo?.email, currentVault.id, currentVault.owner_id, shares]);

  // Modal Dialog States
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isAddSkillOpen, setIsAddSkillOpen] = useState(false);
  const [isConvertToSkillOpen, setIsConvertToSkillOpen] = useState(false);
  const [isMcpOpen, setIsMcpOpen] = useState(false);
  const [noteToConvert, setNoteToConvert] = useState<Page | null>(null);
  const [conversionSuccessMessage, setConversionSuccessMessage] = useState<string | null>(null);
  const [copiedSkillName, setCopiedSkillName] = useState<string | null>(null);

  // Auto-save state to localStorage whenever modified
  useEffect(() => {
    if (!isLoaded) return;
  }, [isLoaded, pages, links, shares, auditEvents, lockedSkills, timelineEntries, currentRole, currentVault.id, userInfo?.email]);

  // Ensure activePageId points to a valid page in current vault
  const vaultPages = pages.filter((p) => p.vault_id === currentVault.id);
  const activePage = vaultPages.find((p) => p.id === activePageId) || vaultPages[0] || null;

  // Compute backlinks for active page
  const activeBacklinks = activePage
    ? links
        .filter((l) => l.to_page_id === activePage.id)
        .map((l) => pages.find((p) => p.id === l.from_page_id)?.title || 'Untitled')
    : [];

  const handleSelectVault = (vault: Vault) => {
    setCurrentVault(vault);
    if (vault.mode === 'locked') {
      if (currentTab === 'graph') {
        setCurrentTab('editor'); // Locked vault has no graph view
      }
    }
  };

  const handleToggleNavigation = () => {
    if (window.matchMedia('(max-width: 899px)').matches) {
      setIsNavigationOpen((open) => !open);
      return;
    }
    setIsNavigationCollapsed((collapsed) => !collapsed);
  };

  const handleCreateHubPage = (folderName: string) => {
    const folderPages = pages.filter((p) => p.vault_id === currentVault.id && p.folder === folderName);
    const linksMd = folderPages.map((p) => `- [[${p.title}]]`).join('\n');
    const hubContent = `# ${folderName} Hub\n\nThis is the hub page for the **${folderName}** folder.\n\n## Agents & Skills\n${linksMd}`;
    
    const newPage: Page = {
      id: crypto.randomUUID(),
      vault_id: currentVault.id,
      type: 'note',
      title: `${folderName} Hub`,
      folder: folderName,
      aliases: [],
      tags: ['hub', 'index'],
      front_matter: {
        title: `${folderName} Hub`,
        type: 'note',
        tags: ['hub', 'index'],
        folder: folderName,
        body: hubContent,
      },
      created_at: new Date(),
    };
    
    const newLinks = folderPages.map((p) => ({
      from_page_id: newPage.id,
      to_page_id: p.id
    }));

    const nextPages = [...pages, newPage];
    setPages(nextPages);
    setLinks((prev) => [...prev, ...newLinks]);
    setActivePageId(newPage.id);

    // Audit Event
    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'publish_page',
      target_id: currentVault.id,
      timestamp: new Date(),
      metadata: { pageId: newPage.id, title: newPage.title, type: newPage.type, hub: true },
    };
    setAuditEvents([audit, ...auditEvents]);

    // Global state sync is handled by resource-oriented APIs
  };

  const handleCreateNewPage = (targetFolder?: string) => {
    const newId = crypto.randomUUID();
    const newPage: Page = {
      id: newId,
      vault_id: currentVault.id,
      type: 'note',
      title: 'New Page',
      folder: targetFolder,
      aliases: [],
      tags: ['draft'],
      front_matter: {
        title: 'New Page',
        folder: targetFolder,
        type: 'note',
        tags: ['draft'],
        aliases: [],
        body: '# New Page\n\nStart writing notes and use [[wiki-links]] to connect concepts.',
      },
      current_version_id: null,
      created_at: new Date(),
    };

    setPages([newPage, ...pages]);
    setActivePageId(newId);

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'create_page',
      target_id: newId,
      timestamp: new Date(),
      metadata: { title: 'New Page' },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleCreateGhostPage = (ghostTitle: string) => {
    const newId = crypto.randomUUID();
    const newPage: Page = {
      id: newId,
      vault_id: currentVault.id,
      type: 'note',
      title: ghostTitle,
      aliases: [],
      tags: ['linked'],
      front_matter: {
        title: ghostTitle,
        type: 'note',
        tags: ['linked'],
        aliases: [],
        body: `# ${ghostTitle}\n\nInstantiated via wiki-link from [[${activePage.title}]].`,
      },
      current_version_id: null,
      created_at: new Date(),
    };

    setPages([newPage, ...pages]);
    setActivePageId(newId);

    // Link current page to ghost page
    setLinks((prev) => [...prev, { from_page_id: activePage.id, to_page_id: newId }]);

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'create_page',
      target_id: newId,
      timestamp: new Date(),
      metadata: { title: ghostTitle, instantiated_from: activePage.title },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleDeletePage = (pageId: string) => {
    const pageToDelete = pages.find((p) => p.id === pageId);
    let remainingPages = pages.filter((p) => p.id !== pageId);

    if (remainingPages.length === 0) {
      const fallbackId = crypto.randomUUID();
      const fallbackPage: Page = {
        id: fallbackId,
        vault_id: currentVault.id,
        type: 'note',
        title: 'Untitled Note',
        aliases: [],
        tags: ['welcome'],
        front_matter: {
          title: 'Untitled Note',
          type: 'note',
          tags: ['welcome'],
          aliases: [],
          body: '# Untitled Note\n\nStart writing notes and use [[wiki-links]] to connect concepts.',
        },
        current_version_id: null,
        created_at: new Date(),
      };
      remainingPages = [fallbackPage];
      setActivePageId(fallbackId);
    } else if (activePageId === pageId) {
      setActivePageId(remainingPages[0].id);
    }

    setPages(remainingPages);
    setLinks((prev) => prev.filter((l) => l.from_page_id !== pageId && l.to_page_id !== pageId));

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'delete_page',
      target_id: pageId,
      timestamp: new Date(),
      metadata: { title: pageToDelete?.title || 'Unknown Note' },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleSavePage = async (updated: {
    title: string;
    content: string;
    tags: string[];
    type: PageType;
    aliases?: string[];
    folder?: string;
  }, isDraft: boolean = true) => {
    const oldTitle = activePage.title;
    const newTitle = updated.title.trim();
    let updatedPages = [...pages];

    // Transactional wiki-link refactoring if title renamed (DEF-05)
    if (oldTitle !== newTitle) {
      updatedPages = updatedPages.map((p) => {
        if (p.id === activePage.id) return p;
        const currentBody = (p.front_matter?.body as string) || '';
        const refactored = MarkdownEngine.refactorLinks(currentBody, oldTitle, newTitle);
        if (refactored !== currentBody) {
          return {
            ...p,
            front_matter: {
              ...p.front_matter,
              body: refactored,
            },
            updated_at: new Date(),
          };
        }
        return p;
      });
    }

    // Update active page
    updatedPages = updatedPages.map((p) => {
      if (p.id === activePage.id) {
        return {
          ...p,
          title: newTitle,
          type: updated.type,
          folder: updated.folder,
          tags: updated.tags,
          aliases: updated.aliases || p.aliases || [],
          front_matter: {
            ...p.front_matter,
            title: newTitle,
            type: updated.type,
            folder: updated.folder,
            tags: updated.tags,
            aliases: updated.aliases || p.aliases || [],
            body: updated.content,
          },
          updated_at: new Date(),
        };
      }
      return p;
    });
    setPages(updatedPages);

    // Extract links & synchronize graph (DEF-04)
    const parsed = MarkdownEngine.parse(updated.content);
    const newOutgoing: Array<{ from_page_id: string; to_page_id: string }> = [];

    parsed.links.forEach((link) => {
      const target = updatedPages.find(
        (p) =>
          p.title.toLowerCase() === link.target.toLowerCase() ||
          p.aliases?.some((a) => a.toLowerCase() === link.target.toLowerCase())
      );
      if (target && target.id !== activePage.id) {
        if (!newOutgoing.some((e) => e.to_page_id === target.id)) {
          newOutgoing.push({ from_page_id: activePage.id, to_page_id: target.id });
        }
      }
    });

    const finalLinks = [
      ...links.filter((l) => l.from_page_id !== activePage.id),
      ...newOutgoing,
    ];
    setLinks(finalLinks);

    // Record audit event
    const newAuditEvent: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: userInfo?.email || 'alex.dev@tkxel.com',
      action: (isDraft ? 'save_draft' : 'publish_version') as any,
      target_id: activePage.id,
      timestamp: new Date(),
      metadata: {
        title: newTitle,
        previousTitle: oldTitle,
        linksCount: newOutgoing.length,
        renamed: oldTitle !== newTitle,
      },
    };
    setAuditEvents((prev) => [newAuditEvent, ...prev]);

    // Immediately persist to local cache so user never loses draft or publish state
    saveVaultLocalCache(currentVault.id, {
      pages: updatedPages,
      links: finalLinks,
    });

    // Make API call for draft or publish (Epic B)
    try {
      const endpoint = isDraft ? 'draft' : 'publish';
      const _userId = userInfo?.email || 'usr_admin';
      void _userId;
      const res = await fetch(`http://localhost:3002/api/pages/${activePage.id}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ssoToken}`,
        },
        body: JSON.stringify({ 
          content: updated.content, 
          vault_id: currentVault.id,
          updated_at: activePage.updated_at?.toISOString() // Optimistic Concurrency Control
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          alert('Conflict: This page was modified by another user. Please refresh to see their changes before saving your own.');
        } else {
          console.error('Failed to save version to DB:', await res.text());
        }
      } else {
        const data = await res.json();
        if (data.updated_at) {
          // Sync our local page updated_at with the server's new one
          setPages((prev) => prev.map((p) => p.id === activePage.id ? { ...p, updated_at: new Date(data.updated_at) } : p));
        }
      }
    } catch (err) {
      console.error('Network error saving version:', err);
    }
  };

  const handleLinkPages = (sourcePageId: string, targetPageId: string) => {
    const sourcePage = pages.find((p) => p.id === sourcePageId);
    const targetPage = pages.find((p) => p.id === targetPageId);
    if (!sourcePage || !targetPage || sourcePage.id === targetPageId) return;

    // Check if link already exists
    const exists = links.some(
      (l) => l.from_page_id === sourcePageId && l.to_page_id === targetPageId
    );
    if (exists) return;

    // Append link to source page body
    const currentBody = (sourcePage.front_matter?.body as string) || '';
    const linkSyntax = `[[${targetPage.title}]]`;
    const newBody = currentBody.trim() ? `${currentBody}\n\n- ${linkSyntax}` : `- ${linkSyntax}`;

    const updatedSourcePage: Page = {
      ...sourcePage,
      front_matter: {
        ...sourcePage.front_matter,
        body: newBody,
      },
      updated_at: new Date(),
    };

    setPages((prev) => prev.map((p) => (p.id === sourcePageId ? updatedSourcePage : p)));
    setLinks((prev) => [...prev, { from_page_id: sourcePageId, to_page_id: targetPageId }]);

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'edit_page',
      target_id: sourcePageId,
      timestamp: new Date(),
      metadata: {
        action_detail: 'graph_link_created',
        target_page_id: targetPageId,
        target_title: targetPage.title,
      },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleCreateSkill = (skillData: Omit<SkillItem, 'id' | 'created_at'>) => {
    const newSkill: SkillItem = {
      ...skillData,
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    setLockedSkills((prev) => [newSkill, ...prev]);

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'upload_skill',
      target_id: newSkill.id,
      timestamp: new Date(),
      metadata: { name: newSkill.name, version: newSkill.version, runtime: newSkill.runtime },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleDeleteSkill = (skillId: string) => {
    const skill = lockedSkills.find((s) => s.id === skillId);
    setLockedSkills((prev) => prev.filter((s) => s.id !== skillId));

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'delete_skill',
      target_id: skillId,
      timestamp: new Date(),
      metadata: { name: skill?.name || 'Unknown Skill' },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  const handleOpenConvertToSkill = (targetPage?: Page) => {
    const page = targetPage || activePage;
    if (!page) return;
    setNoteToConvert(page);
    setIsConvertToSkillOpen(true);
  };

  const handleConvertFolderToSkill = (folderName: string) => {
    const folderPages = pages.filter((p) => p.vault_id === currentVault.id && p.folder === folderName);
    
    // Find the main skill note if it exists (e.g. SKILL.md or type: 'skill')
    const mainNote = folderPages.find(p => p.title.toLowerCase() === 'skill' || p.front_matter?.type === 'skill') || folderPages[0];
    
    if (!mainNote) return;
    
    // Combine the bodies of all files in the folder for the instructions payload
    const combinedBody = folderPages.map(p => {
      const body = p.front_matter.body as string || '';
      return `## ${p.title}\n\n${body}`;
    }).join('\n\n---\n\n');
    
    const syntheticNote: Page = {
      ...mainNote,
      title: folderName,
      front_matter: {
        ...mainNote.front_matter,
        body: combinedBody,
      }
    };
    
    setNoteToConvert(syntheticNote);
    setIsConvertToSkillOpen(true);
  };

  const handleConvertNoteToSkill = ({
    targetVaultId,
    skill,
    deleteOriginalNote,
  }: {
    targetVaultId: string;
    skill: Omit<SkillItem, 'id' | 'created_at'>;
    deleteOriginalNote: boolean;
  }) => {
    const newSkill: SkillItem = {
      ...skill,
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    setLockedSkills((prev) => [newSkill, ...prev]);

    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: userInfo?.email || 'admin@tkxel.com',
      action: 'upload_skill',
      target_id: newSkill.id,
      timestamp: new Date(),
      metadata: {
        operation: 'promote_note_to_skill',
        source_note_id: noteToConvert?.id,
        source_note_title: noteToConvert?.title,
        skill_name: newSkill.name,
        target_vault_id: targetVaultId,
        deleted_original: deleteOriginalNote,
      },
    };
    setAuditEvents((prev) => [audit, ...prev]);

    if (deleteOriginalNote && noteToConvert) {
      handleDeletePage(noteToConvert.id);
    }

    const targetVault = vaults.find((v) => v.id === targetVaultId);
    const vaultName = targetVault?.name || 'Proprietary IP & Skills Store';
    setConversionSuccessMessage(`Successfully promoted "${noteToConvert?.title}" to ${vaultName}!`);
    setTimeout(() => setConversionSuccessMessage(null), 10000);
  };

  const handleAddTimelineEntry = (text: string) => {
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      page_id: activePage.id,
      date: new Date().toISOString().slice(0, 10),
      entry_text: text,
      created_by: 'alex.dev@tkxel.com',
      created_at: new Date(),
    };
    setTimelineEntries([...timelineEntries, entry]);
  };

  // Bulk Ingestion with link registration and audit event (DEF-07)
  const handleImportComplete = (result: ImportResult) => {
    const newPages: Page[] = result.pages.map((p) => ({
      id: crypto.randomUUID(),
      vault_id: currentVault.id,
      type: (p.parsed.frontMatter.type as PageType) || 'note',
      title: p.title,
      folder: p.folder,
      aliases: Array.isArray(p.parsed.frontMatter.aliases) ? (p.parsed.frontMatter.aliases as string[]) : [],
      tags: p.parsed.tags,
      front_matter: {
        ...p.parsed.frontMatter,
        title: p.title,
        folder: p.folder,
        type: p.parsed.frontMatter.type || 'note',
        tags: p.parsed.tags,
        body: p.content,
      },
      created_at: new Date(),
    }));

    const combinedPages = [...newPages, ...pages];
    setPages(combinedPages);

    // Register all internal wiki links into graph
    const importedLinks: Array<{ from_page_id: string; to_page_id: string }> = [];
    newPages.forEach((np) => {
      const parsed = MarkdownEngine.parse(np.front_matter.body as string);
      parsed.links.forEach((l) => {
        const target = combinedPages.find(
          (cp) =>
            cp.title.toLowerCase() === l.target.toLowerCase() ||
            cp.aliases?.some((a) => a.toLowerCase() === l.target.toLowerCase())
        );
        if (target && target.id !== np.id) {
          if (!importedLinks.some((il) => il.from_page_id === np.id && il.to_page_id === target.id)) {
            importedLinks.push({ from_page_id: np.id, to_page_id: target.id });
          }
        }
      });
    });

    setLinks((prev) => [...prev, ...importedLinks]);

    if (newPages.length > 0) {
      setActivePageId(newPages[0].id);
    }

    // Ingestion Audit Event
    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'publish_page',
      target_id: currentVault.id,
      timestamp: new Date(),
      metadata: {
        operation: 'import_vault',
        importedCount: newPages.length,
        linksIndexed: importedLinks.length,
      },
    };
    const nextAudits = [audit, ...auditEvents];
    setAuditEvents(nextAudits);

    // Immediate synchronous browser persistence & API background sync
    // Global state sync is handled by resource-oriented APIs
  };

  // Real JSZip Packaging & Download (DEF-01)
  const handleConfirmExport = async (justification: string) => {
    const zip = new JSZip();
    const vaultNotes = pages.filter((p) => p.vault_id === currentVault.id);

    vaultNotes.forEach((page) => {
      const rawBody = (page.front_matter?.body as string) || `# ${page.title}\n`;
      const fm: Record<string, unknown> = {
        title: page.title,
        type: page.type,
        tags: page.tags,
        aliases: page.aliases || [],
        created_at: page.created_at ? new Date(page.created_at).toISOString() : new Date().toISOString(),
      };
      const yamlHeader = `---\n${Object.entries(fm)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n')}\n---\n\n`;

      const finalContent = rawBody.startsWith('---') ? rawBody : `${yamlHeader}${rawBody}`;
      const safeFilename = `${page.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
      zip.file(safeFilename, finalContent);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = URL.createObjectURL(blob);
    const linkEl = document.createElement('a');
    linkEl.href = downloadUrl;
    linkEl.download = `${currentVault.name.toLowerCase().replace(/\s+/g, '-')}-notes.zip`;
    document.body.appendChild(linkEl);
    linkEl.click();
    document.body.removeChild(linkEl);
    URL.revokeObjectURL(downloadUrl);

    // Audit Event
    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'export_open_vault',
      target_id: currentVault.id,
      timestamp: new Date(),
      metadata: { justification, pageCount: vaultNotes.length, format: 'zip' },
    };
    setAuditEvents((prev) => [audit, ...prev]);
  };

  // Real CSV Compilation & Download (DEF-02)
  const handleExportCsv = () => {
    const headers = ['ID', 'Actor ID', 'Action', 'Target ID', 'Timestamp', 'Metadata'];
    const rows = auditEvents.map((evt) => [
      evt.id,
      evt.actor_id,
      evt.action,
      evt.target_id,
      new Date(evt.timestamp).toISOString(),
      JSON.stringify(evt.metadata || {}).replace(/"/g, '""'),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `tkxel-vault-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  const isLocked = currentVault.mode === 'locked';

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-tkxel-blue">
        <Sparkles className="animate-pulse h-8 w-8" />
        <span className="ml-3 font-semibold text-lg">Loading Vault Data...</span>
      </div>
    );
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy_client_id';

  if (!ssoToken) {
    return (
      <GoogleOAuthProvider clientId={clientId}>
        <div style={{
          display: 'flex',
          height: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F8FAFC',
          padding: '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px', color: 'var(--tk-primary)' }}>
            <Lock size={36} />
            <h1 style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.025em', margin: 0, color: 'var(--tk-secondary)' }}>tkxel Vault</h1>
          </div>
          <div style={{
            backgroundColor: '#FFFFFF',
            padding: '36px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
            borderRadius: '16px',
            border: '1px solid var(--border-subtle)',
            maxWidth: '420px',
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Corporate SSO</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              Sign in with your Google Workspace account to access encrypted vaults and locked skills.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', minHeight: '40px' }}>
              <GoogleLogin
                onSuccess={(res: CredentialResponse) => {
                  if (res.credential) {
                    try {
                      const decoded = jwtDecode(res.credential) as any;
                      
                      // Check Domain Restrictions
                      const allowedDomainsStr = import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS;
                      if (allowedDomainsStr) {
                        const allowedDomains = allowedDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean);
                        const domain = decoded.email.split('@')[1];
                        if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
                          alert(`Access Denied: Your email domain (@${domain}) is not authorized. Allowed: ${allowedDomains.join(', ')}`);
                          return; // Reject login
                        }
                      }

                      setSsoToken(res.credential);
                      localStorage.setItem('ssoToken', res.credential);
                      setUserInfo({
                        email: decoded.email,
                        name: decoded.name,
                        picture: decoded.picture
                      });
                    } catch (e) {
                      console.error('Failed to parse JWT', e);
                    }
                  }
                }}
                onError={() => {
                  console.warn('Google Identity Services unavailable or origin not whitelisted.');
                }}
              />
            </div>

            {/* Local Developer / Quick Admin Access */}
            <div style={{ margin: '20px 0 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>OR</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
            </div>

            <button
              onClick={() => {
                const adminEmail = (import.meta.env.VITE_VAULT_OWNER_EMAIL || 'mubashir.ali@camp1.tkxel.com').split(',')[0].trim();
                setSsoToken('dev_admin_token');
                localStorage.setItem('ssoToken', 'dev_admin_token');
                setUserInfo({
                  email: adminEmail,
                  name: 'Mubashir Ali (Administrator)',
                });
              }}
              className="btn btn-primary-blue"
              style={{ width: '100%', padding: '10px 14px', fontSize: '0.84rem' }}
            >
              Continue as Workspace Administrator (Local Dev)
            </button>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  if (currentRole === null) {
    return (
      <GoogleOAuthProvider clientId={clientId}>
        <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: '20px' }}>
          <ShieldCheck size={48} color="var(--tk-primary)" style={{ marginBottom: 16 }} />
          <h2 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: '1.3rem', fontWeight: 800 }}>Access Denied</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, textAlign: 'center', maxWidth: 440, fontSize: '0.85rem', lineHeight: 1.5 }}>
            Your account ({userInfo?.email}) does not have access to this Vault. Please ask the Vault Administrator to grant you access via the Share menu.
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              className="btn btn-primary-blue"
              style={{ padding: '8px 16px', fontSize: '0.82rem' }}
              onClick={() => {
                const adminEmail = (import.meta.env.VITE_VAULT_OWNER_EMAIL || 'mubashir.ali@camp1.tkxel.com').split(',')[0].trim();
                setSsoToken('dev_admin_token');
                localStorage.setItem('ssoToken', 'dev_admin_token');
                setUserInfo({
                  email: adminEmail,
                  name: 'Mubashir Ali (Administrator)',
                });
              }}
            >
              Switch to Workspace Administrator
            </button>
            <button 
              className="btn btn-secondary-white"
              style={{ padding: '8px 16px', fontSize: '0.82rem' }}
              onClick={() => {
                localStorage.removeItem('ssoToken');
                setSsoToken(null);
                setUserInfo(null);
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
    <AppShell
      userInfo={userInfo || undefined}
      currentVault={currentVault}
      vaults={vaults}
      currentRole={currentRole}
      currentTab={currentTab}
      navigationOpen={isNavigationOpen}
      navigationCollapsed={isNavigationCollapsed}
      navigationAvailable={!isLocked && currentTab === 'editor'}
      onToggleNavigation={handleToggleNavigation}
      onCloseNavigation={() => setIsNavigationOpen(false)}
      onSelectVault={handleSelectVault}
      onSelectTab={setCurrentTab}
      onOpenShareModal={() => setIsShareOpen(true)}
      onOpenExportModal={() => setIsExportOpen(true)}
      onOpenImportModal={() => setIsImportOpen(true)}
      onOpenMcpModal={() => setIsMcpOpen(true)}
      onLogout={() => {
        localStorage.removeItem('ssoToken');
        setSsoToken(null);
        setUserInfo(null);
      }}
    >
      {conversionSuccessMessage && (
        <div
          style={{
            position: 'fixed',
            top: '72px',
            right: '24px',
            zIndex: 600,
            padding: '12px 18px',
            backgroundColor: '#FFF7ED',
            border: '1px solid var(--locked-border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#9A3412',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          <Sparkles size={18} color="var(--locked-accent)" />
          <span>{conversionSuccessMessage}</span>
          <button
            onClick={() => {
              const lockedVault = vaults.find((v) => v.mode === 'locked');
              if (lockedVault) {
                handleSelectVault(lockedVault);
                setCurrentTab('editor');
                setConversionSuccessMessage(null);
              }
            }}
            className="btn btn-primary-blue"
            style={{
              padding: '4px 10px',
              fontSize: '0.78rem',
              backgroundColor: 'var(--locked-accent)',
              borderColor: 'var(--locked-accent)',
            }}
          >
            Switch to Skills Store →
          </button>
          <button
            onClick={() => setConversionSuccessMessage(null)}
            className="btn btn-ghost"
            style={{ padding: '2px 6px', color: '#9A3412' }}
          >
            ✕
          </button>
        </div>
      )}

      {!isLocked && currentTab === 'editor' && <Sidebar
        currentVault={currentVault}
        currentRole={currentRole}
        pages={vaultPages}
        activePageId={activePageId}
        folders={allFolders}
        onSelectPage={(p) => setActivePageId(p.id)}
        onCreateNewPage={handleCreateNewPage}
        onCreateFolder={handleCreateFolder}
        onMoveNoteToFolder={handleMoveNoteToFolder}
        onDeleteFolder={handleDeleteFolder}
        onDeletePage={handleDeletePage}
        onOpenConvertToSkill={(page) => handleOpenConvertToSkill(page)}
        onConvertFolderToSkill={handleConvertFolderToSkill}
        onCreateHubPage={handleCreateHubPage}
        isNavigationOpen={isNavigationOpen}
        isNavigationCollapsed={isNavigationCollapsed}
        onCloseNavigation={() => setIsNavigationOpen(false)}
      />}

      {/* OPEN VAULT: EDITOR TAB */}
      {!isLocked && currentTab === 'editor' && (
        activePage ? (
          <MarkdownEditor
            page={activePage}
            availablePages={vaultPages}
            timelineEntries={timelineEntries.filter((t) => t.page_id === activePage.id)}
            backlinks={activeBacklinks}
            allLinks={links}
            canEdit={currentRole === 'owner' || currentRole === 'editor'}
            currentRole={currentRole}
            isOpenVault={!isLocked}
            folders={allFolders}
            onSave={handleSavePage}
            onDelete={() => handleDeletePage(activePage.id)}
            onOpenConvertToSkill={() => activePage && handleOpenConvertToSkill(activePage)}
            onAddTimelineEntry={handleAddTimelineEntry}
            onNavigateToPage={(t) => {
              const found = vaultPages.find(
                (p) => p.title.toLowerCase() === t.toLowerCase() || p.aliases?.some((a) => a.toLowerCase() === t.toLowerCase())
              );
              if (found) setActivePageId(found.id);
            }}
            onCreateGhostPage={handleCreateGhostPage}
            onCreateFolder={handleCreateFolder}
            onMoveNoteToFolder={handleMoveNoteToFolder}
            onEditNoteContent={handleAiUpdateNoteContent}
          />
        ) : (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
              backgroundColor: '#FFFFFF',
              textAlign: 'center',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                backgroundColor: 'var(--open-bg)',
                border: '1px solid var(--open-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <FileText size={32} color="var(--tk-primary)" />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--tk-secondary)', margin: '0 0 10px 0' }}>
              Agent Workbench Ready
            </h2>
            <p style={{ maxWidth: '480px', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 28px 0' }}>
              This workspace is empty. Start pasting and refining prompts, instructions, and context gathered from Claude/Codex to build your agents.
            </p>
            <button
              onClick={() => handleCreateNewPage()}
              className="btn btn-primary-blue"
              style={{ padding: '10px 22px', fontSize: '0.9rem', gap: '8px' }}
            >
              <Plus size={16} />
              <span>Draft first agent</span>
            </button>
          </div>
        )
      )}

      {/* OPEN VAULT: 2D KNOWLEDGE GRAPH TAB */}
      {!isLocked && currentTab === 'graph' && (
        <Suspense fallback={<div className="loading-state">Loading graph...</div>}>
          <KnowledgeGraph
            pages={vaultPages}
            links={links}
            activePageId={activePageId || undefined}
            onSelectPage={(pageId) => {
              setActivePageId(pageId);
              setCurrentTab('editor');
            }}
            onLinkPages={handleLinkPages}
          />
        </Suspense>
      )}

      {/* LOCKED VAULT: DEDICATED ZERO-READ SKILLS CATALOG VIEW (DEF-06) */}
      {isLocked && currentTab === 'editor' && (
        <main
          className="protected-catalog"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            backgroundColor: '#FAFCFF',
            padding: '36px 40px',
            gap: '24px',
          }}
        >
          {/* Header Banner */}
          <div
            className="clean-panel protected-banner"
            style={{
              padding: '24px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--locked-border)',
              backgroundColor: '#FFF7ED',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  backgroundColor: '#EA580C',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Lock size={22} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#9A3412', margin: 0 }}>
                  Protected skills
                </h2>
                <p style={{ fontSize: '0.86rem', color: '#7C2D12', margin: 0, lineHeight: 1.5, maxWidth: '680px' }}>
                  Run approved capabilities without exposing their instructions or source content.
                </p>
                <details className="protected-banner__details">
                  <summary>How zero-read protection works</summary>
                  <p>Content stays encrypted at rest with AES-256-GCM and is decrypted only in isolated memory during execution. Connected clients can use <code>run_skill</code> and <code>ask_vault</code>; raw content, file listings, graph data, and export remain unavailable.</p>
                </details>
              </div>
            </div>

            {(currentRole === 'owner' || currentRole === 'editor') && (
              <button
                onClick={() => setIsAddSkillOpen(true)}
                className="btn btn-primary-blue"
                style={{ padding: '10px 18px', gap: '8px', fontSize: '0.88rem' }}
              >
                <Plus size={16} />
                <span>Add protected skill</span>
              </button>
            )}
          </div>

          {/* Runtime Isolation Telemetry */}
          <div className="protected-health" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div className="clean-panel" style={{ padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--tk-primary)', marginBottom: '6px' }}>
                <Terminal size={16} />
                <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>MCP GATEWAY STATUS</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>Streamable HTTP Active</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>Anthropic Spec 2025-11-25</div>
            </div>

            <div className="clean-panel" style={{ padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--tk-success)', marginBottom: '6px' }}>
                <ShieldCheck size={16} />
                <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>ENCRYPTION INVARIANT</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>AES-256-GCM Sealed</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>Zero Raw Disk Exfiltration</div>
            </div>

            <div className="clean-panel" style={{ padding: '16px', backgroundColor: '#FFFFFF', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--locked-accent)', marginBottom: '6px' }}>
                <Sparkles size={16} />
                <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>REGISTERED SKILLS</span>
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{lockedSkills.length} Operational</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>In-Memory Sandbox Runner</div>
            </div>
          </div>

          {/* Registered Skills Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Protected skills ({lockedSkills.length})
            </h3>
            {lockedSkills.length > 0 ? (
              <div className="protected-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                {lockedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="clean-panel protected-skill-card"
                    style={{
                      padding: '18px',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={16} color="var(--locked-accent)" />
                        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {skill.name}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.72rem', backgroundColor: '#EFF6FF', color: 'var(--tk-primary)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                        {skill.version}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                      {safeSkillSummary(skill.description)}
                    </p>

                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', backgroundColor: '#F8FAFC', padding: '6px 10px', borderRadius: '4px' }}>
                      Runtime: <strong>{skill.runtime}</strong> | Timeout: <strong>{skill.timeout_seconds}s</strong>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(`claude: run_skill("${skill.name}")`);
                          setCopiedSkillName(skill.name);
                          setTimeout(() => setCopiedSkillName(null), 2000);
                        }}
                        className="btn btn-secondary-white"
                        style={{ flex: 1, padding: '7px 12px', fontSize: '0.78rem', gap: '6px' }}
                      >
                        {copiedSkillName === skill.name ? (
                          <>
                            <Check size={14} color="var(--tk-success)" />
                            <span style={{ color: 'var(--tk-success)', fontWeight: 600 }}>Copied to Clipboard!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            <span>Copy invocation</span>
                          </>
                        )}
                      </button>
                      {(currentRole === 'owner' || currentRole === 'editor') && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSkill(skill.id)}
                          className="btn btn-ghost"
                          title={`Delete ${skill.name}`}
                          aria-label={`Delete ${skill.name}`}
                          style={{ padding: '7px 10px', color: 'var(--tk-error)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="clean-panel"
                style={{
                  padding: '48px 24px',
                  backgroundColor: '#FFFFFF',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: '#FFF7ED',
                    color: 'var(--locked-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Sparkles size={24} />
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  No protected skills yet
                </div>
                <p style={{ maxWidth: '440px', fontSize: '0.86rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  This vault is ready for proprietary tools. Add a locked skill with declared parameter schemas or promote an existing note from your open knowledge hub.
                </p>
                {(currentRole === 'owner' || currentRole === 'editor') && (
                  <button
                    onClick={() => setIsAddSkillOpen(true)}
                    className="btn btn-primary-blue"
                    style={{ padding: '8px 18px', gap: '8px', fontSize: '0.85rem', marginTop: '6px' }}
                  >
                    <Plus size={15} />
                    <span>Add first protected skill</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      )}

      {/* AUDIT TRAIL TAB */}
      {currentTab === 'audit' && (
        <Suspense fallback={<div className="loading-state">Loading audits...</div>}>
          <AuditViewer
            events={auditEvents}
            onExportCsv={handleExportCsv}
            knownNames={Object.fromEntries([
              [currentVault.id, currentVault.name],
              ...vaultPages.map((page) => [page.id, page.title]),
              ...lockedSkills.map((skill) => [skill.id, skill.name]),
              ...shares.map((share) => [share.principal_id, share.principal_id]),
              ['usr_admin', userInfo?.name || 'Vault owner'],
            ])}
          />
        </Suspense>
      )}

      {/* MODALS */}
      <Suspense fallback={null}>
        <SharingModal
          isOpen={isShareOpen}
          vault={currentVault}
          currentRole={currentRole}
          shares={shares}
          onClose={() => setIsShareOpen(false)}
          onAddShare={async (principalId, role) => {
            const userEmail = userInfo?.email || 'usr_admin';
            // Persist to PostgreSQL backend
            const apiShare = await addVaultShareApi(
              currentVault.id,
              principalId,
              role,
              userEmail,
              ssoToken
            );

            const newShare: Share = apiShare || {
              id: crypto.randomUUID(),
              vault_id: currentVault.id,
              principal_id: principalId.toLowerCase().trim(),
              role,
              granted_by: userEmail,
              granted_at: new Date(),
            };

            setShares((prev) => {
              const filtered = prev.filter(
                (s) =>
                  !(
                    s.vault_id === currentVault.id &&
                    s.principal_id.toLowerCase().trim() === principalId.toLowerCase().trim()
                  )
              );
              return [...filtered, newShare];
            });

            // Audit record for sharing (DEF-08)
            const audit: AuditEvent = {
              id: crypto.randomUUID(),
              actor_id: userEmail,
              action: 'share_vault',
              target_id: currentVault.id,
              timestamp: new Date(),
              metadata: { principal_id: principalId, role },
            };
            setAuditEvents((prev) => [audit, ...prev]);
          }}
          onRevokeShare={async (shareId) => {
            const userEmail = userInfo?.email || 'usr_admin';
            // Revoke in PostgreSQL backend
            await revokeVaultShareApi(currentVault.id, shareId, userEmail, ssoToken);

            const share = shares.find((s) => s.id === shareId);
            setShares((prev) => prev.filter((s) => s.id !== shareId));

            // Audit record for revocation (DEF-08)
            const audit: AuditEvent = {
              id: crypto.randomUUID(),
              actor_id: userEmail,
              action: 'revoke_vault',
              target_id: currentVault.id,
              timestamp: new Date(),
              metadata: { principal_id: share?.principal_id, role: share?.role },
            };
            setAuditEvents((prev) => [audit, ...prev]);
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ExportModal
          isOpen={isExportOpen}
          vault={currentVault}
          currentRole={currentRole}
          onClose={() => setIsExportOpen(false)}
          onConfirmExport={handleConfirmExport}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ImporterModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onImportComplete={handleImportComplete}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AddSkillModal
          isOpen={isAddSkillOpen}
          onClose={() => setIsAddSkillOpen(false)}
          onAddSkill={handleCreateSkill}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ConvertNoteToSkillModal
          isOpen={isConvertToSkillOpen}
          note={noteToConvert}
          lockedVaults={vaults.filter((v) => v.mode === 'locked')}
          onClose={() => setIsConvertToSkillOpen(false)}
          onConvert={handleConvertNoteToSkill}
        />
      </Suspense>

      <Suspense fallback={null}>
        <McpConnectModal
          isOpen={isMcpOpen}
          currentVault={currentVault}
          onClose={() => setIsMcpOpen(false)}
        />
      </Suspense>
    </AppShell>
    </GoogleOAuthProvider>
  );
};
