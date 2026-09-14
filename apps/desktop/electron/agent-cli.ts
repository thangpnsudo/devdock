import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

import type { AgentProviderId, AgentSnapshot } from './agent-contract';
import type {
  AgentControlDescriptor,
  AgentControlMessage,
  AgentControlRequest,
} from './agent-control-contract';
import { agentControlDescriptorPath } from './agent-control-paths';

const PROVIDERS = new Set<AgentProviderId>(['codex', 'claude-code', 'opencode']);
const PROVIDER_ALIASES: Readonly<Record<string, AgentProviderId>> = {
  codex: 'codex',
  claude: 'claude-code',
  'claude-code': 'claude-code',
  opencode: 'opencode',
};
const HELP_FLAGS = new Set(['help', '-h', '--help', '-help']);
const HELP_TEXT = `DevDock command line

Usage:
  devdock                              Open the DevDock desktop app
  devdock .                            Open a DevDock terminal in this directory
  devdock <provider> [options]         Start and attach to a managed agent
  devdock agent <provider> [options]   Start and attach to a managed agent
  devdock agent list                   List managed agents
  devdock agent status <agent-id>      Show agent status
  devdock agent attach <agent-id>      Attach to an agent terminal
  devdock agent stop <agent-id>        Stop an agent
  devdock agent restart <agent-id>     Restart an agent
  devdock agent rename <agent-id> <name>
                                      Rename an agent and its terminal tab
  devdock agent remove <agent-id>      Stop and remove an agent
  devdock agent group start <providers> [options]
                                      Start multiple agents in one project
  devdock agent group stop --cwd <path>
                                      Stop active agents in a project
  devdock agent group restart --cwd <path>
                                      Restart the latest agent per provider

Providers:
  codex | claude | opencode
  (claude-code remains available as an alias)

Start options:
  --cwd <path>       Project directory (defaults to the current directory)
  --task <text>      Initial task or prompt
  --name <text>      Display name in DevDock
  --detach           Start without attaching to the terminal

General options:
  -h, --help, -help  Show this help
`;

export interface AgentCliInvocation {
  command:
    | 'help'
    | 'open-terminal'
    | 'start'
    | 'list'
    | 'status'
    | 'attach'
    | 'stop'
    | 'restart'
    | 'rename'
    | 'group-start'
    | 'group-stop'
    | 'group-restart'
    | 'remove';
  provider?: AgentProviderId;
  providers?: AgentProviderId[];
  agentId?: string;
  cwd?: string;
  task?: string;
  displayName?: string;
  detach?: boolean;
}

