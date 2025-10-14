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
  const [tool, setTool] = useState<"select" | "rectangle">("select")
  const lastCursorUpdate = useRef<number>(0)
  const CURSOR_THROTTLE_MS = 16 // ~60 updates per second for smooth cursor movement

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
      ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2)
      ctx.rotate((obj.rotation * Math.PI) / 180)

      if (obj.type === "rectangle") {
        ctx.fillStyle = obj.fill_color
        ctx.strokeStyle = obj.stroke_color
        ctx.lineWidth = obj.stroke_width
        ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
        ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height)
      }

      // Draw selection highlight
      if (obj.id === selectedId) {
        ctx.strokeStyle = "#3b82f6"
        ctx.lineWidth = 2 / viewport.zoom
        ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom])
        ctx.strokeRect(-obj.width / 2 - 5, -obj.height / 2 - 5, obj.width + 10, obj.height + 10)
        ctx.setLineDash([])
      }

      ctx.restore()
    })

    ctx.restore()
  }, [objects, viewport, selectedId])

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = screenToCanvas(e.clientX, e.clientY)

      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        // Middle mouse or shift+left mouse for panning
        setIsPanning(true)
        setDragStart({ x: e.clientX, y: e.clientY })
        return
      }

      if (tool === "rectangle") {
        // Create new rectangle
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

      // Check if clicking on an object
      const clickedObj = [...objects].reverse().find((obj) => {
        const dx = pos.x - (obj.x + obj.width / 2)
        const dy = pos.y - (obj.y + obj.height / 2)
        const cos = Math.cos((-obj.rotation * Math.PI) / 180)
        const sin = Math.sin((-obj.rotation * Math.PI) / 180)
        const localX = dx * cos - dy * sin
        const localY = dx * sin + dy * cos

        return Math.abs(localX) <= obj.width / 2 && Math.abs(localY) <= obj.height / 2
      })

      if (clickedObj) {
        setSelectedId(clickedObj.id)
        setIsDragging(true)
        setDragStart({ x: pos.x - clickedObj.x, y: pos.y - clickedObj.y })
      } else {
        setSelectedId(null)
      }
    },
    [screenToCanvas, tool, objects, onObjectsChange, canvasId],
  )

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = screenToCanvas(e.clientX, e.clientY)

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
    [screenToCanvas, isPanning, isDragging, selectedId, objects, dragStart, onObjectsChange, onCursorMove],
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
  }
}
