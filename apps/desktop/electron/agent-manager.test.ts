import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentManager,
  resolveAgentExecutable,
  type AgentPersistence,
  type AgentTerminalRuntime,
} from './agent-manager';

const resolveTestExecutable = (executable: string): string => `/test/bin/${executable}`;

function runtime(): AgentTerminalRuntime & {
  active: Set<string>;
  requests: Parameters<AgentTerminalRuntime['createManaged']>[0][];
  labels: Map<string, string>;
  writes: Array<{ id: string; data: string }>;
} {
  let next = 0;
  const active = new Set<string>();
  const requests: Parameters<AgentTerminalRuntime['createManaged']>[0][] = [];
  const labels = new Map<string, string>();
  const writes: Array<{ id: string; data: string }> = [];
  return {
    active,
    requests,
    labels,
    writes,
    createManaged: (request) => {
      requests.push(request);
      const id = `terminal-${++next}`;
      active.add(id);
      if (request.label) labels.set(id, request.label);
      return id;
    },
    close: (id) => {
      active.delete(id);
    },
    has: (id) => active.has(id),
    rename: (id, label) => {
      labels.set(id, label);
    },
    write: (id, data) => {
      writes.push({ id, data });
    },
  };
}

describe('AgentManager', () => {
  it('resolves an installed provider from PATH without executing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'devdock-agent-path-'));
    const executable = join(directory, process.platform === 'win32' ? 'codex.CMD' : 'codex');
    writeFileSync(
      executable,
      process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n',
    );
    chmodSync(executable, 0o755);

    const environment = { PATH: directory, PATHEXT: '.EXE;.CMD' };
    const resolved = resolveAgentExecutable('codex', environment, directory);
    if (process.platform === 'win32') {
      expect(resolved?.toLocaleLowerCase()).toBe(executable.toLocaleLowerCase());
    } else {
      expect(resolved).toBe(executable);
    }
    expect(resolveAgentExecutable('claude', environment, directory)).toBeNull();
  });

  it('starts, tracks output, stops, and restarts through the terminal runtime', () => {
    const terminal = runtime();
    const onChanged = vi.fn();
    const manager = new AgentManager(terminal, { onChanged }, undefined, resolveTestExecutable);
    const agent = manager.start({ provider: 'codex', cwd: process.cwd(), task: 'Inspect tests' });

    expect(agent.status).toBe('starting');
    expect(agent.displayName).toContain('Inspect tests');
    expect(terminal.requests[0]?.args).toEqual(['Inspect tests']);
    expect(terminal.active.has(agent.terminalSessionId)).toBe(true);
    manager.onTerminalData({ sessionId: agent.terminalSessionId, data: 'ready', sequence: 1 });
    expect(manager.get(agent.id)?.status).toBe('working');

    const restarted = manager.restart(agent.id);
    expect(restarted.id).toBe(agent.id);
    expect(restarted.terminalSessionId).not.toBe(agent.terminalSessionId);
    expect(terminal.requests[1]?.args).toEqual(['resume', '--last']);
    expect(terminal.active.has(agent.terminalSessionId)).toBe(false);
    expect(manager.stop(agent.id).status).toBe('stopped');
    expect(manager.hasActiveAgents()).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });

  it('renames an agent and its live terminal label', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });

    expect(agent.displayName).toContain('Codex');
    expect(manager.rename(agent.id, 'Paster · auth review').displayName).toBe(
      'Paster · auth review',
    );
    expect(terminal.labels.get(agent.terminalSessionId)).toBe('Paster · auth review');
  });

  it('starts and controls a project group across providers', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );

    const agents = manager.startGroup({
      providers: ['codex', 'claude-code'],
      cwd: '.',
      task: 'Review project',
    });
    expect(agents).toHaveLength(2);
    expect(new Set(agents.map((agent) => agent.provider))).toEqual(
      new Set(['codex', 'claude-code']),
    );
    expect(agents.every((agent) => agent.cwd === process.cwd())).toBe(true);
    expect(agents[0]?.displayName).not.toBe(agents[1]?.displayName);
    expect(manager.stopGroup('.')).toHaveLength(2);
    expect(manager.hasActiveAgents()).toBe(false);
    expect(manager.restartGroup('.')).toHaveLength(2);
  });

  it('still stops and removes an active agent when PTY kill races with process exit', () => {
    const terminal = runtime();
    terminal.close = () => {
      throw new Error('kill ESRCH');
    };
    const stored = new Map<string, Parameters<AgentPersistence['upsertManagedAgent']>[0]>();
    const persistence: AgentPersistence = {
      listManagedAgents: () => [],
      upsertManagedAgent: (agent) => stored.set(agent.id, agent),
      deleteManagedAgent: (id) => {
        stored.delete(id);
      },
    };
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      persistence,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });

    expect(manager.stop(agent.id)).toEqual(
      expect.objectContaining({ status: 'stopped', terminalAvailable: false }),
    );
    expect(manager.get(agent.id)?.error).toContain('kill ESRCH');
    manager.remove(agent.id);
    expect(manager.get(agent.id)).toBeNull();
    expect(stored.has(agent.id)).toBe(false);
  });

  it('stops an active agent automatically before removing it', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });

    manager.remove(agent.id);

    expect(terminal.active.has(agent.terminalSessionId)).toBe(false);
    expect(manager.get(agent.id)).toBeNull();
  });

  it('marks unexpected non-zero exits as errors needing attention', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'claude-code', cwd: process.cwd() });

    manager.onTerminalExit({ sessionId: agent.terminalSessionId, exitCode: 127 });

    expect(manager.get(agent.id)).toEqual(
      expect.objectContaining({
        status: 'error',
        attention: 'unseen-result',
        error: 'Process exited with code 127.',
      }),
    );
  });

  it('uses a strict terminal prompt as blocked evidence until the user responds', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });

    manager.onTerminalData({
      sessionId: agent.terminalSessionId,
      data: 'Do you want to proceed?',
      sequence: 1,
    });
    expect(manager.get(agent.id)).toEqual(
      expect.objectContaining({
        status: 'blocked',
        attention: 'needs-input',
      }),
    );

    manager.markSeen(agent.id);
    expect(manager.get(agent.id)?.attention).toBe('needs-input');

    manager.onTerminalInput(agent.terminalSessionId);
    expect(manager.get(agent.id)).toEqual(
      expect.objectContaining({
        status: 'working',
        attention: 'none',
      }),
    );
  });

  it('applies a remote response only to the exact blocked terminal', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });
    manager.onTerminalData({
      sessionId: agent.terminalSessionId,
      data: '1. Yes, proceed\n2. No',
      sequence: 1,
    });

    expect(manager.applyRemoteResponse(agent.id, 'wrong-terminal', { kind: 'approved' })).toBe(
      false,
    );
    expect(
      manager.applyRemoteResponse(agent.id, agent.terminalSessionId, { kind: 'approved' }),
    ).toBe(true);
    expect(terminal.writes).toEqual([{ id: agent.terminalSessionId, data: '1\r' }]);
    expect(manager.get(agent.id)?.status).toBe('working');
  });

  it('keeps an actionable provider authentication error after process exit', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      resolveTestExecutable,
    );
    const agent = manager.start({ provider: 'codex', cwd: process.cwd() });

    manager.onTerminalData({
      sessionId: agent.terminalSessionId,
      data: '401 Unauthorized',
      sequence: 1,
    });
    manager.onTerminalExit({ sessionId: agent.terminalSessionId, exitCode: 1 });

    expect(manager.get(agent.id)).toEqual(
      expect.objectContaining({
        status: 'error',
        error: expect.stringContaining('codex login'),
      }),
    );
  });

  it('automatically resumes persisted active records after restart', () => {
    const terminal = runtime();
    const stored = new Map([
      [
        'agent-persisted',
        {
          id: 'agent-persisted',
          terminalSessionId: 'terminal-gone',
          provider: 'opencode' as const,
          displayName: 'Persisted agent',
          cwd: process.cwd(),
          status: 'working' as const,
          attention: 'none' as const,
          startedAt: 10,
          lastActivityAt: 20,
          terminalAvailable: false,
        },
      ],
    ]);
    const persistence: AgentPersistence = {
      listManagedAgents: () => [...stored.values()],
      upsertManagedAgent: (agent) => stored.set(agent.id, agent),
      deleteManagedAgent: (id) => {
        stored.delete(id);
      },
    };
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      persistence,
      resolveTestExecutable,
    );

    expect(manager.get('agent-persisted')).toEqual(
      expect.objectContaining({ status: 'working', terminalAvailable: false }),
    );
    const [restarted] = manager.recoverInterrupted();
    expect(restarted).toEqual(
      expect.objectContaining({
        status: 'starting',
        terminalAvailable: true,
      }),
    );
    manager.stop('agent-persisted');
    manager.remove('agent-persisted');
    expect(manager.get('agent-persisted')).toBeNull();
    expect(stored.has('agent-persisted')).toBe(false);
  });

  it('reports unavailable providers before attempting to create a PTY', () => {
    const terminal = runtime();
    const manager = new AgentManager(
      terminal,
      { onChanged: () => undefined },
      undefined,
      () => null,
    );

    expect(manager.providers().every((provider) => !provider.available)).toBe(true);
    expect(() => manager.start({ provider: 'codex', cwd: process.cwd() })).toThrow(
      'Codex CLI is not installed',
    );
    expect(terminal.active.size).toBe(0);
  });
});
