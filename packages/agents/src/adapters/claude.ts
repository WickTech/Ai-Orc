import type { AgentAdapter } from "../types"

export const claude: AgentAdapter = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  args: [],
  installHint: "npm install -g @anthropic-ai/claude-code",
  capabilities: { headless: true, mcp: true },
  headlessArgs: (prompt) => ["-p", prompt],
}
