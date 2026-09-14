import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import electron from 'electron';

const executableIndex = process.argv.indexOf('--executable');
const packagedExecutable = executableIndex >= 0 ? process.argv[executableIndex + 1] : undefined;
const root = mkdtempSync(join(tmpdir(), 'devdock-agent-cli-smoke-'));
const userData = join(root, 'profile');
const dataHome = join(root, 'data');
const fakeBin = join(root, 'bin');
const descriptorPath = join(userData, 'agent-runtime.json');
const uiCapturePath = join(root, 'background-runtime-window.png');
mkdirSync(userData, { recursive: true });
mkdirSync(dataHome, { recursive: true });
mkdirSync(fakeBin, { recursive: true });
const fakeProviderScript =
  process.platform === 'win32'
    ? '@echo off\r\necho DEVDock_CLI_SMOKE\r\npause >nul\r\n'
    : '#!/bin/sh\nprintf "DEVDock_CLI_SMOKE\\r\\n"\nIFS= read -r answer\n';
for (const provider of ['codex', 'claude']) {
  const executablePath = join(
    fakeBin,
    process.platform === 'win32' ? `${provider}.cmd` : provider,
  );
  writeFileSync(executablePath, fakeProviderScript);
  chmodSync(executablePath, 0o755);
}

const executable = packagedExecutable ? resolve(packagedExecutable) : electron;
const prefix = packagedExecutable ? [] : ['.'];
const environment = {
  ...process.env,
  DEVDOCK_USER_DATA_DIR: userData,
  DEVDOCK_AGENT_RUNTIME_FILE: descriptorPath,
  XDG_DATA_HOME: dataHome,
  DEVDOCK_UI_CAPTURE: uiCapturePath,
  PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

function run(arguments_) {
  const result = spawnSync(executable, [...prefix, ...arguments_], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: environment,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `CLI exited with ${result.status}`);
  }
  return result.stdout;
}

async function runAttachedProvider() {
  const child = spawn(
    executable,
    [...prefix, 'codex', '--cwd', process.cwd(), '--name', 'Attached smoke'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
    if (output.includes('[devdock] attached')) child.stdin.write('\x1d');
  });
  child.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString('utf8');
  });
  let timeout;
  const exitCode = await Promise.race([
    new Promise((resolve) =>
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      }),
    ),
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Attached CLI timed out: ${output}\n${errorOutput}`));
      }, 15_000);
    }),
  ]);
  if (exitCode !== 0 || !output.includes('[devdock] attached')) {
    throw new Error(`Attached CLI failed (${exitCode}): ${output}\n${errorOutput}`);
  }
  const line = output.split('\n').find((value) => value.includes('\tcodex\t'));
  return line?.split('\t')[0] ?? '';
}

let runtimePid;
try {
  const coldList = run(['agent', 'list']);
  if (!coldList.includes('No managed agents.')) {
    throw new Error('Cold `agent list` did not start an empty background runtime.');
  }
  const started = run(['codex', '--cwd', process.cwd(), '--name', 'External smoke', '--detach']);
  const agentId = started.trim().split('\t')[0];
  if (!agentId) throw new Error('CLI did not return an agent id.');
  const listed = run(['agent', 'list']);
  if (!listed.includes(agentId) || !listed.includes('External smoke')) {
    throw new Error('Started agent was missing from CLI list.');
  }
  const status = run(['agent', 'status', agentId]);
  if (!status.includes(agentId) || !status.includes('terminalAvailable')) {
    throw new Error('CLI status did not return the managed agent state.');
  }
  run(['agent', 'rename', agentId, 'Renamed smoke']);
  if (!run(['agent', 'list']).includes('Renamed smoke')) {
    throw new Error('CLI rename did not update the managed agent label.');
  }
  run(['agent', 'stop', agentId]);
  run(['agent', 'remove', agentId]);
  if (run(['agent', 'list']).includes(agentId)) {
    throw new Error('Removed agent was still returned by CLI list.');
  }
  const grouped = run([
    'agent',
    'group',
    'start',
    'codex,claude',
    '--cwd',
    process.cwd(),
    '--task',
    'Group smoke',
  ]);
  const groupedIds = grouped
    .trim()
    .split('\n')
    .map((line) => line.split('\t')[0])
    .filter(Boolean);
  if (groupedIds.length !== 2) throw new Error('Group start did not create two agents.');
  run(['agent', 'group', 'stop', '--cwd', process.cwd()]);
  for (const groupedId of groupedIds) run(['agent', 'remove', groupedId]);
  const attachedAgentId = await runAttachedProvider();
  if (!attachedAgentId) throw new Error('Attached provider did not return an agent id.');
  run(['agent', 'remove', attachedAgentId]);
  const recoveryStarted = run([
    'codex',
    '--cwd',
    process.cwd(),
    '--name',
    'Recovery smoke',
    '--detach',
  ]);
  const recoveryId = recoveryStarted.trim().split('\t')[0];
  const descriptorBeforeRecovery = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  process.kill(descriptorBeforeRecovery.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(descriptorBeforeRecovery.pid, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    } catch {
      break;
    }
  }
  const recoveredStatus = run(['agent', 'status', recoveryId]);
  if (!recoveredStatus.includes('"terminalAvailable": true')) {
    throw new Error('Interrupted agent was not resumed by the replacement runtime.');
  }
  run(['agent', 'remove', recoveryId]);
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  runtimePid = descriptor.pid;
  run(['.']);
  const descriptorAfterOpen = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  if (
    descriptorAfterOpen.pid !== descriptor.pid ||
    descriptorAfterOpen.token !== descriptor.token
  ) {
    throw new Error('Opening a second app instance replaced the active Agent runtime descriptor.');
  }
  const deadline = Date.now() + 15_000;
  while (!existsSync(uiCapturePath) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!existsSync(uiCapturePath) || statSync(uiCapturePath).size === 0) {
    throw new Error('Background runtime did not open the DevDock window on second launch.');
  }
  console.info(
    '[agent-cli-smoke] PASS dot-terminal=ok cold-list=ok autostart=ok shorthand=ok attach=ok detach=ok list=ok status=ok rename=ok group=ok recovery=ok stop=ok remove=ok background-open=ok single-instance=stable',
  );
} finally {
  if (Number.isInteger(runtimePid)) {
    try {
      process.kill(runtimePid, 'SIGTERM');
    } catch {
      // Runtime may already have exited.
    }
  }
  rmSync(root, { recursive: true, force: true });
}