function option(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

export function parseAgentCli(arguments_: string[]): AgentCliInvocation | null {
  if (arguments_.slice(1).some((argument) => HELP_FLAGS.has(argument))) {
    return { command: 'help' };
  }
  const agentIndex = arguments_.indexOf('agent');
  const directProviderIndex = arguments_.findIndex(
    (value, index) => index > 0 && PROVIDER_ALIASES[value] !== undefined,
  );
  if (agentIndex < 0 && directProviderIndex < 0) {
    if (arguments_.at(-1) !== '.') return null;
    const cwd = resolve(process.cwd());
    if (!statSync(cwd).isDirectory()) throw new Error('Current path is not a directory.');
    return { command: 'open-terminal', cwd };
  }
  const values =
    agentIndex >= 0 ? arguments_.slice(agentIndex + 1) : arguments_.slice(directProviderIndex);
  const first = values[0];
  const directProvider = PROVIDER_ALIASES[first];
  const command = directProvider ? 'start' : first;
  if (command === 'group') {
    const action = values[1];
    if (!['start', 'stop', 'restart'].includes(action ?? '')) {
      throw new Error('Usage: devdock agent group <start|stop|restart>');
    }
    const cwd = option(values, '--cwd') ?? process.cwd();
    if (action === 'start') {
      const requestedProviders = (values[2] ?? '').split(',').filter(Boolean);
      const providers = requestedProviders.map((value) => PROVIDER_ALIASES[value]);
      if (providers.length === 0 || providers.some((value) => !value)) {
        throw new Error('Choose comma-separated agent providers.');
      }
      return {
        command: 'group-start',
        providers: providers as AgentProviderId[],
        cwd,
        task: option(values, '--task'),
      };
    }
    return { command: `group-${action}` as 'group-stop' | 'group-restart', cwd };
  }
  if (
    !['start', 'list', 'status', 'attach', 'stop', 'restart', 'rename', 'remove'].includes(
      command ?? '',
    )
  ) {
    throw new Error(
      'Usage: devdock agent <codex|claude|opencode|list|status|attach|stop|restart|rename|remove>',
    );
  }
  if (command === 'start') {
    const provider = directProvider ?? PROVIDER_ALIASES[values[1]];
    if (!provider || !PROVIDERS.has(provider))
      throw new Error('Choose codex, claude, or opencode.');
    return {
      command,
      provider,
      cwd: option(values, '--cwd') ?? process.cwd(),
      task: option(values, '--task'),
      displayName: option(values, '--name'),
      detach: values.includes('--detach'),
    };
  }
  if (command === 'list') return { command };
  const agentId = values[1];
  if (!agentId) throw new Error(`Agent id is required for ${command}.`);
  if (command === 'rename') {
    const displayName = values.slice(2).join(' ').trim();
    if (!displayName) throw new Error('Agent name is required for rename.');
    return { command, agentId, displayName };
  }
  return { command: command as AgentCliInvocation['command'], agentId };
}

function readDescriptor(path: string): AgentControlDescriptor {
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as AgentControlDescriptor;
  if (descriptor.version !== 1 || !descriptor.endpoint || !descriptor.token) {
    throw new Error('DevDock agent runtime descriptor is invalid.');
  }
  return descriptor;
}

export async function waitForDescriptor(
  path: string,
  previousToken = '',
  attempts = 300,
  delayMilliseconds = 100,
): Promise<AgentControlDescriptor> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const descriptor = readDescriptor(path);
      if (descriptor.token !== previousToken) return descriptor;
    } catch {
      // The runtime may not have created its descriptor yet.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
  }
  throw new Error('DevDock background runtime did not start.');
}

function openSocket(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint, () => resolve(socket));
    socket.once('error', reject);
  });
}

function request(socket: Socket, payload: AgentControlRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.off('data', onData);
      const message = JSON.parse(buffer.slice(0, newline)) as AgentControlMessage;
      if (!('ok' in message) || message.id !== payload.id) {
        reject(new Error('Unexpected DevDock runtime response.'));
      } else if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    };
    socket.on('data', onData);
    socket.write(`${JSON.stringify(payload)}\n`);
  });
}

function printAgent(agent: AgentSnapshot): void {
  process.stdout.write(
    `${agent.id}\t${agent.provider}\t${agent.status}\t${agent.displayName}\t${agent.cwd}\n`,
  );
}

async function attach(
  socket: Socket,
  descriptor: AgentControlDescriptor,
  agentId: string,
): Promise<void> {
  const id = randomUUID();
  let buffer = '';
  let attached = false;
  socket.removeAllListeners('data');
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line) as AgentControlMessage;
      if ('ok' in message && message.id === id) {
        if (!message.ok) {
          process.stderr.write(`[devdock] ${message.error}\n`);
          socket.destroy();
          return;
        }
        const result = message.result as { replay: Array<{ data: string }> };
        for (const event of result.replay) process.stdout.write(event.data);
        attached = true;
      } else if ('type' in message && message.type === 'output') process.stdout.write(message.data);
      else if ('type' in message && message.type === 'exit') {
        process.stdout.write(`\n[devdock] agent exited with code ${message.exitCode}\n`);
        socket.end();
      }
    }
  });
  socket.write(`${JSON.stringify({ id, token: descriptor.token, method: 'attach', agentId })}\n`);
  const resize = (): void => {
    if (!process.stdout.columns || !process.stdout.rows) return;
    socket.write(
      `${JSON.stringify({
        id: randomUUID(),
        token: descriptor.token,
        method: 'resize',
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      })}\n`,
    );
  };
  process.stdout.on('resize', resize);
  resize();
  process.stdout.write('[devdock] attached · press Ctrl+] to detach\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    if (data.includes(0x1d)) {
      socket.write(
        `${JSON.stringify({ id: randomUUID(), token: descriptor.token, method: 'detach' })}\n`,
      );
      socket.end();
      return;
    }
    if (attached) {
      socket.write(
        `${JSON.stringify({ id: randomUUID(), token: descriptor.token, method: 'input', data: data.toString('utf8') })}\n`,
      );
    }
  });
  await new Promise<void>((resolve) => socket.once('close', resolve));
  process.stdout.off('resize', resize);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

