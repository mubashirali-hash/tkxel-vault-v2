import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Cpu,
  Terminal,
  Shield,
  Bot,
  Lock,
  BookOpen,
  Code,
  Layers,
} from 'lucide-react';
import { Vault } from '@tkxel-vault/types';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface McpConnectModalProps {
  isOpen: boolean;
  currentVault: Vault;
  onClose: () => void;
}

type ClientTab = 'claude-desktop' | 'cursor' | 'remote-http' | 'tools';

export const McpConnectModal: React.FC<McpConnectModalProps> = ({
  isOpen,
  currentVault,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ClientTab>('claude-desktop');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const dialogRef = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  const isOpenVault = currentVault.mode === 'open';

  // Check if local MCP gateway is active
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setGatewayStatus('checking');

    fetch('http://localhost:3002/api/health', { method: 'GET' })
      .then((res) => {
        if (res.ok && isMounted) setGatewayStatus('online');
        else if (isMounted) setGatewayStatus('offline');
      })
      .catch(() => {
        if (isMounted) setGatewayStatus('offline');
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Portable placeholder: replace with a deployment or checkout root.
  const stdioScriptPath = '<TKXEL_VAULT_ROOT>/services/mcp-gateway/dist/stdio.js';

  const claudeDesktopConfig = `{
  "mcpServers": {
    "tkxel-vault": {
      "command": "node",
      "args": [
        "${stdioScriptPath}"
      ]
    }
  }
}`;

  const cursorConfig = `{
  "mcpServers": {
    "tkxel-vault": {
      "command": "node",
      "args": [
        "${stdioScriptPath}"
      ]
    }
  }
}`;

  const curlTestCommand = `node "<TKXEL_VAULT_ROOT>/services/mcp-gateway/dist/stdio.js"`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 600,
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="clean-panel modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Connect MCP client"
        tabIndex={-1}
        style={{
          width: '740px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-modal)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FAFCFF',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(7, 85, 233, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--tk-primary)',
              }}
            >
              <Cpu size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--tk-secondary)', margin: 0 }}>
                  Integrations
                </h3>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(7, 85, 233, 0.1)',
                    color: 'var(--tk-primary)',
                  }}
                >
                  MCP 2025-11-25
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Integrate Claude, Cursor, or Codex directly with your encrypted knowledge graph
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Live Gateway Indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '0.72rem',
                fontWeight: 600,
                backgroundColor:
                  gatewayStatus === 'online'
                    ? '#ECFDF5'
                    : gatewayStatus === 'offline'
                    ? '#FEF2F2'
                    : '#F8FAFC',
                color:
                  gatewayStatus === 'online'
                    ? '#059669'
                    : gatewayStatus === 'offline'
                    ? '#DC2626'
                    : 'var(--text-muted)',
                border: `1px solid ${
                  gatewayStatus === 'online'
                    ? '#A7F3D0'
                    : gatewayStatus === 'offline'
                    ? '#FECACA'
                    : 'var(--border-subtle)'
                }`,
              }}
              title="tkxel Vault backend status"
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor:
                    gatewayStatus === 'online'
                      ? '#10B981'
                      : gatewayStatus === 'offline'
                      ? '#EF4444'
                      : '#94A3B8',
                }}
              />
              {gatewayStatus === 'online'
                ? 'Backend Ready'
                : gatewayStatus === 'offline'
                ? 'Offline (Run pnpm dev)'
                : 'Pinging...'}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              style={{ padding: '6px', color: 'var(--text-muted)' }}
              title="Close modal"
              aria-label="Close integrations dialog"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Client Selector Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Integration setup"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (currentIndex < 0) return;
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            tabs[(currentIndex + direction + tabs.length) % tabs.length]?.click();
            tabs[(currentIndex + direction + tabs.length) % tabs.length]?.focus();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: '#FFFFFF',
            gap: '8px',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'claude-desktop'}
            aria-controls="integration-panel-claude-desktop"
            onClick={() => setActiveTab('claude-desktop')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 12px',
              fontSize: '0.82rem',
              fontWeight: activeTab === 'claude-desktop' ? 700 : 500,
              color: activeTab === 'claude-desktop' ? 'var(--tk-primary)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === 'claude-desktop' ? 'var(--tk-primary)' : 'transparent'}`,
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Bot size={15} />
            Claude Desktop
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cursor'}
            aria-controls="integration-panel-cursor"
            onClick={() => setActiveTab('cursor')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 12px',
              fontSize: '0.82rem',
              fontWeight: activeTab === 'cursor' ? 700 : 500,
              color: activeTab === 'cursor' ? 'var(--tk-primary)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === 'cursor' ? 'var(--tk-primary)' : 'transparent'}`,
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Code size={15} />
            Cursor / Codex / IDEs
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'remote-http'}
            aria-controls="integration-panel-remote-http"
            onClick={() => setActiveTab('remote-http')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 12px',
              fontSize: '0.82rem',
              fontWeight: activeTab === 'remote-http' ? 700 : 500,
              color: activeTab === 'remote-http' ? 'var(--tk-primary)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === 'remote-http' ? 'var(--tk-primary)' : 'transparent'}`,
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Terminal size={15} />
            Claude.ai / Remote HTTP
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tools'}
            aria-controls="integration-panel-tools"
            onClick={() => setActiveTab('tools')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 12px',
              fontSize: '0.82rem',
              fontWeight: activeTab === 'tools' ? 700 : 500,
              color: activeTab === 'tools' ? 'var(--tk-primary)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${activeTab === 'tools' ? 'var(--tk-primary)' : 'transparent'}`,
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Layers size={15} />
            Available Tools ({isOpenVault ? '5' : '2'})
          </button>
        </div>

        {/* Body Content Area */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Active Vault Mode Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: isOpenVault ? '#F0F9FF' : '#FFF7ED',
              border: `1px solid ${isOpenVault ? '#BAE6FD' : '#FFEDD5'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isOpenVault ? <BookOpen size={16} color="var(--tk-primary)" /> : <Lock size={16} color="var(--locked-accent)" />}
              <div>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isOpenVault ? 'var(--tk-primary)' : 'var(--locked-accent)' }}>
                  Active Target Vault: {currentVault.name}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                  ({isOpenVault ? 'Open Knowledge Graph' : 'Zero-Read Proprietary Skills Store'})
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: isOpenVault ? 'var(--tk-primary)' : 'var(--locked-accent)',
              }}
            >
              {isOpenVault ? 'Full Markdown & Context Retrieval' : 'Sandboxed In-Memory Execution Only'}
            </span>
          </div>

          {/* TAB 1: CLAUDE DESKTOP */}
          {activeTab === 'claude-desktop' && (
            <div id="integration-panel-claude-desktop" role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Connect Anthropic Claude Desktop to query your notes, discover bidirectional links, or trigger locked skills via natural conversation.
              </div>

              {/* Step 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  <span style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'var(--tk-primary)', color: '#FFFFFF', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    1
                  </span>
                  Open your Claude Desktop configuration file:
                </div>
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>%APPDATA%\Claude\claude_desktop_config.json</span>
                  <button
                    onClick={() => copyToClipboard('%APPDATA%\\Claude\\claude_desktop_config.json', 'path')}
                    className="btn btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '0.72rem', height: '24px' }}
                  >
                    {copiedKey === 'path' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                    {copiedKey === 'path' ? 'Copied' : 'Copy Path'}
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'var(--tk-primary)', color: '#FFFFFF', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      2
                    </span>
                    Paste this configuration:
                  </div>

                  <button
                    onClick={() => copyToClipboard(claudeDesktopConfig, 'claude')}
                    className="btn btn-primary-blue"
                    style={{ padding: '4px 10px', fontSize: '0.78rem', height: '28px' }}
                  >
                    {copiedKey === 'claude' ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === 'claude' ? 'Config Copied!' : 'Copy Config'}
                  </button>
                </div>

                <pre
                  style={{
                    margin: 0,
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#0F172A',
                    color: '#E2E8F0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    overflowX: 'auto',
                    lineHeight: 1.45,
                  }}
                >
                  {claudeDesktopConfig}
                </pre>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                <span style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#E2E8F0', color: 'var(--text-primary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  3
                </span>
                <span>Restart Claude Desktop. The hammer tool icon will appear with your tkxel Vault tools!</span>
              </div>
            </div>
          )}

          {/* TAB 2: CURSOR & IDES */}
          {activeTab === 'cursor' && (
            <div id="integration-panel-cursor" role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Connect Cursor or any IDE supporting MCP to let AI coding agents inspect notes, system designs, and team context during development.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Add to Cursor MCP Settings (.cursor/mcp.json):
                  </span>
                  <button
                    onClick={() => copyToClipboard(cursorConfig, 'cursor')}
                    className="btn btn-primary-blue"
                    style={{ padding: '4px 10px', fontSize: '0.78rem', height: '28px' }}
                  >
                    {copiedKey === 'cursor' ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === 'cursor' ? 'Copied!' : 'Copy Config'}
                  </button>
                </div>

                <pre
                  style={{
                    margin: 0,
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#0F172A',
                    color: '#E2E8F0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    overflowX: 'auto',
                    lineHeight: 1.45,
                  }}
                >
                  {cursorConfig}
                </pre>
              </div>

              {/* Command line quick test */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Quick CLI Test Command:
                  </span>
                  <button
                    onClick={() => copyToClipboard(curlTestCommand, 'clitest')}
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: '0.75rem', height: '26px' }}
                  >
                    {copiedKey === 'clitest' ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                    {copiedKey === 'clitest' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {curlTestCommand}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: REMOTE STREAMABLE HTTP */}
          {activeTab === 'remote-http' && (
            <div id="integration-panel-remote-http" role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                For Claude.ai Custom Connectors, cloud multi-agent frameworks, and remote orchestrators using the Anthropic Streamable HTTP protocol.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="clean-panel" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    MCP PROTOCOL ENDPOINT
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--tk-primary)', fontFamily: 'var(--font-mono)' }}>
                    &lt;MCP_GATEWAY_URL&gt;/mcp
                  </div>
                </div>

                <div className="clean-panel" style={{ padding: '12px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    PROTOCOL STANDARD
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Anthropic Streamable HTTP (2025-11-25)
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Authentication & Headers:
                </span>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  Authorization: Bearer &lt;corporate-sso-jwt&gt;<br />
                  Content-Type: application/json<br />
                  X-MCP-Protocol-Version: 2025-11-25
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  User claims, roles, and vault access are dynamically evaluated per request with sub-60s revocation.
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AVAILABLE TOOLS CATALOG */}
          {activeTab === 'tools' && (
            <div id="integration-panel-tools" role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {isOpenVault ? (
                  <span>
                    When connected to this <strong>Open Vault</strong>, Claude has access to 5 retrieval and contribution tools:
                  </span>
                ) : (
                  <span>
                    When connected to this <strong>Locked Vault</strong>, Claude operates under zero-read constraints (no raw Markdown exposure):
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {isOpenVault ? (
                  <>
                    <div className="clean-panel" style={{ padding: '10px 14px', display: 'flex', gap: '10px' }}>
                      <code style={{ color: 'var(--tk-primary)', fontWeight: 700, fontSize: '0.82rem' }}>search(query)</code>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Search notes using hybrid lexical (BM25) and semantic vector matching.
                      </span>
                    </div>

                    <div className="clean-panel" style={{ padding: '10px 14px', display: 'flex', gap: '10px' }}>
                      <code style={{ color: 'var(--tk-primary)', fontWeight: 700, fontSize: '0.82rem' }}>get_page(title)</code>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Read full markdown document, tags, front matter, and backlinks.
                      </span>
                    </div>

                    <div className="clean-panel" style={{ padding: '10px 14px', display: 'flex', gap: '10px' }}>
                      <code style={{ color: 'var(--tk-primary)', fontWeight: 700, fontSize: '0.82rem' }}>get_links(page_id)</code>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Explore 1-hop and 2-hop bidirectional graph connections.
                      </span>
                    </div>

                    <div className="clean-panel" style={{ padding: '10px 14px', display: 'flex', gap: '10px' }}>
                      <code style={{ color: 'var(--tk-primary)', fontWeight: 700, fontSize: '0.82rem' }}>get_context(page_id)</code>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Assemble a unified RAG context package with citations for high-accuracy reasoning.
                      </span>
                    </div>

                    <div className="clean-panel" style={{ padding: '10px 14px', display: 'flex', gap: '10px' }}>
                      <code style={{ color: 'var(--tk-primary)', fontWeight: 700, fontSize: '0.82rem' }}>add_note(title, content)</code>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Allow Claude to draft new notes or append findings to the knowledge vault.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="clean-panel" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ color: 'var(--locked-accent)', fontWeight: 700, fontSize: '0.82rem' }}>run_skill(skill_name, params)</code>
                        <span className="badge badge-locked" style={{ fontSize: '0.65rem' }}>Zero-Read Sandboxed</span>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Executes a locked proprietary skill in ephemeral memory. Instructions are wiped after execution and never revealed to the user.
                      </span>
                    </div>

                    <div className="clean-panel" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <code style={{ color: 'var(--locked-accent)', fontWeight: 700, fontSize: '0.82rem' }}>ask_vault(question)</code>
                        <span className="badge badge-locked" style={{ fontSize: '0.65rem' }}>Anti-Exfiltration Guard</span>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Ask questions against locked proprietary playbooks. Output passes through an anti-exfiltration filter blocking prompt leakage.
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: currentVault.data_key_id ? 'var(--tk-primary)' : '#9CA3AF' }}>
            <Shield size={13} color={currentVault.data_key_id ? "var(--tk-primary)" : "#9CA3AF"} />
            <span>
              {currentVault.data_key_id 
                ? "Corporate SSO & AES-256-GCM Cryptographic Boundary Enforced"
                : "Warning: Target vault does not have an active KMS data key."}
            </span>
          </div>

          <button onClick={onClose} className="btn btn-secondary-white" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
