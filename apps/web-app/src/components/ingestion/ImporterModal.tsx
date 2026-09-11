import React, { useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle } from 'lucide-react';
import { MarkdownImporter, ImportResult } from '@tkxel-vault/vault-core/markdown';
import { useModalAccessibility } from '../ui/useModalAccessibility.js';

export interface ImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (result: ImportResult) => void;
}

export const ImporterModal: React.FC<ImporterModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const importer = new MarkdownImporter();

      let totalRes: ImportResult = {
        pages: [],
        totalFilesProcessed: 0,
        totalWikiLinksFound: 0,
        totalTagsFound: 0,
        skippedFiles: []
      };

      const fileMap = new Map<string, string>();
      const zipPromises = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith('.zip')) {
          zipPromises.push(
            file.arrayBuffer().then(buf => importer.importFromZip(new Uint8Array(buf)))
          );
        } else {
          fileMap.set(file.name, await file.text());
        }
      }

      if (fileMap.size > 0) {
        const mapRes = importer.importFromMap(fileMap);
        totalRes.pages.push(...mapRes.pages);
        totalRes.totalFilesProcessed += mapRes.totalFilesProcessed;
        totalRes.totalWikiLinksFound += mapRes.totalWikiLinksFound;
        totalRes.totalTagsFound += mapRes.totalTagsFound;
        totalRes.skippedFiles.push(...mapRes.skippedFiles);
      }

      if (zipPromises.length > 0) {
        const zipResults = await Promise.all(zipPromises);
        for (const res of zipResults) {
          totalRes.pages.push(...res.pages);
          totalRes.totalFilesProcessed += res.totalFilesProcessed;
          totalRes.totalWikiLinksFound += res.totalWikiLinksFound;
          totalRes.totalTagsFound += res.totalTagsFound;
          totalRes.skippedFiles.push(...res.skippedFiles);
        }
      }

      setImportResult(totalRes);
    } catch (e: any) {
      setError(e?.message || 'Failed to process import files.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = () => {
    if (importResult) {
      onImportComplete(importResult);
      onClose();
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
        aria-label="Import Markdown notes"
        tabIndex={-1}
        style={{
          width: '520px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          backgroundColor: '#FFFFFF',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={18} color="var(--tk-primary)" />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Import Markdown or Obsidian Vault
            </h3>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" style={{ padding: '4px' }} aria-label="Close import dialog">
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
          Upload Markdown files, Obsidian vault archives, or JSZip Skill Bundles in bulk.
        </p>

        {/* Drag and Drop Box */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose Markdown files or a ZIP archive to import"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFileUpload(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragOver ? 'var(--tk-primary)' : 'var(--border-medium)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '36px 20px',
            textAlign: 'center',
            backgroundColor: dragOver ? 'var(--open-bg)' : '#F8FAFC',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.md,.zip';
            input.onchange = (e: any) => handleFileUpload(e.target.files);
            input.click();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.currentTarget.click();
            }
          }}
        >
          <Upload
            size={32}
            color="var(--tk-primary)"
            style={{ margin: '0 auto 10px' }}
          />
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Drag & drop files here, or click to browse
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Supports .md files, Obsidian .zip archives, and JSZip skill bundles
          </div>
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
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Import Results */}
        {importResult && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#F0FDF4',
              border: '1px solid #BBF7D0',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16A34A', fontWeight: 700, fontSize: '0.85rem' }}>
              <CheckCircle size={16} />
              <span>Archive Ready to Import</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#15803D' }}>
              • {importResult.totalFilesProcessed} Markdown notes ready
            </div>
            <div style={{ fontSize: '0.8rem', color: '#15803D' }}>
              • {importResult.totalWikiLinksFound} Wiki-links detected
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleConfirmImport}
            disabled={!importResult || loading}
            className="btn btn-primary-blue"
          >
            {loading ? 'Importing...' : 'Import to Vault'}
          </button>
        </div>
      </div>
    </div>
  );
};
