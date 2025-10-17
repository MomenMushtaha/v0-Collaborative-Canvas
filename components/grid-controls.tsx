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

interface GridControlsProps {
  gridEnabled: boolean
  snapEnabled: boolean
  gridSize: number
  onGridChange: (enabled: boolean, snap: boolean, size: number) => void
}

export function GridControls({ gridEnabled, snapEnabled, gridSize, onGridChange }: GridControlsProps) {
  const gridSizes = [10, 20, 30, 50, 100]

  const handleToggleGrid = () => {
    onGridChange(!gridEnabled, snapEnabled, gridSize)
  }

  const handleToggleSnap = () => {
    onGridChange(gridEnabled, !snapEnabled, gridSize)
  }

  const handleChangeGridSize = (size: number) => {
    onGridChange(gridEnabled, snapEnabled, size)
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={gridEnabled ? "default" : "ghost"}
        size="sm"
        onClick={handleToggleGrid}
        title="Toggle Grid (Ctrl+')"
      >
        <Grid3x3 className="h-4 w-4" />
      </Button>

      <Button
        variant={snapEnabled ? "default" : "ghost"}
        size="sm"
        onClick={handleToggleSnap}
        disabled={!gridEnabled}
        title="Toggle Snap to Grid"
      >
        <Magnet className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!gridEnabled} className="justify-center">
            {gridSize}px
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Grid Size</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {gridSizes.map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => handleChangeGridSize(size)}
              className={gridSize === size ? "bg-accent" : ""}
            >
              {size}px
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
