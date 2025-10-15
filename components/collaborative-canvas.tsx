"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { PresencePanel } from "@/components/presence-panel"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useMemo, useEffect } from "react"
import type { CanvasObject } from "@/lib/types"

// Generate a random color for each user
function generateUserColor() {
  const colors = [
    "#ef4444", // red
    "#f59e0b", // amber
    "#10b981", // emerald
    "#3b82f6", // blue
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

interface CollaborativeCanvasProps {
  canvasId: string
  userId: string
  userName: string
  aiOperations?: any[]
  onAiOperationsProcessed?: () => void
}

export function CollaborativeCanvas({
  canvasId,
  userId,
  userName,
  aiOperations = [],
  onAiOperationsProcessed,
}: CollaborativeCanvasProps) {
  const userColor = useMemo(() => generateUserColor(), [])

  const { objects, isLoading, syncObjects } = useRealtimeCanvas({
    canvasId,
    userId,
  })

  const { otherUsers, updateCursor } = usePresence({
    canvasId,
    userId,
    userName,
    userColor,
  })

  useEffect(() => {
    if (aiOperations.length > 0) {
      console.log("[v0] Processing AI operations:", aiOperations)

      let updatedObjects = [...objects]

      for (const operation of aiOperations) {
        switch (operation.type) {
          case "create":
            updatedObjects.push(operation.object)
            break

          case "move":
            const moveIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
            if (moveIndex >= 0 && moveIndex < updatedObjects.length) {
              const obj = updatedObjects[moveIndex]
              updatedObjects[moveIndex] = {
                ...obj,
                x: operation.x !== undefined ? operation.x : obj.x + (operation.deltaX || 0),
                y: operation.y !== undefined ? operation.y : obj.y + (operation.deltaY || 0),
              }
            }
            break

          case "resize":
            const resizeIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
            if (resizeIndex >= 0 && resizeIndex < updatedObjects.length) {
              const obj = updatedObjects[resizeIndex]
              const scale = operation.scale || 1
              updatedObjects[resizeIndex] = {
                ...obj,
                width: operation.width !== undefined ? operation.width : obj.width * scale,
                height: operation.height !== undefined ? operation.height : obj.height * scale,
              }
            }
            break

          case "rotate":
            const rotateIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
            if (rotateIndex >= 0 && rotateIndex < updatedObjects.length) {
              const obj = updatedObjects[rotateIndex]
              updatedObjects[rotateIndex] = {
                ...obj,
                rotation: operation.absolute ? operation.degrees : obj.rotation + operation.degrees,
              }
            }
            break

          case "delete":
            if (operation.all) {
              updatedObjects = []
            } else {
              const deleteIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
              if (deleteIndex >= 0 && deleteIndex < updatedObjects.length) {
                updatedObjects.splice(deleteIndex, 1)
              }
            }
            break

          case "arrange":
            updatedObjects = handleArrange(updatedObjects, operation)
            break

          case "distribute":
            updatedObjects = handleDistribute(updatedObjects, operation)
            break

          case "align":
            updatedObjects = handleAlign(updatedObjects, operation)
            break

          case "createLoginForm":
            updatedObjects = createLoginForm(updatedObjects, operation)
            break

          case "createDashboard":
            updatedObjects = createDashboard(updatedObjects, operation)
            break

          case "createNavBar":
            updatedObjects = createNavBar(updatedObjects, operation)
            break

          case "createCard":
            updatedObjects = createCard(updatedObjects, operation)
            break

          case "createButton":
            updatedObjects = createButton(updatedObjects, operation)
            break

          case "createForm":
            updatedObjects = createForm(updatedObjects, operation)
            break
        }
      }

      syncObjects(updatedObjects)
      onAiOperationsProcessed?.()
    }
  }, [aiOperations])

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">Loading canvas...</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <PresencePanel currentUser={{ userName, userColor }} otherUsers={otherUsers} />
      <Canvas canvasId={canvasId} objects={objects} onObjectsChange={syncObjects} onCursorMove={updateCursor}>
        <MultiplayerCursors users={otherUsers} />
      </Canvas>
    </div>
  )
}

function handleArrange(objects: CanvasObject[], operation: any): CanvasObject[] {
  const indices = operation.shapeIndices || objects.map((_: any, i: number) => i)
  const shapesToArrange = indices.map((i: number) => objects[i]).filter(Boolean)

  if (shapesToArrange.length === 0) return objects

  const { pattern, spacing, centerX, centerY, columns } = operation
  const updatedObjects = [...objects]

  switch (pattern) {
    case "grid": {
      const cols = columns || Math.ceil(Math.sqrt(shapesToArrange.length))
      const rows = Math.ceil(shapesToArrange.length / cols)

      shapesToArrange.forEach((shape: CanvasObject, i: number) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const index = indices[i]

        updatedObjects[index] = {
          ...shape,
          x: centerX - ((cols - 1) * spacing) / 2 + col * spacing,
          y: centerY - ((rows - 1) * spacing) / 2 + row * spacing,
        }
      })
      break
    }

    case "row": {
      const totalWidth = (shapesToArrange.length - 1) * spacing
      shapesToArrange.forEach((shape: CanvasObject, i: number) => {
        const index = indices[i]
        updatedObjects[index] = {
          ...shape,
          x: centerX - totalWidth / 2 + i * spacing,
          y: centerY,
        }
      })
      break
    }

    case "column": {
      const totalHeight = (shapesToArrange.length - 1) * spacing
      shapesToArrange.forEach((shape: CanvasObject, i: number) => {
        const index = indices[i]
        updatedObjects[index] = {
          ...shape,
          x: centerX,
          y: centerY - totalHeight / 2 + i * spacing,
        }
      })
      break
    }

    case "circle": {
      const radius = (spacing * shapesToArrange.length) / (2 * Math.PI)
      shapesToArrange.forEach((shape: CanvasObject, i: number) => {
        const angle = (i / shapesToArrange.length) * 2 * Math.PI
        const index = indices[i]
        updatedObjects[index] = {
          ...shape,
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        }
      })
      break
    }
  }

  return updatedObjects
}

