import React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'open' | 'locked' | 'info' | 'success' | 'warning';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  icon,
  className = '',
  children,
  ...props
}) => (
  <span {...props} className={`ui-badge ui-badge--${tone} ${className}`.trim()}>
    {icon}
    {children}
  </span>
);
