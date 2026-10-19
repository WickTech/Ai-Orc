/**
 * Describes how Axion launches one AI coding CLI. An adapter is data plus two
 * tiny functions, so supporting a new agent means adding one file under
 * `adapters/` and listing it in `registry.ts`.
 */
export interface AgentAdapter {
  /** Stable identifier used in URLs, the registry and WebSocket spawn messages. */
  id: string
  /** Human-readable name for the UI. */
  label: string
  /** Executable name resolved from PATH. Never a path and never contains arguments. */
  command: string
  /** Arguments for an interactive terminal session. */
  args: readonly string[]
  /** One line telling the user how to install the CLI when it is missing. */
  installHint: string
  capabilities: AgentCapabilities
  /**
   * Arguments for a one-shot, non-interactive run of `prompt`, or undefined
   * when the CLI has no headless mode we rely on.
   */
  headlessArgs?: (prompt: string) => string[]
}

export interface AgentCapabilities {
  /** Can run unattended with a prompt and print the result (see headlessArgs). */
  headless: boolean
  /** Speaks the Model Context Protocol as a client. */
  mcp: boolean
}
