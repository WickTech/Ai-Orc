# AI-Orc — AI Platform Orchestrator

> A local, open-source web app to observe and control all your AI language model CLIs from one place.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://typescriptlang.org)

---

## What it does

| Feature | Description |
|---|---|
| **Live terminals** | Full xterm.js terminals for each CLI — type and see real-time output |
| **Dashboard** | See all tools at a glance, launch with one click |
| **Obsidian vault** | Browse and edit your `.md` notes; edits persist directly to your vault |
| **Tool registry** | Paste a GitHub URL → repo is cloned → install steps extracted from README |
| **Extensible** | Add any open-source AI tool, model, or CLI by pasting its GitHub repo URL |
| **Local & private** | All data stays on your machine — no cloud, no telemetry |

---

## Isolated worktree sessions

Add git repositories under **Settings → Repositories**, then pick one in the **Isolated worktree** dropdown when launching a tool. The session runs in its own `git worktree` on a new `axion/<tool>-<session>` branch under `~/.ai-orc/worktrees/`, so two agents can edit the same repo without touching each other or your checkout.

- Refuses to start when the repository has uncommitted changes to tracked files (they would not appear in the worktree). Untracked files are ignored.
- The browser never sends a path: the WebSocket message carries a repo id, and the server only honours ids of repos in your saved config. Each repo must be an existing git repository root and not `/` or your home folder.
- Worktrees and branches are kept after a session ends. The **Worktrees** page shows branch, uncommitted changes and commit count, and removes one (deleting its branch). Removing one with uncommitted or unmerged work needs an explicit confirmation.
- Restarting a terminal reuses its worktree.
- All git calls use argument arrays without a shell.

---

## Adding an agent adapter

Built-in tools are agent adapters in `packages/agents`. To support a new CLI, add `packages/agents/src/adapters/<name>.ts` exporting an `AgentAdapter` (id, label, bare `command`, `args`, `installHint`, `capabilities`, optional `headlessArgs`) and list it in `packages/agents/src/registry.ts`. Commands must be bare executable names (no paths or spaces); the registry rejects anything else. Existing installs pick up new built-ins automatically because built-ins are not stored in `~/.ai-orc/db.json`.

---

## Built-in tools

Out of the box AI-Orc launches terminals for:

- **Claude Code** (`claude`)
- **Gemini CLI** (`gemini`)
- **Codex CLI** (`codex`)
- **OpenCode** (`opencode`)

Any of these you have installed will work immediately. Add more via the Registry.

---

## Prerequisites

