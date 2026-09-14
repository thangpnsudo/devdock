import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';

import type { TerminalDataEvent, TerminalExitEvent } from './terminal-contract';
import type { ManagedTerminalRequest } from './terminal-session-manager';
import type {
  AgentProviderDefinition,
  AgentSnapshot,
  StartAgentGroupRequest,
  StartAgentRequest,
} from './agent-contract';
import {
  agentProvider,
  agentProviders,
  providerResponseInput,
  type RemoteAgentResponse,
} from './agent-providers';

const ACTIVE_STATUSES = new Set<AgentSnapshot['status']>([
  'starting',
  'working',
  'blocked',
  'idle',
]);

export interface AgentPersistence {
  listManagedAgents(limit?: number): AgentSnapshot[];
  upsertManagedAgent(agent: AgentSnapshot): void;
  deleteManagedAgent(id: string): void;
}

export type AgentExecutableResolver = (executable: string) => string | null;

function executableDirectories(environment: NodeJS.ProcessEnv, home: string): string[] {
  const paths = (environment.PATH ?? environment.Path ?? '').split(delimiter).filter(Boolean);
  const common =
    process.platform === 'win32'
      ? [
          environment.APPDATA ? join(environment.APPDATA, 'npm') : '',
          environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, 'pnpm') : '',
          join(home, '.bun', 'bin'),
        ]
      : [
          join(home, '.local', 'bin'),
          join(home, '.npm-global', 'bin'),
          join(home, '.volta', 'bin'),
          join(home, '.bun', 'bin'),
          join(home, '.cargo', 'bin'),
          join(home, '.local', 'share', 'pnpm'),
          join(home, 'Library', 'pnpm'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
        ];
  const nvmRoot = join(home, '.nvm', 'versions', 'node');
  try {
    for (const entry of readdirSync(nvmRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) common.push(join(nvmRoot, entry.name, 'bin'));
    }
  } catch {
    // NVM is optional.
  }
  return [...new Set([...paths, ...common].filter(Boolean))];
}

