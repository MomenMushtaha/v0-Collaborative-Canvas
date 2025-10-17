"use client"

import { Button } from "@/components/ui/button"
import { LogOut, Undo, Redo } from "lucide-react"
import { AlignmentToolbar } from "./alignment-toolbar"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"

interface ToolbarProps {
  userName: string
  onSignOut: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  selectedCount?: number
  onAlign?: (type: AlignmentType) => void
  onDistribute?: (type: DistributeType) => void
}

export function Toolbar({
  userName,
  onSignOut,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  selectedCount = 0,
  onAlign,
  onDistribute,
}: ToolbarProps) {
  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">CollabCanvas</h1>
        <span className="text-sm text-muted-foreground">MVP</span>

        <div className="flex items-center gap-1 border-l pl-4">
          <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <Redo className="h-4 w-4" />
          </Button>
        </div>

        {onAlign && onDistribute && (
          <AlignmentToolbar selectedCount={selectedCount} onAlign={onAlign} onDistribute={onDistribute} />
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{userName}</span>
        <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign Out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
