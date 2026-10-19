import type { AgentAdapter } from "../types"

export const gemini: AgentAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  command: "gemini",
  args: [],
  installHint: "npm install -g @google/gemini-cli",
  capabilities: { headless: true, mcp: true },
  headlessArgs: (prompt) => ["-p", prompt],
}
