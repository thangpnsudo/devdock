# Security policy

## Supported version

Security fixes are applied to the latest DevDock Kit release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability or include secrets, private terminal output, or user data in a report. Use GitHub's private vulnerability reporting for this repository with:

- the affected version and operating system;
- reproduction steps or a minimal proof of concept;
- the expected impact;
- any suggested mitigation.

You should receive an acknowledgement within seven days. A fix and disclosure timeline will be coordinated after the report is reproduced.

## Trust boundaries

DevDock Kit can execute local and SSH terminal commands. Treat project files, command output, SSH servers, and agent-generated commands as untrusted input.

Never commit or share terminal output, clipboard data, SSH credentials, tokens, or private keys. Review every agent command before approving it and keep the local control socket restricted to the current user.
