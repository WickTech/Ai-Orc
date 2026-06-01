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

## Built-in tools

Out of the box AI-Orc launches terminals for:

- **Claude Code** (`claude`)
- **Gemini CLI** (`gemini`)
- **Codex CLI** (`codex`)

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
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note for WSL users:** The server binds to `0.0.0.0:3000`. Access it at `http://localhost:3000` from your Windows browser.

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

```
Ai-Orc/
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
