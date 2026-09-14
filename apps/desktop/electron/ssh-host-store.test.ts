import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SshHostStore } from './ssh-host-store';

describe('SshHostStore', () => {
  it('persists profiles and orders recently connected hosts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devdock-host-store-'));
    const filePath = join(directory, 'ssh-hosts.json');
    const store = new SshHostStore(filePath);
    const first = await store.create({
      title: 'Production',
      host: 'prod.example.test',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
    });
    const second = await store.create({
      title: 'Staging',
      host: 'staging.example.test',
      port: 2222,
      username: 'ops',
      authMethod: 'public_key',
      credential: '/tmp/test-key',
    });

    await store.markConnected(second.id);
    expect((await store.recent())[0]?.id).toBe(second.id);
    expect(await store.list()).toHaveLength(2);
    expect((await readFile(filePath, 'utf8')).includes('/tmp/test-key')).toBe(true);

    await store.delete(first.id);
    expect((await store.list()).map((host) => host.id)).toEqual([second.id]);
  });

  it('stores passwords only through the injected OS encryption adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devdock-host-password-'));
    const filePath = join(directory, 'ssh-hosts.json');
    const store = new SshHostStore(filePath, {
      available: () => true,
      encrypt: (password) => Buffer.from(`protected:${password}`).toString('base64'),
      decrypt: (payload) => Buffer.from(payload, 'base64').toString().replace(/^protected:/u, ''),
    });
    const created = await store.create({
      title: 'Password host',
      host: 'password.example.test',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      savePassword: true,
      password: 'correct horse battery staple',
    });

    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).not.toContain('correct horse battery staple');
    expect(await store.savedPassword(created.id)).toBe('correct horse battery staple');
    expect((await store.listPublic())[0]).toMatchObject({
      id: created.id,
      hasSavedPassword: true,
    });
    expect(await store.listPublic()).not.toHaveProperty('0.encryptedPassword');

    await store.update({
      id: created.id,
      title: 'Password host',
      host: 'password.example.test',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      savePassword: false,
    });
    expect(await store.savedPassword(created.id)).toBeUndefined();
  });

  it('refuses password persistence without secure OS storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devdock-host-no-vault-'));
    const store = new SshHostStore(join(directory, 'ssh-hosts.json'));
    await expect(store.create({
      title: 'Unsafe host',
      host: 'unsafe.example.test',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      savePassword: true,
      password: 'do-not-store-this',
    })).rejects.toThrow('Secure password storage is unavailable');
  });
});
