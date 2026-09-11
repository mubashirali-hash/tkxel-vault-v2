import React, { useState, useEffect } from 'react';
import { Page, Vault } from '@tkxel-vault/types';
import { SkillItem } from './AddSkillModal.js';
import { Sparkles, X, ShieldCheck, Code, AlertCircle, FileText } from 'lucide-react';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface ConvertNoteToSkillModalProps {
  isOpen: boolean;
  note: Page | null;
  lockedVaults: Vault[];
  onClose: () => void;
  onConvert: (params: {
    targetVaultId: string;
    skill: Omit<SkillItem, 'id' | 'created_at'>;
    deleteOriginalNote: boolean;
  }) => void;
}

export const ConvertNoteToSkillModal: React.FC<ConvertNoteToSkillModalProps> = ({
  isOpen,
  note,
  lockedVaults,
  onClose,
  onConvert,
}) => {
  const [targetVaultId, setTargetVaultId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [version, setVersion] = useState<string>('v1.0');
  const [description, setDescription] = useState<string>('');
  const [runtime, setRuntime] = useState<string>('Python 3.12 Sandboxed');
  const [instructions, setInstructions] = useState<string>('');
  const [schemaJson, setSchemaJson] = useState<string>('{\n  "query": "string",\n  "format": "markdown"\n}');
  const [deleteOriginalNote, setDeleteOriginalNote] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const dialogOpen = isOpen && Boolean(note);
  const dialogRef = useModalAccessibility<HTMLDivElement>(dialogOpen, onClose);

  // Auto-populate when note changes
  useEffect(() => {
    if (note) {
      // 1. Generate clean slug from title
      const slug = note.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      setName(slug || 'proprietary-skill');

      // 2. Use public catalog metadata without copying protected note content.
      const rawBody = (note.front_matter.body as string) || '';
      setDescription(`Protected capability created from ${note.title}.`);

      // 3. System Instructions: Full note markdown body
      setInstructions(
        rawBody ||
          `# ${note.title}\n\nExecute specialized analysis based on this proprietary playbook.`
      );

      // Check for tool schema in frontmatter from JSZip imports
      if (note.front_matter.tool_schema && typeof note.front_matter.tool_schema === 'string') {
        setSchemaJson(note.front_matter.tool_schema);
      } else {
        setSchemaJson('{\n  "query": "string",\n  "format": "markdown"\n}');
      }

      // 4. Default target vault
      if (lockedVaults.length > 0) {
        setTargetVaultId(lockedVaults[0].id);
      }
      setDeleteOriginalNote(false);
      setError(null);
    }
  }, [note, lockedVaults]);

  if (!isOpen || !note) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a valid skill name.');
      return;
    }
    if (!targetVaultId) {
      setError('Please select a target locked vault.');
      return;
    }

    try {
      JSON.parse(schemaJson);
    } catch {
      setError('Invalid parameter schema JSON. Please correct syntax before proceeding.');
      return;
    }

    const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

    onConvert({
      targetVaultId,
      skill: {
        name: sanitizedName,
        version: version.trim() || 'v1.0',
        description: description.trim(),
        runtime,
        timeout_seconds: 120,
        system_instructions: instructions,
        tool_schema: schemaJson,
      },
      deleteOriginalNote,
    });

    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
    >
      <div
        ref={dialogRef}
        className="clean-panel modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Deploy agent to locked skills"
        tabIndex={-1}
        style={{
          width: '620px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          backgroundColor: '#FFFFFF',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'var(--locked-bg)',
                border: '1px solid var(--locked-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={18} color="var(--locked-accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Deploy Agent to Locked Skills
              </h3>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Deploy your current agent draft from the Workbench as an immutable, zero-read skill in the Store.
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ padding: '4px' }} aria-label="Close deploy agent dialog">
            <X size={16} />
          </button>
        </div>

        {/* Source Note Badge */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--open-bg)',
            border: '1px solid var(--open-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} color="var(--tk-primary)" />
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                Source Draft:
              </span>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {note.title}
              </div>
            </div>
          </div>
          <span className="badge badge-open" style={{ textTransform: 'capitalize' }}>
            {note.type}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: '8px',
              padding: '10px 12px',
              backgroundColor: '#FEF2F2',
              color: '#DC2626',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              border: '1px solid #FECACA',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Target Vault Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              DESTINATION LOCKED VAULT:
            </label>
            <select
              value={targetVaultId}
              onChange={(e) => setTargetVaultId(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                backgroundColor: '#FFF7ED',
                color: '#9A3412',
                fontWeight: 600,
              }}
            >
              {lockedVaults.map((v) => (
                <option key={v.id} value={v.id}>
                  🔒 {v.name} (Zero-Read Store)
                </option>
              ))}
            </select>
          </div>

          {/* Skill Name & Version */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                SKILL NAME (Claude Tool Identifier):
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                VERSION:
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          </div>

          {/* Description for Claude */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              CLAUDE TOOL DESCRIPTION (Used for Autonomous MCP Tool Selection):
            </label>
            <textarea
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                resize: 'none',
              }}
            />
          </div>

          {/* Runtime */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              SANDBOX RUNTIME:
            </label>
            <select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
              }}
            >
              <option value="Python 3.12 Sandboxed">Python 3.12 Sandboxed (RAM-only)</option>
              <option value="Node.js 20 Sandboxed">Node.js 20 Sandboxed (RAM-only)</option>
              <option value="Bash Shell (Restricted)">Bash Shell (Restricted Sandbox)</option>
            </select>
          </div>

          {/* System Instructions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              SYSTEM INSTRUCTIONS (SKILL.md prompt compiled from Note):
            </label>
            <textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                resize: 'none',
              }}
            />
          </div>

          {/* Parameter Schema */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Code size={13} color="var(--text-muted)" />
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                PARAMETER SCHEMA (tool.json input signature):
              </label>
            </div>
            <textarea
              rows={3}
              value={schemaJson}
              onChange={(e) => setSchemaJson(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                resize: 'none',
              }}
            />
          </div>

          {/* Retention Option */}
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: deleteOriginalNote ? '#FEF2F2' : '#F8FAFC',
              border: `1px solid ${deleteOriginalNote ? '#FECACA' : 'var(--border-subtle)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={deleteOriginalNote}
                onChange={(e) => setDeleteOriginalNote(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: deleteOriginalNote ? '#DC2626' : 'var(--text-primary)' }}>
                Remove original note from Open Vault upon conversion
              </span>
            </label>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '26px' }}>
              {deleteOriginalNote
                ? 'The open note will be deleted to enforce zero-read secrecy. Staff will only be able to execute the skill via Claude.'
                : 'The open note will remain readable in this vault as public reference documentation.'}
            </span>
          </div>

          {/* Security Notice */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}
          >
            <ShieldCheck size={16} color="var(--tk-primary)" />
            <span>Encrypted at rest with AES-256-GCM. Source code is never exposed to Claude users.</span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary-blue"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: 'var(--locked-accent)',
                borderColor: 'var(--locked-accent)',
              }}
            >
              <Sparkles size={15} />
              <span>Convert & Encrypt into Skills Store</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
