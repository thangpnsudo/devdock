import { describe, expect, it, vi } from 'vitest';

import type { AgentSnapshot } from './agent-contract';
import { DevDockAgentApi, type AgentApiRuntime, type AgentTerminalApiRuntime } from './agent-api';

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-1',
    terminalSessionId: 'terminal-1',
    provider: 'codex',
    displayName: 'Codex',
    cwd: '/project',
    status: 'working',
    attention: 'none',
    startedAt: 10,
    lastActivityAt: 20,
    terminalAvailable: true,
    ...overrides,
  };
}

function runtime(agent: AgentSnapshot | null): AgentApiRuntime {
  return {
    providers: vi.fn(() => []),
    list: vi.fn(() => (agent ? [agent] : [])),
    get: vi.fn((id: string) => (agent?.id === id ? agent : null)),
    start: vi.fn(() => snapshot()),
    startGroup: vi.fn(() => [snapshot()]),
    stopGroup: vi.fn(() => [snapshot({ status: 'stopped', terminalAvailable: false })]),
    restartGroup: vi.fn(() => [snapshot({ terminalSessionId: 'terminal-2' })]),
    stop: vi.fn(() => snapshot({ status: 'stopped', terminalAvailable: false })),
    restart: vi.fn(() => snapshot({ terminalSessionId: 'terminal-2' })),
    rename: vi.fn((_id, displayName) => snapshot({ displayName })),
    markSeen: vi.fn(() => snapshot()),
    remove: vi.fn(),
    onTerminalInput: vi.fn(),
  };
}

describe('DevDockAgentApi', () => {
  it('returns a minimal status projection without terminal replay', () => {
    const api = new DevDockAgentApi(runtime(snapshot()), {
      read: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    });

    expect(api.getAgentStatus('agent-1')).toEqual({
      id: 'agent-1',
      status: 'working',
      attention: 'none',
      lastActivityAt: 20,
      terminalAvailable: true,
    });
    expect(api.getAgentStatus('missing')).toBeNull();
  });

  it('renames through the shared runtime API', () => {
    const agents = runtime(snapshot());
    const api = new DevDockAgentApi(agents, { read: vi.fn(), write: vi.fn(), resize: vi.fn() });

    expect(api.renameAgent('agent-1', 'Project · review').displayName).toBe('Project · review');
    expect(agents.rename).toHaveBeenCalledWith('agent-1', 'Project · review');
  });

  it('maps read and write to the agent terminal without attaching a client', () => {
    const terminals: AgentTerminalApiRuntime = {
      read: vi.fn(() => ({
        session: {
          id: 'terminal-1',
          kind: 'local',
          purpose: 'agent',
          pid: 42,
          cwd: '/project',
          cols: 120,
          rows: 32,
          createdAt: 10,
          lastActivityAt: 20,
          attached: false,
        },
        replay: [{ sessionId: 'terminal-1', data: 'ready\r\n', sequence: 1 }],
      })),
      write: vi.fn(),
      resize: vi.fn(),
    };
    const agents = runtime(snapshot({ status: 'blocked', attention: 'needs-input' }));
    const api = new DevDockAgentApi(agents, terminals);

    expect(api.readAgentTerminal('agent-1').replay[0]?.data).toBe('ready\r\n');
    api.writeAgentTerminal('agent-1', 'continue\r');

    expect(terminals.read).toHaveBeenCalledWith('terminal-1');
    expect(agents.onTerminalInput).toHaveBeenCalledWith('terminal-1');
    expect(terminals.write).toHaveBeenCalledWith('terminal-1', 'continue\r');
  });

  it('rejects terminal access for missing or finished agents', () => {
    const terminals: AgentTerminalApiRuntime = {
      read: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    };

    expect(() =>
      new DevDockAgentApi(runtime(null), terminals).readAgentTerminal('missing'),
    ).toThrow('Agent was not found');
    expect(() =>
      new DevDockAgentApi(
        runtime(snapshot({ status: 'stopped', terminalAvailable: false })),
        terminals,
      ).writeAgentTerminal('agent-1', 'input'),
    ).toThrow('no longer running');
    expect(terminals.read).not.toHaveBeenCalled();
    expect(terminals.write).not.toHaveBeenCalled();
  });

  it('does not change agent state when terminal input is rejected', () => {
    const agents = runtime(snapshot({ status: 'blocked', attention: 'needs-input' }));
    const terminals: AgentTerminalApiRuntime = {
      read: vi.fn(),
      write: vi.fn(() => {
        throw new Error('Invalid terminal input.');
      }),
      resize: vi.fn(),
    };
    const api = new DevDockAgentApi(agents, terminals);

    expect(() => api.writeAgentTerminal('agent-1', 'invalid')).toThrow('Invalid terminal input');
    expect(agents.onTerminalInput).not.toHaveBeenCalled();
  });
});
