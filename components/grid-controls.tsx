"use client"

import { Grid3x3, Magnet } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { GridSettings } from "@/lib/grid-utils"

interface GridControlsProps {
  gridSettings: GridSettings
  onToggleGrid: () => void
  onToggleSnap: () => void
  onChangeGridSize: (size: number) => void
}

export function GridControls({ gridSettings, onToggleGrid, onToggleSnap, onChangeGridSize }: GridControlsProps) {
  const gridSizes = [10, 20, 30, 50, 100]

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={gridSettings.enabled ? "default" : "ghost"}
        size="sm"
        onClick={onToggleGrid}
        title="Toggle Grid (Ctrl+')"
      >
        <Grid3x3 className="h-4 w-4" />
      </Button>

      <Button
        variant={gridSettings.snapEnabled ? "default" : "ghost"}
        size="sm"
        onClick={onToggleSnap}
        disabled={!gridSettings.enabled}
        title="Toggle Snap to Grid"
      >
        <Magnet className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!gridSettings.enabled}>
            {gridSettings.size}px
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Grid Size</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {gridSizes.map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => onChangeGridSize(size)}
              className={gridSettings.size === size ? "bg-accent" : ""}
            >
              {size}px
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
