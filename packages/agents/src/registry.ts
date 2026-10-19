import type { AgentAdapter } from "./types"
import { claude } from "./adapters/claude"
import { gemini } from "./adapters/gemini"
import { codex } from "./adapters/codex"
import { opencode } from "./adapters/opencode"

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
// A bare executable name: no path separators, whitespace or shell metacharacters.
const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/** Throws when an adapter could launch something other than a named executable. */
export function validateAdapter(adapter: AgentAdapter): AgentAdapter {
  if (!ID_RE.test(adapter.id)) throw new Error(`Invalid agent id "${adapter.id}"`)
  if (!COMMAND_RE.test(adapter.command)) {
    throw new Error(`Agent "${adapter.id}": command must be a bare executable name, got "${adapter.command}"`)
  }
  if (adapter.capabilities.headless !== (typeof adapter.headlessArgs === "function")) {
    throw new Error(`Agent "${adapter.id}": capabilities.headless must match the presence of headlessArgs`)
  }
  return adapter
}

// Add a new agent by creating adapters/<name>.ts and listing it here.
const ADAPTERS: readonly AgentAdapter[] = [claude, gemini, codex, opencode].map(validateAdapter)

const seen = new Set<string>()
for (const a of ADAPTERS) {
  if (seen.has(a.id)) throw new Error(`Duplicate agent id "${a.id}"`)
  seen.add(a.id)
}

export function listAdapters(): readonly AgentAdapter[] {
  return ADAPTERS
}

export function getAdapter(id: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}
