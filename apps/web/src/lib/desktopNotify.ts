// Opt-in browser notifications for session events. The choice is a per-browser
// convenience kept in localStorage; every access tolerates it being unavailable.

const KEY = "axion.desktopNotify"

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

export function desktopEnabled(): boolean {
  if (!desktopSupported() || Notification.permission !== "granted") return false
  try {
    return window.localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

/** Asks for permission (must follow a user gesture) and remembers the opt-in. */
export async function enableDesktop(): Promise<boolean> {
  if (!desktopSupported()) return false
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
  if (permission !== "granted") return false
  try {
    window.localStorage.setItem(KEY, "1")
  } catch {
    // Without storage the opt-in only lasts until reload; permission is still granted.
  }
  return true
}

export function disableDesktop(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // nothing to remove
  }
}

/** Shows a notification only when the tab is in the background: otherwise the in-app list is enough. */
export function notifyDesktop(title: string, body: string): void {
  if (!desktopEnabled() || !document.hidden) return
  try {
    new Notification(`Axion: ${title}`, { body })
  } catch {
    // Some browsers only allow notifications from a service worker; ignore.
  }
}
