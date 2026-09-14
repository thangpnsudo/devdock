import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseAgentCli, waitForDescriptor } from './agent-cli';

describe('parseAgentCli', () => {
  it('supports the common help aliases without starting the desktop app', () => {
    for (const argument of ['help', '-h', '--help', '-help']) {
      expect(parseAgentCli(['devdock', argument])).toEqual({ command: 'help' });
    }
  });

  it('opens a local terminal in the current directory for `devdock .`', () => {
    expect(parseAgentCli(['devdock', '.'])).toEqual({
      command: 'open-terminal',
      cwd: process.cwd(),
    });
    expect(parseAgentCli(['electron', '.', '.'])).toEqual({
      command: 'open-terminal',
      cwd: process.cwd(),
    });
    expect(parseAgentCli(['electron', '.', 'agent', 'list'])).toEqual({ command: 'list' });
  });

  it('supports provider shorthand with project and task options', () => {
    expect(parseAgentCli(['devdock', 'codex', '.'])).toMatchObject({
      command: 'start',
      provider: 'codex',
      cwd: process.cwd(),
    });
    expect(
      parseAgentCli([
        '/opt/DevDock/devdock',
        'agent',
        'codex',
        '--cwd',
        '/project',
        '--task',
        'Review changes',
        '--detach',
      ]),
    ).toEqual({
      command: 'start',
      provider: 'codex',
      cwd: '/project',
      task: 'Review changes',
      displayName: undefined,
      detach: true,
    });
    expect(parseAgentCli(['/opt/DevDock/devdock', 'codex', '--detach'])).toMatchObject({
      command: 'start',
      provider: 'codex',
      detach: true,
    });
    expect(parseAgentCli(['/opt/DevDock/devdock', 'claude', '--detach'])).toMatchObject({
      command: 'start',
      provider: 'claude-code',
      detach: true,
    });
    expect(parseAgentCli(['/opt/DevDock/devdock', 'agent', 'claude'])).toMatchObject({
      command: 'start',
      provider: 'claude-code',
    });
  });

  it('parses management commands and rejects missing ids', () => {
    expect(parseAgentCli(['devdock', 'agent', 'list'])).toEqual({ command: 'list' });
    expect(parseAgentCli(['devdock', 'agent', 'attach', 'agent-1'])).toEqual({
      command: 'attach',
      agentId: 'agent-1',
    });
    expect(parseAgentCli(['devdock', 'agent', 'remove', 'agent-1'])).toEqual({
      command: 'remove',
      agentId: 'agent-1',
    });
    expect(parseAgentCli(['devdock', 'agent', 'rename', 'agent-1', 'API', 'migration'])).toEqual({
      command: 'rename',
      agentId: 'agent-1',
      displayName: 'API migration',
    });
    expect(() => parseAgentCli(['devdock', 'agent', 'stop'])).toThrow('Agent id is required');
    expect(() => parseAgentCli(['devdock', 'agent', 'rename', 'agent-1'])).toThrow(
      'Agent name is required',
    );
  });

  it('parses project group orchestration commands', () => {
    expect(
      parseAgentCli([
        'devdock',
        'agent',
        'group',
        'start',
        'codex,claude',
        '--cwd',
        '/project',
        '--task',
        'Review project',
      ]),
    ).toEqual({
      command: 'group-start',
      providers: ['codex', 'claude-code'],
      cwd: '/project',
      task: 'Review project',
    });
    expect(parseAgentCli(['devdock', 'agent', 'group', 'stop', '--cwd', '/project'])).toEqual({
      command: 'group-stop',
      cwd: '/project',
    });
  });

  it('waits for a stale runtime descriptor to be replaced', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devdock-agent-cli-stale-'));
    const descriptorPath = join(directory, 'agent-runtime.json');
    writeFileSync(
      descriptorPath,
      JSON.stringify({ version: 1, endpoint: '/tmp/stale.sock', token: 'old', pid: 1 }),
    );
    setTimeout(
      () =>
        writeFileSync(
          descriptorPath,
          JSON.stringify({ version: 1, endpoint: '/tmp/new.sock', token: 'new', pid: 2 }),
        ),
      20,
    );

    await expect(waitForDescriptor(descriptorPath, 'old', 20, 5)).resolves.toMatchObject({
      endpoint: '/tmp/new.sock',
      token: 'new',
    });
  });
});
