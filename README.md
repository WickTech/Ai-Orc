# AI-Orc — AI Platform Orchestrator

A local, open-source web app to observe and control all your AI language model CLIs from one place.

**Built-in tools:** Claude Code · Gemini CLI · Codex CLI  
**Extend:** Add any open-source AI tool by pasting its GitHub URL  
**Notes:** Reads and writes to your real Obsidian vault  

---

## What it does

| Feature | Description |
|---|---|
| Live terminals | Full xterm.js terminals for each CLI — type and see output in real-time |
| Dashboard | See all tools at a glance, launch with one click |
| Obsidian vault | Browse and edit your `.md` notes; task checkboxes sync back to disk |
| Tool registry | Paste a GitHub URL → repo is cloned → install steps extracted from README |
| Open & local | All data stays on your machine. No cloud, no telemetry. |

---

## Prerequisites

- Node.js 20+
- `git` available in PATH
- The CLI tools you want to use must already be installed and on PATH  
  (`claude`, `gemini`, `codex` — only the ones you have)

---

## Install & run

```bash
git clone https://github.com/your-username/ai-orc
cd ai-orc
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### First-time setup

1. Go to **Settings** and set your Obsidian vault path (e.g. `/home/you/MyVault`)
2. Return to **Dashboard** — your tools are ready to launch

---

## Adding a tool

1. Go to **Registry**
2. Paste a GitHub URL: `https://github.com/owner/repo`
3. AI-Orc clones the repo locally to `~/.ai-orc/tools/owner/repo`
4. Install steps are extracted from the README — copy-paste and run them
5. The tool is saved and appears in your Dashboard

---

## Data & config

All state is stored locally at `~/.ai-orc/db.json`. Nothing is sent to any server.

```json
{
  "config": { "vaultPath": "/home/you/ObsidianVault", "port": 3000 },
  "tools": [ ... ]
}
```

---

## Architecture

```
ai-orc/
├── server.ts          # Custom Node.js server (Next.js + WebSocket for PTY)
├── src/
│   ├── app/           # Next.js App Router pages + API routes
│   ├── components/    # React components (terminal, vault, registry, layout)
│   ├── lib/           # Server-side logic (pty, vault, registry, db)
│   ├── hooks/         # useTerminal
│   ├── providers/     # WebSocketProvider
│   └── store/         # Zustand state
```

**Why a custom server?** `node-pty` creates real pseudo-terminals. It needs a persistent Node.js process — Next.js API routes are stateless. `server.ts` starts Next.js and adds a WebSocket upgrade on `/ws` so the same port serves both.

---

## Tech stack

Next.js 16 · TypeScript · Tailwind CSS v4 · shadcn/ui · xterm.js · node-pty · Vercel AI SDK · Zustand

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.  
License: [MIT](LICENSE)
