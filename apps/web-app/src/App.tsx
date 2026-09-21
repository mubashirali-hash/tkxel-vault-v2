import React, { useState, useEffect, useMemo } from 'react';
import { Vault, VaultRole, Page, PageType, TimelineEntry, AuditEvent, Share } from '@tkxel-vault/types';
import { ImportResult } from '@tkxel-vault/vault-core/markdown';
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
const CreateVaultModal = React.lazy(() => import('./components/vault/CreateVaultModal.js').then(m => ({ default: m.CreateVaultModal })));
const MoveToVaultModal = React.lazy(() => import('./components/vault/MoveToVaultModal.js').then(m => ({ default: m.MoveToVaultModal })));
import { SkillItem } from './components/skills/AddSkillModal.js';
import { loadVaultData, saveVaultLocalCache, addVaultShareApi, revokeVaultShareApi, getAuthToken, setAuthToken, removeAuthToken } from './utils/storage.js';
import {
  createVaultApi,
  movePageApi,
  applyPageSave,
  savePageContentApi,
  applyAiContentTransform,
  insertWikiLink,
  processImportPages,
  buildExportZipPackage,
  triggerBlobDownload,
} from './operations/index.js';
import { Lock, Sparkles, Plus, Copy, Check, Terminal, ShieldCheck, FileText, Trash2 } from 'lucide-react';
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

const SEED_PAGES: Page[] = [
  {
    id: '11111111-1111-1111-1111-000000000001',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'System Architecture',
    folder: 'Architecture',
    type: 'architecture',
    tags: ['core', 'infrastructure', 'security'],
    aliases: ['Architecture', 'Tech Stack'],
    content: `# System Architecture\n\nOverview of tkxel Vault microservices and [[API Gateway Security]] with [[KMS Encryption Model]].\n\n## Core Principles\n- Air-gapped confidentiality.\n- Zero-plain-text storage on disk.\n- Envelope encryption with AWS KMS.`,
    created_at: new Date('2026-02-01'),
    front_matter: {
      title: 'System Architecture',
      folder: 'Architecture',
      type: 'architecture',
      tags: ['core', 'infrastructure', 'security'],
      aliases: ['Architecture', 'Tech Stack'],
    },
  },
  {
    id: '11111111-1111-1111-1111-000000000002',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'API Gateway Security',
    folder: 'Security',
    type: 'note',
    tags: ['security', 'mcp', 'gateway'],
    aliases: ['Gateway Rules', 'MCP Gateway'],
    content: `# API Gateway Security\n\nImplements Anthropic Model Context Protocol (MCP 2025-11-25) over Streamable HTTP and stdio.\n\nConnects to [[System Architecture]] and [[Coding Agent Guidelines]].`,
    created_at: new Date('2026-02-02'),
    front_matter: {
      title: 'API Gateway Security',
      folder: 'Security',
      type: 'note',
      tags: ['security', 'mcp', 'gateway'],
      aliases: ['Gateway Rules', 'MCP Gateway'],
    },
  },
  {
    id: '11111111-1111-1111-1111-000000000003',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'KMS Encryption Model',
    folder: 'Security',
    type: 'decision',
    tags: ['crypto', 'envelope-encryption', 'aws-kms'],
    aliases: ['Envelope Encryption', 'KMS Master Key'],
    content: `# KMS Encryption Model\n\nAES-256-GCM envelope encryption protecting document chunks and proprietary skill instructions.\n\nReferences [[System Architecture]].`,
    created_at: new Date('2026-02-03'),
    front_matter: {
      title: 'KMS Encryption Model',
      folder: 'Security',
      type: 'decision',
      tags: ['crypto', 'envelope-encryption', 'aws-kms'],
      aliases: ['Envelope Encryption', 'KMS Master Key'],
    },
  },
  {
    id: '11111111-1111-1111-1111-000000000004',
    vault_id: '11111111-1111-1111-1111-111111111111',
    title: 'Coding Agent Guidelines',
    folder: 'Agents',
    type: 'project',
    tags: ['claude-code', 'codex', 'antigravity'],
    aliases: ['Agent Rules', 'Claude Code Ingestion'],
    content: `# Coding Agent Guidelines\n\nBest practices for pairing Claude Code, Codex, and Antigravity with tkxel Vault.\n\nConfigured via [[API Gateway Security]].`,
    created_at: new Date('2026-02-04'),
    front_matter: {
      title: 'Coding Agent Guidelines',
      folder: 'Agents',
      type: 'project',
      tags: ['claude-code', 'codex', 'antigravity'],
      aliases: ['Agent Rules', 'Claude Code Ingestion'],
    },
  },
];

