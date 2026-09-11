import React, { useState, useRef } from 'react';
import { Sparkles, X, ShieldCheck, Code, AlertCircle, UploadCloud, FileArchive } from 'lucide-react';
import JSZip from 'jszip';
import YAML from 'yaml';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface SkillItem {
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: string;
  timeout_seconds: number;
  system_instructions?: string;
  tool_schema?: string;
  created_at: Date;
}

export interface AddSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSkill: (skill: Omit<SkillItem, 'id' | 'created_at'>) => void;
}

type TabMode = 'manual' | 'upload';

export const AddSkillModal: React.FC<AddSkillModalProps> = ({
  isOpen,
  onClose,
  onAddSkill,
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('manual');
  
  // Manual Form State
  const [name, setName] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState('Python 3.12 Sandboxed');
  const [instructions, setInstructions] = useState(
    '# Skill Instructions\nYou are a specialized AI assistant. Execute analysis and output executive findings.'
  );
  const [schemaJson, setSchemaJson] = useState('{\n  "query": "string",\n  "max_results": 10\n}');
  
  // Upload State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parsedSkill, setParsedSkill] = useState<Omit<SkillItem, 'id' | 'created_at'> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const resetState = () => {
    setActiveTab('manual');
    setName('');
    setDescription('');
    setError(null);
    setUploadError(null);
    setParsedSkill(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim()) {
      setError('Please provide a skill name and description.');
      return;
    }

    const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');

    onAddSkill({
      name: sanitizedName,
      version: version.trim() || 'v1.0',
      description: description.trim(),
      runtime,
      timeout_seconds: 120,
      system_instructions: instructions,
      tool_schema: schemaJson,
    });

    handleClose();
  };

  const processZipFile = async (file: File) => {
    setUploadError(null);
    setParsedSkill(null);

    if (!file.name.endsWith('.zip')) {
      setUploadError('Invalid file type. Please upload a .zip file.');
      return;
    }

    try {
      const zip = await JSZip.loadAsync(file);
      
      // Find SKILL.md (might be in a subdirectory)
      const skillMdFile = Object.values(zip.files).find(f => !f.dir && f.name.endsWith('SKILL.md'));
      
      if (!skillMdFile) {
        setUploadError('Invalid bundle: SKILL.md not found in the ZIP.');
        return;
      }

      const skillMdContent = await skillMdFile.async('string');
      
      // Extract YAML frontmatter
      const match = skillMdContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      let frontmatter: any = {};
      let body = skillMdContent;
      
      if (match) {
        try {
          frontmatter = YAML.parse(match[1]);
          body = match[2].trim();
        } catch (e) {
          console.error("YAML parsing error", e);
        }
      }

      const parsedName = frontmatter.name || file.name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-_]/g, '');
      
      // Find tool.json
      const toolJsonFile = Object.values(zip.files).find(f => !f.dir && f.name.endsWith('tool.json'));
      let extractedSchema = '{}';
      
      if (toolJsonFile) {
        extractedSchema = await toolJsonFile.async('string');
      }

      setParsedSkill({
        name: parsedName,
        version: frontmatter.version || 'v1.0',
        description: frontmatter.description || 'No description provided.',
        runtime: frontmatter.runtime || 'Python 3.12 Sandboxed',
        timeout_seconds: frontmatter.timeout_seconds || 120,
        system_instructions: body,
        tool_schema: extractedSchema
      });

    } catch (err: any) {
      console.error(err);
      setUploadError(`Failed to process ZIP: ${err.message}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processZipFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processZipFile(e.target.files[0]);
    }
  };

  const handleImportParsedSkill = () => {
    if (parsedSkill) {
      onAddSkill(parsedSkill);
      handleClose();
    }
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
        aria-label="Add locked skill"
        tabIndex={-1}
        style={{
          width: '560px',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="var(--locked-accent)" />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Add New Locked Skill
            </h3>
          </div>
          <button type="button" onClick={handleClose} className="btn btn-ghost" style={{ padding: '4px' }} aria-label="Close add skill dialog">
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
          Register a proprietary skill into this Locked Vault. Claude can execute it via MCP under zero-read confidential guarantees.
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', gap: '16px', marginBottom: '8px' }}>
          <button
            onClick={() => setActiveTab('manual')}
            style={{
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'manual' ? '2px solid var(--tk-primary)' : '2px solid transparent',
              color: activeTab === 'manual' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'manual' ? 600 : 500,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Manual Entry
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            style={{
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'upload' ? '2px solid var(--tk-primary)' : '2px solid transparent',
              color: activeTab === 'upload' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'upload' ? 600 : 500,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <UploadCloud size={16} />
            Upload ZIP Bundle
          </button>
        </div>

        {error && activeTab === 'manual' && (
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

        {/* MANUAL TAB */}
        {activeTab === 'manual' && (
          <form onSubmit={handleSubmitManual} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Skill Name & Version */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  SKILL NAME:
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. security-log-auditor"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
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

            {/* Description */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                DESCRIPTION (Visible to Claude for tool selection):
              </label>
              <textarea
                required
                rows={2}
                placeholder="What does this skill do? (e.g. Analyzes AWS VPC flow logs for anomalous traffic spikes)"
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

            {/* System Instructions / Prompt */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                SYSTEM INSTRUCTIONS (SKILL.md prompt):
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

            {/* Schema JSON */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Code size={13} color="var(--text-muted)" />
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  PARAMETER SCHEMA (tool.json input fields):
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
              <button type="button" onClick={handleClose} className="btn btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary-blue">
                Save & Encrypt Skill
              </button>
            </div>
          </form>
        )}

        {/* UPLOAD TAB */}
        {activeTab === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {uploadError && (
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
                <span>{uploadError}</span>
              </div>
            )}

            {!parsedSkill ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--tk-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '40px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.05)' : '#FAFAFA',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'center'
                }}
              >
                <FileArchive size={36} color={isDragging ? 'var(--tk-primary)' : 'var(--text-muted)'} />
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: 'var(--text-primary)' }}>
                    Drop skill .zip bundle here
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    or click to browse from your computer
                  </p>
                </div>
                <input
                  type="file"
                  accept=".zip"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ 
                  padding: '16px', 
                  backgroundColor: '#F8FAFC', 
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <ShieldCheck size={18} color="var(--success)" />
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                      Skill Bundle Parsed Successfully
                    </h4>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '8px', fontSize: '0.85rem' }}>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>NAME:</div>
                    <div style={{ fontWeight: 500 }}>{parsedSkill.name} ({parsedSkill.version})</div>
                    
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>RUNTIME:</div>
                    <div>{parsedSkill.runtime}</div>
                    
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>DESC:</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{parsedSkill.description}</div>
                  </div>
                  
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', marginBottom: '4px' }}>
                      INSTRUCTIONS PREVIEW:
                    </div>
                    <div style={{ 
                      maxHeight: '100px', 
                      overflowY: 'auto', 
                      padding: '8px', 
                      backgroundColor: '#FFFFFF',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                      color: 'var(--text-secondary)'
                    }}>
                      {parsedSkill.system_instructions || 'No instructions found'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" onClick={() => setParsedSkill(null)} className="btn btn-ghost">
                    Cancel
                  </button>
                  <button type="button" onClick={handleImportParsedSkill} className="btn btn-primary-blue">
                    Import Skill
                  </button>
                </div>
              </div>
            )}
            
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
              <span>Skill resources and scripts will be securely stored and never exposed to consumers.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
