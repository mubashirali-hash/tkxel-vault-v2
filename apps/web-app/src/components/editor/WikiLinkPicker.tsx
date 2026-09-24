import React, { useState, useEffect } from 'react';
import { FileText, Plus, X, CornerDownLeft } from 'lucide-react';
import { Page } from '@tkxel-vault/types';

export interface WikiLinkPickerProps {
  availablePages: Page[];
  query: string;
  onSelectLink: (title: string) => void;
  onClose: () => void;
}

export const WikiLinkPicker: React.FC<WikiLinkPickerProps> = ({
  availablePages,
  query,
  onSelectLink,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = availablePages.filter(
    (p) =>
      p.title.toLowerCase().includes(query.toLowerCase()) ||
      p.aliases?.some((a) => a.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0 && filtered[selectedIndex]) {
          onSelectLink(filtered[selectedIndex].title);
        } else {
          onSelectLink(query.trim() || 'New Page');
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [filtered, selectedIndex, query, onSelectLink, onClose]);

  return (
    <div
      className="clean-panel modal-content wiki-link-picker"
      role="listbox"
      aria-label="Link to note"
      style={{
        width: 'min(340px, calc(100vw - 24px))',
        maxHeight: '270px',
        overflowY: 'auto',
        padding: '6px',
        boxShadow: '0 12px 30px -4px rgba(0, 0, 0, 0.18), 0 4px 12px -2px rgba(0, 0, 0, 0.08)',
        border: '1px solid var(--tk-primary, #0755e9)',
        backgroundColor: '#FFFFFF',
        borderRadius: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--tk-primary)',
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          LINK TO NOTE [[{query}...]] (↑/↓ + Enter)
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close link suggestions"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={13} />
        </button>
      </div>

      {filtered.length > 0 ? (
        filtered.map((page, idx) => {
          const isHighlighted = idx === selectedIndex;
          return (
            <button
              type="button"
              role="option"
              aria-selected={isHighlighted}
              key={page.id}
              onClick={() => onSelectLink(page.title)}
              onMouseEnter={() => setSelectedIndex(idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                marginBottom: '2px',
                backgroundColor: isHighlighted ? 'var(--open-bg)' : 'transparent',
                border: isHighlighted ? '1px solid var(--open-border)' : '1px solid transparent',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={15} color={isHighlighted ? 'var(--tk-primary)' : 'var(--text-muted)'} />
                <span style={{ fontSize: '0.85rem', fontWeight: isHighlighted ? 700 : 500, color: 'var(--text-primary)' }}>
                  {page.title}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                  {page.type}
                </span>
                <CornerDownLeft size={11} color="var(--text-muted)" />
              </div>
            </button>
          );
        })
      ) : (
        <button
          type="button"
          role="option"
          aria-selected="true"
          onClick={() => onSelectLink(query || 'New Page')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--tk-primary)',
            backgroundColor: 'var(--open-bg)',
            border: '1px solid var(--open-border)',
            width: '100%',
          }}
        >
          <Plus size={14} />
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Create "[[{query || 'New Page'}]]" (Enter)</span>
        </button>
      )}
    </div>
  );
};
