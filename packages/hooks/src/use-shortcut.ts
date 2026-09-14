// Keyboard shortcut hook.
//
// Phase 1: stub. Phase 2 wires to a global shortcut registry.

import { useEffect } from 'react';

/**
 * Registers a global keyboard shortcut.
 *
 * Phase 1: logs the binding. Phase 2 wires to a Tauri global shortcut plugin.
 *
 * @param key - The keyboard key (e.g., `'p'`).
 * @param modifiers - Active modifiers (e.g., `['ctrl', 'alt']`).
 * @param callback - Fires when the shortcut is pressed.
 */
export function useShortcut(
  key: string,
  modifiers: ReadonlyArray<'ctrl' | 'alt' | 'shift' | 'meta'>,
  callback: () => void,
): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: KeyboardEvent): void => {
      const expected = new Set(modifiers);
      const actual = new Set<string>();
      if (event.ctrlKey) actual.add('ctrl');
      if (event.altKey) actual.add('alt');
      if (event.shiftKey) actual.add('shift');
      if (event.metaKey) actual.add('meta');

      const sameKey = event.key.toLowerCase() === key.toLowerCase();
      const sameModifiers =
        expected.size === actual.size && [...expected].every((m) => actual.has(m));
      if (sameKey && sameModifiers) {
        callback();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, modifiers, callback]);
}