import React from 'react';
import { ArrowRight, ExternalLink, Link2, X } from 'lucide-react';
import { Page } from '@tkxel-vault/types';
import { Button, IconButton } from '../ui/index.js';
import { getCategoryColor, humanizeNodeTitle } from './KnowledgeGraph.js';

interface GraphInspectorProps {
  page: Page;
  incoming: Page[];
  outgoing: Page[];
  onOpen: () => void;
  onConnect?: () => void;
  onSelect: (pageId: string) => void;
  onClose: () => void;
}

export const GraphInspector: React.FC<GraphInspectorProps> = ({ page, incoming, outgoing, onOpen, onConnect, onSelect, onClose }) => (
  <aside className="graph-inspector" aria-label="Selected note details">
    <div className="graph-inspector__header">
      <div className="graph-inspector__eyebrow"><i style={{ background: getCategoryColor(page.type) }} />{page.type}</div>
      <IconButton label="Close selected note details" icon={<X size={18} />} onClick={onClose} />
    </div>
    <h2>{humanizeNodeTitle(page.title)}</h2>
    <p className="graph-inspector__stored-title">Stored as {page.title}</p>
    <div className="graph-inspector__tags">
      {page.tags.length ? page.tags.map((tag) => <span key={tag}>#{tag}</span>) : <span>No tags</span>}
    </div>
    <div className="graph-inspector__actions">
      <Button leadingIcon={<ExternalLink size={15} />} onClick={onOpen}>Open note</Button>
      {onConnect && <Button variant="secondary" leadingIcon={<Link2 size={15} />} onClick={onConnect}>Connect</Button>}
    </div>
    <GraphLinkList title="Links to this note" pages={incoming} onSelect={onSelect} />
    <GraphLinkList title="Links from this note" pages={outgoing} onSelect={onSelect} />
  </aside>
);

const GraphLinkList: React.FC<{ title: string; pages: Page[]; onSelect: (id: string) => void }> = ({ title, pages, onSelect }) => (
  <section className="graph-inspector__links">
    <h3>{title}<span>{pages.length}</span></h3>
    {pages.length
      ? pages.map((page) => <button type="button" key={page.id} onClick={() => onSelect(page.id)}>{humanizeNodeTitle(page.title)}<ArrowRight size={14} /></button>)
      : <p>None yet.</p>}
  </section>
);
