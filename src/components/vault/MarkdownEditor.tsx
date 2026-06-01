"use client"

import { useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Save, Loader2 } from "lucide-react"

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-white/30">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
})

interface MarkdownEditorProps {
  filePath: string
  initialContent: string
  onSave?: (content: string) => void
}

export function MarkdownEditor({ filePath, initialContent, onSave }: MarkdownEditorProps) {
  const [value, setValue] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setValue(initialContent)
    setDirty(false)
  }, [initialContent, filePath])

  const handleChange = useCallback((val: string | undefined) => {
    setValue(val ?? "")
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch("/api/vault/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: value }),
      })
      setDirty(false)
      onSave?.(value)
    } finally {
      setSaving(false)
    }
  }, [filePath, value, onSave])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  return (
    <div className="flex flex-col h-full" data-color-mode="dark">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-[#161b22]">
        <span className="text-sm text-white/50 font-mono truncate flex-1">{filePath.split("/").pop()}</span>
        {dirty && <span className="text-xs text-yellow-400/70">unsaved</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="h-7 gap-1.5 text-white/60 hover:text-white"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <MDEditor
          value={value}
          onChange={handleChange}
          height="100%"
          visibleDragbar={false}
          style={{ height: "100%", background: "transparent" }}
        />
      </div>
    </div>
  )
}
