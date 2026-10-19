// Step executors (AC-38). All resolve, never reject.
//
// Child confinement (fix round 1, review CRITICAL #1): `--allowedTools` only
// pre-approves tools inside whatever permission mode the child inherits from
// user/project settings. On a machine where `~/.claude/settings.json` sets
// `permissions.defaultMode: "auto"`, an unlisted tool is not denied — it is
// routed to the auto classifier. So every child claude process here also
// gets:
//   --permission-mode dontAsk   deny anything not explicitly allowed, instead
//                                of asking a classifier (A10's whole point).
//   --setting-sources project,local
//                                deliberately excludes "user" so a developer's
//                                personal defaultMode/allow rules (as above)
//                                are never inherited by a spawned agent. Only
//                                this repo's own (currently absent) project/
//                                local settings would apply.
//   --strict-mcp-config          for agents that never need a live MCP
//                                connector (advisor, search, researcher,
//                                developer, content, the generic `claude`
//                                executor, and the planner): confines them to
//                                zero MCP servers, since none is passed via
//                                --mcp-config. Not applied to scout/operator,
//                                which do need the user's configured Gmail/
//                                Vercel/Supabase connectors.
//   --disallowedTools             explicit denies layered on top of the
//                                allowlist (see config/axion.config.json).
// Every allow/deny tool name is passed as its own argv element, because
// `--allowedTools`/`--disallowedTools` are variadic (`<tools...>`), not a
// single comma-joined string.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAgent, escapeControlChars } from './registry.mjs';

export const PERMISSION_MODE = 'dontAsk';
export const SETTING_SOURCES = 'project,local';

// Agents/executors with no live MCP-connector need at all.
export const STRICT_MCP_AGENTS = new Set(['advisor', 'search', 'researcher', 'developer', 'content']);

function toolArgs(flag, tools) {
  if (!tools || tools.length === 0) return [];
  return [flag, ...tools];
}

/**
 * Builds the confinement + tool-allowlist argv shared by every spawned
 * claude process (agents, the generic `claude` executor, and the planner).
 * @param {{allowedTools?:string[], disallowedTools?:string[], strictMcp?:boolean}} opts
 * @returns {string[]}
 */
export function buildClaudeArgs({ allowedTools = [], disallowedTools = [], strictMcp = false }) {
  const args = ['--permission-mode', PERMISSION_MODE, '--setting-sources', SETTING_SOURCES];
  if (strictMcp) args.push('--strict-mcp-config');
  args.push(...toolArgs('--allowedTools', allowedTools));
  args.push(...toolArgs('--disallowedTools', disallowedTools));
  return args;
}

function spawnAndCapture(spawnImpl, command, args, { cwd, timeoutMs, shell }) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;

    const options = { cwd, stdio: ['ignore', 'pipe', 'pipe'] };
    if (shell) options.shell = true;

    try {
      child = spawnImpl(command, args, options);
    } catch (err) {
      resolve({ exitCode: 'SPAWN_ERROR', stdout: '', stderr: String((err && err.message) || err), durationMs: Date.now() - start });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve({ exitCode: 'TIMEOUT', stdout, stderr, durationMs: Date.now() - start });
    }, timeoutMs);

    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 'SPAWN_ERROR', stdout, stderr: stderr || String((err && err.message) || err), durationMs: Date.now() - start });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code === null ? 'TIMEOUT' : code, stdout, stderr, durationMs: Date.now() - start });
    });
  });
}

/**
 * @param {{rootDir:string, config:object, spawnImpl?:Function}} args
 */
export function createExecutors({ rootDir, config, spawnImpl = spawn }) {
  async function runAgent(step, opts) {
    // Defense in depth (fix round 2, review CRITICAL #1 re-audit): a plain
    // `REGISTRY[step.agent]` lookup would resolve inherited
    // Object.prototype keys to a truthy function value here too. runPlan
    // already refuses unknown agents before ever calling runAgent, but this
    // must not silently misbehave (or throw and violate "executors never
    // reject") if it is ever called directly with an untrusted name.
    const entry = getAgent(step.agent);
    if (!entry || entry.kind !== 'agent') {
      // Final review MINOR "optional hardening": besides the unknown-name
      // case, also refuse a real registry entry whose kind isn't 'agent'
      // (e.g. 'shell'/'claude'/'build-data' routed here by a future bug) —
      // runAgent must never be called with a non-agent entry.
      return { exitCode: 'SPAWN_ERROR', stdout: '', stderr: `unknown agent: ${escapeControlChars(String(step.agent))}`, durationMs: 0 };
    }
    const promptPath = path.join(rootDir, entry.promptFile);
    let promptText;
    try {
      promptText = await fs.readFile(promptPath, 'utf8');
    } catch (err) {
      // A missing prompt file is a hard failure: no Hard-rules text means no
      // spawn (fix round 1, review IMPORTANT #9 / AC-38).
      return {
        exitCode: 'SPAWN_ERROR',
        stdout: '',
        stderr: `prompt file not found: ${entry.promptFile} (${(err && err.message) || err})`,
        durationMs: 0,
      };
    }
    const fullPrompt = `${promptText}\n\n## Task input\n${step.input}`;
    // Safe by construction (audited for CRITICAL #1, fix round 2): this
    // line is only reached after the `getAgent(step.agent)` check above
    // returned a real entry, so `step.agent` can only be one of REGISTRY's
    // own `kind: 'agent'` names here — never `toString`/`__proto__`/etc.
    const agentCfg = (config.agents && config.agents[step.agent]) || {};
    // The prompt goes last, after a `--` terminator (review MINOR #8): a
    // task/prompt string that happens to start with `-` (e.g. a
    // planner-authored task like "--dangerously-skip-permissions") must
    // never be parsable as a CLI option instead of the positional prompt.
    const args = [
      '-p',
      ...buildClaudeArgs({
        allowedTools: agentCfg.allowedTools || [],
        disallowedTools: agentCfg.disallowedTools || [],
        strictMcp: STRICT_MCP_AGENTS.has(step.agent),
      }),
      '--', fullPrompt,
    ];
    return spawnAndCapture(spawnImpl, 'claude', args, { cwd: rootDir, timeoutMs: opts.timeoutMs });
  }

  async function runScript(step, opts) {
    const entry = getAgent(step.agent);
    if (!entry || entry.kind !== 'script') {
      // Same kind-check hardening as runAgent above.
      return { exitCode: 'SPAWN_ERROR', stdout: '', stderr: `unknown agent: ${escapeControlChars(String(step.agent))}`, durationMs: 0 };
    }
    return spawnAndCapture(spawnImpl, process.execPath, [entry.script], { cwd: rootDir, timeoutMs: opts.timeoutMs });
  }

  async function runClaude(step, opts) {
    const claudeCfg = (config.executors && config.executors.claude) || {};
    // Same `--` terminator rationale as runAgent above (review MINOR #8).
    const args = [
      '-p',
      ...buildClaudeArgs({
        allowedTools: claudeCfg.allowedTools || [],
        disallowedTools: claudeCfg.disallowedTools || ['Bash'],
        strictMcp: true,
      }),
      '--', step.input,
    ];
    return spawnAndCapture(spawnImpl, 'claude', args, { cwd: rootDir, timeoutMs: opts.timeoutMs });
  }

  async function runShell(step, opts) {
    return spawnAndCapture(spawnImpl, step.input, [], { cwd: rootDir, timeoutMs: opts.timeoutMs, shell: true });
  }

  return { runAgent, runScript, runClaude, runShell };
}
