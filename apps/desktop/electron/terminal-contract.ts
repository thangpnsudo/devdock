export type TerminalKind = 'local' | 'ssh';

export interface CreateTerminalRequest {
  kind: TerminalKind;
  cols?: number;
  rows?: number;
  cwd?: string;
  host?: string;
  port?: number;
  username?: string;
  identityFile?: string;
  hostId?: string;
  password?: string;
  remoteCwd?: string;
}

export interface TerminalDataEvent {
  sessionId: string;
  data: string;
  sequence: number;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number;
  signal?: number;
  expected?: boolean;
  reason?: 'closed' | 'agent-stopped' | 'agent-restarted' | 'shutdown';
}

export interface TerminalResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalWriteRequest {
  sessionId: string;
  data: string;
}

export interface TerminalCloseRequest {
  sessionId: string;
}

export interface TerminalSessionSnapshot {
  id: string;
  kind: TerminalKind;
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

export interface TerminalAttachResult {
  session: TerminalSessionSnapshot;
  replay: TerminalDataEvent[];
}
