import React, { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './Button.js';

export interface ActionMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export interface ActionMenuProps {
  label?: string;
  items: ActionMenuItem[];
  compact?: boolean;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({ label = 'More', items, compact = false }) => {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<'first' | 'last'>('first');

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.requestAnimationFrame(() => {
      const menuItems = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
      const target = initialFocusRef.current === 'last' ? menuItems?.[menuItems.length - 1] : menuItems?.[0];
      target?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + direction + menuItems.length) % menuItems.length;
      menuItems[nextIndex]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      menuItems[event.key === 'Home' ? 0 : menuItems.length - 1]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="ui-menu">
      <Button
        ref={triggerRef}
        variant="quiet"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={compact ? label : undefined}
        leadingIcon={<MoreHorizontal size={16} aria-hidden="true" />}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          }
        }}
      >
        {!compact && label}
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="ui-menu__content"
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separatorBefore && <div className="ui-menu__separator" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={`ui-menu__item ${item.danger ? 'ui-menu__item--danger' : ''}`.trim()}
                onClick={() => {
                  item.onSelect();
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
