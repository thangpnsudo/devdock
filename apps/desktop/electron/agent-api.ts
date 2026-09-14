import type {
  AgentProviderDefinition,
  AgentSnapshot,
  StartAgentGroupRequest,
  StartAgentRequest,
} from './agent-contract';
import type { TerminalAttachResult } from './terminal-contract';

export interface AgentApiRuntime {
  providers(): AgentProviderDefinition[];
  list(): AgentSnapshot[];
  get(id: string): AgentSnapshot | null;
  start(request: StartAgentRequest): AgentSnapshot;
  startGroup(request: StartAgentGroupRequest): AgentSnapshot[];
  stopGroup(cwd: string): AgentSnapshot[];
  restartGroup(cwd: string): AgentSnapshot[];
  stop(id: string): AgentSnapshot;
  restart(id: string): AgentSnapshot;
  rename(id: string, displayName: string): AgentSnapshot;
  markSeen(id: string): AgentSnapshot;
  remove(id: string): void;
  onTerminalInput(sessionId: string): void;
}

export interface AgentTerminalApiRuntime {
  read(sessionId: string): TerminalAttachResult;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
}

export interface AgentStatusSnapshot {
  id: string;
  status: AgentSnapshot['status'];
  attention: AgentSnapshot['attention'];
  lastActivityAt: number;
  terminalAvailable: boolean;
}

/**
 * Transport-independent privileged API for the managed-agent runtime.
 * Electron IPC is one client; a future local transport can reuse this class
 * without moving process ownership out of Electron main.
 */
export class DevDockAgentApi {
  public constructor(
    private readonly agents: AgentApiRuntime,
    private readonly terminals: AgentTerminalApiRuntime,
  ) {}

  public providers(): AgentProviderDefinition[] {
    return this.agents.providers();
  }

  public listAgents(): AgentSnapshot[] {
    return this.agents.list();
  }

  public getAgent(id: string): AgentSnapshot | null {
    return this.agents.get(id);
  }

  public getAgentStatus(id: string): AgentStatusSnapshot | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return {
      id: agent.id,
      status: agent.status,
      attention: agent.attention,
      lastActivityAt: agent.lastActivityAt,
      terminalAvailable: agent.terminalAvailable,
    };
  }

  public startAgent(request: StartAgentRequest): AgentSnapshot {
    return this.agents.start(request);
  }

  public startAgentGroup(request: StartAgentGroupRequest): AgentSnapshot[] {
    return this.agents.startGroup(request);
  }

  public stopAgentGroup(cwd: string): AgentSnapshot[] {
    return this.agents.stopGroup(cwd);
  }

  public restartAgentGroup(cwd: string): AgentSnapshot[] {
    return this.agents.restartGroup(cwd);
  }

  public stopAgent(id: string): AgentSnapshot {
    return this.agents.stop(id);
  }

  public restartAgent(id: string): AgentSnapshot {
    return this.agents.restart(id);
  }

  public renameAgent(id: string, displayName: string): AgentSnapshot {
    return this.agents.rename(id, displayName);
  }

  public markAgentSeen(id: string): AgentSnapshot {
    return this.agents.markSeen(id);
  }

  public removeAgent(id: string): void {
    this.agents.remove(id);
  }

  public readAgentTerminal(id: string): TerminalAttachResult {
    const agent = this.requireLiveAgent(id);
    return this.terminals.read(agent.terminalSessionId);
  }

  public writeAgentTerminal(id: string, data: string): void {
    const agent = this.requireLiveAgent(id);
    this.terminals.write(agent.terminalSessionId, data);
    this.agents.onTerminalInput(agent.terminalSessionId);
  }

  public resizeAgentTerminal(id: string, cols: number, rows: number): void {
    const agent = this.requireLiveAgent(id);
    this.terminals.resize(agent.terminalSessionId, cols, rows);
  }

  private requireLiveAgent(id: string): AgentSnapshot {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent was not found: ${id}`);
    if (!agent.terminalAvailable) throw new Error('Agent terminal is no longer running.');
    return agent;
  }
}
