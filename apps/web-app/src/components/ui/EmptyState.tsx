import React from 'react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action, compact = false }) => (
  <div className={`ui-empty-state ${compact ? 'ui-empty-state--compact' : ''}`.trim()}>
    {icon && <div className="ui-empty-state__icon" aria-hidden="true">{icon}</div>}
    <h2>{title}</h2>
    <p>{description}</p>
    {action}
  </div>
);