const SEED_LINKS: Array<{ from_page_id: string; to_page_id: string }> = [
  { from_page_id: '11111111-1111-1111-1111-000000000001', to_page_id: '11111111-1111-1111-1111-000000000002' },
  { from_page_id: '11111111-1111-1111-1111-000000000001', to_page_id: '11111111-1111-1111-1111-000000000003' },
  { from_page_id: '11111111-1111-1111-1111-000000000002', to_page_id: '11111111-1111-1111-1111-000000000001' },
  { from_page_id: '11111111-1111-1111-1111-000000000002', to_page_id: '11111111-1111-1111-1111-000000000004' },
  { from_page_id: '11111111-1111-1111-1111-000000000003', to_page_id: '11111111-1111-1111-1111-000000000001' },
  { from_page_id: '11111111-1111-1111-1111-000000000004', to_page_id: '11111111-1111-1111-1111-000000000002' },
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
  const [ssoToken, setSsoToken] = useState<string | null>(() => getAuthToken());
  const [userInfo, setUserInfo] = useState<{ email: string; name: string; picture?: string } | null>(() => {
    const token = getAuthToken();
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

  // Initial Default Vaults (Fallback for offline mode)
  const DEFAULT_VAULTS: Vault[] = [
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
  ];

  const [vaults, setVaults] = useState<Vault[]>(DEFAULT_VAULTS);
  const [currentVault, setCurrentVault] = useState<Vault>(DEFAULT_VAULTS[0]);

  // Fetch dynamic vaults list from API
  useEffect(() => {
    const fetchVaults = async () => {
      try {
        const token = ssoToken || getAuthToken();
        const res = await fetch('http://localhost:3002/api/vaults', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.vaults) && data.vaults.length > 0) {
            const parsedVaults: Vault[] = data.vaults.map((v: any) => ({
              id: v.id,
              name: v.name,
              mode: v.mode,
              owner_id: v.owner_id,
              data_key_id: v.data_key_id,
              export_policy: v.export_policy,
              created_at: new Date(v.created_at),
            }));
            setVaults(parsedVaults);
            setCurrentVault((prev) => parsedVaults.find((pv) => pv.id === prev.id) || parsedVaults[0]);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch dynamic vaults, using local defaults:', err);
      }
    };
    fetchVaults();
  }, [ssoToken]);
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
        return applyAiContentTransform(p, mode, content);
      });
      saveVaultLocalCache(currentVault.id, { pages: updated }, currentVault.mode);
      return updated;
    });
  };

  useEffect(() => {
    // Initial load state
    const userId = userInfo?.email || 'usr_admin';
    loadVaultData(currentVault.id, userId, currentVault.mode).then((savedState: any) => {
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
  const [isCreateVaultOpen, setIsCreateVaultOpen] = useState(false);
  const [isMoveToVaultOpen, setIsMoveToVaultOpen] = useState(false);
  const [pageToMove, setPageToMove] = useState<Page | null>(null);
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
      content: hubContent,
      front_matter: {
        title: `${folderName} Hub`,
        type: 'note',
        tags: ['hub', 'index'],
        folder: folderName,
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
    const content = '# New Page\n\nStart writing notes and use [[wiki-links]] to connect concepts.';
    const newPage: Page = {
      id: newId,
      vault_id: currentVault.id,
      type: 'note',
      title: 'New Page',
      folder: targetFolder,
      aliases: [],
      tags: ['draft'],
      content,
      front_matter: {
        title: 'New Page',
        folder: targetFolder,
        type: 'note',
        tags: ['draft'],
        aliases: [],
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
    const content = `# ${ghostTitle}\n\nInstantiated via wiki-link from [[${activePage.title}]].`;
    const newPage: Page = {
      id: newId,
      vault_id: currentVault.id,
      type: 'note',
      title: ghostTitle,
      aliases: [],
      tags: ['linked'],
      content,
      front_matter: {
        title: ghostTitle,
        type: 'note',
        tags: ['linked'],
        aliases: [],
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
      const fallbackContent = '# Untitled Note\n\nStart writing notes and use [[wiki-links]] to connect concepts.';
      const fallbackPage: Page = {
        id: fallbackId,
        vault_id: currentVault.id,
        type: 'note',
        title: 'Untitled Note',
        aliases: [],
        tags: ['welcome'],
        content: fallbackContent,
        front_matter: {
          title: 'Untitled Note',
          type: 'note',
          tags: ['welcome'],
          aliases: [],
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
    const saveResult = applyPageSave({
      pages,
      activePage,
      updated,
    });
    const { updatedPages, newTitle, oldTitle, renamed, newOutgoingLinks } = saveResult;
    setPages(updatedPages);

    const finalLinks = [
      ...links.filter((l) => l.from_page_id !== activePage.id),
      ...newOutgoingLinks,
    ];
    setLinks(finalLinks);

    // Record audit event (throttled for repetitive draft autosaves within 30s)
    const lastDraftAudit = auditEvents.find(
      (a) => a.target_id === activePage.id && a.action === ('save_draft' as any)
    );
    const timeSinceLastDraft = lastDraftAudit ? Date.now() - new Date(lastDraftAudit.timestamp).getTime() : Infinity;
    const shouldRecordAudit = !isDraft || renamed || timeSinceLastDraft > 30000;

    if (shouldRecordAudit) {
      const newAuditEvent: AuditEvent = {
        id: crypto.randomUUID(),
        actor_id: userInfo?.email || 'alex.dev@tkxel.com',
        action: (isDraft ? 'save_draft' : 'publish_version') as any,
        target_id: activePage.id,
        timestamp: new Date(),
        metadata: {
          title: newTitle,
          previousTitle: oldTitle,
          linksCount: newOutgoingLinks.length,
          renamed,
        },
      };
      setAuditEvents((prev) => [newAuditEvent, ...prev]);
    }

    // Immediately persist to local cache so user never loses draft or publish state
    saveVaultLocalCache(
      currentVault.id,
      {
        pages: updatedPages,
        links: finalLinks,
      },
      currentVault.mode
    );

    // Make API call for draft or publish
    try {
      const res = await savePageContentApi(
        activePage.id,
        {
          content: updated.content,
          vault_id: currentVault.id,
          updated_at: activePage.updated_at?.toISOString(),
          title: updated.title,
          type: updated.type,
          folder: updated.folder,
          tags: updated.tags,
          aliases: updated.aliases,
        },
        isDraft,
        { token: ssoToken || getAuthToken() }
      );
      if (!res.ok) {
        if (res.status === 409) {
          // Attempt automatic timestamp reconciliation if page was desynchronized
          try {
            const pageRes = await fetch(`http://localhost:3002/api/pages/${activePage.id}?vaultId=${currentVault.id}`, {
              headers: {
                ...(ssoToken || getAuthToken() ? { Authorization: `Bearer ${ssoToken || getAuthToken()}` } : {}),
              },
            });
            if (pageRes.ok) {
              const resData = await pageRes.json();
              const serverPage = resData.page || resData;
              if (serverPage && serverPage.updated_at) {
                const refreshedDate = new Date(serverPage.updated_at);
                setPages((prev) =>
                  prev.map((p) => (p.id === activePage.id ? { ...p, updated_at: refreshedDate } : p))
                );
                // Retry save once with the authoritative server timestamp
                const retryRes = await savePageContentApi(
                  activePage.id,
                  {
                    content: updated.content,
                    vault_id: currentVault.id,
                    updated_at: serverPage.updated_at,
                    title: updated.title,
                    type: updated.type,
                    folder: updated.folder,
                    tags: updated.tags,
                    aliases: updated.aliases,
                  },
                  isDraft,
                  { token: ssoToken || getAuthToken() }
                );
                if (retryRes.ok) {
                  const retryData = await retryRes.json();
                  if (retryData.updated_at) {
                    const finalDate = new Date(retryData.updated_at);
                    setPages((prev) => {
                      const reconciled = prev.map((p) => (p.id === activePage.id ? { ...p, updated_at: finalDate } : p));
                      saveVaultLocalCache(currentVault.id, { pages: reconciled, links: finalLinks }, currentVault.mode);
                      return reconciled;
                    });
                  }
                  return true;
                }
              }
            }
          } catch (reconcileErr) {
            console.warn('Failed to reconcile OCC conflict timestamp:', reconcileErr);
          }
          console.warn('Conflict: Page was modified concurrently. Local draft preserved in cache.');
          return false;
        } else {
          console.warn('Failed to save version to DB (cloud offline):', await res.text());
          // Changes are safely stored in saveVaultLocalCache, treat as successful local save
          return true;
        }
      } else {
        const data = await res.json();
        if (data.updated_at) {
          const freshDate = new Date(data.updated_at);
          setPages((prev) => {
            const updatedWithTimestamp = prev.map((p) => p.id === activePage.id ? { ...p, updated_at: freshDate } : p);
            saveVaultLocalCache(currentVault.id, { pages: updatedWithTimestamp, links: finalLinks }, currentVault.mode);
            return updatedWithTimestamp;
          });
        }
        return true;
      }
    } catch (err) {
      console.warn('Network error saving version (offline mode):', err);
      // Changes are safely stored in saveVaultLocalCache, treat as successful local save
      return true;
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

    const updatedSourcePage = insertWikiLink(sourcePage, targetPage.title);

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
    
    // Combine the contents of all files in the folder for the instructions payload
    const combinedBody = folderPages.map(p => {
      const body = p.content || '';
      return `## ${p.title}\n\n${body}`;
    }).join('\n\n---\n\n');
    
    const { body: _scrubbedBody, ...cleanMainFm } = (mainNote.front_matter || {}) as Record<string, unknown>;

    const syntheticNote: Page = {
      ...mainNote,
      title: folderName,
      content: combinedBody,
      front_matter: cleanMainFm,
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

  const handleCreateVault = async (data: { name: string; mode: 'open' | 'locked'; export_policy?: string }) => {
    const token = ssoToken || getAuthToken();
    const newVault = await createVaultApi(data, { token });
    setVaults((prev) => [...prev, newVault]);
    setCurrentVault(newVault);
  };

  const handleMovePageToVault = async (destinationVaultId: string) => {
    if (!pageToMove) return;
    const token = ssoToken || getAuthToken();
    await movePageApi(pageToMove.id, destinationVaultId, { token });

    const targetPageId = pageToMove.id;
    // Update local state ONLY on server-confirmed success: reassign page's vault_id
    setPages((prev) =>
      prev.map((p) => (p.id === targetPageId ? { ...p, vault_id: destinationVaultId } : p))
    );

    // If active page was moved, switch to another page in current vault
    if (activePageId === targetPageId) {
      const remainingInCurrent = pages.filter((p) => p.vault_id === currentVault.id && p.id !== targetPageId);
      if (remainingInCurrent.length > 0) {
        setActivePageId(remainingInCurrent[0].id);
      }
    }

    setIsMoveToVaultOpen(false);
    setPageToMove(null);
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
    const { newPages, combinedPages, importedLinks } = processImportPages(result, currentVault.id, pages);
    setPages(combinedPages);
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
  };

  // Real JSZip Packaging & Download (DEF-01)
  const handleConfirmExport = async (justification: string) => {
    const { zip, fileCount } = await buildExportZipPackage(pages, currentVault.id);
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(blob, `${currentVault.name.toLowerCase().replace(/\s+/g, '-')}-notes.zip`);

    // Audit Event
    const audit: AuditEvent = {
      id: crypto.randomUUID(),
      actor_id: 'alex.dev@tkxel.com',
      action: 'export_open_vault',
      target_id: currentVault.id,
      timestamp: new Date(),
      metadata: { justification, pageCount: fileCount, format: 'zip' },
    };
    setAuditEvents((prev) => [audit, ...prev]);
    setIsExportOpen(false);
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
                      setAuthToken(res.credential);
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
                setAuthToken('dev_admin_token');
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
                setAuthToken('dev_admin_token');
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
                removeAuthToken();
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
      onOpenCreateVault={() => setIsCreateVaultOpen(true)}
      onLogout={() => {
        removeAuthToken();
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
        onOpenMoveToVault={(page) => {
          setPageToMove(page);
          setIsMoveToVaultOpen(true);
        }}
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
            onOpenMoveToVault={() => {
              if (activePage) {
                setPageToMove(activePage);
                setIsMoveToVaultOpen(true);
              }
            }}
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
              Vault Knowledge Base Ready
            </h2>
            <p style={{ maxWidth: '480px', color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 28px 0' }}>
              This vault is empty. Start creating notes, documents, and connecting concepts using [[wiki-links]] to build your knowledge graph.
            </p>
            <button
              onClick={() => handleCreateNewPage()}
              className="btn btn-primary-blue"
              style={{ padding: '10px 22px', fontSize: '0.9rem', gap: '8px' }}
            >
              <Plus size={16} />
              <span>Create first note</span>
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

      <Suspense fallback={null}>
        <CreateVaultModal
          isOpen={isCreateVaultOpen}
          onClose={() => setIsCreateVaultOpen(false)}
          onCreateVault={handleCreateVault}
        />
      </Suspense>

      <Suspense fallback={null}>
        <MoveToVaultModal
          isOpen={isMoveToVaultOpen}
          onClose={() => {
            setIsMoveToVaultOpen(false);
            setPageToMove(null);
          }}
          pageTitle={pageToMove?.title || ''}
          pageId={pageToMove?.id || ''}
          currentVault={currentVault}
          availableVaults={vaults}
          onMovePage={handleMovePageToVault}
        />
      </Suspense>
    </AppShell>
    </GoogleOAuthProvider>
  );
};
