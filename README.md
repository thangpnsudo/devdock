# DevDock

> **Local-first developer workspace.**
> SSH. Clipboard. Library. Search. Synchronization.
> Everything you need. Nothing you don't.

DevDock reduces context switching for developers by bringing SSH, clipboard history,
commands, and search into one fast, focused desktop application. Your data stays on
your machine, and core features keep working fully offline.

🌐 **Official website:** [https://devdock.io.vn](https://devdock.io.vn)

---

## Download DevDock

Download the latest build for your operating system:

| OS | Installer | Architecture |
|----|-----------|--------------|
| Linux | [Download .deb](LINK_SAP_BIET) | amd64 (x64) |
| macOS | [Download .dmg](LINK_SAP_BIET) | Apple Silicon (arm64) / Intel (x64) |
| Windows | [Download .exe](LINK_SAP_BIET) | x64 |

> These are **pilot** builds — not yet the official release on the website. They
> are published on a regular cadence so you can try new versions early and share
> feedback that helps us improve the product.

### Installation

<details>
<summary>Linux (Debian / Ubuntu)</summary>

```bash
sudo apt install ./DevDock_<version>_amd64.deb
```

Launch **DevDock** from your application menu.
</details>

<details>
<summary>macOS (Apple Silicon / Intel)</summary>

Open the `.dmg` for your chip, drag **DevDock** into **Applications**. If macOS
asks, allow the app in **System Settings → Privacy & Security**.
</details>

<details>
<summary>Windows</summary>

Run the `.exe` and follow the installer, then launch **DevDock** from the Start menu.
</details>

---

## Product

DevDock keeps everything in a developer's day close to the work it belongs to:
less searching, less remembering, more momentum.

### Five tools, one working memory

| Area | What it does |
|------|--------------|
| **Workspace terminals** | Arrange local and remote sessions around a project — no rebuilding your layout every morning. |
| **Clipboard memory** | Capture useful fragments automatically, find them later, and stop losing what you just copied. |
| **Command library** | Turn commands and snippets into a reusable toolkit. |
| **SSH connections** | Hosts, credentials, recent sessions, and terminal context in one focused workflow. |
| **Search everything** | One query across clipboard, commands, snippets, and servers — fully offline. |

### Architecture

Local-first: a React 19 + TypeScript interface over a Rust core (SQLite + FTS5 for
local storage). No account required; your data stays on your machine.

### Roadmap

- **Available now:** local-first desktop workflow for individuals.
- **In development:** shared team command/snippet libraries, centrally managed
  workspace configuration, encrypted cloud synchronization.

---

## Feedback

DevDock is built in public, and your feedback on pilot builds is what drives the
roadmap. Pick the channel that fits:

- 🐞 **Bug in a pilot build** — open a [Bug report](../../issues/new?template=bug_report.yml)
- 💡 **Idea / feature request** — open a [Feature request](../../issues/new?template=feature_request.yml)
- 📝 **Quick review** — open [Pilot feedback](../../issues/new?template=pilot_feedback.yml) (~2 minutes)
- 💬 **Open discussion** — start a thread in [Discussions](../../discussions)

When reporting a bug, include the **version** (shown in the release tag) and your
**OS + architecture** to help us fix it faster.

---

## License

Pilot builds are preview software distributed for evaluation. See the notes of each
release for details.