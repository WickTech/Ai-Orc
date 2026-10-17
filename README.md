# A.X.I.O.N.

**A**daptive **E**xecutive **I**ntelligence & **O**perations **N**etwork — a
local, read-only Iron-Man-style Mission Control dashboard for a solo
developer running several projects (GitHub, Vercel, Gmail, Supabase), plus a
terminal orchestrator that never runs a write, shell, or Claude step without
your explicit approval.

## Safety rules

These rules are copied verbatim into every prompt (`prompts/*.md`,
`prompts/subagents/*.md`) and govern every agent in this repository:

1. Nothing sends, spends, or publishes autonomously.
2. Every number has a source and a date.
3. If a number cannot be verified, it is reported as "UNAVAILABLE" — never estimate.
4. Drafts before execution: agents produce drafts; a human executes.
5. Autonomy is earned: no agent gains a new permission without the human explicitly granting it.
6. The orchestrator never runs a write, shell, or claude step without explicit human approval in the terminal.

## Setup

1. Node ≥22 (developed against Node 22.22).
2. `npm install` (installs the single devDependency, `jsdom`, and generates
   `package-lock.json`).
3. `gh auth login` — the GitHub collector shells out to the `gh` CLI. If
   `gh` is missing or unauthenticated, the github section degrades to
   `UNAVAILABLE` instead of failing the run.
4. Connect the claude.ai Gmail, Vercel and Supabase connectors to your
   Claude Code / claude.ai account. Their exact tool names are unverified
   from this repo, so **you** add them by name to the `allowedTools` lists
   in `config/axion.config.json` (see "Connector tools and permissions"
   below). Until you do, the sections that need them come out UNAVAILABLE.
5. Copy `.env.example` to `.env` and adjust `AXION_PORT` if needed.
6. Confirm with one manual `claude -p` run that your claude.ai connectors
   are actually reachable from headless `claude -p` — this is unverified
   and may differ from the interactive app.

## npm scripts

| Script | What it does |
|---|---|
| `npm run serve` | Starts the local read-only server on `127.0.0.1:${AXION_PORT\|\|4173}`. |
| `npm run collect` | Runs the Node GitHub collector, writes `data/sources/github.json`. |
| `npm run build:data` | Merges `data/sources/*.json` into `data/mission-control.json`, computes `alerts`, and writes a `data/history/<date>.json` snapshot — only if the merged document validates. |
| `npm run scout:local` | `npm run collect && npm run build:data`. |
| `npm run validate [path]` | Validates a mission-control JSON file (default `data/mission-control.json`). |
| `npm run slug -- "<topic>"` | Prints the slug for a research topic. |
| `npm run followups` | Prints `{ open, malformed }` from `data/recommendations-log.md`. |
| `npm run axion -- [options] "<task>"` | The orchestrator CLI (see below). |
| `npm test` | Runs the whole test suite (`node --test "test/*.test.mjs"`). |

## The orchestrator

`npm run axion -- [options] "<task>"` (`scripts/axion.mjs` → `main()` in
`src/orchestrator/cli.mjs`).

Options:

| Option | Effect |
|---|---|
| `--agent <name>` | Run exactly one step for a registry entry: `scout, operator, developer, content, advisor, search, researcher, build-data, validate, claude, shell`. |
| `--plan-with-claude` | Ask Claude to plan the task (itself an approval-gated `claude` call with an empty tool allowlist), then validate the plan. Cannot be combined with `--agent`. |
| `--dry-run` | Print the plan, run nothing, write nothing, exit 0. |
| `--timeout <minutes>` | Per-step timeout, default 10. Must be a positive number. |
| `--help` | Usage, exit 0. |

**There is no approval-bypass flag.** `--yes`, `-y` and `--auto-approve`
all exit 3 with `unknown option <opt> (no approval bypass exists)`.

### Risk classes and approval

Every registry entry has a risk class:

- `read` (scout, search, researcher, advisor, build-data, validate): run
  with no prompt, decision `AUTO`.
- `write` (operator, developer, content), `shell` (shell), `claude`
  (claude): **always** need approval.

