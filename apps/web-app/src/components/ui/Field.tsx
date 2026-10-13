import React, { useId } from 'react';
import type { ReactElement } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  className?: string;
}

export const Field: React.FC<FieldProps> = ({ label, hint, children, className = '' }) => {
  const fieldId = useId();
  const hintId = useId();
  return (
    <div className={`ui-field ${className}`.trim()}>
      <label className="ui-field__label" htmlFor={fieldId}>{label}</label>
      {React.cloneElement(children, {
        id: children.props.id ?? fieldId,
        'aria-describedby': hint ? hintId : children.props['aria-describedby'],
      })}
      {hint && <span id={hintId} className="ui-field__hint">{hint}</span>}
    </div>
  );
};
