import type { AgentProviderId } from './agent-contract';

export interface AgentControlDescriptor {
  version: 1;
  endpoint: string;
  token: string;
  pid: number;
}

export type AgentControlRequest =
  | { id: string; token: string; method: 'open-terminal'; cwd: string }
  | { id: string; token: string; method: 'list' }
  | {
      id: string;
      token: string;
      method: 'group-start';
      providers: AgentProviderId[];
      cwd: string;
      task?: string;
    }
  | { id: string; token: string; method: 'group-stop' | 'group-restart'; cwd: string }
  | { id: string; token: string; method: 'status'; agentId: string }
  | { id: string; token: string; method: 'rename'; agentId: string; displayName: string }
  | {
      id: string;
      token: string;
      method: 'start';
      provider: AgentProviderId;
      cwd: string;
      task?: string;
      displayName?: string;
    }
  | { id: string; token: string; method: 'stop' | 'restart' | 'remove' | 'attach'; agentId: string }
  | { id: string; token: string; method: 'input'; data: string }
  | { id: string; token: string; method: 'resize'; cols: number; rows: number }
  | { id: string; token: string; method: 'detach' };

export type AgentControlMessage =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number };
