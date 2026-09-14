export type AgentProviderId = 'claude-code' | 'codex' | 'opencode';

export type AgentStatus =
  'starting' | 'working' | 'blocked' | 'idle' | 'stopped' | 'exited' | 'error' | 'unknown';

export type AgentAttention = 'none' | 'unseen-result' | 'needs-input';

export interface StartAgentRequest {
  provider: AgentProviderId;
  cwd: string;
  task?: string;
  displayName?: string;
}

export interface StartAgentGroupRequest {
  providers: AgentProviderId[];
  cwd: string;
  task?: string;
}

export interface AgentSnapshot {
  id: string;
  terminalSessionId: string;
  provider: AgentProviderId;
  displayName: string;
  cwd: string;
  task?: string;
  status: AgentStatus;
  attention: AgentAttention;
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
  error?: string;
  terminalAvailable: boolean;
}

export interface AgentProviderDefinition {
  id: AgentProviderId;
  displayName: string;
  executable: string;
  available: boolean;
}

export interface AgentChangedEvent {
  agent: AgentSnapshot;
}
