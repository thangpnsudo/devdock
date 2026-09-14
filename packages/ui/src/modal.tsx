// Modal primitive — minimal skeleton.

import type { ReactElement, ReactNode } from 'react';

export interface ModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Modal title (used in the header). */
  title?: string;
  /** Callback fired when the user requests dismissal (Esc / backdrop click). */
  onClose: () => void;
  /** Body content. */
  children: ReactNode;
  /** Footer content (typically action buttons). */
  footer?: ReactNode;
}

/**
 * Minimal modal primitive. Phase 2 wires focus trap + animations.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps): ReactElement | null {
  if (!open) return null;
  return (
    <div className="dd-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="dd-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        {title && <header className="dd-modal-header">{title}</header>}
        <div className="dd-modal-body">{children}</div>
        {footer && <footer className="dd-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