export async function runAgentCli(
  invocation: AgentCliInvocation,
  runtimeExecutable: string,
  runtimeArguments: string[],
  descriptorPath = agentControlDescriptorPath(),
): Promise<void> {
  if (invocation.command === 'help') {
    process.stdout.write(HELP_TEXT);
    return;
  }
  let descriptor: AgentControlDescriptor;
  let socket: Socket | null = null;
  let previousToken = '';
  try {
    descriptor = readDescriptor(descriptorPath);
    previousToken = descriptor.token;
    socket = await openSocket(descriptor.endpoint);
  } catch {
    const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...runtimeEnvironment } = process.env;
    const child = spawn(runtimeExecutable, runtimeArguments, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...runtimeEnvironment,
        DEVDOCK_USER_DATA_DIR: dirname(descriptorPath),
        DEVDOCK_AGENT_RUNTIME_FILE: descriptorPath,
      },
    });
    child.unref();
    descriptor = await waitForDescriptor(descriptorPath, previousToken);
    socket = await openSocket(descriptor.endpoint);
  }
  if (!socket) throw new Error('DevDock agent runtime is unavailable.');
  const id = randomUUID();
  if (invocation.command === 'open-terminal') {
    await request(socket, {
      id,
      token: descriptor.token,
      method: 'open-terminal',
      cwd: invocation.cwd!,
    });
    socket.end();
    return;
  }
  if (invocation.command === 'list') {
    const agents = (await request(socket, {
      id,
      token: descriptor.token,
      method: 'list',
    })) as AgentSnapshot[];
    if (agents.length === 0) process.stdout.write('No managed agents.\n');
    else agents.forEach(printAgent);
    socket.end();
    return;
  }
  if (invocation.command === 'start') {
    const agent = (await request(socket, {
      id,
      token: descriptor.token,
      method: 'start',
      provider: invocation.provider!,
      cwd: invocation.cwd!,
      ...(invocation.task ? { task: invocation.task } : {}),
      ...(invocation.displayName ? { displayName: invocation.displayName } : {}),
    })) as AgentSnapshot;
    printAgent(agent);
    if (invocation.detach) {
      socket.end();
      return;
    }
    await attach(socket, descriptor, agent.id);
    return;
  }
  if (invocation.command === 'group-start') {
    const agents = (await request(socket, {
      id,
      token: descriptor.token,
      method: 'group-start',
      providers: invocation.providers!,
      cwd: invocation.cwd!,
      ...(invocation.task ? { task: invocation.task } : {}),
    })) as AgentSnapshot[];
    agents.forEach(printAgent);
    socket.end();
    return;
  }
  if (invocation.command === 'group-stop' || invocation.command === 'group-restart') {
    const agents = (await request(socket, {
      id,
      token: descriptor.token,
      method: invocation.command,
      cwd: invocation.cwd!,
    })) as AgentSnapshot[];
    agents.forEach(printAgent);
    socket.end();
    return;
  }
  if (invocation.command === 'attach') {
    await attach(socket, descriptor, invocation.agentId!);
    return;
  }
  if (invocation.command === 'rename') {
    const result = await request(socket, {
      id,
      token: descriptor.token,
      method: 'rename',
      agentId: invocation.agentId!,
      displayName: invocation.displayName!,
    });
    if (result) printAgent(result as AgentSnapshot);
    socket.end();
    return;
  }
  const method = invocation.command;
  const result = await request(socket, {
    id,
    token: descriptor.token,
    method,
    agentId: invocation.agentId!,
  } as AgentControlRequest);
  if (result) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  socket.end();
}
