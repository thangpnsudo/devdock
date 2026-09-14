import { build } from 'esbuild';

await Promise.all([
  build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node-pty', 'ssh2'],
    outfile: 'dist-electron/main.cjs',
  }),
  build({
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: 'dist-electron/preload.cjs',
  }),
  build({
    entryPoints: ['electron/agent-cli-entry.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist-electron/agent-cli.cjs',
  }),
]);
