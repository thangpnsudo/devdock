# Contributing to DevDock

Thank you for helping improve DevDock. Small, focused pull requests are easiest to review and release.

## Before opening a pull request

1. Create a branch from `main`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Keep changes scoped to one bug or feature.
4. Add or update the smallest test that proves the behavior.
5. Run the checks for the modules you changed.

For desktop changes:

```bash
pnpm --filter @devdock/desktop typecheck
pnpm --filter @devdock/desktop lint
pnpm --filter @devdock/desktop test
pnpm --filter @devdock/desktop electron:smoke
```

Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:`. Explain the user impact in the pull request and include screenshots for visible UI changes.

## Local data and credentials

Do not include personal clipboard contents, terminal output, SSH credentials, tokens, private keys, or local `.env` files in issues, tests, screenshots, commits, or logs.

Report security problems privately as described in [SECURITY.md](SECURITY.md).
