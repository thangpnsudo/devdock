import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function defaultDevDockUserData(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (environment.DEVDOCK_USER_DATA_DIR) return environment.DEVDOCK_USER_DATA_DIR;
  if (platform === 'win32')
    return join(environment.APPDATA ?? join(home, 'AppData', 'Roaming'), 'DevDock');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'DevDock');
  return join(environment.XDG_CONFIG_HOME ?? join(home, '.config'), 'DevDock');
}

export function agentControlDescriptorPath(userData = defaultDevDockUserData()): string {
  return process.env.DEVDOCK_AGENT_RUNTIME_FILE ?? join(userData, 'agent-runtime.json');
}

export function agentControlEndpoint(userData = defaultDevDockUserData()): string {
  if (process.env.DEVDOCK_AGENT_ENDPOINT) return process.env.DEVDOCK_AGENT_ENDPOINT;
  if (process.platform === 'win32') {
    const safeUser = Buffer.from(userData).toString('hex').slice(-32);
    return `\\\\.\\pipe\\devdock-agent-${safeUser}`;
  }
  // Unix domain sockets have a small platform-specific path limit (108 bytes
  // on macOS/Linux). Application Support paths and test temp directories can
  // exceed it, so keep the endpoint in the OS temp directory and derive a
  // stable, collision-resistant name from the user-data directory.
  const identity = createHash('sha256').update(userData).digest('hex').slice(0, 24);
  return join(tmpdir(), `devdock-agent-${identity}.sock`);
}
