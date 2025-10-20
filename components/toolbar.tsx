"use client"

import { Button } from "@/components/ui/button"
import {
  LogOut,
  Undo,
  Redo,
  Download,
  History,
  MessageSquare,
  Lasso,
  MousePointerClick,
  Group,
  Ungroup,
} from "lucide-react"
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
  isHistoryOpen?: boolean
  commentMode?: boolean
  onToggleCommentMode?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onBringToFront?: () => void
  onSendToBack?: () => void
  onBringForward?: () => void
  onSendBackward?: () => void
  lassoMode?: boolean
  onToggleLassoMode?: () => void
  onSelectAllOfType?: () => void
  onGroup?: () => void
  onUngroup?: () => void
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
  isHistoryOpen = false,
  commentMode = false,
  onToggleCommentMode,
  onCopy,
  onPaste,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  lassoMode = false,
  onToggleLassoMode,
  onSelectAllOfType,
  onGroup,
  onUngroup,
}: ToolbarProps) {
  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border/50 bg-background/95 backdrop-blur-md shadow-sm transition-all duration-200 px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">CollabCanvas</h1>

        <div className="flex items-center gap-1 border-l pl-4">
          <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <Redo className="h-4 w-4" />
          </Button>
          {onShowHistory && (
            <Button
              variant={isHistoryOpen ? "default" : "ghost"}
              size="icon"
              onClick={onShowHistory}
              title="Version History"
            >
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

        {(onGroup || onUngroup) && (
          <div className="flex items-center gap-1 border-l pl-4">
            {onGroup && (
              <Button variant="ghost" size="icon" onClick={onGroup} disabled={selectedCount < 2} title="Group (Ctrl+G)">
                <Group className="h-4 w-4" />
              </Button>
            )}
            {onUngroup && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onUngroup}
                disabled={selectedCount === 0}
                title="Ungroup (Ctrl+Shift+G)"
              >
                <Ungroup className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {(onToggleLassoMode || onSelectAllOfType) && (
          <div className="flex items-center gap-1 border-l pl-4">
            {onToggleLassoMode && (
              <Button
                variant={lassoMode ? "default" : "ghost"}
                size="icon"
                onClick={onToggleLassoMode}
                title="Lasso Select (L)"
              >
                <Lasso className="h-4 w-4" />
              </Button>
            )}
            {onSelectAllOfType && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  console.log("[v0] Select All of Type button clicked")
                  console.log("[v0] onSelectAllOfType function:", onSelectAllOfType)
                  onSelectAllOfType()
                }}
                disabled={selectedCount === 0}
                title="Select All of Type (Ctrl+Shift+A)"
              >
                <MousePointerClick className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

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
