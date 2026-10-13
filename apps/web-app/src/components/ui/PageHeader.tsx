import React from 'react';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, badge, actions }) => (
  <header className="ui-page-header">
    <div className="ui-page-header__copy">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 className="ui-page-header__title">{title}</h1>
        {badge}
      </div>
      {description && <p className="ui-page-header__description">{description}</p>}
    </div>
    {actions}
  </header>
);
