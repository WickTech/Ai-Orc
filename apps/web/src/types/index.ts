export interface Tool {
  id: string
  label: string
  command: string
  args?: string[]
  builtin?: boolean
  repoUrl?: string
  clonePath?: string
}

export interface AppConfig {
  vaultPath: string
  port: number
  /** Absolute paths of git repository roots that sessions may run isolated worktrees in. */
  repos: string[]
}

export interface Db {
  config: AppConfig
  tools: Tool[]
}

export type WsMessageType =
  | "terminal:spawn"
  | "terminal:input"
  | "terminal:resize"
  | "terminal:kill"
  | "terminal:output"
  | "terminal:exit"
  | "terminal:worktree"
  | "vault:change"

export interface WsMessage {
  type: WsMessageType
  id?: string
  data?: string
  toolId?: string
  /** Id of a configured repo: run the session in an isolated worktree of it. */
  repoId?: string
  /** Set on terminal:worktree: the session branch. */
  branch?: string
  command?: string
  args?: string[]
  cols?: number
  rows?: number
  code?: number
  path?: string
  event?: "add" | "change" | "unlink"
}

export interface InstallStep {
  label: string
  command: string
}

export interface RegistryAddResult {
  name: string
  description: string
  installSteps: InstallStep[]
  repoUrl: string
  clonePath: string
}

export interface VaultFile {
  name: string
  path: string
  type: "file" | "dir"
  children?: VaultFile[]
}

export type TerminalStatus = "idle" | "running" | "exited"

export interface TerminalState {
  id: string
  toolId: string
  label: string
  status: TerminalStatus
  /** Repo whose isolated worktree this session runs in (resent on restart). */
  repoId?: string
  /** Present once the server created the worktree. */
  branch?: string
  worktreePath?: string
}
