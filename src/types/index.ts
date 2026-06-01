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
  | "vault:change"

export interface WsMessage {
  type: WsMessageType
  id?: string
  data?: string
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
}
