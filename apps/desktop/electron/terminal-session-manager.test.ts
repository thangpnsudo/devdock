import { describe, expect, it } from 'vitest';

import {
  isSshPasswordPrompt,
  isExitedPtyResizeError,
  localShell,
  shellQuote,
  sshCommand,
  TerminalSessionManager,
} from './terminal-session-manager';

describe('PTY resize race detection', () => {
  it('suppresses only the node-pty already-exited resize error', () => {
    expect(isExitedPtyResizeError(new Error('Cannot resize a pty that has already exited'))).toBe(
      true,
    );
    expect(isExitedPtyResizeError(new Error('Invalid terminal dimensions'))).toBe(false);
  });
});

describe('localShell', () => {
  it('uses cmd.exe on Windows instead of a Unix shell', () => {
    expect(
      localShell('win32', {
        SystemRoot: 'C:\\Windows',
      }),
    ).toEqual({
      executable: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d'],
    });
  });
});

describe('SSH password prompt detection', () => {
  it('recognizes an OpenSSH password prompt without matching ordinary output', () => {
    expect(isSshPasswordPrompt("deploy@example.test's password: ")).toBe(true);
    expect(isSshPasswordPrompt('\u001b[31mPassword:\u001b[0m ')).toBe(true);
    expect(isSshPasswordPrompt('password authentication is enabled')).toBe(false);
  });
});

describe('SSH terminal working directory', () => {
  it('quotes remote paths and starts an interactive shell in that folder', () => {
    expect(shellQuote("/srv/developer's app")).toBe("'/srv/developer'\"'\"'s app'");
    const command = sshCommand({
      kind: 'ssh',
      host: 'server.example.test',
      username: 'deploy',
      remoteCwd: "/srv/developer's app",
    });
    expect(command.args.at(-1)).toBe(
      "cd -- '/srv/developer'\"'\"'s app' && exec \"${SHELL:-/bin/sh}\" -l",
    );
  });

  it('rejects control characters in a remote path', () => {
    expect(() =>
      sshCommand({
        kind: 'ssh',
        host: 'server.example.test',
        username: 'deploy',
        remoteCwd: '/srv/app\nmalicious',
      }),
    ).toThrow('Invalid remote terminal path');
  });
});

describe('TerminalSessionManager', () => {
  it('marks an explicit close as expected instead of a terminal failure', async () => {
    let resolveExit: ((event: import('./terminal-contract').TerminalExitEvent) => void) | undefined;
    const exited = new Promise<import('./terminal-contract').TerminalExitEvent>((resolve) => {
      resolveExit = resolve;
    });
    const manager = new TerminalSessionManager({
      onData: () => undefined,
      onExit: (event) => resolveExit?.(event),
    });
    const sessionId = manager.create({ kind: 'local' });

    manager.close(sessionId, 'agent-stopped');

    await expect(exited).resolves.toMatchObject({
      sessionId,
      expected: true,
      reason: 'agent-stopped',
    });
  });

  it('runs an interactive local shell and accepts keyboard input', async () => {
    const marker = `DEVDock_PTY_${Date.now()}`;
    let output = '';
    let resolveOutput: (() => void) | undefined;
    const received = new Promise<void>((resolve) => {
      resolveOutput = resolve;
    });

    const manager = new TerminalSessionManager({
      onData: ({ data }) => {
        output += data;
        if (output.includes(marker)) resolveOutput?.();
      },
      onExit: () => undefined,
    });

    const sessionId = manager.create({ kind: 'local', cols: 100, rows: 30 });
    manager.write(sessionId, `printf '${marker}\\n'\r`);

    await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`PTY output timed out: ${output}`)), 5000),
      ),
    ]);

    expect(output).toContain(marker);
    manager.resize(sessionId, 120, 40);
    manager.close(sessionId);
    expect(manager.has(sessionId)).toBe(false);
    expect(() => manager.resize(sessionId, 80, 24)).not.toThrow();
  });

  it('lists, detaches, and reattaches a live PTY with bounded output replay', async () => {
    const marker = `DEVDock_REATTACH_${Date.now()}`;
    let resolveOutput: (() => void) | undefined;
    const received = new Promise<void>((resolve) => {
      resolveOutput = resolve;
    });
    const manager = new TerminalSessionManager(
      {
        onData: ({ data }) => {
          if (data.includes(marker)) resolveOutput?.();
        },
        onExit: () => undefined,
      },
      512,
    );

    const sessionId = manager.create({ kind: 'local', cols: 90, rows: 25 });
    manager.write(sessionId, `printf '${marker}\\n'\r`);
    await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PTY replay output timed out')), 5000),
      ),
    ]);

    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: sessionId,
        kind: 'local',
        attached: false,
        cols: 90,
        rows: 25,
      }),
    ]);
    const attached = manager.attach(sessionId, 7);
    expect(attached.session.attached).toBe(true);
    expect(attached.replay.map(({ data }) => data).join('')).toContain(marker);
    expect(
      attached.replay.reduce((size, event) => size + event.data.length, 0),
    ).toBeLessThanOrEqual(512);

    manager.detach(sessionId, 7);
    const readOnly = manager.read(sessionId);
    expect(readOnly.replay.map(({ data }) => data).join('')).toContain(marker);
    expect(readOnly.session.attached).toBe(false);

    expect(manager.list()[0]?.attached).toBe(false);
    manager.rename(sessionId, 'Paster · agent review');
    expect(manager.list()[0]?.label).toBe('Paster · agent review');
    expect(manager.has(sessionId)).toBe(true);
    manager.close(sessionId);
  });
});
