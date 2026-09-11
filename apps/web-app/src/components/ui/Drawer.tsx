import React, { useId } from 'react';
import type { ReactNode } from 'react';
import { useModalAccessibility } from './useModalAccessibility.js';

export interface DrawerProps {
  open: boolean;
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({ open, label, children, onClose, className = '' }) => {
  const labelId = useId();
  const drawerRef = useModalAccessibility<HTMLElement>(open, onClose);

  if (!open) return null;

  return (
    <div className="ui-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        ref={drawerRef}
        className={`ui-drawer ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
      >
        <span id={labelId} className="sr-only">{label}</span>
        {children}
      </aside>
    </div>
  );
};
