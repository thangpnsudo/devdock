import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import * as pty from 'node-pty';

import type {
  CreateTerminalRequest,
  TerminalAttachResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSnapshot,
} from './terminal-contract';

const MIN_COLS = 20;
const MIN_ROWS = 2;
const MAX_COLS = 1000;
const MAX_ROWS = 500;
const DEFAULT_REPLAY_LIMIT = 2_000_000;

export interface TerminalSessionEvents {
  onData: (event: TerminalDataEvent) => void;
  onExit: (event: TerminalExitEvent) => void;
}

export interface ManagedTerminalRequest {
  executable: string;
  args?: string[];
  cwd: string;
  label?: string;
  cols?: number;
  rows?: number;
}

interface TerminalSessionEntry {
  processHandle: pty.IPty;
  snapshot: Omit<TerminalSessionSnapshot, 'attached'>;
  attachedClients: Set<number>;
  replay: TerminalDataEvent[];
  replaySize: number;
  sequence: number;
}

function terminalSize(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value as number)));
}

export function isExitedPtyResizeError(error: unknown): boolean {
  return error instanceof Error && /pty that has already exited/iu.test(error.message);
}

export function localShell(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): { executable: string; args: string[] } {
  if (platform === 'win32') {
    const windowsDirectory = environment.SystemRoot ?? environment.WINDIR;
    const fallback = windowsDirectory
      ? `${windowsDirectory}\\System32\\cmd.exe`
      : 'C:\\Windows\\System32\\cmd.exe';
    const configured = environment.ComSpec ?? environment.COMSPEC;
    const executable = configured && existsSync(configured) ? configured : fallback;
    return { executable, args: ['/d'] };
  }

  const configured = environment.SHELL;
  const executable = configured && existsSync(configured) ? configured : '/bin/bash';
  return { executable, args: ['-i'] };
}