function handleDistribute(objects: CanvasObject[], operation: any): CanvasObject[] {
  const indices = operation.shapeIndices || objects.map((_: any, i: number) => i)
  const shapesToDistribute = indices.map((i: number) => objects[i]).filter(Boolean)

  if (shapesToDistribute.length < 2) return objects

  const { direction, spacing } = operation
  const updatedObjects = [...objects]

  if (direction === "horizontal") {
    // Sort by x position
    const sorted = [...shapesToDistribute].sort((a, b) => a.x - b.x)
    const minX = sorted[0].x
    const maxX = sorted[sorted.length - 1].x
    const totalSpacing = spacing !== undefined ? spacing * (sorted.length - 1) : maxX - minX
    const step = totalSpacing / (sorted.length - 1)

    sorted.forEach((shape: CanvasObject, i: number) => {
      const originalIndex = indices[shapesToDistribute.indexOf(shape)]
      updatedObjects[originalIndex] = {
        ...shape,
        x: minX + i * step,
      }
    })
  } else {
    // Sort by y position
    const sorted = [...shapesToDistribute].sort((a, b) => a.y - b.y)
    const minY = sorted[0].y
    const maxY = sorted[sorted.length - 1].y
    const totalSpacing = spacing !== undefined ? spacing * (sorted.length - 1) : maxY - minY
    const step = totalSpacing / (sorted.length - 1)

    sorted.forEach((shape: CanvasObject, i: number) => {
      const originalIndex = indices[shapesToDistribute.indexOf(shape)]
      updatedObjects[originalIndex] = {
        ...shape,
        y: minY + i * step,
      }
    })
  }

  return updatedObjects
}

