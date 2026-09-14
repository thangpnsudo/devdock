import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DevDockAgentApi } from './agent-api';
import type { AgentControlDescriptor, AgentControlMessage } from './agent-control-contract';
import { AgentControlServer } from './agent-control-server';

const servers: AgentControlServer[] = [];

afterEach(() => {
  servers.splice(0).forEach((server) => server.close());
});

function message(socket: ReturnType<typeof connect>): Promise<AgentControlMessage> {
  return new Promise((resolve) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline >= 0) resolve(JSON.parse(buffer.slice(0, newline)) as AgentControlMessage);
    });
  });
}

describe('AgentControlServer', () => {
  it('authenticates local requests and streams attached terminal data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'devdock-agent-control-'));
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\devdock-agent-test-${randomUUID()}`
        : join(directory, 'runtime.sock');
    const descriptorPath = join(directory, 'runtime.json');
    const api = {
      listAgents: vi.fn(() => []),
      removeAgent: vi.fn(),
      readAgentTerminal: vi.fn(() => ({
        session: {
          id: 'terminal-1',
          kind: 'local',
          purpose: 'agent',
          pid: 10,
          cwd: directory,
          cols: 80,
          rows: 24,
          createdAt: 1,
          lastActivityAt: 2,
          attached: false,
        },
        replay: [{ sessionId: 'terminal-1', data: 'replay', sequence: 1 }],
      })),
      writeAgentTerminal: vi.fn(),
    } as unknown as DevDockAgentApi;
    const openTerminal = vi.fn(() => ({ sessionId: 'local-1' }));
    const server = new AgentControlServer(api, endpoint, descriptorPath, openTerminal);
    servers.push(server);
    await server.start();

    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as AgentControlDescriptor;
    if (process.platform !== 'win32') {
      expect(statSync(descriptorPath).mode & 0o777).toBe(0o600);
      expect(statSync(endpoint).mode & 0o777).toBe(0o600);
    }
    const unauthorized = connect(endpoint);
    await new Promise<void>((resolve) => unauthorized.once('connect', resolve));
    const unauthorizedMessage = message(unauthorized);
    unauthorized.write(`${JSON.stringify({ id: 'bad', token: 'wrong', method: 'list' })}\n`);
    await expect(unauthorizedMessage).resolves.toMatchObject({ ok: false, error: 'Unauthorized.' });
    unauthorized.destroy();

    const client = connect(endpoint);
    await new Promise<void>((resolve) => client.once('connect', resolve));
    const attachMessage = message(client);
    client.write(
      `${JSON.stringify({ id: 'attach', token: descriptor.token, method: 'attach', agentId: 'agent-1' })}\n`,
    );
    await expect(attachMessage).resolves.toMatchObject({
      id: 'attach',
      ok: true,
      result: { replay: [{ data: 'replay' }] },
    });

    const outputMessage = message(client);
    server.publishData({ sessionId: 'terminal-1', data: 'live', sequence: 2 });
    await expect(outputMessage).resolves.toEqual({ type: 'output', data: 'live' });
    client.destroy();

    const removeClient = connect(endpoint);
    await new Promise<void>((resolve) => removeClient.once('connect', resolve));
    const removeMessage = message(removeClient);
    removeClient.write(
      `${JSON.stringify({ id: 'remove', token: descriptor.token, method: 'remove', agentId: 'agent-1' })}\n`,
    );
    await expect(removeMessage).resolves.toMatchObject({ id: 'remove', ok: true, result: null });
    expect(api.removeAgent).toHaveBeenCalledWith('agent-1');
    removeClient.destroy();

    const terminalClient = connect(endpoint);
    await new Promise<void>((resolve) => terminalClient.once('connect', resolve));
    const terminalMessage = message(terminalClient);
    terminalClient.write(
      `${JSON.stringify({ id: 'terminal', token: descriptor.token, method: 'open-terminal', cwd: directory })}\n`,
    );
    await expect(terminalMessage).resolves.toMatchObject({
      id: 'terminal',
      ok: true,
      result: { sessionId: 'local-1' },
    });
    expect(openTerminal).toHaveBeenCalledWith(directory);
    terminalClient.destroy();
  });
});