function validateSshRequest(request: CreateTerminalRequest): {
  host: string;
  port: number;
  username: string;
} {
  const host = request.host?.trim() ?? '';
  const username = request.username?.trim() ?? '';
  const port = terminalSize(request.port, 22, 65535);

  if (!host || /[\s\0]/u.test(host)) throw new Error('Invalid SSH host.');
  if (!username || /[\s\0@]/u.test(username)) throw new Error('Invalid SSH username.');
  if (port < 1 || port > 65535) throw new Error('Invalid SSH port.');
  return { host, port, username };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export function sshCommand(request: CreateTerminalRequest): { executable: string; args: string[] } {
  const { host, port, username } = validateSshRequest(request);
  const identityFile = request.identityFile?.trim();
  const remoteCwd = request.remoteCwd?.trim();
  if (identityFile?.includes('\0')) throw new Error('Invalid private key path.');
  if (remoteCwd && /[\0\r\n]/u.test(remoteCwd)) throw new Error('Invalid remote terminal path.');
  return {
    executable: 'ssh',
    args: [
      '-tt',
      '-p',
      String(port),
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'TCPKeepAlive=yes',
      '-o',
      'ConnectTimeout=15',
      ...(identityFile ? ['-i', identityFile] : []),
      `${username}@${host}`,
      ...(remoteCwd ? [`cd -- ${shellQuote(remoteCwd)} && exec "\${SHELL:-/bin/sh}" -l`] : []),
    ],
  };
}

export function isSshPasswordPrompt(output: string): boolean {
  const withoutAnsi = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, '');
  return /password:\s*$/iu.test(withoutAnsi);
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSessionEntry>();
  private readonly expectedExits = new Map<
    string,
    NonNullable<TerminalExitEvent['reason']>
  >();

  public constructor(
    private readonly events: TerminalSessionEvents,
    private readonly replayLimit = DEFAULT_REPLAY_LIMIT,
  ) {}

  public create(request: CreateTerminalRequest): string {
    const command = request.kind === 'ssh' ? sshCommand(request) : localShell();
    return this.spawn(command, request, request.kind === 'ssh' ? request.password : undefined);
  }

  public createManaged(request: ManagedTerminalRequest): string {
    if (!request.executable.trim() || request.executable.includes('\0')) {
      throw new Error('Invalid managed terminal executable.');
    }
    if (!request.cwd.trim() || request.cwd.includes('\0')) {
      throw new Error('Invalid managed terminal working directory.');
    }
    return this.spawn(
      { executable: request.executable, args: request.args ?? [] },
      {
        kind: 'local',
        cwd: request.cwd,
        cols: request.cols,
        rows: request.rows,
      },
      undefined,
      request.label,
    );
  }

  private spawn(
    command: { executable: string; args: string[] },
    request: CreateTerminalRequest,
    initialPassword?: string,
    managedLabel?: string,
  ): string {
    const sessionId = randomUUID();
    const cols = terminalSize(request.cols, 120, MAX_COLS);
    const rows = terminalSize(request.rows, 32, MAX_ROWS);
    const cwd = request.cwd?.trim() || homedir();
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>;

    const processHandle = pty.spawn(command.executable, command.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
      encoding: 'utf8',
    });

    const now = Date.now();
    const entry: TerminalSessionEntry = {
      processHandle,
      snapshot: {
        id: sessionId,
        kind: request.kind,
        purpose: managedLabel ? 'agent' : 'terminal',
        ...(managedLabel ? { label: managedLabel } : {}),
        pid: processHandle.pid,
        ...(request.kind === 'local' ? { cwd } : {}),
        ...(request.kind === 'ssh' && request.host ? { host: request.host } : {}),
        ...(request.kind === 'ssh' && request.port ? { port: request.port } : {}),
        ...(request.kind === 'ssh' && request.username ? { username: request.username } : {}),
        ...(request.kind === 'ssh' && request.remoteCwd ? { remoteCwd: request.remoteCwd } : {}),
        cols,
        rows,
        createdAt: now,
        lastActivityAt: now,
      },
      attachedClients: new Set(),
      replay: [],
      replaySize: 0,
      sequence: 0,
    };
    this.sessions.set(sessionId, entry);
    let savedPassword = initialPassword;
    let authenticationOutput = '';
    processHandle.onData((data) => {
      entry.sequence += 1;
      entry.snapshot.lastActivityAt = Date.now();
      const event = { sessionId, data, sequence: entry.sequence };
      this.appendReplay(entry, event);
      this.events.onData(event);
      if (!savedPassword) return;
      authenticationOutput = `${authenticationOutput}${data}`.slice(-2048);
      if (!isSshPasswordPrompt(authenticationOutput)) return;
      processHandle.write(`${savedPassword}\r`);
      savedPassword = undefined;
      authenticationOutput = '';
    });
    processHandle.onExit(({ exitCode, signal }) => {
      const reason = this.expectedExits.get(sessionId);
      this.expectedExits.delete(sessionId);
      savedPassword = undefined;
      authenticationOutput = '';
      this.sessions.delete(sessionId);
      this.events.onExit({
        sessionId,
        exitCode,
        signal,
        ...(reason ? { expected: true, reason } : {}),
      });
    });
    return sessionId;
  }

  public write(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId);
    if (typeof data !== 'string' || data.length > 1024 * 1024) {
      throw new Error('Invalid terminal input.');
    }
    session.processHandle.write(data);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    // ResizeObserver callbacks can race with a tab/window closing. A resize
    // for an already-closed PTY is stale layout work, not a user-facing error.
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const nextCols = terminalSize(cols, MIN_COLS, MAX_COLS);
    const nextRows = terminalSize(rows, MIN_ROWS, MAX_ROWS);
    session.snapshot.cols = nextCols;
    session.snapshot.rows = nextRows;
    try {
      session.processHandle.resize(nextCols, nextRows);
    } catch (error) {
      if (isExitedPtyResizeError(error)) return;
      throw error;
    }
  }

  public close(
    sessionId: string,
    reason: NonNullable<TerminalExitEvent['reason']> = 'closed',
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.expectedExits.set(sessionId, reason);
    this.sessions.delete(sessionId);
    try {
      session.processHandle.kill();
    } catch (error) {
      this.expectedExits.delete(sessionId);
      throw error;
    }
  }

  public closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id, 'shutdown');
  }

  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public rename(sessionId: string, label: string): void {
    const session = this.requireSession(sessionId);
    const normalized = label.trim();
    if (!normalized || normalized.length > 80) throw new Error('Invalid terminal label.');
    session.snapshot.label = normalized;
  }

  public list(): TerminalSessionSnapshot[] {
    return [...this.sessions.values()].map((entry) => this.toSnapshot(entry));
  }

  public read(sessionId: string): TerminalAttachResult {
    const entry = this.requireSession(sessionId);
    return {
      session: this.toSnapshot(entry),
      replay: entry.replay.map((event) => ({ ...event })),
    };
  }

  public attach(sessionId: string, clientId: number): TerminalAttachResult {
    const entry = this.requireSession(sessionId);
    entry.attachedClients.add(clientId);
    return this.read(sessionId);
  }

  public detach(sessionId: string, clientId: number): void {
    this.sessions.get(sessionId)?.attachedClients.delete(clientId);
  }

  public detachClient(clientId: number): void {
    for (const entry of this.sessions.values()) entry.attachedClients.delete(clientId);
  }

  private appendReplay(entry: TerminalSessionEntry, event: TerminalDataEvent): void {
    if (this.replayLimit <= 0) return;
    entry.replay.push(event);
    entry.replaySize += event.data.length;
    while (entry.replaySize > this.replayLimit && entry.replay.length > 1) {
      const removed = entry.replay.shift();
      if (removed) entry.replaySize -= removed.data.length;
    }
    const only = entry.replay[0];
    if (only && only.data.length > this.replayLimit) {
      const data = only.data.slice(-this.replayLimit);
      entry.replay[0] = { ...only, data };
      entry.replaySize = data.length;
    }
  }

  private toSnapshot(entry: TerminalSessionEntry): TerminalSessionSnapshot {
    return {
      ...entry.snapshot,
      attached: entry.attachedClients.size > 0,
    };
  }

  private requireSession(sessionId: string): TerminalSessionEntry {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Terminal session is not active: ${sessionId}`);
    return session;
  }
}
