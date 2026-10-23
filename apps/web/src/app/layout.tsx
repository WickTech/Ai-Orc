import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { AppShell } from "@/components/layout/AppShell"
import { WebSocketProvider } from "@/providers/WebSocketProvider"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Axion — agent mission control",
  description: "Locally run and observe Claude Code, Gemini CLI, Codex, and any open-source AI tool.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <body className="h-full antialiased bg-[#0d1117]">
        <WebSocketProvider>
          <AppShell>{children}</AppShell>
        </WebSocketProvider>
      </body>
    </html>
  )
}
