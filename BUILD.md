# Build DevDock Kit

DevDock Kit uses Electron, React, TypeScript, `node-pty`, and `ssh2`. Development and packaging happen entirely on your machine.

## Common setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Use Node.js 20.10 or newer and pnpm 9.15.9. Native modules also require Python and a C/C++ toolchain.

## Linux

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++ libsecret-1-dev
pnpm dev
```

Optional local package:

```bash
pnpm --filter @devdock/desktop electron:package:linux
```

## macOS

```bash
xcode-select --install
pnpm dev
```

Optional local package:

```bash
pnpm --filter @devdock/desktop electron:package:mac:arm64
# or, on Intel:
pnpm --filter @devdock/desktop electron:package:mac:x64
```

## Windows

Install Python and Visual Studio Build Tools with **Desktop development with C++**, then run in PowerShell:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Optional local package:

```powershell
pnpm --filter @devdock/desktop electron:package:windows
```

Generated installers are written to `apps/desktop/release/electron/` and are ignored by Git. Local packages are unsigned, so the operating system may display a warning.

## Verify changes

```bash
pnpm verify
pnpm --filter @devdock/desktop electron:smoke
```
