"use client"

import { useEffect, useState, useCallback } from "react"
import { FileTree } from "@/components/vault/FileTree"
import { MarkdownEditor } from "@/components/vault/MarkdownEditor"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWebSocket } from "@/providers/WebSocketProvider"
import { BookOpen, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { VaultFile, WsMessage } from "@/types"

export default function VaultPage() {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null)
  const [fileContent, setFileContent] = useState("")
  const [loading, setLoading] = useState(false)
  const { subscribe } = useWebSocket()

  const loadTree = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/vault/tree")
      const data = await res.json()
      if (Array.isArray(data)) setFiles(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/vault/tree")
      .then((res) => res.json())
      .then((data) => { if (!cancelled && Array.isArray(data)) setFiles(data) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unsub = subscribe((msg: WsMessage) => {
      if (msg.type === "vault:change") loadTree()
    })
    return unsub
  }, [subscribe, loadTree])

  async function openFile(file: VaultFile) {
    setSelectedFile(file)
    const res = await fetch(`/api/vault/file?path=${encodeURIComponent(file.path)}`)
    const data = await res.json()
    setFileContent(data.content ?? "")
  }

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      <div className="w-[240px] shrink-0 flex flex-col border-r border-white/10 bg-[#0d1117]">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-white/40" />
            <span className="text-xs font-medium text-white/50">Vault</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/30 hover:text-white/70"
            onClick={loadTree}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <FileTree
            files={files}
            selectedPath={selectedFile?.path}
            onSelect={openFile}
          />
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile ? (
          <MarkdownEditor
            key={selectedFile.path}
            filePath={selectedFile.path}
            initialContent={fileContent}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/20 flex-col gap-2">
            <BookOpen className="h-8 w-8 opacity-40" />
            <p>Select a note to edit</p>
          </div>
        )}
      </div>
    </div>
  )
}
