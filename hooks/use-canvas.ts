"use client"

import type React from "react"
import { snapToGrid } from "@/lib/grid-utils"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CanvasObject } from "@/lib/types"

interface UseCanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
  gridEnabled?: boolean
  snapEnabled?: boolean
  gridSize?: number
}

type ResizeHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | null

export function useCanvas({
  canvasId,
  objects,
  onObjectsChange,
  onCursorMove,
  gridEnabled = false,
  snapEnabled = false,
  gridSize = 20,
}: UseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle>(null)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, objX: 0, objY: 0 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragOffsets, setDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [tool, setTool] = useState<"select" | "rectangle" | "circle" | "triangle" | "line" | "text">("select")
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null)
  const [linePreview, setLinePreview] = useState<{ x: number; y: number } | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [isNewTextObject, setIsNewTextObject] = useState(false)
  const lastClickTime = useRef<number>(0)
  const lastClickedId = useRef<string | null>(null)
  const lastCursorUpdate = useRef<number>(0)
  const CURSOR_THROTTLE_MS = 16
  const animationFrameRef = useRef<number>()

  const fpsRef = useRef<number[]>([])
  const lastFrameTimeRef = useRef<number>(performance.now())

  const deleteSelectedObjects = useCallback(() => {
    if (selectedIds.length === 0) return

    console.log("[v0] Deleting objects:", selectedIds)
    const updatedObjects = objects.filter((obj) => !selectedIds.includes(obj.id))
    onObjectsChange(updatedObjects)
    setSelectedIds([])
  }, [selectedIds, objects, onObjectsChange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.key === "Backspace") {
          e.preventDefault()
        }
        deleteSelectedObjects()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [deleteSelectedObjects])

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }

      const rect = canvas.getBoundingClientRect()
      const x = (screenX - rect.left - viewport.x) / viewport.zoom
      const y = (screenY - rect.top - viewport.y) / viewport.zoom

      return { x, y }
    },
    [viewport],
  )

  const getResizeHandleAtPosition = useCallback(
    (pos: { x: number; y: number }, obj: CanvasObject): ResizeHandle => {
      if (obj.type === "line" || obj.type === "text") return null

      const handleSize = 8 / viewport.zoom
      const x1 = obj.x
      const y1 = obj.y
      const x2 = obj.x + obj.width
      const y2 = obj.y + obj.height
      const centerX = obj.x + obj.width / 2
      const centerY = obj.y + obj.height / 2

      if (Math.abs(pos.x - x1) < handleSize && Math.abs(pos.y - y1) < handleSize) return "top-left"
      if (Math.abs(pos.x - x2) < handleSize && Math.abs(pos.y - y1) < handleSize) return "top-right"
      if (Math.abs(pos.x - x1) < handleSize && Math.abs(pos.y - y2) < handleSize) return "bottom-left"
      if (Math.abs(pos.x - x2) < handleSize && Math.abs(pos.y - y2) < handleSize) return "bottom-right"

      if (Math.abs(pos.x - centerX) < handleSize && Math.abs(pos.y - y1) < handleSize) return "top"
      if (Math.abs(pos.x - x2) < handleSize && Math.abs(pos.y - centerY) < handleSize) return "right"
      if (Math.abs(pos.x - centerX) < handleSize && Math.abs(pos.y - y2) < handleSize) return "bottom"
      if (Math.abs(pos.x - x1) < handleSize && Math.abs(pos.y - centerY) < handleSize) return "left"

      return null
    },
    [viewport.zoom],
  )

  const isObjectInSelectionBox = useCallback(
    (obj: CanvasObject, box: { x: number; y: number; width: number; height: number }) => {
      const boxX1 = Math.min(box.x, box.x + box.width)
      const boxY1 = Math.min(box.y, box.y + box.height)
      const boxX2 = Math.max(box.x, box.x + box.width)
      const boxY2 = Math.max(box.y, box.y + box.height)

      const objX1 = obj.x
      const objY1 = obj.y
      const objX2 = obj.x + obj.width
      const objY2 = obj.y + obj.height

      return objX1 < boxX2 && objX2 > boxX1 && objY1 < boxY2 && objY2 > boxY1
    },
    [],
  )

  const measureText = useCallback((text: string, fontSize: number, fontFamily: string) => {
    const canvas = canvasRef.current
    if (!canvas) return { width: 200, height: 50 }

    const ctx = canvas.getContext("2d")
    if (!ctx) return { width: 200, height: 50 }

    ctx.font = `${fontSize}px ${fontFamily}`
    const lines = text.split("\n")
    const lineHeight = fontSize * 1.2

    let maxWidth = 0
    lines.forEach((line) => {
      const metrics = ctx.measureText(line)
      maxWidth = Math.max(maxWidth, metrics.width)
    })

    const width = Math.max(150, maxWidth + 40) // Increased minimum width and padding
    const height = Math.max(fontSize * 1.5 + 20, lines.length * lineHeight + 20) // Better minimum height

    return { width, height }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    })
    if (!ctx) return

    const render = () => {
      const now = performance.now()
      const frameDelta = now - lastFrameTimeRef.current
      lastFrameTimeRef.current = now

      if (frameDelta > 0) {
        const fps = 1000 / frameDelta
        fpsRef.current.push(fps)

        // Keep only last 60 frames for average calculation
        if (fpsRef.current.length > 60) {
          fpsRef.current.shift()
        }

        // Log FPS every 60 frames (approximately once per second at 60fps)
        if (fpsRef.current.length === 60) {
          const avgFps = fpsRef.current.reduce((a, b) => a + b, 0) / fpsRef.current.length
          console.log(`[v0] [PERF] Average FPS: ${avgFps.toFixed(1)} (${objects.length} objects)`)
          fpsRef.current = []
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.save()
      ctx.translate(viewport.x, viewport.y)
      ctx.scale(viewport.zoom, viewport.zoom)

      if (gridEnabled) {
        ctx.strokeStyle = "#e5e7eb"
        ctx.lineWidth = 1 / viewport.zoom
        const startX = Math.floor(-viewport.x / viewport.zoom / gridSize) * gridSize
        const startY = Math.floor(-viewport.y / viewport.zoom / gridSize) * gridSize
        const endX = startX + canvas.width / viewport.zoom + gridSize
        const endY = startY + canvas.height / viewport.zoom + gridSize

        ctx.beginPath()
        for (let x = startX; x < endX; x += gridSize) {
          ctx.moveTo(x, startY)
          ctx.lineTo(x, endY)
        }
        for (let y = startY; y < endY; y += gridSize) {
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y)
        }
        ctx.stroke()
      }

      objects.forEach((obj) => {
        ctx.save()

        const isSelected = selectedIds.includes(obj.id)

        if (obj.type === "line") {
          ctx.strokeStyle = obj.stroke_color
          ctx.lineWidth = obj.stroke_width
          ctx.beginPath()
          ctx.moveTo(obj.x, obj.y)
          ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
          ctx.stroke()

          if (isSelected) {
            ctx.strokeStyle = "#3b82f6"
            ctx.lineWidth = 4 / viewport.zoom
            ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
            ctx.beginPath()
            ctx.moveTo(obj.x, obj.y)
            ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
            ctx.stroke()
            ctx.setLineDash([])
          }
        } else if (obj.type === "rectangle") {
          ctx.fillStyle = obj.fill_color
          ctx.strokeStyle = obj.stroke_color
          ctx.lineWidth = obj.stroke_width
          ctx.fillRect(obj.x, obj.y, obj.width, obj.height)
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
        } else if (obj.type === "circle") {
          ctx.fillStyle = obj.fill_color
          ctx.strokeStyle = obj.stroke_color
          ctx.lineWidth = obj.stroke_width
          const radius = Math.min(obj.width, obj.height) / 2
          ctx.beginPath()
          ctx.arc(obj.x + obj.width / 2, obj.y + obj.height / 2, radius, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } else if (obj.type === "triangle") {
          ctx.fillStyle = obj.fill_color
          ctx.strokeStyle = obj.stroke_color
          ctx.lineWidth = obj.stroke_width
          ctx.beginPath()
          // Top vertex (center top)
          ctx.moveTo(obj.x + obj.width / 2, obj.y)
          // Bottom-left vertex
          ctx.lineTo(obj.x, obj.y + obj.height)
          // Bottom-right vertex
          ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        } else if (obj.type === "text") {
          if (obj.id === editingTextId) {
            // Draw selection box but not the text itself
            if (isSelected) {
              ctx.strokeStyle = "#3b82f6"
              ctx.lineWidth = 2 / viewport.zoom
              ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
              ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
              ctx.setLineDash([])
            }
          } else {
            // Normal text rendering when not editing
            if (isSelected) {
              ctx.strokeStyle = "#3b82f6"
              ctx.lineWidth = 2 / viewport.zoom
              ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
              ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
              ctx.setLineDash([])
            }

            ctx.font = `${obj.font_size || 16}px ${obj.font_family || "Arial"}`
            ctx.fillStyle = obj.fill_color
            ctx.textBaseline = "middle"
            ctx.textAlign = "center"
            ctx.fillText(obj.text_content || "", obj.x + obj.width / 2, obj.y + obj.height / 2)
          }
        }

        if (isSelected && obj.type !== "text") {
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 2 / viewport.zoom
          ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
          ctx.strokeRect(obj.x - 5, obj.y - 5, obj.width + 10, obj.height + 10)
          ctx.setLineDash([])
        }

        ctx.restore()
      })

      if (selectionBox) {
        ctx.strokeStyle = "#3b82f6"
        ctx.lineWidth = 2 / viewport.zoom
        ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
        ctx.fillStyle = "rgba(59, 130, 246, 0.1)"
        ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height)
        ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height)
        ctx.setLineDash([])
      }

      if (lineStart && linePreview) {
        ctx.strokeStyle = "#a855f7"
        ctx.lineWidth = 3
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(lineStart.x, lineStart.y)
        ctx.lineTo(linePreview.x, linePreview.y)
        ctx.stroke()
        ctx.setLineDash([])
      }

      ctx.restore()
    }

    const scheduleRender = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      animationFrameRef.current = requestAnimationFrame(render)
    }

    scheduleRender()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [objects, viewport, selectedIds, lineStart, linePreview, selectionBox, editingTextId, gridEnabled, gridSize])

  const handleTextEdit = useCallback((objectId: string) => {
    setEditingTextId(objectId)
  }, [])

  const saveTextEdit = useCallback(
    (objectId: string, newText: string) => {
      if (!newText.trim()) {
        // If text is empty or only whitespace, delete the object
        const updatedObjects = objects.filter((o) => o.id !== objectId)
        onObjectsChange(updatedObjects)
        setSelectedIds([])
      } else {
        const textObj = objects.find((o) => o.id === objectId)
        if (textObj && textObj.type === "text") {
          const { width, height } = measureText(newText, textObj.font_size || 16, textObj.font_family || "Arial")

          const updatedObjects = objects.map((o) =>
            o.id === objectId
              ? {
                  ...o,
                  text_content: newText,
                  width,
                  height,
                  _hasBeenEdited: true,
                }
              : o,
          )
          onObjectsChange(updatedObjects)
        }
      }
      setEditingTextId(null)
      setIsNewTextObject(false)
    },
    [objects, onObjectsChange, measureText],
  )

  const cancelTextEdit = useCallback(() => {
    if (editingTextId) {
      const textObj = objects.find((o) => o.id === editingTextId)
      if (textObj && textObj.type === "text" && !textObj.text_content?.trim()) {
        // Delete the empty text object
        const updatedObjects = objects.filter((o) => o.id !== editingTextId)
        onObjectsChange(updatedObjects)
        setSelectedIds([])
      }
    }
    setEditingTextId(null)
    setIsNewTextObject(false)
  }, [editingTextId, objects, onObjectsChange])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (editingTextId) return

      const pos = screenToCanvas(e.clientX, e.clientY)

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setIsPanning(true)
        setDragStart({ x: e.clientX, y: e.clientY })
        return
      }

      if (tool === "line") {
        if (!lineStart) {
          setLineStart(pos)
        } else {
          const newObj: CanvasObject = {
            id: crypto.randomUUID(),
            canvas_id: canvasId,
            type: "line",
            x: lineStart.x,
            y: lineStart.y,
            width: pos.x - lineStart.x,
            height: pos.y - lineStart.y,
            rotation: 0,
            fill_color: "#a855f7",
            stroke_color: "#a855f7",
            stroke_width: 3,
          }
          onObjectsChange([...objects, newObj])
          setSelectedIds([newObj.id])
          setLineStart(null)
          setLinePreview(null)
          setTool("select")
        }
        return
      }

      if (tool === "rectangle") {
        const newObj: CanvasObject = {
          id: crypto.randomUUID(),
          canvas_id: canvasId,
          type: "rectangle",
          x: pos.x,
          y: pos.y,
          width: 100,
          height: 100,
          rotation: 0,
          fill_color: "#3b82f6",
          stroke_color: "#1e40af",
          stroke_width: 2,
        }
        onObjectsChange([...objects, newObj])
        setSelectedIds([newObj.id])
        setTool("select")
        return
      }

      if (tool === "circle") {
        const newObj: CanvasObject = {
          id: crypto.randomUUID(),
          canvas_id: canvasId,
          type: "circle",
          x: pos.x,
          y: pos.y,
          width: 100,
          height: 100,
          rotation: 0,
          fill_color: "#10b981",
          stroke_color: "#059669",
          stroke_width: 2,
        }
        onObjectsChange([...objects, newObj])
        setSelectedIds([newObj.id])
        setTool("select")
        return
      }

      if (tool === "triangle") {
        const newObj: CanvasObject = {
          id: crypto.randomUUID(),
          canvas_id: canvasId,
          type: "triangle",
          x: pos.x,
          y: pos.y,
          width: 100,
          height: 100,
          rotation: 0,
          fill_color: "#f97316",
          stroke_color: "#ea580c",
          stroke_width: 2,
        }
        onObjectsChange([...objects, newObj])
        setSelectedIds([newObj.id])
        setTool("select")
        return
      }

      if (tool === "text") {
        const newObj: CanvasObject = {
          id: crypto.randomUUID(),
          canvas_id: canvasId,
          type: "text",
          x: pos.x,
          y: pos.y,
          width: 200,
          height: 50,
          rotation: 0,
          fill_color: "#000000",
          stroke_color: "#000000",
          stroke_width: 0,
          font_size: 24,
          font_family: "Arial",
          text_content: "",
        }
        onObjectsChange([...objects, newObj])
        setSelectedIds([newObj.id])
        setEditingTextId(newObj.id)
        setIsNewTextObject(true)
        setTool("select")
        return
      }

      if (selectedIds.length === 1 && tool === "select") {
        const selectedObj = objects.find((o) => o.id === selectedIds[0])
        if (selectedObj) {
          const handle = getResizeHandleAtPosition(pos, selectedObj)
          if (handle) {
            setIsResizing(true)
            setResizeHandle(handle)
            setResizeStart({
              x: pos.x,
              y: pos.y,
              width: selectedObj.width,
              height: selectedObj.height,
              objX: selectedObj.x,
              objY: selectedObj.y,
            })
            return
          }
        }
      }

      const clickedObj = [...objects].reverse().find((obj) => {
        if (obj.type === "line") {
          const x1 = obj.x
          const y1 = obj.y
          const x2 = obj.x + obj.width
          const y2 = obj.y + obj.height

          const lineLength = Math.sqrt(obj.width ** 2 + obj.height ** 2)
          if (lineLength === 0) return false

          const distance = Math.abs((y2 - y1) * pos.x - (x2 - x1) * pos.y + x2 * y1 - y2 * x1) / lineLength
          const threshold = 5 / viewport.zoom

          const minX = Math.min(x1, x2) - threshold
          const maxX = Math.max(x1, x2) + threshold
          const minY = Math.min(y1, y2) - threshold
          const maxY = Math.max(y1, y2) + threshold

          return distance < threshold && pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY
        } else {
          const dx = pos.x - (obj.x + obj.width / 2)
          const dy = pos.y - (obj.y + obj.height / 2)
          const cos = Math.cos((-obj.rotation * Math.PI) / 180)
          const sin = Math.sin((-obj.rotation * Math.PI) / 180)
          const localX = dx * cos - dy * sin
          const localY = dx * sin + dy * cos

          return Math.abs(localX) <= obj.width / 2 && Math.abs(localY) <= obj.height / 2
        }
      })

      if (clickedObj) {
        const now = Date.now()
        const isDoubleClick = now - lastClickTime.current < 300 && lastClickedId.current === clickedObj.id
        lastClickTime.current = now
        lastClickedId.current = clickedObj.id

        if (isDoubleClick && clickedObj.type === "text") {
          handleTextEdit(clickedObj.id)
          return
        }

        if (e.shiftKey) {
          if (selectedIds.includes(clickedObj.id)) {
            setSelectedIds(selectedIds.filter((id) => id !== clickedObj.id))
          } else {
            setSelectedIds([...selectedIds, clickedObj.id])
          }
        } else {
          if (selectedIds.includes(clickedObj.id)) {
            setIsDragging(true)
            const offsets = new Map<string, { x: number; y: number }>()
            selectedIds.forEach((id) => {
              const obj = objects.find((o) => o.id === id)
              if (obj) {
                offsets.set(id, { x: pos.x - obj.x, y: pos.y - obj.y })
              }
            })
            setDragOffsets(offsets)
          } else {
            setSelectedIds([clickedObj.id])
            setIsDragging(true)
            const offsets = new Map<string, { x: number; y: number }>()
            offsets.set(clickedObj.id, { x: pos.x - clickedObj.x, y: pos.y - clickedObj.y })
            setDragOffsets(offsets)
          }
        }
      } else {
        if (!e.shiftKey) {
          setSelectedIds([])
        }
        setIsSelecting(true)
        setSelectionBox({ x: pos.x, y: pos.y, width: 0, height: 0 })
      }
    },
    [
      screenToCanvas,
      tool,
      objects,
      onObjectsChange,
      canvasId,
      lineStart,
      viewport.zoom,
      selectedIds,
      getResizeHandleAtPosition,
      handleTextEdit,
      editingTextId,
    ],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (editingTextId) return

      let pos = screenToCanvas(e.clientX, e.clientY)

      if (snapEnabled && (isDragging || tool !== "select")) {
        pos = snapToGrid(pos.x, pos.y, gridSize)
      }

      if (tool === "line" && lineStart) {
        setLinePreview(pos)
      }

      const now = Date.now()
      if (onCursorMove && now - lastCursorUpdate.current >= CURSOR_THROTTLE_MS) {
        onCursorMove(pos.x, pos.y)
        lastCursorUpdate.current = now
      }

      if (isPanning) {
        const dx = e.clientX - dragStart.x
        const dy = e.clientY - dragStart.y
        setViewport((prev) => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy,
        }))
        setDragStart({ x: e.clientX, y: e.clientY })
        return
      }

      if (isSelecting && selectionBox) {
        setSelectionBox({
          ...selectionBox,
          width: pos.x - selectionBox.x,
          height: pos.y - selectionBox.y,
        })
        return
      }

      if (isResizing && selectedIds.length === 1 && resizeHandle) {
        const obj = objects.find((o) => o.id === selectedIds[0])
        if (obj) {
          const dx = pos.x - resizeStart.x
          const dy = pos.y - resizeStart.y

          let newX = resizeStart.objX
          let newY = resizeStart.objY
          let newWidth = resizeStart.width
          let newHeight = resizeStart.height

          switch (resizeHandle) {
            case "top-left":
              newX = resizeStart.objX + dx
              newY = resizeStart.objY + dy
              newWidth = resizeStart.width - dx
              newHeight = resizeStart.height - dy
              break
            case "top-right":
              newY = resizeStart.objY + dy
              newWidth = resizeStart.width + dx
              newHeight = resizeStart.height - dy
              break
            case "bottom-left":
              newX = resizeStart.objX + dx
              newWidth = resizeStart.width - dx
              newHeight = resizeStart.height + dy
              break
            case "bottom-right":
              newWidth = resizeStart.width + dx
              newHeight = resizeStart.height + dy
              break
            case "top":
              newY = resizeStart.objY + dy
              newHeight = resizeStart.height - dy
              break
            case "right":
              newWidth = resizeStart.width + dx
              break
            case "bottom":
              newHeight = resizeStart.height + dy
              break
            case "left":
              newX = resizeStart.objX + dx
              newWidth = resizeStart.width - dx
              break
          }

          if (newWidth < 10) {
            newWidth = 10
            newX = resizeStart.objX
          }
          if (newHeight < 10) {
            newHeight = 10
            newY = resizeStart.objY
          }

          const updatedObjects = objects.map((o) =>
            o.id === selectedIds[0]
              ? {
                  ...o,
                  x: newX,
                  y: newY,
                  width: newWidth,
                  height: newHeight,
                }
              : o,
          )
          onObjectsChange(updatedObjects)
        }
        return
      }

      if (isDragging && selectedIds.length > 0) {
        const updatedObjects = objects.map((o) => {
          if (selectedIds.includes(o.id)) {
            const offset = dragOffsets.get(o.id)
            if (offset) {
              return {
                ...o,
                x: pos.x - offset.x,
                y: pos.y - offset.y,
              }
            }
          }
          return o
        })
        onObjectsChange(updatedObjects)
      }
    },
    [
      screenToCanvas,
      isPanning,
      isDragging,
      isResizing,
      isSelecting,
      selectedIds,
      resizeHandle,
      resizeStart,
      selectionBox,
      objects,
      dragStart,
      dragOffsets,
      onObjectsChange,
      onCursorMove,
      tool,
      lineStart,
      editingTextId,
      snapEnabled,
      gridSize,
    ],
  )

  const handleMouseUp = useCallback(() => {
    if (isSelecting && selectionBox) {
      const selectedObjects = objects.filter((obj) => isObjectInSelectionBox(obj, selectionBox))
      setSelectedIds(selectedObjects.map((obj) => obj.id))
      setSelectionBox(null)
    }

    setIsDragging(false)
    setIsPanning(false)
    setIsResizing(false)
    setIsSelecting(false)
    setResizeHandle(null)
  }, [isSelecting, selectionBox, objects, isObjectInSelectionBox])

  const MIN_ZOOM = 1 // 100% minimum - no zooming out
  const MAX_ZOOM = 3 // Updated from 2 to 3 (300% maximum - allows zooming in up to 3x)

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setViewport((prev) => ({
      ...prev,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * delta)),
    }))
  }, [])

  return {
    canvasRef,
    viewport,
    selectedIds,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    deleteSelectedObject: deleteSelectedObjects,
    editingTextId,
    saveTextEdit,
    cancelTextEdit,
    measureText,
    isNewTextObject,
  }
}
