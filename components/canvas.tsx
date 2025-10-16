"use client"

import { useEffect, useRef, useState } from "react"
import { useCanvas } from "@/hooks/use-canvas"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Square, MousePointer2, Circle, Triangle, Trash2, Minus, Type } from "lucide-react"

interface CanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
  onSelectionChange?: (selectedIds: string[]) => void
  children?: any
}

export function Canvas({ canvasId, objects, onObjectsChange, onCursorMove, onSelectionChange, children }: CanvasProps) {
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
    editingTextId,
    saveTextEdit,
    cancelTextEdit,
  } = useCanvas({
    canvasId,
    objects,
    onObjectsChange,
    onCursorMove,
  })

  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const [textValue, setTextValue] = useState("")

  useEffect(() => {
    if (editingTextId) {
      const obj = objects.find((o) => o.id === editingTextId)
      if (obj && obj.type === "text") {
        setTextValue(obj.text_content || "")
        setTimeout(() => {
          textInputRef.current?.focus()
          textInputRef.current?.select()
        }, 0)
      }
    }
  }, [editingTextId, objects])

  useEffect(() => {
    onSelectionChange?.(selectedIds)
  }, [selectedIds, onSelectionChange])

  const editingTextObject = editingTextId ? objects.find((o) => o.id === editingTextId) : null

  const getTextareaPosition = () => {
    if (!canvasRef.current || !editingTextObject) return null

    const rect = canvasRef.current.getBoundingClientRect()
    const scaledLeft = (viewport.x + editingTextObject.x) * viewport.zoom
    const scaledTop = (viewport.y + editingTextObject.y) * viewport.zoom

    return {
      left: rect.left + scaledLeft,
      top: rect.top + scaledTop,
      width: editingTextObject.width * viewport.zoom,
      height: editingTextObject.height * viewport.zoom,
    }
  }

  const textareaPosition = getTextareaPosition()

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
        <Button
          variant={tool === "text" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool("text")}
          title="Text (T) - Black"
        >
          <Type className="h-4 w-4" />
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

      <div className="absolute bottom-4 right-4 z-10 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg">
        <span className="text-muted-foreground">Zoom: </span>
        <span className="font-medium">{Math.round(viewport.zoom * 100)}%</span>
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

      {editingTextId && editingTextObject && textareaPosition && (
        <textarea
          ref={textInputRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              saveTextEdit(editingTextId, textValue)
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancelTextEdit()
            }
          }}
          onBlur={() => {
            saveTextEdit(editingTextId, textValue)
          }}
          className="fixed z-20 resize-none border-2 border-blue-500 bg-white/90 text-center text-black outline-none overflow-hidden"
          style={{
            left: `${textareaPosition.left}px`,
            top: `${textareaPosition.top}px`,
            width: `${textareaPosition.width}px`,
            height: `${textareaPosition.height}px`,
            fontSize: `${(editingTextObject.font_size || 16) * viewport.zoom}px`,
            fontFamily: editingTextObject.font_family || "Arial",
            lineHeight: "1.2",
            color: editingTextObject.fill_color,
            caretColor: editingTextObject.fill_color,
            padding: 0,
            margin: 0,
            boxSizing: "border-box",
          }}
        />
      )}

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
