import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

import type { DevDockAgentApi } from './agent-api';
import type {
  AgentControlDescriptor,
  AgentControlMessage,
  AgentControlRequest,
} from './agent-control-contract';
import type { TerminalDataEvent, TerminalExitEvent } from './terminal-contract';

interface ClientState {
  socket: Socket;
  buffer: string;
  attachedSessionId?: string;
  attachedAgentId?: string;
}

function serialize(message: AgentControlMessage): string {
  return `${JSON.stringify(message)}\n`;
}

function safeTokenEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AgentControlServer {
  private server: Server | null = null;
  private readonly clients = new Set<ClientState>();
  private token = '';

  public constructor(
    private readonly api: DevDockAgentApi,
    private readonly endpoint: string,
    private readonly descriptorPath: string,
    private readonly openTerminal?: (cwd: string) => { sessionId: string },
  ) {}

  public async start(): Promise<void> {
    if (this.server) return;
    this.token = randomBytes(32).toString('base64url');
    if (process.platform !== 'win32') {
      try {
        unlinkSync(this.endpoint);
      } catch {
        // A missing stale socket is expected.
      }
    }
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') chmodSync(this.endpoint, 0o600);
    mkdirSync(dirname(this.descriptorPath), { recursive: true, mode: 0o700 });
    const descriptor: AgentControlDescriptor = {
      version: 1,
      endpoint: this.endpoint,
      token: this.token,
      pid: process.pid,
    };
    writeFileSync(this.descriptorPath, `${JSON.stringify(descriptor)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  public publishData(event: TerminalDataEvent): void {
    for (const client of this.clients) {
      if (client.attachedSessionId === event.sessionId) {
        client.socket.write(serialize({ type: 'output', data: event.data }));
      }
    }
  }

  public publishExit(event: TerminalExitEvent): void {
    for (const client of this.clients) {
      if (client.attachedSessionId !== event.sessionId) continue;
      client.socket.write(serialize({ type: 'exit', exitCode: event.exitCode }));
      client.attachedSessionId = undefined;
    }
  }

  public close(): void {
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    this.server?.close();
    this.server = null;
    try {
      unlinkSync(this.descriptorPath);
    } catch {
      // Descriptor may already be absent during a partial startup.
    }
    if (process.platform !== 'win32') {
      try {
        unlinkSync(this.endpoint);
      } catch {
        // Socket may already be absent during a partial startup.
      }
    }
  }

  private accept(socket: Socket): void {
    const client: ClientState = { socket, buffer: '' };
    this.clients.add(client);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.read(client, chunk));
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private read(client: ClientState, chunk: string): void {
    client.buffer += chunk;
    if (client.buffer.length > 1024 * 1024) {
      client.socket.destroy(new Error('Agent control request is too large.'));
      return;
    }
    while (true) {
      const newline = client.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = client.buffer.slice(0, newline);
      client.buffer = client.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const request = JSON.parse(line) as AgentControlRequest;
        this.handle(client, request);
      } catch (error) {
        client.socket.write(
          serialize({
            id: 'invalid',
            ok: false,
            error: error instanceof Error ? error.message : 'Invalid control request.',
          }),
        );
      }
    }
  }

  private handle(client: ClientState, request: AgentControlRequest): void {
    if (!safeTokenEqual(request.token, this.token)) {
      client.socket.write(serialize({ id: request.id, ok: false, error: 'Unauthorized.' }));
      return;
    }
    try {
      let result: unknown;
      switch (request.method) {
        case 'open-terminal':
          if (!this.openTerminal) throw new Error('Terminal launcher is unavailable.');
          result = this.openTerminal(request.cwd);
          break;
        case 'list':
          result = this.api.listAgents();
          break;
        case 'group-start':
          result = this.api.startAgentGroup({
            providers: request.providers,
            cwd: request.cwd,
            ...(request.task ? { task: request.task } : {}),
          });
          break;
        case 'group-stop':
          result = this.api.stopAgentGroup(request.cwd);
          break;
        case 'group-restart':
          result = this.api.restartAgentGroup(request.cwd);
          break;
        case 'status':
          result = this.api.getAgentStatus(request.agentId);
          break;
        case 'start':
          result = this.api.startAgent({
            provider: request.provider,
            cwd: request.cwd,
            ...(request.task ? { task: request.task } : {}),
            ...(request.displayName ? { displayName: request.displayName } : {}),
          });
          break;
        case 'stop':
          result = this.api.stopAgent(request.agentId);
          break;
        case 'restart':
          result = this.api.restartAgent(request.agentId);
          break;
        case 'rename':
          result = this.api.renameAgent(request.agentId, request.displayName);
          break;
        case 'remove':
          this.api.removeAgent(request.agentId);
          result = null;
          break;
        case 'attach': {
          const attached = this.api.readAgentTerminal(request.agentId);
          client.attachedSessionId = attached.session.id;
          client.attachedAgentId = request.agentId;
          result = attached;
          break;
        }
        case 'input':
          if (!client.attachedSessionId) throw new Error('Attach an agent before sending input.');
          if (!client.attachedAgentId) throw new Error('Attached agent was not found.');
          this.api.writeAgentTerminal(client.attachedAgentId, request.data);
          result = null;
          break;
        case 'resize':
          if (!client.attachedAgentId) throw new Error('Attach an agent before resizing.');
          this.api.resizeAgentTerminal(client.attachedAgentId, request.cols, request.rows);
          result = null;
          break;
        case 'detach':
          client.attachedSessionId = undefined;
          client.attachedAgentId = undefined;
          result = null;
          break;
      }
      client.socket.write(serialize({ id: request.id, ok: true, result }));
    } catch (error) {
      client.socket.write(
        serialize({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
