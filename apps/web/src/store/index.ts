import { create } from "zustand"
import { listAdapters } from "@wicktech/axion-agents"
import type { Tool, TerminalState, TerminalStatus } from "@/types"

const DEFAULT_TOOLS: Tool[] = listAdapters().map((a) => ({
  id: a.id,
  label: a.label,
  command: a.command,
  args: [...a.args],
  builtin: true,
}))

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
