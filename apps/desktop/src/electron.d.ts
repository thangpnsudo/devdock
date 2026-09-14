interface ElectronTerminalCreateRequest {
  kind: 'local' | 'ssh';
  cols?: number;
  rows?: number;
  cwd?: string;
  host?: string;
  port?: number;
  username?: string;
  identityFile?: string;
  hostId?: string;
  remoteCwd?: string;
}

interface ElectronTerminalDataEvent {
  sessionId: string;
  data: string;
  sequence: number;
}

interface ElectronTerminalSessionSnapshot {
  id: string;
  kind: 'local' | 'ssh';
  purpose: 'terminal' | 'agent';
  label?: string;
  pid: number;
  cwd?: string;
  host?: string;
  port?: number;
  username?: string;
  remoteCwd?: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivityAt: number;
  attached: boolean;
}

interface ElectronTerminalExitEvent {
  sessionId: string;
  exitCode: number;
  signal?: number;
  expected?: boolean;
  reason?: 'closed' | 'agent-stopped' | 'agent-restarted' | 'shutdown';
}

interface ElectronTerminalBridge {
  list(): Promise<ElectronTerminalSessionSnapshot[]>;
  attach(sessionId: string): Promise<{
    session: ElectronTerminalSessionSnapshot;
    replay: ElectronTerminalDataEvent[];
  }>;
  detach(sessionId: string): Promise<void>;
  create(request: ElectronTerminalCreateRequest): Promise<{ sessionId: string }>;
  write(request: { sessionId: string; data: string }): Promise<void>;
  resize(request: { sessionId: string; cols: number; rows: number }): Promise<void>;
  close(sessionId: string): Promise<void>;
  onData(handler: (event: ElectronTerminalDataEvent) => void): () => void;
  onExit(handler: (event: ElectronTerminalExitEvent) => void): () => void;
  onFocusRequested(handler: (event: { sessionId: string }) => void): () => void;
  onPasteShortcut(handler: () => void): () => void;
}

type ElectronAgentProviderId = 'claude-code' | 'codex' | 'opencode';
type ElectronAgentStatus =
  'starting' | 'working' | 'blocked' | 'idle' | 'stopped' | 'exited' | 'error' | 'unknown';

interface ElectronAgentSnapshot {
  id: string;
  terminalSessionId: string;
  provider: ElectronAgentProviderId;
  displayName: string;
  cwd: string;
  task?: string;
  status: ElectronAgentStatus;
  attention: 'none' | 'unseen-result' | 'needs-input';
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
  error?: string;
  terminalAvailable: boolean;
}

