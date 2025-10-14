"use client"

import type React from "react"

import { useCanvas } from "@/hooks/use-canvas"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Square, MousePointer2 } from "lucide-react"

interface CanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
  children?: React.ReactNode
}

export function Canvas({ canvasId, objects, onObjectsChange, onCursorMove, children }: CanvasProps) {
  const { canvasRef, tool, setTool, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, viewport } =
    useCanvas({
      canvasId,
      objects,
      onObjectsChange,
      onCursorMove,
    })

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/20">
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
          title="Rectangle (R)"
        >
          <Square className="h-4 w-4" />
        </Button>
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
          <div style={{ transform: `translate(${-viewport.x}px, ${-viewport.y}px) scale(${viewport.zoom})` }}>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
