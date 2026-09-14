# DevDock Kit

An open-source Electron starter kit for solo developers who want to build a personal, local-first developer workspace.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/thangpnsudo/devdock/actions/workflows/ci.yml/badge.svg)](https://github.com/thangpnsudo/devdock/actions/workflows/ci.yml)

This repository is intentionally smaller than the DevDock product. It contains the reusable local desktop foundation, not the hosted services, production infrastructure, landing page, customer data, or internal product-development documents.

Want the ready-to-use original product instead? Visit [devdock.io.vn](https://devdock.io.vn).

## Included

- Electron + React + TypeScript desktop shell.
- Local and SSH terminals powered by `node-pty` and `ssh2`.
- Local Codex and Claude Code session management.
- Local clipboard history, library, search, and settings.
- Shared UI, hooks, types, and configuration packages.
- Tests and a minimal GitHub Actions quality check.

All workspace data stays on the developer's machine. The kit does not include a hosted API, admin portal, Telegram relay, analytics, cloud challenge service, update control plane, or deployment configuration.

## Start locally

Requirements: Node.js 20.10+, pnpm 9.15.9, and native build tools for `node-pty`.

```bash
git clone https://github.com/thangpnsudo/devdock.git
cd devdock
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Run the checks:

```bash
pnpm verify
```

See [BUILD.md](BUILD.md) for OS-specific setup and optional local packaging.

## Structure

```text
apps/desktop/    Electron desktop application
packages/        Shared TypeScript UI, hooks, types, and configuration
```

Start with `apps/desktop/src/routes/index.tsx` to add a screen and `apps/desktop/electron/main.ts` to add a local native capability.

## Contributing

Fork the repository and adapt it to your own workflow. General fixes that keep the kit local, small, and reusable are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

DevDock Kit is available under the [MIT License](LICENSE).
