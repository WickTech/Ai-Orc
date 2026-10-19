import type { AgentAdapter } from "../types"

export const opencode: AgentAdapter = {
  id: "opencode",
  label: "OpenCode",
  command: "opencode",
  args: [],
  installHint: "npm install -g opencode-ai",
  capabilities: { headless: true, mcp: true },
  headlessArgs: (prompt) => ["run", prompt],
}