`requiresApproval(step)` is exactly that split. When approval is needed,
the terminal shows `Run step N: <description>? [y/N] ` and reads one line.
Only `y`/`yes` (trimmed, case-insensitive) approves; anything else —
including an empty line, or EOF — denies with `denied by user`. When stdin
is not a TTY (cron, pipes, CI), the answer is always
`approval required (no TTY)`. This is the only gate; there is no other way
to skip it.

### Exit codes

- `0` — every step succeeded.
- `1` — no step was denied, but at least one step failed (non-zero exit,
  `TIMEOUT`, or `SPAWN_ERROR`). A failed step also skips its dependents.
- `2` — at least one step was denied (this takes priority over `1`).
- `3` — usage, route, or plan error; nothing ran.

### The log

Every non-dry run appends to `data/orchestrator-log.md` under
`## Orchestrator run <ISO> — <task>` (task sanitised: newlines → spaces,
`|` → `/`, truncated to 200 characters). Each step gets one line:

```
<n> | <agent> | <risk> | APPROVED|DENIED|AUTO|SKIPPED | <exit code or TIMEOUT/SPAWN_ERROR or -> | <seconds>s or - | <note or ->
```

followed by a `### Output` section with the last 2000 characters of each
executed step's stdout/stderr. After a non-dry run, the orchestrator writes
`data/sources/orchestrator.json` and rebuilds `data/mission-control.json`
(a build failure only prints a warning; it never changes the exit code).

### No network execution surface

`src/server.mjs` imports neither `child_process` nor anything under
`src/orchestrator/`. It has no POST routes, checks the `Host` header, and
binds to `127.0.0.1` only. The dashboard's `run <task>` command only prints
the terminal command — it never executes anything. This is deliberate: a
browser-reachable orchestrator would be exactly the "RCE over LAN via a
local dashboard" class of bug this design avoids.

## Scheduling

**Recommended: local cron + headless `claude -p`.** Claude Code's cloud
`/schedule` routines run against a git checkout in the cloud, where your
local `gh` CLI and your gitignored `data/` directory are not present — so
scout, which needs both, cannot run there reliably. Run scheduling locally
instead:

A raw `claude -p "$(...)"` one-liner in a crontab is a trap: cron treats any
**unescaped `%`** as a newline and feeds the rest of the line to the
command's stdin, and a `printf '%s\n...'`-built prompt is full of `%`. Put
it in a small wrapper script instead, and call the script from cron:

```bash
#!/usr/bin/env bash
# scripts/cron-scout.sh — direct claude -p equivalent of
# `npm run axion -- --agent scout`, including the CRITICAL #1 confinement
# flags: --permission-mode dontAsk keeps the child from falling back to
# your interactive defaultMode/auto rules, --setting-sources excludes
# "user" so personal allow rules never leak in, and --disallowedTools
# layers extra denies on top of the allowlist (see config/axion.config.json
# for the exact list — keep this script's flags in sync with it).
set -euo pipefail
cd /path/to/axion
prompt="$(cat prompts/scout.md)
## Task input
morning scout"
claude -p \
  --permission-mode dontAsk \
  --setting-sources project,local \
  --allowedTools "Read(./**)" Grep Glob "Write(data/**)" "Edit(data/**)" "Bash(npm run collect)" "Bash(npm run build:data)" \
  --disallowedTools "Read(~/.ssh/**)" "Read(~/.aws/**)" "Read(~/.config/gh/**)" "Read(~/.claude/**)" "Read(~/.gnupg/**)" "Bash(git push:*)" "Bash(curl:*)" "Bash(rm:*)" "Bash(sudo:*)" \
  -- "$prompt"
```

```cron
# Every weekday morning at 07:30, run the wrapper script above (AC-25).
30 7 * * 1-5 /path/to/axion/scripts/cron-scout.sh >> /path/to/axion/data/cron.log 2>&1

# Equivalent, and usually simpler to maintain — the orchestrator builds the
# same claude -p invocation (and appends to data/orchestrator-log.md too):
30 7 * * 1-5 cd /path/to/axion && npm run axion -- --agent scout "morning scout" >> data/cron.log 2>&1
```

