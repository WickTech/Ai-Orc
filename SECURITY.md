# Security

Axion starts terminals, runs AI coding agents and merges their work into your repositories. It is built to run **on your own machine, for one person**. This document says what it protects against, what it does not, and how to report a problem.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability"). If that button is not available, open an issue titled "security contact request" **without any details** and the maintainer will arrange a private channel. Do not post exploit details publicly. This is a solo-maintained project; expect a reply within a few days.

## Threat model

### What we protect

- Your files and shell: the app can spawn processes and write to your repositories and notes vault.
- Your repositories' history: nothing an agent writes reaches your branch without your explicit approval.

### Who we defend against

| Threat | Defence |
|---|---|
| A web page you visit sends requests to the local server (CSRF) | Mutating `/api` requests from a browser must carry an `Origin` that is the app's own; the WebSocket handshake too. |
| A web page rebinds its DNS name to `127.0.0.1` to read your data (DNS rebinding) | Every `/api` request and the `/ws` handshake must carry a `Host` that is one of the server's own `host:port` values. |
| Another machine on your network | The server binds to `127.0.0.1` by default. `HOST=0.0.0.0` is an explicit opt-in (see below). |
| A script that sends no `Origin` (curl) | Mutating requests without an `Origin` are refused unless `AI_ORC_TOKEN` is set and sent as `Authorization: Bearer <token>` (compared in constant time). |
| A malicious or mistaken setting | `PUT /api/config` accepts known keys only and validates each: the vault must be an existing directory that is not `/` or your home folder; `repos` must be git repository roots; `verify` commands must be a bare program name plus plain arguments. |
| Path traversal and symlink tricks | The vault API serves visible `.md` files only, with symlinks resolved before the containment check. Worktree session ids are slugs; the server derives all worktree paths itself. Clients send a repository *id*, never a path. |
| Command injection | Git and verify commands run through `spawn` with an argument array and no shell. The WebSocket only starts tools registered on the server (built-in adapters or registry entries), never a command from the client. Tool commands must be bare executable names. |
| Supply-chain surprises from the registry | Registry clones accept `https://github.com/<owner>/<repo>` only, no credentials. A repository named like a built-in tool cannot replace the built-in. |
| An agent changing code after you reviewed it | Approval is bound to a SHA-256 of the exact diff (and base commit). If anything changed, the merge is refused and you must review again. When a verify command is configured, a passing run on that same diff is also required. |
| An agent's mess in your main checkout | Isolated sessions get their own git worktree and branch under `~/.ai-orc/worktrees`. A merge needs a clean main checkout and a checked-out branch; conflicts are aborted and leave your branch untouched. |
| Untrustworthy data files | Mission Control reduces its JSON file to the fields it renders, caps sizes, renders only `https` links, and shows unverified numbers as UNAVAILABLE. |

### What we do **not** protect against

Read this before exposing the app or running untrusted code.

- **Local users and local processes.** There is no login. Any process running as any user on the machine can reach `127.0.0.1:<port>`. A non-browser client can send forged `Origin` and `Host` headers, and the WebSocket (which starts terminals) has no token. If your machine is shared, do not run Axion on it, or put it behind a firewall rule that limits loopback access.
- **LAN exposure.** With `HOST=0.0.0.0` the same header checks are the only barrier, so anyone on the network who can forge them can start terminals. Do not use it on networks you do not trust. Use an SSH tunnel instead.
- **The agents themselves.** Agents run with your user's privileges, with your environment variables, inside a worktree that is *not* a sandbox. A worktree isolates git state, not the filesystem or the network. An agent can read your home directory, call the network and run anything you could. Only run agents you trust on repositories you trust. (A container sandbox is a possible future feature, not a current one.)
- **Verify commands and git hooks.** The verify command and your repository's own hooks execute code from the session's worktree, which an agent may have changed. Treat them as running the agent's code.
- **Review mistakes.** The approval gate proves you merged what you saw, not that what you saw is safe. Large diffs are displayed truncated at 512 KB (the hash still covers the whole diff).
- **Audit log integrity.** `~/.ai-orc/audit.log` is an append-only convenience for you, not tamper-evident: anyone who can write your home directory can edit it.
- **Secrets in transcripts.** Terminal output is shown in the browser and not stored, but anything an agent prints is visible to whoever can see your screen. Axion does not scan agent output for secrets.
- **Third-party services.** Agents send prompts and code to their model providers (Anthropic, Google, OpenAI, OpenCode providers...) under those providers' terms.

### History

Early versions of this project (as AI-Orc) allowed unauthenticated requests from the local network to spawn terminals. That was fixed by the loopback default, Host/Origin checks and the token (PR #2 and PR #4, when the project was still called AI-Orc). The tests in `apps/web/test/security.test.ts` and `proxy.test.ts` pin that behaviour.

## Safe use checklist

1. Keep the default `HOST=127.0.0.1`.
2. Set `AI_ORC_TOKEN` if you script against the API: `AI_ORC_TOKEN=$(openssl rand -hex 24) npm run dev`.
3. Open the app via `http://localhost:<port>` or `http://127.0.0.1:<port>`; other host names are refused.
4. Review every diff yourself. Configure a verify command for repositories that have tests.
5. Keep secrets out of repositories you let agents work in, and out of your shell environment where possible.
6. Do not run Axion as root.

## Automated checks

CI runs gitleaks (secret scan), Semgrep (static analysis, new findings fail the PR) and GitGuardian on every pull request, plus a weekly full scan. See `.github/workflows/security.yml`.
