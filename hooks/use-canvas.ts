"use client"

import type React from "react"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CanvasObject } from "@/lib/types"

interface UseCanvasProps {
  canvasId: string
  objects: CanvasObject[]
  onObjectsChange: (objects: CanvasObject[]) => void
  onCursorMove?: (x: number, y: number) => void
}

export function useCanvas({ canvasId, objects, onObjectsChange, onCursorMove }: UseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState<"select" | "rectangle" | "circle" | "triangle" | "line">("select")
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null)
  const [linePreview, setLinePreview] = useState<{ x: number; y: number } | null>(null)
  const lastCursorUpdate = useRef<number>(0)
  const CURSOR_THROTTLE_MS = 16

  const deleteSelectedObject = useCallback(() => {
    if (!selectedId) return

    console.log("[v0] Deleting object:", selectedId)
    const updatedObjects = objects.filter((obj) => obj.id !== selectedId)
    onObjectsChange(updatedObjects)
    setSelectedId(null)
  }, [selectedId, objects, onObjectsChange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Prevent default backspace navigation
        if (e.key === "Backspace") {
          e.preventDefault()
        }
        deleteSelectedObject()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [deleteSelectedObject])

  // Convert screen coordinates to canvas coordinates
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

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Apply viewport transform
    ctx.save()
    ctx.translate(viewport.x, viewport.y)
    ctx.scale(viewport.zoom, viewport.zoom)

    // Draw grid
    ctx.strokeStyle = "#e5e7eb"
    ctx.lineWidth = 1 / viewport.zoom
    const gridSize = 50
    const startX = Math.floor(-viewport.x / viewport.zoom / gridSize) * gridSize
    const startY = Math.floor(-viewport.y / viewport.zoom / gridSize) * gridSize
    const endX = startX + canvas.width / viewport.zoom + gridSize
    const endY = startY + canvas.height / viewport.zoom + gridSize

    for (let x = startX; x < endX; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, startY)
      ctx.lineTo(x, endY)
      ctx.stroke()
    }

    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(startX, y)
      ctx.lineTo(endX, y)
      ctx.stroke()
    }

    // Draw objects
    objects.forEach((obj) => {
      ctx.save()

      if (obj.type === "line") {
        ctx.strokeStyle = obj.stroke_color
        ctx.lineWidth = obj.stroke_width
        ctx.beginPath()
        ctx.moveTo(obj.x, obj.y)
        ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
        ctx.stroke()

        if (obj.id === selectedId) {
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 4 / viewport.zoom
          ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
          ctx.beginPath()
          ctx.moveTo(obj.x, obj.y)
          ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
          ctx.stroke()
          ctx.setLineDash([])
        }
      } else {
        ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2)
        ctx.rotate((obj.rotation * Math.PI) / 180)

        ctx.fillStyle = obj.fill_color
        ctx.strokeStyle = obj.stroke_color
        ctx.lineWidth = obj.stroke_width

        if (obj.type === "rectangle") {
          ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
          ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
        } else if (obj.type === "circle") {
          const radius = Math.min(obj.width, obj.height) / 2
          ctx.beginPath()
          ctx.arc(0, 0, radius, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } else if (obj.type === "triangle") {
          ctx.beginPath()
          ctx.moveTo(0, -obj.height / 2)
          ctx.lineTo(-obj.width / 2, obj.height / 2)
          ctx.lineTo(obj.width / 2, obj.height / 2)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        }

        if (obj.id === selectedId) {
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 2 / viewport.zoom
          ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
          ctx.strokeRect(-obj.width / 2 - 5, -obj.height / 2 - 5, obj.width + 10, obj.height + 10)
          ctx.setLineDash([])
        }
      }

      ctx.restore()
    })

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
  }, [objects, viewport, selectedId, lineStart, linePreview])

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = screenToCanvas(e.clientX, e.clientY)

      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
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
          setSelectedId(newObj.id)
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
        setSelectedId(newObj.id)
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
        setSelectedId(newObj.id)
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
        setSelectedId(newObj.id)
        setTool("select")
        return
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
        setSelectedId(clickedObj.id)
        setIsDragging(true)
        setDragStart({ x: pos.x - clickedObj.x, y: pos.y - clickedObj.y })
      } else {
        setSelectedId(null)
      }
    },
    [screenToCanvas, tool, objects, onObjectsChange, canvasId, lineStart, viewport.zoom],
  )

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = screenToCanvas(e.clientX, e.clientY)

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

      if (isDragging && selectedId) {
        const obj = objects.find((o) => o.id === selectedId)
        if (obj) {
          const updatedObjects = objects.map((o) =>
            o.id === selectedId
              ? {
                  ...o,
                  x: pos.x - dragStart.x,
                  y: pos.y - dragStart.y,
                }
              : o,
          )
          onObjectsChange(updatedObjects)
        }
      }
    },
    [
      screenToCanvas,
      isPanning,
      isDragging,
      selectedId,
      objects,
      dragStart,
      onObjectsChange,
      onCursorMove,
      tool,
      lineStart,
    ],
  )

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setIsPanning(false)
  }, [])

  // Handle wheel for zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setViewport((prev) => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(5, prev.zoom * delta)),
    }))
  }, [])

  return {
    canvasRef,
    viewport,
    selectedId,
    tool,
    setTool,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    deleteSelectedObject,
  }
}
