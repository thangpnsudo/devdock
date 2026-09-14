import { describe, expect, it } from 'vitest';

import {
  fileShortcutAction,
  parsePersistedFilePanes,
  resolveHostCredential,
  setPathSelected,
} from './sftp-workspace';

const shortcut = (key: string) => ({
  key,
  ctrlKey: true,
  metaKey: false,
});

describe('file workspace shortcuts', () => {
  it('maps Ctrl+C, Ctrl+X, and Ctrl+V to file operations', () => {
    expect(fileShortcutAction(shortcut('c'), true, false)).toBe('copy');
    expect(fileShortcutAction(shortcut('x'), true, false)).toBe('move');
    expect(fileShortcutAction(shortcut('v'), false, true)).toBe('paste');
  });

  it('does not consume shortcuts when there is nothing to operate on', () => {
    expect(fileShortcutAction(shortcut('c'), false, false)).toBeNull();
    expect(fileShortcutAction(shortcut('x'), false, false)).toBeNull();
    expect(fileShortcutAction(shortcut('v'), false, false)).toBeNull();
  });
});

describe('SFTP host credentials', () => {
  it('lets the main process use an encrypted saved password automatically', () => {
    expect(
      resolveHostCredential({ authMethod: 'password', hasSavedPassword: true }, undefined),
    ).toBeUndefined();
  });

  it('requests a password only when none is entered or saved', () => {
    expect(
      resolveHostCredential({ authMethod: 'password', hasSavedPassword: false }, undefined),
    ).toBeNull();
    expect(resolveHostCredential({ authMethod: 'password' }, 'secret')).toBe('secret');
  });
});

describe('SFTP checkbox selection', () => {
  it('unchecks an already selected folder without changing other selections', () => {
    expect(setPathSelected(['/one', '/two'], '/two', false)).toEqual(['/one']);
  });

  it('does not duplicate a selected path', () => {
    expect(setPathSelected(['/one'], '/one', true)).toEqual(['/one']);
  });
});

describe('SFTP pane persistence', () => {
  it('restores the last source, folder, and view after navigating away', () => {
    expect(
      parsePersistedFilePanes(
        JSON.stringify([
          {
            sourceId: 'local',
            path: '/home/dev/Downloads',
            view: 'grid',
          },
        ]),
      ),
    ).toEqual([
      {
        sourceId: 'local',
        path: '/home/dev/Downloads',
        view: 'grid',
      },
    ]);
  });

  it('ignores malformed persisted workspace data', () => {
    expect(parsePersistedFilePanes('{broken')).toEqual([]);
    expect(parsePersistedFilePanes(JSON.stringify([{ sourceId: 'local' }]))).toEqual([]);
  });
});
