import React, { useState } from 'react';
import { Clock, Plus, User } from 'lucide-react';
import { TimelineEntry } from '@tkxel-vault/types';

export interface TimelineViewProps {
  entries: TimelineEntry[];
  onAddEntry: (text: string) => void;
  canEdit: boolean;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  entries,
  onAddEntry,
  canEdit,
}) => {
  const [newText, setNewText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    onAddEntry(newText.trim());
    setNewText('');
  };

  return (
    <div style={{ marginTop: '36px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={16} color="var(--tk-primary)" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Note Updates & History
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ({entries.length} entries)
          </span>
        </div>
      </div>

      {/* Entry List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--tk-primary)', fontWeight: 600 }}>
                <User size={13} />
                <span>{entry.created_by}</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {entry.date}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
              {entry.entry_text}
            </p>
          </div>
        ))}
      </div>

      {/* Authoring Form */}
      {canEdit && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Add update or observation to note history..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
          <button type="submit" className="btn btn-primary-blue" disabled={!newText.trim()}>
            <Plus size={15} />
            Add Update
          </button>
        </form>
      )}
    </div>
  );
};
