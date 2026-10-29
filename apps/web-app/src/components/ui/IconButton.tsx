import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { Button, ButtonProps } from './Button.js';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leadingIcon' | 'trailingIcon'> {
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className = '', ...props },
  ref,
) {
  return (
    <Button
      {...props}
      ref={ref}
      aria-label={label}
      title={props.title ?? label}
      className={`ui-icon-button ${className}`.trim()}
    >
      {icon}
    </Button>
  );
});
