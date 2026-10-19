import type { AgentAdapter } from "../types"

export const codex: AgentAdapter = {
  id: "codex",
  label: "Codex CLI",
  command: "codex",
  args: [],
  installHint: "npm install -g @openai/codex",
  capabilities: { headless: true, mcp: true },
  headlessArgs: (prompt) => ["exec", prompt],
}
