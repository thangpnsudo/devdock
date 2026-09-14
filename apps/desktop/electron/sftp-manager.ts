import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, posix, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { Client, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2';

import type { SshHostStore, StoredSshHost } from './ssh-host-store';

const execFileAsync = promisify(execFile);

export interface SftpEntry {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link';
  size: number;
  modifiedAt: number;
}

export type FileEndpoint =
  | { kind: 'local' }
  | { kind: 'remote'; hostId: string; credential?: string };

interface SftpConnection {
  client: Client;
  sftp: SFTPWrapper;
}

function remotePath(value: string): string {
  const normalized = posix.resolve('/', value || '/');
  if (normalized.includes('\0')) throw new Error('Invalid remote path.');
  return normalized;
}

function localPath(value: string): string {
  if (value.includes('\0')) throw new Error('Invalid local path.');
  return resolve(value || homedir());
}

export class SftpManager {
  private readonly connections = new Map<string, Promise<SftpConnection>>();

  public constructor(private readonly hosts: SshHostStore) {}

  public localHome(): string {
    return homedir();
  }

  public async listLocal(path: string): Promise<SftpEntry[]> {
    const directory = localPath(path);
    const entries = await readdir(directory, { withFileTypes: true });
    const mapped = await Promise.all(entries.map(async (entry): Promise<SftpEntry> => {
      const path = join(directory, entry.name);
      const attributes = await lstat(path);
      return {
        name: entry.name,
        path,
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file',
        size: attributes.size,
        modifiedAt: attributes.mtimeMs,
      };
    }));
    return mapped.sort((left, right) =>
      left.type === right.type
        ? left.name.localeCompare(right.name)
        : left.type === 'directory' ? -1 : 1);
  }

  public async mkdirLocal(path: string): Promise<void> {
    await mkdir(localPath(path));
  }

  public async removeLocal(path: string, directory: boolean): Promise<void> {
    if (directory) await rmdir(localPath(path));
    else await unlink(localPath(path));
  }

  public async list(hostId: string, path: string, credential?: string): Promise<SftpEntry[]> {
    const connection = await this.connection(hostId, credential);
    const directory = remotePath(path);
    return new Promise((resolve, reject) => {
      connection.sftp.readdir(directory, (error, entries) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(entries
          .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
          .map((entry) => ({
            name: entry.filename,
            path: posix.join(directory, entry.filename),
            type: entry.attrs.isDirectory()
              ? 'directory'
              : entry.attrs.isSymbolicLink() ? 'link' : 'file',
            size: entry.attrs.size,
            modifiedAt: entry.attrs.mtime * 1000,
          }))
          .sort((left, right) =>
            left.type === right.type
              ? left.name.localeCompare(right.name)
              : left.type === 'directory' ? -1 : 1));
      });
    });
  }

  public async mkdir(hostId: string, path: string, credential?: string): Promise<void> {
    const connection = await this.connection(hostId, credential);
    await new Promise<void>((resolve, reject) => {
      connection.sftp.mkdir(remotePath(path), (error) => error ? reject(error) : resolve());
    });
  }

  public async remove(
    hostId: string,
    path: string,
    directory: boolean,
    credential?: string,
  ): Promise<void> {
    const connection = await this.connection(hostId, credential);
    await new Promise<void>((resolve, reject) => {
      const callback = (error?: Error | null): void => error ? reject(error) : resolve();
      if (directory) connection.sftp.rmdir(remotePath(path), callback);
      else connection.sftp.unlink(remotePath(path), callback);
    });
  }

  public async transfer(
    sourceHostId: string,
    sourcePath: string,
    targetHostId: string,
    targetDirectory: string,
    sourceCredential?: string,
    targetCredential?: string,
  ): Promise<void> {
    if (sourceHostId === targetHostId) throw new Error('Choose two different hosts.');
    const [source, target] = await Promise.all([
      this.connection(sourceHostId, sourceCredential),
      this.connection(targetHostId, targetCredential),
    ]);
    const from = remotePath(sourcePath);
    const to = posix.join(remotePath(targetDirectory), posix.basename(from));
    await new Promise<void>((resolve, reject) => {
      const reader = source.sftp.createReadStream(from);
      const writer = target.sftp.createWriteStream(to, { flags: 'w', mode: 0o644 });
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reader.destroy();
        writer.destroy();
        reject(error);
      };
      reader.once('error', fail);
      writer.once('error', fail);
      writer.once('close', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      reader.pipe(writer);
    });
  }

  public async upload(
    hostId: string,
    localPaths: string[],
    targetDirectory: string,
    credential?: string,
  ): Promise<void> {
    if (localPaths.length === 0) return;
    const target = await this.connection(hostId, credential);
    const directory = remotePath(targetDirectory);
    for (const sourcePath of localPaths) {
      const source = localPath(sourcePath);
      const attributes = await lstat(source);
      if (!attributes.isFile()) throw new Error(`Only files can be uploaded: ${basename(source)}`);
      const destination = posix.join(directory, basename(source));
      await pipeline(
        createReadStream(source),
        target.sftp.createWriteStream(destination, {
          flags: 'w',
          mode: attributes.mode & 0o777,
        }),
      );
    }
  }

  public async download(
    hostId: string,
    remotePaths: string[],
    targetDirectory: string,
    credential?: string,
  ): Promise<void> {
    if (remotePaths.length === 0) return;
    const source = await this.connection(hostId, credential);
    const directory = localPath(targetDirectory);
    for (const sourcePath of remotePaths) {
      const remote = remotePath(sourcePath);
      const attributes = await new Promise<Stats>((resolve, reject) => {
        source.sftp.stat(remote, (error, stats) => {
          if (error) reject(error);
          else resolve(stats);
        });
      });
      if (!attributes.isFile()) {
        throw new Error(`Only files can be downloaded: ${posix.basename(remote)}`);
      }
      await pipeline(
        source.sftp.createReadStream(remote),
        createWriteStream(join(directory, posix.basename(remote)), {
          flags: 'w',
          mode: attributes.mode & 0o777,
        }),
      );
    }
  }

  public async renameItem(endpoint: FileEndpoint, path: string, nextPath: string): Promise<void> {
    if (endpoint.kind === 'local') {
      await rename(localPath(path), localPath(nextPath));
      return;
    }
    const connection = await this.connection(endpoint.hostId, endpoint.credential);
    await new Promise<void>((resolve, reject) => {
      connection.sftp.rename(remotePath(path), remotePath(nextPath), (error) =>
        error ? reject(error) : resolve());
    });
  }

  public async removeItems(endpoint: FileEndpoint, paths: string[]): Promise<void> {
    if (endpoint.kind === 'local') {
      for (const path of paths) await rm(localPath(path), { recursive: true, force: false });
      return;
    }
    const connection = await this.connection(endpoint.hostId, endpoint.credential);
    for (const path of paths) await this.removeRemoteRecursive(connection.sftp, remotePath(path));
  }

  public async transferItems(
    source: FileEndpoint,
    target: FileEndpoint,
    sourcePaths: string[],
    targetDirectory: string,
    mode: 'copy' | 'move',
  ): Promise<void> {
    if (sourcePaths.length === 0) return;
    if (source.kind === 'local' && target.kind === 'local') {
      const directory = localPath(targetDirectory);
      for (const value of sourcePaths) {
        const from = localPath(value);
        const to = join(directory, basename(from));
        if (from === to) throw new Error('Source and destination are the same.');
        const attributes = await lstat(from);
        if (attributes.isDirectory() && to.startsWith(`${from}${sep}`)) {
          throw new Error('A folder cannot be copied into itself.');
        }
        if (mode === 'move') {
          try {
            await rename(from, to);
            continue;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
          }
        }
        await cp(from, to, { recursive: true, force: true, preserveTimestamps: true });
        if (mode === 'move') await rm(from, { recursive: true, force: false });
      }
      return;
    }

    const sourceConnection = source.kind === 'remote'
      ? await this.connection(source.hostId, source.credential)
      : null;
    const targetConnection = target.kind === 'remote'
      ? await this.connection(target.hostId, target.credential)
      : null;

    for (const sourcePath of sourcePaths) {
      if (source.kind === 'local' && target.kind === 'remote' && targetConnection) {
        const from = localPath(sourcePath);
        await this.copyLocalToRemote(
          from,
          posix.join(remotePath(targetDirectory), basename(from)),
          targetConnection.sftp,
        );
      } else if (source.kind === 'remote' && target.kind === 'local' && sourceConnection) {
        const from = remotePath(sourcePath);
        await this.copyRemoteToLocal(
          sourceConnection.sftp,
          from,
          join(localPath(targetDirectory), posix.basename(from)),
        );
      } else if (
        source.kind === 'remote'
        && target.kind === 'remote'
        && sourceConnection
        && targetConnection
      ) {
        const from = remotePath(sourcePath);
        const to = posix.join(remotePath(targetDirectory), posix.basename(from));
        if (source.hostId === target.hostId && from === to) {
          throw new Error('Source and destination are the same.');
        }
        if (mode === 'move' && source.hostId === target.hostId) {
          await new Promise<void>((resolve, reject) => {
            sourceConnection.sftp.rename(from, to, (error) =>
              error ? reject(error) : resolve());
          });
          continue;
        }
        await this.copyRemoteToRemote(sourceConnection.sftp, from, targetConnection.sftp, to);
      }

      if (mode === 'move') {
        if (source.kind === 'local') {
          await rm(localPath(sourcePath), { recursive: true, force: false });
        } else if (sourceConnection) {
          await this.removeRemoteRecursive(sourceConnection.sftp, remotePath(sourcePath));
        }
      }
    }
  }

  public closeAll(): void {
    for (const pending of this.connections.values()) {
      void pending.then(({ client }) => client.end()).catch(() => undefined);
    }
    this.connections.clear();
  }

  private connection(hostId: string, credential?: string): Promise<SftpConnection> {
    const existing = this.connections.get(hostId);
    if (existing) return existing;
    const pending = this.connect(hostId, credential).catch((error) => {
      this.connections.delete(hostId);
      throw error;
    });
    this.connections.set(hostId, pending);
    return pending;
  }

  private async remoteStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      sftp.stat(path, (error, attributes) => error ? reject(error) : resolve(attributes));
    });
  }

  private async remoteEntries(sftp: SFTPWrapper, path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (error, entries) => {
        if (error) reject(error);
        else resolve(entries
          .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
          .map((entry) => entry.filename));
      });
    });
  }

  private async ensureRemoteDirectory(sftp: SFTPWrapper, path: string): Promise<void> {
    const normalized = remotePath(path);
    let current = '/';
    for (const segment of normalized.split('/').filter(Boolean)) {
      current = posix.join(current, segment);
      try {
        const attributes = await this.remoteStat(sftp, current);
        if (!attributes.isDirectory()) throw new Error(`${current} is not a directory.`);
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== 2) throw error;
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(current, (mkdirError) => mkdirError ? reject(mkdirError) : resolve());
        });
      }
    }
  }

  private async copyLocalToRemote(
    source: string,
    target: string,
    sftp: SFTPWrapper,
  ): Promise<void> {
    const attributes = await lstat(source);
    if (attributes.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${source}`);
    if (attributes.isDirectory()) {
      await this.ensureRemoteDirectory(sftp, target);
      const entries = await readdir(source);
      for (const entry of entries) {
        await this.copyLocalToRemote(join(source, entry), posix.join(target, entry), sftp);
      }
      return;
    }
    await this.ensureRemoteDirectory(sftp, posix.dirname(target));
    await pipeline(
      createReadStream(source),
      sftp.createWriteStream(target, { flags: 'w', mode: attributes.mode & 0o777 }),
    );
  }

  private async copyRemoteToLocal(
    sftp: SFTPWrapper,
    source: string,
    target: string,
  ): Promise<void> {
    const attributes = await this.remoteStat(sftp, source);
    if (attributes.isDirectory()) {
      await mkdir(target, { recursive: true });
      for (const entry of await this.remoteEntries(sftp, source)) {
        await this.copyRemoteToLocal(sftp, posix.join(source, entry), join(target, entry));
      }
      return;
    }
    await mkdir(resolve(target, '..'), { recursive: true });
    await pipeline(
      sftp.createReadStream(source),
      createWriteStream(target, { flags: 'w', mode: attributes.mode & 0o777 }),
    );
  }

  private async copyRemoteToRemote(
    sourceSftp: SFTPWrapper,
    source: string,
    targetSftp: SFTPWrapper,
    target: string,
  ): Promise<void> {
    const attributes = await this.remoteStat(sourceSftp, source);
    if (attributes.isDirectory()) {
      if (target.startsWith(`${source}/`) && sourceSftp === targetSftp) {
        throw new Error('A folder cannot be copied into itself.');
      }
      await this.ensureRemoteDirectory(targetSftp, target);
      for (const entry of await this.remoteEntries(sourceSftp, source)) {
        await this.copyRemoteToRemote(
          sourceSftp,
          posix.join(source, entry),
          targetSftp,
          posix.join(target, entry),
        );
      }
      return;
    }
    await this.ensureRemoteDirectory(targetSftp, posix.dirname(target));
    await pipeline(
      sourceSftp.createReadStream(source),
      targetSftp.createWriteStream(target, { flags: 'w', mode: attributes.mode & 0o777 }),
    );
  }

  private async removeRemoteRecursive(sftp: SFTPWrapper, path: string): Promise<void> {
    const attributes = await this.remoteStat(sftp, path);
    if (attributes.isDirectory()) {
      for (const entry of await this.remoteEntries(sftp, path)) {
        await this.removeRemoteRecursive(sftp, posix.join(path, entry));
      }
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(path, (error) => error ? reject(error) : resolve());
      });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      sftp.unlink(path, (error) => error ? reject(error) : resolve());
    });
  }

  private async connect(hostId: string, credential?: string): Promise<SftpConnection> {
    const host = await this.hosts.get(hostId);
    if (!host) throw new Error('SSH host was not found.');
    const savedPassword = host.authMethod === 'password'
      ? await this.hosts.savedPassword(hostId)
      : undefined;
    const config = await this.config(host, credential ?? savedPassword);
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) {
            client.end();
            reject(error);
            return;
          }
          resolve({ client, sftp });
        });
      });
      client.once('error', reject);
      client.once('close', () => this.connections.delete(hostId));
      client.connect(config);
    });
  }

  private async config(host: StoredSshHost, credential?: string): Promise<ConnectConfig> {
    const lookup = host.port === 22 ? host.host : `[${host.host}]:${host.port}`;
    let knownHostOutput = '';
    try {
      const result = await execFileAsync('ssh-keygen', [
        '-F',
        lookup,
        '-f',
        `${homedir()}/.ssh/known_hosts`,
      ]);
      knownHostOutput = result.stdout;
    } catch {
      throw new Error(
        `Host key for ${lookup} is not trusted. Connect once in Terminal and verify its fingerprint first.`,
      );
    }
    const fingerprints = knownHostOutput
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.trim().split(/\s+/u)[2])
      .filter((key): key is string => Boolean(key))
      .map((key) => createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex'));
    if (fingerprints.length === 0) {
      throw new Error(`No trusted host key was found for ${lookup}.`);
    }
    const base: ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.username,
      readyTimeout: 15_000,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (fingerprint) => fingerprints.includes(String(fingerprint)),
    };
    if (host.authMethod === 'password') {
      const password = credential;
      if (!password) throw new Error('Password is required for this SFTP session.');
      return { ...base, password };
    }
    if (host.authMethod === 'public_key') {
      if (!host.credential) throw new Error('This host has no private key path.');
      return { ...base, privateKey: await readFile(host.credential) };
    }
    if (!process.env.SSH_AUTH_SOCK) throw new Error('SSH agent is not available.');
    return { ...base, agent: process.env.SSH_AUTH_SOCK };
  }
}
