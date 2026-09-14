import { describe, expect, it } from 'vitest';

import {
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  isTerminalRecoveryShortcut,
  pasteTerminalText,
} from './terminal-view';

describe('terminal copy shortcut', () => {
  it('copies a selection with Ctrl+C without breaking SIGINT when nothing is selected', () => {
    const ctrlC = { ctrlKey: true, metaKey: false, shiftKey: false, key: 'c' };
    expect(isTerminalCopyShortcut(ctrlC, true)).toBe(true);
    expect(isTerminalCopyShortcut(ctrlC, false)).toBe(false);
  });

  it('supports standard terminal and macOS copy shortcuts', () => {
    expect(
      isTerminalCopyShortcut(
        {
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          key: 'C',
        },
        true,
      ),
    ).toBe(true);
    expect(
      isTerminalCopyShortcut(
        {
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
          key: 'c',
        },
        true,
      ),
    ).toBe(true);
  });
});

describe('terminal paste shortcut', () => {
  it('handles Linux terminal paste and macOS paste through one controlled path', () => {
    expect(
      isTerminalPasteShortcut({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: 'V',
      }),
    ).toBe(true);
    expect(
      isTerminalPasteShortcut({
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        key: 'v',
      }),
    ).toBe(true);
  });

  it('does not intercept regular typing or Ctrl+V', () => {
    expect(
      isTerminalPasteShortcut({
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        key: 'v',
      }),
    ).toBe(false);
    expect(
      isTerminalPasteShortcut({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        key: 'v',
      }),
    ).toBe(false);
  });

  it('routes a multi-line clipboard payload through the xterm paste pipeline', () => {
    const pasted: string[] = [];
    let focused = false;
    const content = 'server {\n  listen 80;\n\n  location / {\n    proxy_pass http://app;\n  }\n}';

    expect(
      pasteTerminalText(
        {
          paste(value) {
            pasted.push(value);
          },
          focus() {
            focused = true;
          },
        },
        content,
      ),
    ).toBe(true);

    expect(pasted).toEqual([content]);
    expect(focused).toBe(true);
  });

  it('does not paste when the terminal or clipboard is unavailable', () => {
    expect(pasteTerminalText(null, 'text')).toBe(false);
    expect(pasteTerminalText({ paste() {}, focus() {} }, '')).toBe(false);
  });
});

describe('failed terminal recovery shortcut', () => {
  const ctrlC = { ctrlKey: true, metaKey: false, shiftKey: false, key: 'c' };

  it('uses Ctrl+C to recover only after the session has failed', () => {
    expect(isTerminalRecoveryShortcut(ctrlC, true)).toBe(true);
    expect(isTerminalRecoveryShortcut(ctrlC, false)).toBe(false);
  });

  it('leaves copy shortcuts and macOS Command+C untouched', () => {
    expect(isTerminalRecoveryShortcut({ ...ctrlC, shiftKey: true }, true)).toBe(false);
    expect(isTerminalRecoveryShortcut({ ...ctrlC, ctrlKey: false, metaKey: true }, true)).toBe(
      false,
    );
  });
});
