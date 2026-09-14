// Input primitive — minimal skeleton.

import type { InputHTMLAttributes, ReactElement } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. */
  label?: string;
}

/**
 * Minimal input primitive. Phase 2 wires design tokens.
 */
export function Input({ label, className, id, ...rest }: InputProps): ReactElement {
  const inputClass = className ? `dd-input ${className}` : 'dd-input';
  const inputId = id ?? `dd-input-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <label htmlFor={inputId} className="dd-input-label">
      {label && <span>{label}</span>}
      <input id={inputId} className={inputClass} {...rest} />
    </label>
  );
}
