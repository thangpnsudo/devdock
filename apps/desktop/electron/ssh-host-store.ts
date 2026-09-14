import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StoredSshHost {
  id: string;
  title: string;
  description?: string;
  favorite: boolean;
  archived: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'public_key' | 'agent';
  credential?: string;
  encryptedPassword?: string;
  lastConnectedAt?: number;
}

export interface PasswordCipher {
  available(): boolean;
  encrypt(password: string): string;
  decrypt(payload: string): string;
}

export type PublicSshHost = Omit<StoredSshHost, 'credential' | 'encryptedPassword'> & {
  hasSavedPassword: boolean;
};

export interface SaveSshHostRequest {
  id?: string;
  title: string;
  description?: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  credential?: string;
  password?: string;
  savePassword?: boolean;
}

function validate(request: SaveSshHostRequest): Omit<StoredSshHost, 'id' | 'favorite' | 'archived'> {
  const title = request.title.trim();
  const host = request.host.trim();
  const username = request.username.trim();
  const port = Math.trunc(request.port);
  if (!title) throw new Error('Host title is required.');
  if (!host || /[\s\0]/u.test(host)) throw new Error('Invalid SSH host.');
  if (!username || /[\s\0@]/u.test(username)) throw new Error('Invalid SSH username.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port.');
  if (!['password', 'public_key', 'agent'].includes(request.authMethod)) {
    throw new Error('Invalid SSH authentication method.');
  }
  return {
    title,
    host,
    port,
    username,
    authMethod: request.authMethod as StoredSshHost['authMethod'],
    ...(request.description?.trim() ? { description: request.description.trim() } : {}),
    ...(request.authMethod === 'public_key' && request.credential?.trim()
      ? { credential: request.credential.trim() }
      : {}),
  };
}

export class SshHostStore {
  private mutationQueue = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly passwordCipher?: PasswordCipher,
  ) {}

  public async list(): Promise<StoredSshHost[]> {
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      return Array.isArray(data) ? (data as StoredSshHost[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async get(id: string): Promise<StoredSshHost | null> {
    return (await this.list()).find((host) => host.id === id) ?? null;
  }

  public async listPublic(): Promise<PublicSshHost[]> {
    return (await this.list()).map((host) => this.toPublic(host));
  }

  public async recentPublic(limit = 10): Promise<PublicSshHost[]> {
    return (await this.recent(limit)).map((host) => this.toPublic(host));
  }

  public async savedPassword(id: string): Promise<string | undefined> {
    const host = await this.get(id);
    if (!host?.encryptedPassword) return undefined;
    if (!this.passwordCipher?.available()) {
      throw new Error('Secure password storage is unavailable on this device.');
    }
    return this.passwordCipher.decrypt(host.encryptedPassword);
  }

  public async create(request: SaveSshHostRequest): Promise<{ id: string }> {
    const id = randomUUID();
    const encryptedPassword = this.passwordForCreate(request);
    await this.mutate((hosts) => [
      ...hosts,
      {
        id,
        favorite: false,
        archived: false,
        ...validate(request),
        ...(encryptedPassword ? { encryptedPassword } : {}),
      },
    ]);
    return { id };
  }

  public async update(request: SaveSshHostRequest & { id: string }): Promise<void> {
    await this.mutate((hosts) =>
      hosts.map((host) => {
        if (host.id !== request.id) return host;
        const next = validate(request);
        const encryptedPassword = this.passwordForUpdate(request, host);
        const credential = next.credential
          ?? (next.authMethod === 'public_key' && host.authMethod === 'public_key'
            ? host.credential
            : undefined);
        const { credential: _credential, encryptedPassword: _password, ...base } = host;
        return {
          ...base,
          ...next,
          ...(credential ? { credential } : {}),
          ...(encryptedPassword ? { encryptedPassword } : {}),
        };
      }),
    );
  }

  public async delete(id: string): Promise<void> {
    await this.mutate((hosts) => hosts.filter((host) => host.id !== id));
  }

  public async recent(limit = 10): Promise<StoredSshHost[]> {
    const hosts = await this.list();
    return hosts
      .filter((host) => host.lastConnectedAt !== undefined)
      .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  public async markConnected(id: string): Promise<void> {
    await this.mutate((hosts) =>
      hosts.map((host) => (host.id === id ? { ...host, lastConnectedAt: Date.now() } : host)),
    );
  }

  private async mutate(transform: (hosts: StoredSshHost[]) => StoredSshHost[]): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const hosts = await this.list();
      const next = transform(hosts);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private passwordForCreate(request: SaveSshHostRequest): string | undefined {
    if (request.authMethod !== 'password' || !request.savePassword) return undefined;
    return this.encryptPassword(request.password);
  }

  private passwordForUpdate(
    request: SaveSshHostRequest,
    current: StoredSshHost,
  ): string | undefined {
    if (request.authMethod !== 'password' || request.savePassword === false) return undefined;
    if (request.savePassword === undefined) return current.encryptedPassword;
    if (!request.password) return current.encryptedPassword;
    return this.encryptPassword(request.password);
  }

  private encryptPassword(password: string | undefined): string {
    if (!password || password.length > 4096 || /[\0\r\n]/u.test(password)) {
      throw new Error('A valid password is required when Save password is enabled.');
    }
    if (!this.passwordCipher?.available()) {
      throw new Error('Secure password storage is unavailable on this device.');
    }
    return this.passwordCipher.encrypt(password);
  }

  private toPublic(host: StoredSshHost): PublicSshHost {
    const { credential: _credential, encryptedPassword, ...publicHost } = host;
    return { ...publicHost, hasSavedPassword: Boolean(encryptedPassword) };
  }
}
