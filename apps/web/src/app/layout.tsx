import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"
import "./globals.css"
import { AppShell } from "@/components/layout/AppShell"
import { WebSocketProvider } from "@/providers/WebSocketProvider"

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "AI-Orc — AI Platform Orchestrator",
  description: "Locally run and observe Claude Code, Gemini CLI, Codex, and any open-source AI tool.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className={`${geistMono.variable} h-full antialiased bg-[#0d1117]`}>
        <WebSocketProvider>
          <AppShell>{children}</AppShell>
        </WebSocketProvider>
      </body>
    </html>
  )
}
