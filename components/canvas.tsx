"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
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
  gridEnabled?: boolean // Added grid props
  snapEnabled?: boolean
  gridSize?: number
}

export function Canvas({
  canvasId,
  objects,
  onObjectsChange,
  onCursorMove,
  onSelectionChange,
  children,
  gridEnabled = false, // Added grid props with defaults
  snapEnabled,
  gridSize,
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
    editingTextId,
    saveTextEdit,
    cancelTextEdit,
    measureText, // Get measureText from hook
  } = useCanvas({
    canvasId,
    objects,
    onObjectsChange,
    onCursorMove,
    gridEnabled, // Pass grid props to useCanvas hook
    snapEnabled,
    gridSize,
  })

  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const [textValue, setTextValue] = useState("")
  const [textareaDimensions, setTextareaDimensions] = useState({ width: 200, height: 50 })
  const resizeTimerRef = useRef<NodeJS.Timeout>()
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [canvasMetrics, setCanvasMetrics] = useState({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
  })

  const updateCanvasMetrics = useCallback(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return

    const rect = canvasEl.getBoundingClientRect()
    const parentRect = canvasEl.parentElement?.getBoundingClientRect()

    const scaleX = rect.width && canvasEl.width ? rect.width / canvasEl.width : 1
    const scaleY = rect.height && canvasEl.height ? rect.height / canvasEl.height : 1

    setCanvasMetrics({
      offsetX: parentRect ? rect.left - parentRect.left : 0,
      offsetY: parentRect ? rect.top - parentRect.top : 0,
      scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
      scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
    })
  }, [canvasRef])

  useEffect(() => {
    if (editingTextId) {
      const obj = objects.find((o) => o.id === editingTextId)
      if (obj && obj.type === "text") {
        setTextValue(obj.text_content || "")
        setShowPlaceholder(!obj.text_content)
        setTextareaDimensions({ width: obj.width, height: obj.height })
        setTimeout(() => {
          textInputRef.current?.focus()
          textInputRef.current?.select()
        }, 0)
        updateCanvasMetrics()
      }
    } else {
      setShowPlaceholder(false)
    }
  }, [editingTextId, objects, updateCanvasMetrics])

  useEffect(() => {
    if (editingTextId && textValue && measureText) {
      // Clear any pending resize
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }

      // Debounce the resize calculation
      resizeTimerRef.current = setTimeout(() => {
        const obj = objects.find((o) => o.id === editingTextId)
        if (obj && obj.type === "text") {
          const { width, height } = measureText(textValue, obj.font_size || 16, obj.font_family || "Arial")
          setTextareaDimensions({ width, height })
        }
      }, 150) // Wait 150ms after user stops typing before resizing

      return () => {
        if (resizeTimerRef.current) {
          clearTimeout(resizeTimerRef.current)
        }
      }
    }
  }, [textValue, editingTextId, objects, measureText])

  useEffect(() => {
    updateCanvasMetrics()

    const handleResize = () => updateCanvasMetrics()
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [updateCanvasMetrics])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => updateCanvasMetrics())
    observer.observe(canvasEl)

    return () => {
      observer.disconnect()
    }
  }, [canvasRef, updateCanvasMetrics])

  useEffect(() => {
    onSelectionChange?.(selectedIds)
  }, [selectedIds, onSelectionChange])

  const editingTextObject = editingTextId ? objects.find((o) => o.id === editingTextId) : null
  const { x: viewportX, y: viewportY, zoom: viewportZoom } = viewport

  const textAreaStyle: CSSProperties | undefined = useMemo(() => {
    if (!editingTextObject) return undefined

    const scaledZoomX = viewportZoom * canvasMetrics.scaleX
    const scaledZoomY = viewportZoom * canvasMetrics.scaleY
    const scaledFontSize = (editingTextObject.font_size || 16) * scaledZoomY
    const paddingTop = Math.max(0, (textareaDimensions.height * scaledZoomY - scaledFontSize * 1.2) / 2)

    return {
      left: `${canvasMetrics.offsetX + (viewportX + editingTextObject.x * viewportZoom) * canvasMetrics.scaleX}px`,
      top: `${canvasMetrics.offsetY + (viewportY + editingTextObject.y * viewportZoom) * canvasMetrics.scaleY}px`,
      width: `${textareaDimensions.width * scaledZoomX}px`,
      height: `${textareaDimensions.height * scaledZoomY}px`,
      fontSize: `${scaledFontSize}px`,
      fontFamily: editingTextObject.font_family || "Arial",
      paddingTop: `${paddingTop}px`,
      lineHeight: "1.2",
      color: editingTextObject.fill_color,
      caretColor: editingTextObject.fill_color,
      paddingLeft: 0,
      paddingRight: 0,
      margin: 0,
      boxSizing: "border-box",
    }
  }, [canvasMetrics, editingTextObject, viewportX, viewportY, viewportZoom, textareaDimensions])

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/20">
      {/* Toolbar */}
      <div className="absolute left-4 top-20 z-10 flex gap-2 rounded-lg border bg-card p-2 shadow-lg">
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

      {/* Zoom display */}
      <div className="absolute bottom-4 right-[224px] z-10 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg">
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

      {editingTextId && editingTextObject && (
        <div
          className="absolute z-20"
          style={{
            left: textAreaStyle?.left,
            top: textAreaStyle?.top,
            width: textAreaStyle?.width,
            height: textAreaStyle?.height,
          }}
        >
          <textarea
            ref={textInputRef}
            value={textValue}
            onChange={(e) => {
              setTextValue(e.target.value)
              setShowPlaceholder(e.target.value.length === 0)
            }}
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
            placeholder={showPlaceholder ? "Type here..." : ""}
            className="h-full w-full resize-none border-none bg-transparent text-center text-black outline-none overflow-hidden placeholder:text-gray-400 placeholder:opacity-50"
            style={{
              fontSize: textAreaStyle?.fontSize,
              fontFamily: textAreaStyle?.fontFamily,
              paddingTop: textAreaStyle?.paddingTop,
              lineHeight: textAreaStyle?.lineHeight,
              color: textAreaStyle?.color,
              caretColor: textAreaStyle?.caretColor,
              boxSizing: "border-box",
            }}
          />
        </div>
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
