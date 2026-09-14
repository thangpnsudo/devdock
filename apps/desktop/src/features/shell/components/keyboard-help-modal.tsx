// Keyboard shortcuts help modal — opens on `?`.

import { useEffect, useRef, useState } from 'react';

interface Shortcut {
  /** Display label, e.g. "Ctrl + P". */
  keys: string;
  /** What the shortcut does. */
  description: string;
}

const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { keys: '?', description: 'Toggle this help modal' },
  { keys: 'Esc', description: 'Close this modal' },
];

const SUBSECTION_SHORTCUTS: ReadonlyArray<{ title: string; shortcuts: ReadonlyArray<Shortcut> }> = [
  {
    title: 'Terminal',
    shortcuts: [
      { keys: 'Ctrl/Cmd + C', description: 'Copy selected terminal text' },
      { keys: 'Ctrl + Shift + V', description: 'Paste on Linux and Windows' },
      { keys: 'Cmd + V', description: 'Paste on macOS' },
    ],
  },
  {
    title: 'SFTP',
    shortcuts: [
      { keys: 'Ctrl/Cmd + C', description: 'Copy selected files' },
      { keys: 'Ctrl/Cmd + X', description: 'Move selected files' },
      { keys: 'Ctrl/Cmd + V', description: 'Paste into the active pane' },
      { keys: 'Shift + click', description: 'Select a continuous range' },
      { keys: 'Ctrl/Cmd + click', description: 'Toggle an item in the selection' },
    ],
  },
];

export function KeyboardHelpModal(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === '?') {
        // Don't toggle when the user is typing in a text field.
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        if (!open) triggerRef.current = target;
        setOpen((v) => !v);
      } else if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dd-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        className="dd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dd-modal-header">Keyboard shortcuts</header>
        <div className="dd-modal-body dd-shortcuts">
          <section>
            <h3>Global</h3>
            <ul>
              {SHORTCUTS.map((s) => (
                <li key={s.keys}>
                  <kbd>{s.keys}</kbd>
                  <span>{s.description}</span>
                </li>
              ))}
            </ul>
          </section>
          {SUBSECTION_SHORTCUTS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.shortcuts.map((s) => (
                  <li key={`${section.title}-${s.keys}`}>
                    <kbd>{s.keys}</kbd>
                    <span>{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="dd-shortcuts__hint">
            Global shortcuts are ignored while you type in a form field.
          </p>
        </div>
        <footer className="dd-modal-footer">
          <button ref={closeRef} type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