function handleAlign(objects: CanvasObject[], operation: any): CanvasObject[] {
  const indices = operation.shapeIndices || objects.map((_: any, i: number) => i)
  const shapesToAlign = indices.map((i: number) => objects[i]).filter(Boolean)

  if (shapesToAlign.length === 0) return objects

  const { alignment, toCanvas } = operation
  const updatedObjects = [...objects]

  if (toCanvas) {
    // Align to canvas center (1000, 1000)
    const canvasCenterX = 1000
    const canvasCenterY = 1000

    shapesToAlign.forEach((shape: CanvasObject, i: number) => {
      const index = indices[i]
      switch (alignment) {
        case "left":
          updatedObjects[index] = { ...shape, x: 100 }
          break
        case "right":
          updatedObjects[index] = { ...shape, x: 1900 - shape.width }
          break
        case "center":
          updatedObjects[index] = { ...shape, x: canvasCenterX - shape.width / 2 }
          break
        case "top":
          updatedObjects[index] = { ...shape, y: 100 }
          break
        case "bottom":
          updatedObjects[index] = { ...shape, y: 1900 - shape.height }
          break
        case "middle":
          updatedObjects[index] = { ...shape, y: canvasCenterY - shape.height / 2 }
          break
      }
    })
  } else {
    // Align to each other
    switch (alignment) {
      case "left": {
        const minX = Math.min(...shapesToAlign.map((s: CanvasObject) => s.x))
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, x: minX }
        })
        break
      }
      case "right": {
        const maxX = Math.max(...shapesToAlign.map((s: CanvasObject) => s.x + s.width))
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, x: maxX - shape.width }
        })
        break
      }
      case "center": {
        const avgX =
          shapesToAlign.reduce((sum: number, s: CanvasObject) => sum + s.x + s.width / 2, 0) / shapesToAlign.length
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, x: avgX - shape.width / 2 }
        })
        break
      }
      case "top": {
        const minY = Math.min(...shapesToAlign.map((s: CanvasObject) => s.y))
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, y: minY }
        })
        break
      }
      case "bottom": {
        const maxY = Math.max(...shapesToAlign.map((s: CanvasObject) => s.y + s.height))
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, y: maxY - shape.height }
        })
        break
      }
      case "middle": {
        const avgY =
          shapesToAlign.reduce((sum: number, s: CanvasObject) => sum + s.y + s.height / 2, 0) / shapesToAlign.length
        shapesToAlign.forEach((shape: CanvasObject, i: number) => {
          const index = indices[i]
          updatedObjects[index] = { ...shape, y: avgY - shape.height / 2 }
        })
        break
      }
    }
  }

  return updatedObjects
}

function createLoginForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y } = operation
  const updatedObjects = [...objects]

  // Username field (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 150,
    y: y - 100,
    width: 300,
    height: 40,
    rotation: 0,
    color: "#e5e7eb",
  })

  // Password field (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 150,
    y: y - 40,
    width: 300,
    height: 40,
    rotation: 0,
    color: "#e5e7eb",
  })

  // Login button (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 75,
    y: y + 20,
    width: 150,
    height: 40,
    rotation: 0,
    color: "#3b82f6",
  })

  return updatedObjects
}

function createDashboard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y } = operation
  const updatedObjects = [...objects]

  // Header (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width: 800,
    height: 60,
    rotation: 0,
    color: "#1f2937",
  })

  // Sidebar (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y: y + 60,
    width: 200,
    height: 540,
    rotation: 0,
    color: "#374151",
  })

  // Main content (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x + 200,
    y: y + 60,
    width: 600,
    height: 540,
    rotation: 0,
    color: "#f3f4f6",
  })

  return updatedObjects
}

function createNavBar(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { items, x, y } = operation
  const updatedObjects = [...objects]

  // Nav bar background (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width: items * 120 + 40,
    height: 50,
    rotation: 0,
    color: "#1f2937",
  })

  // Nav items (rectangles)
  for (let i = 0; i < items; i++) {
    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "rectangle",
      x: x + 20 + i * 120,
      y: y + 10,
      width: 100,
      height: 30,
      rotation: 0,
      color: "#3b82f6",
    })
  }

  return updatedObjects
}

function createCard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, width, height } = operation
  const updatedObjects = [...objects]

  // Card background (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    rotation: 0,
    color: "#ffffff",
  })

  // Card header (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - width / 2,
    y: y - height / 2,
    width,
    height: 60,
    rotation: 0,
    color: "#3b82f6",
  })

  // Card footer (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - width / 2,
    y: y + height / 2 - 50,
    width,
    height: 50,
    rotation: 0,
    color: "#f3f4f6",
  })

  return updatedObjects
}

function createButton(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, width, height, color } = operation
  const updatedObjects = [...objects]

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    color,
  })

  return updatedObjects
}

function createForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { fields, x, y } = operation
  const updatedObjects = [...objects]

  // Form background (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 200,
    y: y - (fields * 60) / 2 - 40,
    width: 400,
    height: fields * 60 + 100,
    rotation: 0,
    color: "#ffffff",
  })

  // Input fields (rectangles)
  for (let i = 0; i < fields; i++) {
    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "rectangle",
      x: x - 180,
      y: y - (fields * 60) / 2 + i * 60,
      width: 360,
      height: 40,
      rotation: 0,
      color: "#e5e7eb",
    })
  }

  // Submit button (rectangle)
  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 75,
    y: y + (fields * 60) / 2 + 20,
    width: 150,
    height: 40,
    rotation: 0,
    color: "#3b82f6",
  })

  return updatedObjects
}