interface ElectronAgentBridge {
  providers(): Promise<
    Array<{
      id: ElectronAgentProviderId;
      displayName: string;
      executable: string;
      available: boolean;
    }>
  >;
  list(): Promise<ElectronAgentSnapshot[]>;
  get(id: string): Promise<ElectronAgentSnapshot | null>;
  status(id: string): Promise<{
    id: string;
    status: ElectronAgentStatus;
    attention: ElectronAgentSnapshot['attention'];
    lastActivityAt: number;
    terminalAvailable: boolean;
  } | null>;
  start(request: {
    provider: ElectronAgentProviderId;
    cwd: string;
    task?: string;
    displayName?: string;
  }): Promise<ElectronAgentSnapshot>;
  startGroup(request: {
    providers: ElectronAgentProviderId[];
    cwd: string;
    task?: string;
  }): Promise<ElectronAgentSnapshot[]>;
  stopGroup(cwd: string): Promise<ElectronAgentSnapshot[]>;
  restartGroup(cwd: string): Promise<ElectronAgentSnapshot[]>;
  stop(id: string): Promise<ElectronAgentSnapshot>;
  restart(id: string): Promise<ElectronAgentSnapshot>;
  rename(id: string, displayName: string): Promise<ElectronAgentSnapshot>;
  markSeen(id: string): Promise<ElectronAgentSnapshot>;
  remove(id: string): Promise<void>;
  readTerminal(id: string): Promise<{
    session: ElectronTerminalSessionSnapshot;
    replay: ElectronTerminalDataEvent[];
  }>;
  writeTerminal(id: string, data: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  onChanged(handler: (event: { agent: ElectronAgentSnapshot }) => void): () => void;
  onFocusRequested(handler: (event: { agentId: string; sessionId: string }) => void): () => void;
}

interface ElectronSshHostBridge {
  list(): Promise<import('@devdock/types').SshHostDto[]>;
  create(request: import('@devdock/types').CreateSshHostRequest): Promise<{ id: string }>;
  update(request: import('@devdock/types').UpdateSshHostRequest): Promise<void>;
  delete(id: string): Promise<void>;
  recent(): Promise<import('@devdock/types').ListRecentHostsResponse>;
  markConnected(id: string): Promise<void>;
}

interface ElectronLibraryBridge {
  listRecent(limit: number): Promise<import('@devdock/types').LibraryItemDto[]>;
  listPage(request: {
    limit: number;
    offset: number;
    filter?: import('@devdock/types').LibraryResourceFilter;
  }): Promise<import('@devdock/types').LibraryItemDto[]>;
  count(filter?: import('@devdock/types').LibraryResourceFilter): Promise<number>;
  get(id: string): Promise<import('@devdock/types').LibraryItemDto | null>;
  createScript(
    request: import('@devdock/types').CreateScriptRequest,
  ): Promise<import('@devdock/types').CreateScriptResponse>;
  updateScript(
    request: import('@devdock/types').UpdateScriptRequest,
  ): Promise<import('@devdock/types').UpdateScriptResponse>;
  createResource(
    request: import('@devdock/types').CreateLibraryResourceRequest,
  ): Promise<import('@devdock/types').CreateScriptResponse>;
  updateResource(
    request: import('@devdock/types').UpdateLibraryResourceRequest,
  ): Promise<import('@devdock/types').UpdateScriptResponse>;
  archive(id: string): Promise<import('@devdock/types').ArchiveItemResponse>;
  restore(id: string): Promise<import('@devdock/types').RestoreItemResponse>;
  delete(id: string): Promise<import('@devdock/types').DeleteItemResponse>;
  deleteMany(ids: string[]): Promise<import('@devdock/types').DeleteItemResponse>;
  toggleFavorite(id: string): Promise<import('@devdock/types').ToggleFavoriteResponse>;
  search(
    request: import('@devdock/types').SearchLibraryRequest,
  ): Promise<import('@devdock/types').SearchLibraryResponse>;
}

interface ElectronClipboardBridge {
  list(
    request: import('@devdock/types').ListClipboardHistoryRequest,
  ): Promise<import('@devdock/types').ClipboardItemDto[]>;
  count(
    request: Pick<import('@devdock/types').ListClipboardHistoryRequest, 'pinnedOnly' | 'query'>,
  ): Promise<number>;
  pin(id: string): Promise<{ pinned: boolean }>;
  delete(id: string): Promise<{ success: boolean }>;
  deleteMany(ids: string[]): Promise<{ success: boolean }>;
  update(request: import('@devdock/types').UpdateClipboardItemRequest): Promise<void>;
  record(
    request: import('@devdock/types').RecordClipboardCaptureRequest,
  ): Promise<import('@devdock/types').RecordClipboardCaptureResponse>;
  copyText(content: string): Promise<void>;
  readText(): Promise<string>;
  copyStored(id: string): Promise<void>;
  markSaved(request: { id: string; scriptId: string }): Promise<void>;
  thumbnail(id: string): Promise<string | null>;
}

interface ElectronSettingsBridge {
  get(): Promise<import('@devdock/types').SettingsDto>;
  save(request: import('@devdock/types').SaveSettingsRequest): Promise<{ updatedAt: number }>;
}

interface ElectronSftpEntry {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link';
  size: number;
  modifiedAt: number;
}

type ElectronFileEndpoint =
  { kind: 'local' } | { kind: 'remote'; hostId: string; credential?: string };

interface ElectronSftpBridge {
  list(request: {
    hostId: string;
    path: string;
    credential?: string;
  }): Promise<ElectronSftpEntry[]>;
  localHome(): Promise<string>;
  listLocal(request: { path: string }): Promise<ElectronSftpEntry[]>;
  mkdirLocal(request: { path: string }): Promise<void>;
  removeLocal(request: { path: string; directory: boolean }): Promise<void>;
  mkdir(request: { hostId: string; path: string; credential?: string }): Promise<void>;
  remove(request: {
    hostId: string;
    path: string;
    directory: boolean;
    credential?: string;
  }): Promise<void>;
  transfer(request: {
    sourceHostId: string;
    sourcePath: string;
    targetHostId: string;
    targetDirectory: string;
    sourceCredential?: string;
    targetCredential?: string;
  }): Promise<void>;
  upload(request: {
    hostId: string;
    localPaths: string[];
    targetDirectory: string;
    credential?: string;
  }): Promise<void>;
  download(request: {
    hostId: string;
    remotePaths: string[];
    targetDirectory: string;
    credential?: string;
  }): Promise<void>;
  renameItem(request: {
    endpoint: ElectronFileEndpoint;
    path: string;
    nextPath: string;
  }): Promise<void>;
  removeItems(request: { endpoint: ElectronFileEndpoint; paths: string[] }): Promise<void>;
  transferItems(request: {
    source: ElectronFileEndpoint;
    target: ElectronFileEndpoint;
    sourcePaths: string[];
    targetDirectory: string;
    mode: 'copy' | 'move';
  }): Promise<void>;
}

interface Window {
  devdockTerminal?: ElectronTerminalBridge;
  devdockAgents?: ElectronAgentBridge;
  devdockSshHosts?: ElectronSshHostBridge;
  devdockLibrary?: ElectronLibraryBridge;
  devdockClipboard?: ElectronClipboardBridge;
  devdockSettings?: ElectronSettingsBridge;
  devdockSftp?: ElectronSftpBridge;
  __devdockTerminalSmoke?: Promise<string>;
}
