import { create } from "zustand"
import type { Tool, TerminalState, TerminalStatus } from "@/types"

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
  tools: [],
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