**Cron must never call `npm run axion` for a write/shell/claude step** —
cron has no TTY, so those are always auto-denied. Only call
`npm run axion -- --agent <read-agent> "..."` (scout, search, researcher,
advisor, build-data, validate) from cron, or call `claude -p` directly for
read-only prompts, always with `--permission-mode dontAsk` and an explicit
`--allowedTools` list — never rely on your personal Claude Code settings
being safe defaults for an unattended job (see "Confining spawned agents"
below).

If you do use Claude Code's `/schedule` for something else, remember it
runs in the cloud against a fresh checkout — it will not see your local
`gh` auth or your local `data/`.

## Connector tools and permissions (A10)

`config/axion.config.json` has an `agents.<name>.allowedTools` list per
agent, and `executors.claude` / `executors.planner` allowlists for the
free-form `claude` step and the `--plan-with-claude` planner call. The
defaults contain **no MCP connector tool names**, because they are
unverified from this repo. To let an agent read (or, for Operator, draft
with) a connector:

1. In Claude Code, deny **send**, **modify**, and **delete** tools for the
   Gmail/Vercel/Supabase connectors through your permission settings —
   Operator must only ever be able to create drafts, never send. See the
   concrete example below.
2. Find the exact tool names Claude Code exposes for your connectors (they
   vary by integration and are not hard-coded here).
3. Add only the read (and, for Operator, draft) tool names to the matching
   `allowedTools` array in `config/axion.config.json`.

Until you do this, the sections that need those tools stay UNAVAILABLE —
this is by design, not a bug.

### Confining spawned agents (important — read this before running for real)

`--allowedTools` alone is **not a sandbox**: it only pre-approves tools
inside whatever permission mode a child `claude -p` process inherits. On a
machine where `~/.claude/settings.json` has `"permissions": { "defaultMode":
"auto" }` (a common personal setting), an unlisted tool is not denied — it
is handed to an auto-approval classifier instead. That would let a single
prompt-injected instruction (from an email, a web page, or any other
untrusted content Scout/Operator/Search/Researcher read) reach tools that
were never explicitly allowed, including editing this repo's own scripts
and then running them — full code execution with no human approval.

To close that gap, every `claude -p` child this codebase spawns
(`src/orchestrator/executors.mjs`) always gets, in addition to its
allowlist:

- `--permission-mode dontAsk` — deny anything not explicitly allowed,
  instead of asking a classifier. This is the actual enforcement boundary;
  the allowlist alone is not.
- `--setting-sources project,local` — **deliberately excludes `"user"`**,
  so your personal `~/.claude/settings.json` (its `defaultMode`, its own
  allow rules, anything) is never inherited by a spawned agent. Only this
  repo's own project/local settings (if you add any) apply.
- `--strict-mcp-config` for every agent that has no genuine need for a live
  MCP connector (Advisor, Search, Researcher, Developer, Content, the
  generic `claude` step, and the planner) — this confines them to zero MCP
  servers. It is **not** applied to Scout or Operator, which do need your
  configured Gmail/Vercel/Supabase connectors; applying it there would
  silently break them.
- `--disallowedTools`, layered on top of the allowlist, per
  `config/axion.config.json`. Agents with no legitimate `Bash` need
  (Operator, Developer, Content, Search, the `claude` step, the planner)
  deny `Bash` outright. Agents that do need a couple of exact `npm run …`
  commands (Scout, Advisor, Researcher) additionally deny broad,
  unrelated-but-dangerous patterns (`Bash(git push:*)`, `Bash(curl:*)`,
  `Bash(rm:*)`, `Bash(sudo:*)`) as defense in depth, without touching their
  narrow, exact `Bash(npm run …)` allow entries.
- Every `Write`/`Edit` entry in `config/axion.config.json` is scoped to
  `Write(data/**)` / `Edit(data/**)` — **no agent can edit `src/`,
  `scripts/`, `package.json`, `config/`, or `prompts/`**, even if a prompt
  injection tries to talk it into doing so. This path-scoping syntax
  (`Tool(pattern)`) is the same parenthetical form `claude --help` shows
  for `Bash` (`"Bash(git *)"`); it has not been confirmed against a live
  connector-equipped run, so treat it as best-effort and verify with one
  manual run before relying on it unattended.

