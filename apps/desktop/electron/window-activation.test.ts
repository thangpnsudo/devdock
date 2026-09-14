import { describe, expect, it, vi } from 'vitest';

import { activateWindow } from './window-activation';

describe('window activation', () => {
  it('restores a minimized window and brings it above other applications', () => {
    const calls: string[] = [];
    const window = {
      isMinimized: () => true,
      restore: vi.fn(() => calls.push('restore')),
      show: vi.fn(() => calls.push('show')),
      focus: vi.fn(() => calls.push('focus')),
      moveTop: vi.fn(() => calls.push('moveTop')),
    };

    activateWindow(window);

    expect(calls).toEqual(['restore', 'show', 'focus', 'moveTop']);
  });

  it('does not restore a window that is not minimized', () => {
    const window = {
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      moveTop: vi.fn(),
    };

    activateWindow(window);

    expect(window.restore).not.toHaveBeenCalled();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.moveTop).toHaveBeenCalledOnce();
  });
});