export function resolveAgentExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  const extensions =
    process.platform === 'win32' ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  const executableExists = (candidate: string): boolean => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  for (const directory of executableDirectories(environment, home)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${executable}${extension.toLocaleLowerCase()}`);
      const originalCaseCandidate = join(directory, `${executable}${extension}`);
      if (executableExists(candidate)) return candidate;
      if (candidate !== originalCaseCandidate && executableExists(originalCaseCandidate)) {
        return originalCaseCandidate;
      }
    }
  }
  return null;
}

export interface AgentTerminalRuntime {
  createManaged(request: ManagedTerminalRequest): string;
  close(sessionId: string, reason?: 'agent-stopped' | 'agent-restarted'): void;
  has(sessionId: string): boolean;
  rename(sessionId: string, label: string): void;
  write(sessionId: string, data: string): void;
}

export interface AgentManagerEvents {
  onChanged: (agent: AgentSnapshot) => void;
}

interface ManagedAgent {
  snapshot: AgentSnapshot;
  request: StartAgentRequest;
  recentOutput: string;
}

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, '');
}

function cloneAgent(agent: AgentSnapshot): AgentSnapshot {
  return { ...agent };
}

export function defaultAgentDisplayName(providerName: string, cwd: string, task?: string): string {
  const projectName = basename(cwd) || cwd;
  const taskSummary = task?.replace(/\s+/gu, ' ').trim();
  return `${projectName} · ${providerName}${taskSummary ? ` · ${taskSummary}` : ''}`.slice(0, 80);
}

function validateStartRequest(request: StartAgentRequest): StartAgentRequest {
  const cwd = resolve(request.cwd.trim());
  if (!cwd || cwd.includes('\0') || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error('Choose an existing project directory before starting an agent.');
  }
  if (!agentProviders().some((provider) => provider.id === request.provider)) {
    throw new Error('Unsupported agent provider.');
  }
  const task = request.task?.trim();
  if (task && task.length > 20_000) throw new Error('Agent task is too long.');
  const displayName = request.displayName?.trim();
  if (displayName && displayName.length > 80) throw new Error('Agent name is too long.');
  return {
    ...request,
    cwd,
    ...(task ? { task } : { task: undefined }),
    ...(displayName ? { displayName } : { displayName: undefined }),
  };
}

export class AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly terminalAgents = new Map<string, string>();

  public constructor(
    private readonly terminalRuntime: AgentTerminalRuntime,
    private readonly events: AgentManagerEvents,
    private readonly persistence?: AgentPersistence,
    private readonly executableResolver: AgentExecutableResolver = resolveAgentExecutable,
  ) {
    this.restorePersistedAgents();
  }

  public providers(): AgentProviderDefinition[] {
    return agentProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      executable: provider.executable,
      available: Boolean(this.executableResolver(provider.executable)),
    }));
  }

  public list(): AgentSnapshot[] {
    return [...this.agents.values()]
      .map(({ snapshot }) => cloneAgent(snapshot))
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  public get(id: string): AgentSnapshot | null {
    const agent = this.agents.get(id)?.snapshot;
    return agent ? cloneAgent(agent) : null;
  }

  public start(input: StartAgentRequest): AgentSnapshot {
    const request = validateStartRequest(input);
    const provider = agentProvider(request.provider);
    const executable = this.executableResolver(provider.executable);
    if (!executable) {
      throw new Error(`${provider.displayName} CLI is not installed or is not available in PATH.`);
    }
    const displayName =
      request.displayName ??
      defaultAgentDisplayName(provider.displayName, request.cwd, request.task);
    const sessionId = this.terminalRuntime.createManaged({
      executable,
      args: provider.args(request.task),
      cwd: request.cwd,
      label: displayName,
    });
    const now = Date.now();
    const snapshot: AgentSnapshot = {
      id: randomUUID(),
      terminalSessionId: sessionId,
      provider: provider.id,
      displayName,
      cwd: request.cwd,
      ...(request.task ? { task: request.task } : {}),
      status: 'starting',
      attention: 'none',
      startedAt: now,
      lastActivityAt: now,
      terminalAvailable: true,
    };
    this.agents.set(snapshot.id, { snapshot, request, recentOutput: '' });
    this.terminalAgents.set(sessionId, snapshot.id);
    this.emit(snapshot);
    return cloneAgent(snapshot);
  }

  public startGroup(input: StartAgentGroupRequest): AgentSnapshot[] {
    const providers = [...new Set(input.providers)];
    if (providers.length === 0 || providers.length > 8) {
      throw new Error('Choose between 1 and 8 agent providers for a group.');
    }
    const started: AgentSnapshot[] = [];
    try {
      for (const provider of providers) {
        started.push(
          this.start({
            provider,
            cwd: input.cwd,
            ...(input.task ? { task: input.task } : {}),
          }),
        );
      }
      return started;
    } catch (error) {
      for (const agent of started) this.remove(agent.id);
      throw error;
    }
  }

  public stopGroup(cwd: string): AgentSnapshot[] {
    const normalizedCwd = resolve(cwd);
    return this.list()
      .filter((agent) => agent.cwd === normalizedCwd && ACTIVE_STATUSES.has(agent.status))
      .map((agent) => this.stop(agent.id));
  }

  public restartGroup(cwd: string): AgentSnapshot[] {
    const normalizedCwd = resolve(cwd);
    const latestByProvider = new Map<AgentSnapshot['provider'], AgentSnapshot>();
    for (const agent of this.list().filter((item) => item.cwd === normalizedCwd)) {
      if (!latestByProvider.has(agent.provider)) latestByProvider.set(agent.provider, agent);
    }
    return [...latestByProvider.values()].map((agent) => this.restart(agent.id));
  }

  public recoverInterrupted(): AgentSnapshot[] {
    const recovered: AgentSnapshot[] = [];
    for (const agent of this.list().filter((item) => ACTIVE_STATUSES.has(item.status))) {
      try {
        recovered.push(this.restart(agent.id));
      } catch (error) {
        const managed = this.requireAgent(agent.id);
        managed.snapshot.status = 'error';
        managed.snapshot.attention = 'unseen-result';
        managed.snapshot.terminalAvailable = false;
        managed.snapshot.error = `Automatic recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.emit(managed.snapshot);
      }
    }
    return recovered;
  }

  public prepareForShutdown(): void {
    for (const managed of this.agents.values()) {
      if (!ACTIVE_STATUSES.has(managed.snapshot.status)) continue;
      managed.snapshot.terminalAvailable = false;
      this.persistence?.upsertManagedAgent(managed.snapshot);
    }
  }

  public stop(id: string): AgentSnapshot {
    const managed = this.requireAgent(id);
    const sessionId = managed.snapshot.terminalSessionId;
    this.terminalAgents.delete(sessionId);
    let closeError: unknown;
    if (this.terminalRuntime.has(sessionId)) {
      try {
        this.terminalRuntime.close(sessionId, 'agent-stopped');
      } catch (error) {
        closeError = error;
      }
    }
    const now = Date.now();
    Object.assign(managed.snapshot, {
      status: 'stopped' as const,
      attention: 'none' as const,
      finishedAt: now,
      lastActivityAt: now,
      terminalAvailable: false,
      ...(closeError
        ? {
            error: `Agent process was detached after stop failed: ${
              closeError instanceof Error ? closeError.message : String(closeError)
            }`,
          }
        : { error: undefined }),
    });
    this.emit(managed.snapshot);
    return cloneAgent(managed.snapshot);
  }

  public restart(id: string): AgentSnapshot {
    const managed = this.requireAgent(id);
    const previousSessionId = managed.snapshot.terminalSessionId;
    this.terminalAgents.delete(previousSessionId);
    if (this.terminalRuntime.has(previousSessionId)) {
      try {
        this.terminalRuntime.close(previousSessionId, 'agent-restarted');
      } catch {
        // A PTY can exit between the presence check and kill. Restart still creates
        // a fresh session and must not leave the UI action permanently broken.
      }
    }
    const provider = agentProvider(managed.request.provider);
    const executable = this.executableResolver(provider.executable);
    if (!executable) {
      throw new Error(`${provider.displayName} CLI is not installed or is not available in PATH.`);
    }
    const sessionId = this.terminalRuntime.createManaged({
      executable,
      args: provider.resumeArgs(),
      cwd: managed.request.cwd,
      label: managed.snapshot.displayName,
    });
    const now = Date.now();
    managed.snapshot = {
      ...managed.snapshot,
      terminalSessionId: sessionId,
      status: 'starting',
      attention: 'none',
      startedAt: now,
      lastActivityAt: now,
      finishedAt: undefined,
      error: undefined,
      terminalAvailable: true,
    };
    managed.recentOutput = '';
    this.terminalAgents.set(sessionId, id);
    this.emit(managed.snapshot);
    return cloneAgent(managed.snapshot);
  }

  public markSeen(id: string): AgentSnapshot {
    const managed = this.requireAgent(id);
    if (managed.snapshot.attention === 'unseen-result') {
      managed.snapshot.attention = 'none';
      this.emit(managed.snapshot);
    }
    return cloneAgent(managed.snapshot);
  }

  public inputContext(id: string): string {
    return this.agents.get(id)?.recentOutput ?? '';
  }

  public applyRemoteResponse(
    id: string,
    terminalSessionId: string,
    response: RemoteAgentResponse,
  ): boolean {
    const managed = this.agents.get(id);
    if (
      !managed ||
      managed.snapshot.terminalSessionId !== terminalSessionId ||
      managed.snapshot.status !== 'blocked' ||
      managed.snapshot.attention !== 'needs-input' ||
      !managed.snapshot.terminalAvailable ||
      !this.terminalRuntime.has(terminalSessionId)
    ) {
      return false;
    }
    const input = providerResponseInput(managed.snapshot.provider, managed.recentOutput, response);
    this.terminalRuntime.write(terminalSessionId, input);
    this.onTerminalInput(terminalSessionId);
    return true;
  }

  public rename(id: string, displayName: string): AgentSnapshot {
    const managed = this.requireAgent(id);
    const normalized = displayName.trim();
    if (!normalized) throw new Error('Agent name is required.');
    if (normalized.length > 80) throw new Error('Agent name is too long.');
    if (
      managed.snapshot.terminalAvailable &&
      this.terminalRuntime.has(managed.snapshot.terminalSessionId)
    ) {
      this.terminalRuntime.rename(managed.snapshot.terminalSessionId, normalized);
    }
    managed.snapshot.displayName = normalized;
    managed.request = { ...managed.request, displayName: normalized };
    this.emit(managed.snapshot);
    return cloneAgent(managed.snapshot);
  }

  public onTerminalData(event: TerminalDataEvent): void {
    const id = this.terminalAgents.get(event.sessionId);
    if (!id) return;
    const managed = this.agents.get(id);
    if (!managed) return;
    managed.snapshot.lastActivityAt = Date.now();
    managed.recentOutput = stripTerminalControlSequences(
      `${managed.recentOutput}${event.data}`.slice(-2_000),
    );
    const provider = agentProvider(managed.snapshot.provider);
    const configurationError = provider.configurationError(managed.recentOutput);
    if (configurationError) {
      if (managed.snapshot.status !== 'blocked' || managed.snapshot.error !== configurationError) {
        managed.snapshot.status = 'blocked';
        managed.snapshot.attention = 'needs-input';
        managed.snapshot.error = configurationError;
        this.emit(managed.snapshot);
      }
      return;
    }
    if (provider.needsInput(managed.recentOutput)) {
      if (managed.snapshot.status !== 'blocked' || managed.snapshot.attention !== 'needs-input') {
        managed.snapshot.status = 'blocked';
        managed.snapshot.attention = 'needs-input';
        this.emit(managed.snapshot);
      }
      return;
    }
    if (managed.snapshot.status === 'starting') {
      managed.snapshot.status = 'working';
      this.emit(managed.snapshot);
    }
  }

  public onTerminalInput(sessionId: string): void {
    const id = this.terminalAgents.get(sessionId);
    if (!id) return;
    const managed = this.agents.get(id);
    if (!managed) return;
    if (managed.snapshot.status === 'blocked' || managed.snapshot.status === 'idle') {
      managed.snapshot.status = 'working';
      managed.snapshot.attention = 'none';
      managed.snapshot.lastActivityAt = Date.now();
      managed.recentOutput = '';
      managed.snapshot.error = undefined;
      this.emit(managed.snapshot);
    }
  }

  public onTerminalExit(event: TerminalExitEvent): void {
    const id = this.terminalAgents.get(event.sessionId);
    if (!id) return;
    this.terminalAgents.delete(event.sessionId);
    const managed = this.agents.get(id);
    if (!managed) return;
    if (event.expected && event.reason === 'shutdown') {
      managed.snapshot.terminalAvailable = false;
      return;
    }
    const now = Date.now();
    managed.snapshot.status = event.exitCode === 0 ? 'exited' : 'error';
    managed.snapshot.attention = 'unseen-result';
    managed.snapshot.finishedAt = now;
    managed.snapshot.lastActivityAt = now;
    managed.snapshot.terminalAvailable = false;
    if (event.exitCode !== 0 && !managed.snapshot.error)
      managed.snapshot.error = `Process exited with code ${event.exitCode}.`;
    this.emit(managed.snapshot);
  }

  public hasActiveAgents(): boolean {
    return [...this.agents.values()].some(({ snapshot }) => ACTIVE_STATUSES.has(snapshot.status));
  }

  public remove(id: string): void {
    const managed = this.requireAgent(id);
    if (ACTIVE_STATUSES.has(managed.snapshot.status)) {
      this.stop(id);
    }
    this.agents.delete(id);
    this.persistence?.deleteManagedAgent(id);
  }

  private requireAgent(id: string): ManagedAgent {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent was not found: ${id}`);
    return agent;
  }

  private emit(agent: AgentSnapshot): void {
    this.persistence?.upsertManagedAgent(agent);
    this.events.onChanged(cloneAgent(agent));
  }

  private restorePersistedAgents(): void {
    for (const persisted of this.persistence?.listManagedAgents(100) ?? []) {
      const wasActive = ACTIVE_STATUSES.has(persisted.status);
      const snapshot: AgentSnapshot = {
        ...persisted,
        status: persisted.status,
        attention: wasActive ? 'none' : persisted.attention,
        terminalAvailable: false,
        ...(wasActive ? { finishedAt: undefined, error: undefined } : {}),
      };
      this.agents.set(snapshot.id, {
        snapshot,
        request: {
          provider: snapshot.provider,
          cwd: snapshot.cwd,
          ...(snapshot.task ? { task: snapshot.task } : {}),
          displayName: snapshot.displayName,
        },
        recentOutput: '',
      });
      if (wasActive) this.persistence?.upsertManagedAgent(snapshot);
    }
  }
}
