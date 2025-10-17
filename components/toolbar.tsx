"use client"

import { Button } from "@/components/ui/button"
import { LogOut, Undo, Redo, Download } from "lucide-react"
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
}: ToolbarProps) {
  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b bg-background/80 backdrop-blur-md px-4 shadow-sm">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          CollabCanvas
        </h1>
        <span className="text-sm text-muted-foreground">MVP</span>

        <div className="flex items-center gap-1 border-l pl-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="transition-all hover:scale-105"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="transition-all hover:scale-105"
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>

        {onAlign && onDistribute && (
          <AlignmentToolbar selectedCount={selectedCount} onAlign={onAlign} onDistribute={onDistribute} />
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
                <Button variant="ghost" size="sm" className="gap-2 transition-all hover:scale-105">
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
        <div className="flex items-center gap-2 rounded-full bg-accent px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-medium">{userName}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          title="Sign Out"
          className="transition-all hover:scale-105 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