- **Node.js 20+**
- **Git** on PATH
- The CLI tools you want to use must already be installed (`claude`, `gemini`, `codex`)
- An [Obsidian](https://obsidian.md) vault folder (optional — for the Vault page)

---

## Install & run

```bash
git clone https://github.com/WickTech/Ai-Orc
cd Ai-Orc
npm install    # installs every workspace from the repo root
npm run dev    # starts apps/web
```

Open [http://localhost:3000](http://localhost:3000).

> **Note for WSL users:** The server binds to `127.0.0.1:3000` by default — WSL2 forwards localhost automatically, so `http://localhost:3000` from your Windows browser just works. There is no auth on the terminal/vault APIs, so only set `HOST=0.0.0.0` if you understand that exposes process-spawning to your whole LAN.

### First-time setup

1. Open **Settings** → set your Obsidian vault path (e.g. `/home/you/MyVault`)
2. Return to **Dashboard** — your tools are ready to launch

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — tool cards with one-click launch |
| `/terminals` | Live xterm.js terminals, tabbed per tool instance |
| `/vault` | Obsidian file tree + markdown editor (Ctrl+S to save) |
| `/registry` | Add tools via GitHub URL |
| `/settings` | Vault path, server port |

---

## Adding a tool

1. Go to **Registry**
2. Paste any GitHub URL: `https://github.com/owner/repo`
3. AI-Orc clones the repo to `~/.ai-orc/tools/owner/repo`
4. Install steps are extracted from the README — copy and run them
5. The tool is saved to your registry and appears on the Dashboard

---

## Architecture

This repository is a monorepo (npm workspaces):

```
├── apps/web/              # The web app described in this README
├── packages/core/         # AXION mission control: read-only dashboard + approval-gated orchestrator
│                          # (zero-dependency Node ESM; see packages/core/README.md)
└── package.json           # Workspace root: npm run dev | test | lint | typecheck | build | validate
```

The web app (`apps/web`):

```
apps/web/
├── server.ts              # Custom server: Next.js + WebSocket on same port
├── src/
│   ├── app/               # Next.js App Router pages + API routes
│   │   ├── page.tsx       # Dashboard
│   │   ├── terminals/     # Terminal page (reads spawn params from URL)
│   │   ├── vault/         # Obsidian vault explorer + editor
│   │   ├── registry/      # Tool registry (GitHub URL → install steps)
│   │   ├── settings/      # Config page
│   │   └── api/           # REST endpoints (config, vault, registry)
│   ├── components/        # React components (terminal, vault, registry, layout)
│   ├── lib/               # Server-side logic
│   │   ├── pty.ts         # node-pty process manager
│   │   ├── vault.ts       # Obsidian vault file ops + chokidar watcher
│   │   ├── registry.ts    # git clone + README parser
│   │   └── db.ts          # JSON config at ~/.ai-orc/db.json
│   ├── providers/         # WebSocketProvider (client-side WS singleton)
│   ├── hooks/             # useTerminal (xterm.js init + WS attach)
│   └── store/             # Zustand state (tools, terminals, active tab)
```

### Why a custom server?

`node-pty` spawns real pseudo-terminals and needs a persistent Node.js process. Next.js API routes are stateless. `server.ts` starts Next.js **and** upgrades HTTP connections to WebSocket at `/ws` — so the same port serves both the web app and terminal I/O.

### Terminal launch flow

The Dashboard passes spawn info through URL params (e.g. `/terminals?id=claude-123&command=claude&label=Claude+Code`). The Terminals page reads those params on mount, adds the terminal to state, and sends the spawn message over WebSocket. This avoids Zustand cross-page state issues in Next.js App Router.

---

## Security model

AI-Orc can spawn terminals and read/write your notes, so the server is locked down by default:

- **Loopback only.** It binds to `127.0.0.1`. Set `HOST=0.0.0.0` only if you accept LAN exposure; the LAN addresses of this machine are then added to the allow-list.
- **Host check (DNS rebinding).** Every `/api` request and the `/ws` handshake must carry a `Host` header that is one of this server's own `host:port` values. A page that rebinds `evil.example` to `127.0.0.1` is rejected, reads included. Reach the app via `localhost` or `127.0.0.1` (or the LAN IP when `HOST` is set), not another hostname.
- **Origin check (CSRF).** Mutating requests from a browser must come from the app's own origin; the WebSocket handshake too.
- **Scripts need a token.** A mutating request with no `Origin` header (curl, scripts) is refused unless `AI_ORC_TOKEN` is set and sent as `Authorization: Bearer <token>`:
  ```bash
  AI_ORC_TOKEN=$(openssl rand -hex 24) npm run dev
  curl -X PUT http://127.0.0.1:3000/api/config -H "Authorization: Bearer $AI_ORC_TOKEN" \
       -H 'Content-Type: application/json' -d '{"port":3000}'
  ```
- **Settings are validated.** `PUT /api/config` accepts only `vaultPath` and `port`. The vault must be an existing directory, and `/` or your home folder (or a parent of it) is refused.
- **The vault API serves notes only.** Only visible `.md` files inside the vault, with symlinks resolved before the check. Dotfiles and dot-folders are refused.
- **Registry clones are GitHub-only.** `https://github.com/<owner>/<repo>` exactly: no other host or scheme, no credentials, no extra path. A repo named like a built-in tool never replaces the built-in.
- **Terminals run registered tools only.** The WebSocket spawns the command stored in the registry, never one supplied by the client.

## Local config

All state lives at `~/.ai-orc/db.json` — never committed to git.

```json
{
  "config": {
    "vaultPath": "/home/you/ObsidianVault",
    "port": 3000
  },
  "tools": [
    { "id": "claude", "label": "Claude Code", "command": "claude", "builtin": true },
    { "id": "gemini", "label": "Gemini CLI",  "command": "gemini", "builtin": true },
    { "id": "codex",  "label": "Codex CLI",   "command": "codex",  "builtin": true }
  ]
}
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Terminals | xterm.js + node-pty |
| WebSocket | `ws` library on custom server |
| Vault watcher | chokidar |
| Markdown editor | @uiw/react-md-editor |
| Git clone | simple-git |
| State | Zustand v5 |
| AI SDK | Vercel AI SDK (ready for direct model API calls) |

---

## API routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Get config + tool list |
| PUT | `/api/config` | Update config |
| GET | `/api/vault/tree` | File tree of the vault |
| GET | `/api/vault/file?path=...` | Read a `.md` file |
| PUT | `/api/vault/file` | Write a `.md` file |
| POST | `/api/registry/add` | Clone GitHub repo + extract install steps |
| GET | `/api/registry` | List all tools |
| DELETE | `/api/registry/:id` | Remove a non-builtin tool |

---

## Contributing

PRs welcome. Issues: [github.com/WickTech/Ai-Orc/issues](https://github.com/WickTech/Ai-Orc/issues)

License: [MIT](LICENSE)
