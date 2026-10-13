import React from 'react';
import { Page } from '@tkxel-vault/types';
import { KnowledgeGraph } from './KnowledgeGraph.js';
import { Network } from 'lucide-react';

export interface LocalGraphViewProps {
  focalPage: Page;
  allPages: Page[];
  allLinks: Array<{ from_page_id: string; to_page_id: string }>;
  onSelectPage: (pageId: string) => void;
}

/**
 * Local Neighborhood Graph: 2-hop radius around active page.
 */
export const LocalGraphView: React.FC<LocalGraphViewProps> = ({
  focalPage,
  allPages,
  allLinks,
  onSelectPage,
}) => {
  const neighborhoodPageIds = new Set<string>([focalPage.id]);

  allLinks.forEach((link) => {
    if (link.from_page_id === focalPage.id) neighborhoodPageIds.add(link.to_page_id);
    if (link.to_page_id === focalPage.id) neighborhoodPageIds.add(link.from_page_id);
  });

  const oneHopIds = Array.from(neighborhoodPageIds);
  allLinks.forEach((link) => {
    if (oneHopIds.includes(link.from_page_id)) neighborhoodPageIds.add(link.to_page_id);
    if (oneHopIds.includes(link.to_page_id)) neighborhoodPageIds.add(link.from_page_id);
  });

  const localPages = allPages.filter((p) => neighborhoodPageIds.has(p.id));
  const localLinks = allLinks.filter(
    (l) => neighborhoodPageIds.has(l.from_page_id) && neighborhoodPageIds.has(l.to_page_id)
  );

  return (
    <div
      className="clean-panel"
      style={{
        width: '100%',
        height: '320px',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        backgroundColor: '#FFFFFF',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '14px',
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--open-bg)',
          border: '1px solid var(--open-border)',
        }}
      >
        <Network size={14} color="var(--tk-primary)" />
        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            color: 'var(--tk-primary)',
          }}
        >
          LOCAL GRAPH ({localPages.length} CONNECTED)
        </span>
      </div>

      <KnowledgeGraph pages={localPages} links={localLinks} onSelectPage={onSelectPage} activePageId={focalPage.id} compact />
    </div>
  );
};
