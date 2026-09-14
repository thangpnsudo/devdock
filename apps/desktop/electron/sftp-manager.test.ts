import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SshHostStore } from './ssh-host-store';
import { SftpManager } from './sftp-manager';

describe('SftpManager local file operations', () => {
  it('lists local files and safely creates and removes empty directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devdock-sftp-local-'));
    const manager = new SftpManager({} as SshHostStore);
    try {
      await writeFile(join(root, 'example.txt'), 'hello');
      await manager.mkdirLocal(join(root, 'folder'));

      const entries = await manager.listLocal(root);
      expect(entries.map((entry) => [entry.name, entry.type])).toEqual([
        ['folder', 'directory'],
        ['example.txt', 'file'],
      ]);
      expect(entries.find((entry) => entry.name === 'example.txt')?.size).toBe(5);

      await manager.removeLocal(join(root, 'example.txt'), false);
      await manager.removeLocal(join(root, 'folder'), true);
      expect(await manager.listLocal(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renames, recursively copies, moves, and removes local items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devdock-file-workspace-'));
    const manager = new SftpManager({} as SshHostStore);
    try {
      const source = join(root, 'source');
      const copiedTo = join(root, 'copied');
      const movedTo = join(root, 'moved');
      await mkdir(join(source, 'nested'), { recursive: true });
      await mkdir(copiedTo);
      await mkdir(movedTo);
      await writeFile(join(source, 'nested', 'gpu.csv'), 'name,memory\nRTX,24GB');

      await manager.renameItem(
        { kind: 'local' },
        join(source, 'nested', 'gpu.csv'),
        join(source, 'nested', 'hardware.csv'),
      );
      await manager.transferItems(
        { kind: 'local' },
        { kind: 'local' },
        [source],
        copiedTo,
        'copy',
      );
      expect(await readFile(join(copiedTo, 'source', 'nested', 'hardware.csv'), 'utf8'))
        .toContain('RTX');

      await manager.transferItems(
        { kind: 'local' },
        { kind: 'local' },
        [join(copiedTo, 'source')],
        movedTo,
        'move',
      );
      expect(await readFile(join(movedTo, 'source', 'nested', 'hardware.csv'), 'utf8'))
        .toContain('24GB');

      await manager.removeItems({ kind: 'local' }, [source, join(movedTo, 'source')]);
      expect((await manager.listLocal(root)).map((entry) => entry.name)).toEqual([
        'copied',
        'moved',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
