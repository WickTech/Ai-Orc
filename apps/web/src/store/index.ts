import { create } from "zustand"
import type { Tool, TerminalState, TerminalStatus } from "@/types"

const DEFAULT_TOOLS: Tool[] = [
  { id: "claude", label: "Claude Code", command: "claude", builtin: true },
  { id: "gemini", label: "Gemini CLI", command: "gemini", builtin: true },
  { id: "codex", label: "Codex CLI", command: "codex", builtin: true },
]

interface AppStore {
  tools: Tool[]
  terminals: TerminalState[]
  activeTerminalId: string | null
  setTools: (tools: Tool[]) => void
  addTerminal: (t: TerminalState) => void
  setActiveTerminal: (id: string | null) => void
  updateTerminalStatus: (id: string, status: TerminalStatus) => void
  removeTerminal: (id: string) => void
}

export const useStore = create<AppStore>((set) => ({
  tools: DEFAULT_TOOLS,
  terminals: [],
  activeTerminalId: null,
  setTools: (tools) => set({ tools }),
  addTerminal: (t) =>
    set((s) => ({ terminals: [...s.terminals, t], activeTerminalId: t.id })),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  updateTerminalStatus: (id, status) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, status } : t)),
    })),
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id)
      const activeTerminalId =
        s.activeTerminalId === id ? (terminals[terminals.length - 1]?.id ?? null) : s.activeTerminalId
      return { terminals, activeTerminalId }
    }),
}))
