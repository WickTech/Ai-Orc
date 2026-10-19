"use client"

import { useState } from "react"
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import type { VaultFile } from "@/types"

interface FileTreeProps {
  files: VaultFile[]
  selectedPath?: string
  onSelect: (file: VaultFile) => void
  depth?: number
}

function FileNode({
  file,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  file: VaultFile
  selectedPath?: string
  onSelect: (f: VaultFile) => void
  depth: number
}) {
  const [open, setOpen] = useState(depth === 0)

  if (file.type === "dir") {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-0.5 hover:bg-white/5 rounded text-sm text-white/70 hover:text-white/90 transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-yellow-400/70" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-yellow-400/70" />}
          <span className="truncate">{file.name}</span>
        </button>
        {open && file.children && (
          <div>
            {file.children.map((child) => (
              <FileNode key={child.path} file={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      className={cn(
        "flex items-center gap-1 w-full text-left px-2 py-0.5 rounded text-sm transition-colors",
        file.path === selectedPath
          ? "bg-blue-500/20 text-blue-300"
          : "text-white/60 hover:text-white/90 hover:bg-white/5"
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={() => onSelect(file)}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400/70" />
      <span className="truncate">{file.name.replace(/\.md$/, "")}</span>
    </button>
  )
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  if (files.length === 0) {
    return (
      <p className="text-xs text-white/30 px-3 py-4 text-center">
        No .md files found.<br />Set your vault path in Settings.
      </p>
    )
  }

  return (
    <div className="py-1">
      {files.map((f) => (
        <FileNode key={f.path} file={f} selectedPath={selectedPath} onSelect={onSelect} depth={0} />
      ))}
    </div>
  )
}
