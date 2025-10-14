"use client"

import type React from "react"

import { useCanvas } from "@/hooks/use-canvas"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Square, MousePointer2, Circle, Triangle, Trash2, Minus } from "lucide-react"

interface CanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
  onSelectionChange?: (selectedIds: string[]) => void
  otherUsersSelections?: Array<{ userId: string; userName: string; color: string; selectedIds: string[] }>
  children?: React.ReactNode
}

export function Canvas({
  canvasId,
  objects,
  onObjectsChange,
  onCursorMove,
  onSelectionChange,
  otherUsersSelections,
  children,
}: CanvasProps) {
  const {
    canvasRef,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    viewport,
    selectedIds,
    deleteSelectedObject,
  } = useCanvas({
    canvasId,
    objects,
    onObjectsChange,
    onCursorMove,
    onSelectionChange,
    otherUsersSelections,
  })

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-10 flex gap-2 rounded-lg border bg-card p-2 shadow-lg">
        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool("select")}
          title="Select (V)"
        >
          <MousePointer2 className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "rectangle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool("rectangle")}
          title="Rectangle (R) - Blue"
        >
          <Square className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "circle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool("circle")}
          title="Circle (C) - Green"
        >
          <Circle className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "triangle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool("triangle")}
          title="Triangle (T) - Orange"
        >
          <Triangle className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "line" ? "default" : "ghost"}
          size="icon"
          onClick={() => {
            console.log("[v0] Line button clicked")
            setTool("line")
          }}
          title="Line (L) - Purple"
        >
          <Minus className="h-4 w-4" />
        </Button>

        {selectedIds.length > 0 && (
          <>
            <div className="w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              onClick={deleteSelectedObject}
              title={`Delete ${selectedIds.length} object${selectedIds.length > 1 ? "s" : ""} (Del/Backspace)`}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={typeof window !== "undefined" ? window.innerWidth : 1920}
        height={typeof window !== "undefined" ? window.innerHeight : 1080}
        className="h-full w-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Multiplayer cursors overlay */}
      <div className="pointer-events-none absolute inset-0">
        {children && (
          <div
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
