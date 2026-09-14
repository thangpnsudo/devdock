import { contextBridge, ipcRenderer } from 'electron';

import type {
  CreateTerminalRequest,
  TerminalAttachResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalResizeRequest,
  TerminalSessionSnapshot,
  TerminalWriteRequest,
} from './terminal-contract';
import type {
  AgentChangedEvent,
  AgentProviderDefinition,
  AgentSnapshot,
  StartAgentRequest,
} from './agent-contract';
import type { AgentStatusSnapshot } from './agent-api';

contextBridge.exposeInMainWorld('devdockTerminal', {
  list: (): Promise<TerminalSessionSnapshot[]> => ipcRenderer.invoke('terminal:list'),
  attach: (sessionId: string): Promise<TerminalAttachResult> =>
    ipcRenderer.invoke('terminal:attach', sessionId),
  detach: (sessionId: string): Promise<void> => ipcRenderer.invoke('terminal:detach', sessionId),
  create: (request: CreateTerminalRequest): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke('terminal:create', request),
  write: (request: TerminalWriteRequest): Promise<void> =>
    ipcRenderer.invoke('terminal:write', request),
  resize: (request: TerminalResizeRequest): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', request),
  close: (sessionId: string): Promise<void> => ipcRenderer.invoke('terminal:close', { sessionId }),
  onData: (handler: (event: TerminalDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void =>
      handler(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onExit: (handler: (event: TerminalExitEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void =>
      handler(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },
  onFocusRequested: (handler: (event: { sessionId: string }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string },
    ): void => handler(payload);
    ipcRenderer.on('terminal:focus-requested', listener);
    return () => ipcRenderer.removeListener('terminal:focus-requested', listener);
  },
  onPasteShortcut: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('terminal:paste-shortcut', listener);
    return () => ipcRenderer.removeListener('terminal:paste-shortcut', listener);
  },
});

contextBridge.exposeInMainWorld('devdockAgents', {
  providers: (): Promise<AgentProviderDefinition[]> => ipcRenderer.invoke('agent:providers'),
  list: (): Promise<AgentSnapshot[]> => ipcRenderer.invoke('agent:list'),
  get: (id: string): Promise<AgentSnapshot | null> => ipcRenderer.invoke('agent:get', id),
  status: (id: string): Promise<AgentStatusSnapshot | null> =>
    ipcRenderer.invoke('agent:status', id),
  start: (request: StartAgentRequest): Promise<AgentSnapshot> =>
    ipcRenderer.invoke('agent:start', request),
  startGroup: (request: import('./agent-contract').StartAgentGroupRequest): Promise<AgentSnapshot[]> =>
    ipcRenderer.invoke('agent:group-start', request),
  stopGroup: (cwd: string): Promise<AgentSnapshot[]> => ipcRenderer.invoke('agent:group-stop', cwd),
  restartGroup: (cwd: string): Promise<AgentSnapshot[]> =>
    ipcRenderer.invoke('agent:group-restart', cwd),
  stop: (id: string): Promise<AgentSnapshot> => ipcRenderer.invoke('agent:stop', id),
  restart: (id: string): Promise<AgentSnapshot> => ipcRenderer.invoke('agent:restart', id),
  rename: (id: string, displayName: string): Promise<AgentSnapshot> =>
    ipcRenderer.invoke('agent:rename', id, displayName),
  markSeen: (id: string): Promise<AgentSnapshot> => ipcRenderer.invoke('agent:mark-seen', id),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('agent:remove', id),
  readTerminal: (id: string): Promise<TerminalAttachResult> =>
    ipcRenderer.invoke('agent:terminal-read', id),
  writeTerminal: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('agent:terminal-write', id, data),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('agent:choose-directory'),
  onChanged: (handler: (event: AgentChangedEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentChangedEvent): void =>
      handler(payload);
    ipcRenderer.on('agent:changed', listener);
    return () => ipcRenderer.removeListener('agent:changed', listener);
  },
  onFocusRequested: (
    handler: (event: { agentId: string; sessionId: string }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { agentId: string; sessionId: string },
    ): void => handler(payload);
    ipcRenderer.on('agent:focus-requested', listener);
    return () => ipcRenderer.removeListener('agent:focus-requested', listener);
  },
});

contextBridge.exposeInMainWorld('devdockSshHosts', {
  list: (): Promise<unknown[]> => ipcRenderer.invoke('ssh-host:list'),
  create: (request: unknown): Promise<{ id: string }> =>
    ipcRenderer.invoke('ssh-host:create', request),
  update: (request: unknown): Promise<void> => ipcRenderer.invoke('ssh-host:update', request),
  delete: (id: string): Promise<void> => ipcRenderer.invoke('ssh-host:delete', id),
  recent: (): Promise<{ hosts: unknown[] }> => ipcRenderer.invoke('ssh-host:recent'),
  markConnected: (id: string): Promise<void> => ipcRenderer.invoke('ssh-host:mark-connected', id),
});

contextBridge.exposeInMainWorld('devdockLibrary', {
  listRecent: (limit: number): Promise<unknown[]> =>
    ipcRenderer.invoke('library:list-recent', limit),
  listPage: (request: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('library:list-page', request),
  count: (filter?: unknown): Promise<number> => ipcRenderer.invoke('library:count', filter),
  get: (id: string): Promise<unknown> => ipcRenderer.invoke('library:get', id),
  createScript: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke('library:create-script', request),
  updateScript: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke('library:update-script', request),
  createResource: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke('library:create-resource', request),
  updateResource: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke('library:update-resource', request),
  archive: (id: string): Promise<unknown> => ipcRenderer.invoke('library:archive', id),
  restore: (id: string): Promise<unknown> => ipcRenderer.invoke('library:restore', id),
  delete: (id: string): Promise<unknown> => ipcRenderer.invoke('library:delete', id),
  deleteMany: (ids: string[]): Promise<unknown> => ipcRenderer.invoke('library:delete-many', ids),
  toggleFavorite: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('library:toggle-favorite', id),
  search: (request: unknown): Promise<unknown> => ipcRenderer.invoke('library:search', request),
});

contextBridge.exposeInMainWorld('devdockClipboard', {
  list: (request: unknown): Promise<unknown[]> => ipcRenderer.invoke('clipboard:list', request),
  count: (request: unknown): Promise<number> => ipcRenderer.invoke('clipboard:count', request),
  pin: (id: string): Promise<unknown> => ipcRenderer.invoke('clipboard:pin', id),
  delete: (id: string): Promise<unknown> => ipcRenderer.invoke('clipboard:delete', id),
  deleteMany: (ids: string[]): Promise<unknown> => ipcRenderer.invoke('clipboard:delete-many', ids),
  update: (request: unknown): Promise<void> => ipcRenderer.invoke('clipboard:update', request),
  record: (request: unknown): Promise<unknown> => ipcRenderer.invoke('clipboard:record', request),
  copyText: (content: string): Promise<void> => ipcRenderer.invoke('clipboard:copy-text', content),
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  copyStored: (id: string): Promise<void> => ipcRenderer.invoke('clipboard:copy-stored', id),
  markSaved: (request: unknown): Promise<void> =>
    ipcRenderer.invoke('clipboard:mark-saved', request),
  thumbnail: (id: string): Promise<string | null> => ipcRenderer.invoke('clipboard:thumbnail', id),
});

contextBridge.exposeInMainWorld('devdockSettings', {
  get: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
  save: (request: unknown): Promise<unknown> => ipcRenderer.invoke('settings:save', request),
});

contextBridge.exposeInMainWorld('devdockSftp', {
  list: (request: unknown): Promise<unknown[]> => ipcRenderer.invoke('sftp:list', request),
  localHome: (): Promise<string> => ipcRenderer.invoke('sftp:local-home'),
  listLocal: (request: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('sftp:list-local', request),
  mkdirLocal: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:mkdir-local', request),
  removeLocal: (request: unknown): Promise<void> =>
    ipcRenderer.invoke('sftp:remove-local', request),
  mkdir: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:mkdir', request),
  remove: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:remove', request),
  transfer: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:transfer', request),
  upload: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:upload', request),
  download: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:download', request),
  renameItem: (request: unknown): Promise<void> => ipcRenderer.invoke('sftp:rename-item', request),
  removeItems: (request: unknown): Promise<void> =>
    ipcRenderer.invoke('sftp:remove-items', request),
  transferItems: (request: unknown): Promise<void> =>
    ipcRenderer.invoke('sftp:transfer-items', request),
});
