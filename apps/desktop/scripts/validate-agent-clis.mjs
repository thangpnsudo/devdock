import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const home = homedir();
const commonDirectories =
  process.platform === 'win32'
    ? [
        process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pnpm') : '',
        join(home, '.bun', 'bin'),
      ]
    : [
        join(home, '.local', 'bin'),
        join(home, '.npm-global', 'bin'),
        join(home, '.volta', 'bin'),
        join(home, '.bun', 'bin'),
        join(home, '.local', 'share', 'pnpm'),
        join(home, 'Library', 'pnpm'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
      ];
try {
  const nvmRoot = join(home, '.nvm', 'versions', 'node');
  for (const entry of readdirSync(nvmRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) commonDirectories.push(join(nvmRoot, entry.name, 'bin'));
  }
} catch {
  // NVM is optional.
}
const searchPath = [...commonDirectories, process.env.PATH ?? ''].filter(Boolean).join(delimiter);

const providers = [
  {
    name: 'Codex',
    executable: 'codex',
    expected: /Usage:\s+codex[^\n]*\[PROMPT\]/iu,
  },
  {
    name: 'Claude Code',
    executable: 'claude',
    expected: /Usage:\s+claude[^\n]*\[prompt\]/iu,
  },
  {
    name: 'OpenCode',
    executable: 'opencode',
    expected: /--prompt\s+prompt to use/iu,
  },
];

for (const provider of providers) {
  const help = spawnSync(provider.executable, ['--help'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: searchPath },
    timeout: 10_000,
  });
  if (help.error || help.status !== 0) {
    const detail =
      help.error?.message ?? `${help.stderr ?? help.stdout ?? ''}`.trim().slice(0, 240);
    throw new Error(
      `${provider.name} CLI is unavailable or its help command failed${detail ? `: ${detail}` : '.'}`,
    );
  }
  const output = `${help.stdout ?? ''}\n${help.stderr ?? ''}`;
  if (!provider.expected.test(output)) {
    throw new Error(`${provider.name} CLI syntax is incompatible with the DevDock adapter.`);
  }
  console.info(`[agent-provider] ${provider.name}: compatible`);
}
