"use client"

import { useState } from "react"

export default function LoginPage() {
  const [token, setToken] = useState("")
  const [error, setError] = useState("")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        window.location.href = "/"
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `Sign-in failed (HTTP ${res.status})`)
    } catch {
      setError("Could not reach the server")
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 p-6 rounded-xl border border-white/10 bg-white/[0.02]">
        <h1 className="text-xl font-bold text-white">Sign in</h1>
        <p className="text-xs text-white/40">Enter the AXION_TOKEN this server was started with.</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="API token"
          autoComplete="current-password"
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none"
        />
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        <button type="submit" className="w-full rounded-md bg-blue-600 hover:bg-blue-500 py-2 text-sm text-white">
          Sign in
        </button>
      </form>
    </div>
  )
}
