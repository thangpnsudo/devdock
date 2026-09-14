// Button primitive — minimal skeleton.

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Optional icon (rendered before children). */
  icon?: ReactNode;
}

/**
 * Minimal button primitive. Phase 2 wires design tokens.
 */
export function Button({
  variant = 'primary',
  icon,
  children,
  className,
  ...rest
}: ButtonProps): ReactElement {
  const variantClass = `dd-btn dd-btn--${variant}`;
  const finalClass = className ? `${variantClass} ${className}` : variantClass;
  return (
    <button type="button" className={finalClass} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