None of this replaces denying send/modify/delete tools for your connectors
in Claude Code's own permission settings — do both. A concrete example, in
your Claude Code settings (adjust the tool names to whatever your Gmail/
Vercel/Supabase connectors actually expose):

```json
{
  "permissions": {
    "deny": [
      "mcp__gmail__send_message",
      "mcp__gmail__delete_message",
      "mcp__gmail__modify_message",
      "mcp__vercel__delete_project",
      "mcp__vercel__redeploy",
      "mcp__supabase__delete_project",
      "mcp__supabase__run_sql"
    ]
  }
}
```

(These exact tool names are illustrative, not verified — list your
connector's real tool names via Claude Code's own tool listing.)

## PII and `.gitignore`

Everything under `data/` except the two `.gitkeep` placeholders is
gitignored: `data/research/`, `data/history/`, `data/drafts/`,
`data/delegations/`, and `data/recommendations-log.md` all hold email
subjects, senders, task text, or drafts. This repository may be pushed to
public GitHub (WickTech), so none of that should ever be committed. The
embedded dashboard mock (`MOCK_DATA` in `dashboard/index.html`) is
obviously fake data and is the only data checked into git.

## Privacy note: voice

The dashboard's optional voice features (`ENGAGE VOICE` and push-to-talk)
use the browser's `SpeechRecognition` API. Depending on your browser, this
may send captured audio to a third-party server (e.g. the browser vendor)
for transcription. Speech output uses `speechSynthesis`, which is usually
local. Voice is entirely optional — the text command box always works.

## Recommendations log

`data/recommendations-log.md` is written by Advisor and may be hand-edited.
Format: optional `#` header lines, then one line per recommendation:

```
YYYY-MM-DD | <rank> | <category> | <action> | OPEN|DONE|DROPPED
```

Only `blocker`, `outperforming` and `degrading` recommendations are ever
appended (never `routine` or `unavailable`). To resolve a follow-up, add a
**new** line for the same action text with status `DONE` or `DROPPED` — the
latest line (by date, then by position in the file) for a given normalised
action wins. A follow-up only shows up between 1 and 7 days after it was
logged (`npm run followups`), at most 10 at a time, oldest first.

## Delegation flow (A17)

Operator never runs the `developer` or `content` sub-agents inline — that
would bypass the orchestrator's approval gate for write steps. Instead,
when a thread needs code or content work, Operator writes a delegation
brief to `data/delegations/<ISO-date>-<subagent>-<slug>.md` and logs
`DELEGATED`. You then run it yourself, with approval:

```
npm run axion -- --agent developer "data/delegations/<file>.md"
npm run axion -- --agent content "data/delegations/<file>.md"
```

The sub-agent writes its draft to
`data/drafts/<subagent>/<ISO-date>-<slug>.md`. A human reviews and executes
it — the sub-agent never pushes, publishes, or sends anything itself.

## Thresholds and alerts

`config/axion.config.json`'s `thresholds` block controls alerting
(defaults used if the key is missing entirely):

```json
{ "metricChangePct": 20, "failingCI": 0, "vercelErrors": 0 }
```

- `failingCI` / `vercelErrors`: a **critical** alert fires when
  `github.totals.failingCI` / `vercel.totals.failed24h` exceeds the
  threshold.
- `metricChangePct`: a **warning** fires for any of the `github`, `vercel`,
  `gmail`, `supabase` totals that moved by at least this percent versus its
  7-day history average (needs at least one same-metric OK snapshot from
  the last 7 days, with an average above 0).

Note: a small average can make a normal-looking change look huge (1 → 2 is
+100%). This is accepted in v1 and tunable via `metricChangePct`.

## CI (A26)

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, and
`npm run build:data && npm run validate` on `push` and `pull_request`.
**This workflow has never actually run** — this repository has no git
remote configured yet, so whether it behaves as expected on GitHub Actions
is unverified.
