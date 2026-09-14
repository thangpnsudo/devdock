import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import electron from 'electron';

const executableArgument = process.argv.indexOf('--executable');
const packagedExecutable =
  executableArgument >= 0 ? process.argv[executableArgument + 1] : undefined;

const smokeRoot = mkdtempSync(join(tmpdir(), 'devdock-electron-smoke-'));
const chromiumProfile = join(smokeRoot, 'chromium');
const dataHome = join(smokeRoot, 'data');
const fakeBin = join(smokeRoot, 'bin');

mkdirSync(chromiumProfile, { recursive: true });
mkdirSync(dataHome, { recursive: true });
mkdirSync(fakeBin, { recursive: true });

const fakeCodex = join(fakeBin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
writeFileSync(
  fakeCodex,
  process.platform === 'win32'
    ? [
        '@echo off',
        'echo DEVDock_FAKE_AGENT_WORKING',
        'set /p answer=Do you want to proceed?',
        'echo DEVDock_FAKE_AGENT_DONE:%answer%',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        "printf 'DEVDock_FAKE_AGENT_WORKING\\r\\n'",
        "printf 'Do you want to proceed?'",
        'IFS= read -r answer',
        'printf \'\\r\\nDEVDock_FAKE_AGENT_DONE:%s\\r\\n\' "$answer"',
      ].join('\n'),
);
chmodSync(fakeCodex, 0o755);

try {
  const executable = packagedExecutable ?? electron;
  const executableArguments = packagedExecutable
    ? [`--user-data-dir=${chromiumProfile}`]
    : ['.', `--user-data-dir=${chromiumProfile}`];
  const result = spawnSync(executable, executableArguments, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      DEVDOCK_TERMINAL_SMOKE: '1',
      XDG_DATA_HOME: dataHome,
      PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
