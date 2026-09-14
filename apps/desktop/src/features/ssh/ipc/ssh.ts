// Typed Electron bridge for local and SSH terminals.

import type {
  ConnectSshRequest,
  CreateSshHostRequest,
  ListRecentHostsResponse,
  SaveCommandRequest,
  SshDataEvent,
  SshExecRequest,
  SshHostDto,
  SshResizeRequest,
  SshSessionIdDto,
  UpdateSshHostRequest,
} from '@devdock/types';

type UnlistenFn = () => void;
type OutputHandler = (payload: SshDataEvent) => void;
type ErrorHandler = (payload: {
  sessionId: string;
  code: string;
  message: string;
  category: string;
}) => void;

const electronOutputHandlers = new Map<string, Set<OutputHandler>>();
const ELECTRON_OUTPUT_LIMIT = 2_000_000;
const electronOutputHistory = new Map<string, ElectronTerminalDataEvent[]>();
const electronErrorHandlers = new Set<ErrorHandler>();
let electronListenersReady = false;

function stringToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ensureElectronListeners(): void {
  const bridge = window.devdockTerminal;
  if (!bridge || electronListenersReady) return;
  electronListenersReady = true;
  bridge.onData((event) => acceptElectronOutput(event));
  bridge.onExit(({ sessionId, exitCode, signal, expected, reason }) => {
    electronOutputHistory.delete(sessionId);
    electronOutputHandlers.delete(sessionId);
    window.dispatchEvent(
      new CustomEvent('devdock:terminal-exited', {
        detail: { sessionId, exitCode, signal, expected: Boolean(expected), reason },
      }),
    );
    if (expected || exitCode === 0) return;
    const signalText = signal === undefined ? '' : ` (signal ${signal})`;
    const payload = {
      sessionId,
      code: 'terminal_exit',
      message: `Terminal exited with code ${exitCode}${signalText}`,
      category: 'process',
    };
    for (const handler of electronErrorHandlers) handler(payload);
  });
}

function acceptElectronOutput({ sessionId, data, sequence }: ElectronTerminalDataEvent): void {
  const current = electronOutputHistory.get(sessionId) ?? [];
  if (current.some((event) => event.sequence === sequence)) return;
  current.push({ sessionId, data, sequence });
  current.sort((left, right) => left.sequence - right.sequence);
  let size = current.reduce((total, event) => total + event.data.length, 0);
  while (size > ELECTRON_OUTPUT_LIMIT && current.length > 1) {
    size -= current.shift()?.data.length ?? 0;
  }
  electronOutputHistory.set(sessionId, current);
  const handlers = electronOutputHandlers.get(sessionId);
  if (!handlers?.size) return;
  const payload = { sessionId, data: stringToBase64(data), at: Date.now() };
  for (const handler of handlers) handler(payload);
}

function terminalBridge(): ElectronTerminalBridge {
  if (!window.devdockTerminal) throw new Error('DevDock requires the Electron runtime.');
  return window.devdockTerminal;
}

function sshHostsBridge(): ElectronSshHostBridge {
  if (!window.devdockSshHosts) throw new Error('DevDock requires the Electron runtime.');
  return window.devdockSshHosts;
}

export const sshIpc = {
  async listTerminalSessions(): Promise<ElectronTerminalSessionSnapshot[]> {
    return terminalBridge().list();
  },
  async listHosts(): Promise<SshHostDto[]> {
    return sshHostsBridge().list();
  },
  async createHost(request: CreateSshHostRequest): Promise<{ id: string }> {
    return sshHostsBridge().create(request);
  },
  async updateHost(request: UpdateSshHostRequest): Promise<void> {
    return sshHostsBridge().update(request);
  },
  async deleteHost(id: string): Promise<void> {
    return sshHostsBridge().delete(id);
  },
  async listRecent(): Promise<ListRecentHostsResponse> {
    return sshHostsBridge().recent();
  },
  async connect(request: ConnectSshRequest): Promise<{ sessionId: SshSessionIdDto }> {
    const host = (await sshHostsBridge().list()).find(({ id }) => id === request.id);
    if (!host) throw new Error(`SSH host not found: ${request.id}`);
    return this.connectHost(host);
  },
  async connectHost(host: SshHostDto, remoteCwd?: string): Promise<{ sessionId: SshSessionIdDto }> {
    ensureElectronListeners();
    const result = await terminalBridge().create({
      kind: 'ssh',
      hostId: host.id,
      host: host.host,
      port: host.port,
      username: host.username,
      ...(remoteCwd ? { remoteCwd } : {}),
    });
    await sshHostsBridge().markConnected(host.id);
    return result;
  },
  async startLocalTerminal(cwd?: string): Promise<{ sessionId: SshSessionIdDto }> {
    ensureElectronListeners();
    return terminalBridge().create({ kind: 'local', ...(cwd ? { cwd } : {}) });
  },
  subscribeOutput(sessionId: string, onData: (payload: SshDataEvent) => void): Promise<UnlistenFn> {
    ensureElectronListeners();
    return terminalBridge()
      .attach(sessionId)
      .then(({ replay }) => {
        for (const event of replay) acceptElectronOutput(event);
        const handlers = electronOutputHandlers.get(sessionId) ?? new Set<OutputHandler>();
        handlers.add(onData);
        electronOutputHandlers.set(sessionId, handlers);
        const history = electronOutputHistory
          .get(sessionId)
          ?.map((event) => event.data)
          .join('');
        if (history) onData({ sessionId, data: stringToBase64(history), at: Date.now() });
        return () => {
          const current = electronOutputHandlers.get(sessionId);
          current?.delete(onData);
          if (!current?.size) {
            electronOutputHandlers.delete(sessionId);
            void window.devdockTerminal?.detach(sessionId).catch(() => undefined);
          }
        };
      });
  },
  async disconnect(sessionId: SshSessionIdDto): Promise<void> {
    electronOutputHandlers.delete(sessionId);
    electronOutputHistory.delete(sessionId);
    return terminalBridge().close(sessionId);
  },
  async exec(request: SshExecRequest): Promise<void> {
    return terminalBridge().write(request);
  },
  async resize(request: SshResizeRequest): Promise<void> {
    return terminalBridge().resize(request);
  },
  async saveCommand(request: SaveCommandRequest): Promise<{ id: string }> {
    if (!window.devdockLibrary) throw new Error('DevDock requires the Electron runtime.');
    const title = request.command.trim().split('\n')[0]?.slice(0, 80) || 'SSH command';
    return window.devdockLibrary.createScript({
      title,
      content: request.command,
      shell: 'sh',
      ...(request.description ? { description: request.description } : {}),
    });
  },
  /** Subscribe to terminal process errors. */
  async onSshError(
    handler: (payload: {
      sessionId: string;
      code: string;
      message: string;
      category: string;
    }) => void,
  ): Promise<UnlistenFn> {
    ensureElectronListeners();
    electronErrorHandlers.add(handler);
    return () => electronErrorHandlers.delete(handler);
  },
};

// Re-export the IPC types for downstream consumers.
export type {
  ConnectSshRequest,
  CreateSshHostRequest,
  ListRecentHostsResponse,
  SaveCommandRequest,
  SshDataEvent,
  SshExecRequest,
  SshHostDto,
  SshResizeRequest,
  SshSessionIdDto,
  UpdateSshHostRequest,
} from '@devdock/types';
