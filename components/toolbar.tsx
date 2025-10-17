"use client"

import { Button } from "@/components/ui/button"
import { LogOut, Undo, Redo, Download, History, MessageSquare, Copy, Clipboard } from "lucide-react"
import { AlignmentToolbar } from "./alignment-toolbar"
import { GridControls } from "./grid-controls"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

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
  onExportPNG?: () => void
  onExportSVG?: () => void
  gridEnabled?: boolean
  snapEnabled?: boolean
  gridSize?: number
  onGridChange?: (enabled: boolean, snap: boolean, size: number) => void
  onShowHistory?: () => void
  commentMode?: boolean
  onToggleCommentMode?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onBringToFront?: () => void
  onSendToBack?: () => void
  onBringForward?: () => void
  onSendBackward?: () => void
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
  onExportPNG,
  onExportSVG,
  gridEnabled = false,
  snapEnabled = false,
  gridSize = 20,
  onGridChange,
  onShowHistory,
  commentMode = false,
  onToggleCommentMode,
  onCopy,
  onPaste,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
}: ToolbarProps) {
  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border/50 bg-background/95 backdrop-blur-md shadow-sm transition-all duration-200 px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">CollabCanvas</h1>
        <span className="text-sm text-muted-foreground">Early Prototype</span>

        <div className="flex items-center gap-1 border-l pl-4">
          <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <Redo className="h-4 w-4" />
          </Button>
          {onCopy && (
            <Button variant="ghost" size="icon" onClick={onCopy} disabled={selectedCount === 0} title="Copy (Ctrl+C)">
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {onPaste && (
            <Button variant="ghost" size="icon" onClick={onPaste} title="Paste (Ctrl+V)">
              <Clipboard className="h-4 w-4" />
            </Button>
          )}
          {onShowHistory && (
            <Button variant="ghost" size="icon" onClick={onShowHistory} title="Version History">
              <History className="h-4 w-4" />
            </Button>
          )}
          {onToggleCommentMode && (
            <Button
              variant={commentMode ? "default" : "ghost"}
              size="icon"
              onClick={onToggleCommentMode}
              title="Comment Mode (C)"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          )}
        </div>

        {onAlign && onDistribute && (
          <AlignmentToolbar
            selectedCount={selectedCount}
            onAlign={onAlign}
            onDistribute={onDistribute}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        )}

        {onGridChange && (
          <div className="border-l pl-4">
            <GridControls
              gridEnabled={gridEnabled}
              snapEnabled={snapEnabled}
              gridSize={gridSize}
              onGridChange={onGridChange}
            />
          </div>
        )}

        {(onExportPNG || onExportSVG) && (
          <div className="border-l pl-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {onExportPNG && <DropdownMenuItem onClick={onExportPNG}>Export as PNG</DropdownMenuItem>}
                {onExportSVG && <DropdownMenuItem onClick={onExportSVG}>Export as SVG</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
