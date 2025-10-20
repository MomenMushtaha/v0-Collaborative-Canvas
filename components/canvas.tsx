"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useCanvas } from "@/hooks/use-canvas"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Square,
  MousePointer2,
  Circle,
  Triangle,
  Trash2,
  Minus,
  Type,
  Send,
  X,
  Hand,
  Group,
  Ungroup,
} from "lucide-react"

function areSelectionsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

interface CanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
  onSelectionChange?: (selectedIds: string[]) => void
  children?: any
  viewport?: { x: number; y: number; zoom: number }
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
  gridEnabled?: boolean
  snapEnabled?: boolean
  gridSize?: number
  commentMode?: boolean
  onCommentCreate?: (x: number, y: number, content: string) => void
  selectedIds?: string[]
  lassoMode?: boolean
  onCommentModeChange?: (enabled: boolean) => void
}

export function Canvas({
  canvasId,
  objects,
  onObjectsChange,
  onCursorMove,
  onSelectionChange,
  children,
  viewport: externalViewport,
  onViewportChange,
  gridEnabled = false,
  snapEnabled,
  gridSize,
  commentMode = false,
  onCommentCreate,
  selectedIds: externalSelectedIds,
  lassoMode = false,
  onCommentModeChange,
}: CanvasProps) {
  const syncingExternalSelection = useRef(false)
  const {
    canvasRef,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    viewport,
    selectedIds: internalSelectedIds,
    setSelectedIds: setInternalSelectedIds,
    deleteSelectedObject,
    editingTextId,
    saveTextEdit,
    cancelTextEdit,
    measureText,
    isNewTextObject, // Get the new text object flag
  } = useCanvas({
    canvasId,
    objects,
    onObjectsChange,
    onCursorMove,
    gridEnabled,
    snapEnabled,
    gridSize,
    lassoMode,
  })

  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
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

  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number; content: string } | null>(null)

  const selectedIds = internalSelectedIds

  useEffect(() => {
    if (externalSelectedIds === undefined) return
    setInternalSelectedIds((prev) => {
      if (areSelectionsEqual(prev, externalSelectedIds)) {
        return prev
      }
      syncingExternalSelection.current = true
      return [...externalSelectedIds]
    })
  }, [externalSelectedIds, setInternalSelectedIds])

  useEffect(() => {
    if (!onSelectionChange) return
    if (syncingExternalSelection.current) {
      syncingExternalSelection.current = false
      return
    }
    onSelectionChange(selectedIds)
  }, [selectedIds, onSelectionChange])

  useEffect(() => {
    if (lassoMode && tool !== "select") {
      setTool("select")
    }
  }, [lassoMode, tool, setTool])

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
    if (onViewportChange) {
      onViewportChange(viewport)
    }
  }, [viewport, onViewportChange])

  const editingTextObject = editingTextId ? objects.find((o) => o.id === editingTextId) : null
  const { x: viewportX, y: viewportY, zoom: viewportZoom } = viewport // Always use internal viewport, not external

  const textAreaStyle: CSSProperties | undefined = useMemo(() => {
    if (!editingTextObject) return undefined

    const scaledZoomX = viewportZoom * canvasMetrics.scaleX
    const scaledZoomY = viewportZoom * canvasMetrics.scaleY
    const scaledFontSize = (editingTextObject.font_size || 16) * scaledZoomY
    const horizontalPadding = scaledFontSize * 0.5 // 50% of font size for comfortable padding
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
      paddingLeft: `${horizontalPadding}px`,
      paddingRight: `${horizontalPadding}px`,
      margin: 0,
      boxSizing: "border-box",
    }
  }, [canvasMetrics, editingTextObject, viewportX, viewportY, viewportZoom, textareaDimensions])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (commentMode && onCommentCreate) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return

        const x = (e.clientX - rect.left - viewportX) / viewportZoom
        const y = (e.clientY - rect.top - viewportY) / viewportZoom

        setCommentDraft({ x, y, content: "" })
        setTimeout(() => commentInputRef.current?.focus(), 0)
        e.stopPropagation()
      }
    },
    [commentMode, onCommentCreate, canvasRef, viewportX, viewportY, viewportZoom],
  )

  const handleCommentSubmit = useCallback(() => {
    if (commentDraft && commentDraft.content.trim() && onCommentCreate) {
      onCommentCreate(commentDraft.x, commentDraft.y, commentDraft.content.trim())
      setCommentDraft(null)
      if (onCommentModeChange) {
        onCommentModeChange(false)
      }
    }
  }, [commentDraft, onCommentCreate, onCommentModeChange])

  const handleCommentCancel = useCallback(() => {
    setCommentDraft(null)
    if (onCommentModeChange) {
      onCommentModeChange(false)
    }
  }, [onCommentModeChange])

  const commentInputStyle: CSSProperties | undefined = useMemo(() => {
    if (!commentDraft) return undefined

    return {
      left: `${canvasMetrics.offsetX + (viewportX + commentDraft.x * viewportZoom) * canvasMetrics.scaleX}px`,
      top: `${canvasMetrics.offsetY + (viewportY + commentDraft.y * viewportZoom) * canvasMetrics.scaleY}px`,
      width: `300px`,
      minHeight: `140px`,
    }
  }, [canvasMetrics, commentDraft, viewportX, viewportY, viewportZoom])

  const handleGroup = useCallback(() => {
    if (selectedIds.length < 2) return

    const groupId = crypto.randomUUID()
    const childObjects = objects.filter((obj) => selectedIds.includes(obj.id))

    // Calculate group bounds
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    childObjects.forEach((obj) => {
      minX = Math.min(minX, obj.x)
      minY = Math.min(minY, obj.y)
      maxX = Math.max(maxX, obj.x + obj.width)
      maxY = Math.max(maxY, obj.y + obj.height)
    })

    const groupObject: CanvasObject = {
      id: groupId,
      canvas_id: canvasId,
      type: "group",
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      fill_color: "transparent",
      stroke_color: "#9ca3af",
      stroke_width: 2,
      children_ids: selectedIds,
    }

    // Update child objects to reference parent group
    const updatedObjects = objects.map((obj) =>
      selectedIds.includes(obj.id) ? { ...obj, parent_group: groupId } : obj,
    )

    onObjectsChange([...updatedObjects, groupObject])
    setInternalSelectedIds([groupId])
  }, [selectedIds, objects, onObjectsChange, canvasId])

  const handleUngroup = useCallback(() => {
    console.log("[v0] handleUngroup called with selectedIds:", selectedIds)

    const selectedObjects = objects.filter((obj) => selectedIds.includes(obj.id))
    const groupObj = selectedObjects.find((obj) => obj.type === "group")

    console.log("[v0] Found group object:", groupObj)

    if (!groupObj || !groupObj.children_ids) {
      console.log("[v0] No valid group object found or no children")
      return
    }

    console.log("[v0] Ungrouping with children:", groupObj.children_ids)

    // Remove parent_group reference from children
    const updatedObjects = objects
      .filter((obj) => obj.id !== groupObj.id)
      .map((obj) => (groupObj.children_ids?.includes(obj.id) ? { ...obj, parent_group: undefined } : obj))

    onObjectsChange(updatedObjects)
    setInternalSelectedIds(groupObj.children_ids)

    console.log("[v0] Ungroup complete")
  }, [selectedIds, objects, onObjectsChange, setInternalSelectedIds])

  const shouldShowUngroupButton = useMemo(() => {
    console.log("[v0] shouldShowUngroupButton calculation - selectedIds:", selectedIds)

    if (selectedIds.length === 0) {
      console.log("[v0] No selection, returning false")
      return false
    }

    const selectedObjects = objects.filter((obj) => selectedIds.includes(obj.id))
    const hasGroupObject = selectedObjects.some((obj) => obj.type === "group")

    if (hasGroupObject) {
      console.log("[v0] Group object found in selection, returning true")
      return true
    }

    // Case 2: Multiple objects selected that all belong to the same group
    if (selectedIds.length > 1) {
      const parentGroups = selectedObjects.map((obj) => obj.parent_group).filter(Boolean)

      console.log("[v0] Multiple selection - Parent groups:", parentGroups)

      // All selected objects must have a parent group
      if (parentGroups.length === selectedObjects.length && parentGroups.length > 0) {
        const firstGroup = parentGroups[0]
        // All parent groups must be the same
        if (parentGroups.every((group) => group === firstGroup)) {
          console.log("[v0] All objects in same group, returning true")
          return true
        }
      }
    }

    console.log("[v0] No group condition met, returning false")
    return false
  }, [selectedIds, objects])

  console.log("[v0] shouldShowUngroupButton final value:", shouldShowUngroupButton)

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/20">
      {/* Toolbar */}
      <div className="absolute left-4 top-20 z-10 flex gap-2 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md p-2 shadow-xl transition-all duration-200 hover:shadow-2xl">
        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "select" ? "pan" : "select")}
          title="Select (V)"
        >
          <MousePointer2 className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "pan" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "pan" ? "select" : "pan")}
          title="Pan (H) - Drag to move canvas"
        >
          <Hand className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "rectangle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "rectangle" ? "select" : "rectangle")}
          title="Rectangle (R) - Blue"
        >
          <Square className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "circle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "circle" ? "select" : "circle")}
          title="Circle (C) - Green"
        >
          <Circle className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "triangle" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "triangle" ? "select" : "triangle")}
          title="Triangle (T) - Orange"
        >
          <Triangle className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "line" ? "default" : "ghost"}
          size="icon"
          onClick={() => {
            console.log("[v0] Line button clicked")
            setTool(tool === "line" ? "select" : "line")
          }}
          title="Line (L) - Purple"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant={tool === "text" ? "default" : "ghost"}
          size="icon"
          onClick={() => setTool(tool === "text" ? "select" : "text")}
          title="Text (T) - Black"
        >
          <Type className="h-4 w-4" />
        </Button>

        {selectedIds.length > 0 && (
          <>
            <div className="w-px bg-border" />
            {shouldShowUngroupButton ? (
              <Button variant="ghost" size="icon" onClick={handleUngroup} title="Ungroup (Ctrl+Shift+G)">
                <Ungroup className="h-4 w-4" />
              </Button>
            ) : selectedIds.length >= 2 ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleGroup}
                title={`Group ${selectedIds.length} objects (Ctrl+G)`}
              >
                <Group className="h-4 w-4" />
              </Button>
            ) : null}
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
      <div className="absolute bottom-4 right-4 md:right-[224px] z-10 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md px-3 py-2 text-sm shadow-xl transition-all duration-200 hover:shadow-2xl">
        <span className="text-muted-foreground">Zoom: </span>
        <span className="font-medium">{Math.round(viewportZoom * 100)}%</span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={typeof window !== "undefined" ? window.innerWidth : 1920}
        height={typeof window !== "undefined" ? window.innerHeight : 1080}
        className={`h-full w-full ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : commentMode ? "cursor-crosshair" : "cursor-crosshair"}`}
        onMouseDown={commentMode ? undefined : handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleCanvasClick}
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
            className="h-full w-full resize-none border-none bg-transparent text-black outline-none overflow-hidden placeholder:text-gray-400 placeholder:opacity-50"
            style={{
              fontSize: textAreaStyle?.fontSize,
              fontFamily: textAreaStyle?.fontFamily,
              paddingTop: textAreaStyle?.paddingTop,
              paddingLeft: textAreaStyle?.paddingLeft,
              paddingRight: textAreaStyle?.paddingRight,
              lineHeight: textAreaStyle?.lineHeight,
              color: textAreaStyle?.color,
              caretColor: textAreaStyle?.caretColor,
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {commentDraft && (
        <div
          className="absolute z-30 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl overflow-hidden"
          style={commentInputStyle}
        >
          <div className="p-3 bg-gradient-to-b from-muted/30 to-transparent border-b border-border/50 mx-2.5 px-3 py-2.5 my-2.5 text-center">
            <p className="text-xs font-semibold text-muted-foreground">New Comment</p>
          </div>
          <div className="p-3">
            <textarea
              ref={commentInputRef}
              value={commentDraft.content}
              onChange={(e) => setCommentDraft({ ...commentDraft, content: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleCommentSubmit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  handleCommentCancel()
                }
              }}
              placeholder="Write a comment... (Ctrl+Enter to submit)"
              className="w-full h-16 resize-none border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="flex gap-2 p-2 border-border/50 bg-gradient-to-t from-muted/20 to-transparent mx-2.5 rounded-none my-2.5 text-center border-t px-0 items-end justify-center">
            <Button variant="ghost" size="sm" onClick={handleCommentCancel}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleCommentSubmit} disabled={!commentDraft.content.trim()}>
              <Send className="h-3 w-3 mr-1" />
              Post
            </Button>
          </div>
        </div>
      )}

      {/* Multiplayer cursors overlay */}
      <div className="pointer-events-none absolute inset-0">
        {children && (
          <div
            style={{
              transform: `translate(${viewportX}px, ${viewportY}px) scale(${viewportZoom})`,
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
