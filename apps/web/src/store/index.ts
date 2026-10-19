import { create } from "zustand"
import { listAdapters } from "@wicktech/axion-agents"
import type { AppNotification, NotificationKind, Tool, TerminalState, TerminalStatus } from "@/types"
import { forgetOutput } from "@/lib/sessions"
import { notifyDesktop } from "@/lib/desktopNotify"

const MAX_NOTIFICATIONS = 50
let notificationSeq = 0

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
  notifications: AppNotification[]
  activeTerminalId: string | null
  setTools: (tools: Tool[]) => void
  addTerminal: (t: TerminalState) => void
  setActiveTerminal: (id: string | null) => void
  updateTerminalStatus: (id: string, status: TerminalStatus) => void
  setTerminalWorktree: (id: string, branch: string, worktreePath: string) => void
  setTerminalWarning: (id: string, warning: string | undefined) => void
  setTerminalExit: (id: string, code: number) => void
  removeTerminal: (id: string) => void
  notify: (kind: NotificationKind, terminalId: string, message: string) => void
  markNotificationsRead: () => void
  clearNotifications: () => void
}

export const useStore = create<AppStore>((set) => ({
  tools: DEFAULT_TOOLS,
  terminals: [],
  notifications: [],
  activeTerminalId: null,
  setTools: (tools) => set({ tools }),
  addTerminal: (t) =>
    set((s) => ({ terminals: [...s.terminals, t], activeTerminalId: t.id })),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  updateTerminalStatus: (id, status) => {
    // A restarted session starts fresh: no old exit code, loop warning or idle clock.
    if (status === "running") forgetOutput(id)
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? (status === "running" ? { ...t, status, exitCode: undefined, warning: undefined } : { ...t, status }) : t,
      ),
    }))
  },
  setTerminalWorktree: (id, branch, worktreePath) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, branch, worktreePath } : t)),
    })),
  setTerminalWarning: (id, warning) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, warning } : t)),
    })),
  setTerminalExit: (id, code) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, status: "exited", exitCode: code } : t)),
    })),
  notify: (kind, terminalId, message) => {
    notifyDesktop(kind, message)
    set((s) => ({
      notifications: [
        { id: `n${++notificationSeq}`, at: Date.now(), kind, terminalId, message, read: false },
        ...s.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    }))
  },
  markNotificationsRead: () =>
    set((s) => (s.notifications.some((n) => !n.read) ? { notifications: s.notifications.map((n) => ({ ...n, read: true })) } : s)),
  clearNotifications: () => set({ notifications: [] }),
  removeTerminal: (id) =>
    set((s) => {
      forgetOutput(id)
      const terminals = s.terminals.filter((t) => t.id !== id)
      const activeTerminalId =
        s.activeTerminalId === id ? (terminals[terminals.length - 1]?.id ?? null) : s.activeTerminalId
      return { terminals, activeTerminalId }
    }),
}))
