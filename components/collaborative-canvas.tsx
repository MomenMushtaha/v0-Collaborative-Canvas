"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { PresencePanel } from "@/components/presence-panel"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useMemo, useEffect } from "react"
import type { CanvasObject } from "@/lib/types"
import { useAIQueue } from "@/hooks/use-ai-queue"
import { AIStatusIndicator } from "@/components/ai-status-indicator"

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

  const { queue, isAIWorking, currentOperation, updateQueueItem } = useAIQueue({
    canvasId,
    userId,
  })

  useEffect(() => {
    if (aiOperations.length > 0) {
      console.log("[v0] Processing AI operations:", aiOperations)

      // Process operations sequentially with delays
      const processOperationsSequentially = async () => {
        let updatedObjects = [...objects]
        const failedOperations: string[] = []

        for (let i = 0; i < aiOperations.length; i++) {
          const operation = aiOperations[i]
          console.log(`[v0] Processing operation ${i + 1}/${aiOperations.length}:`, operation.type)

          try {
            const result = applyOperation(updatedObjects, operation)
            if (result.error) {
              failedOperations.push(`${operation.type}: ${result.error}`)
              console.warn(`[v0] Operation failed:`, result.error)
            } else {
              updatedObjects = result.objects
              // Sync after each successful operation for visual feedback
              syncObjects(updatedObjects)
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error"
            failedOperations.push(`${operation.type}: ${errorMsg}`)
            console.error(`[v0] Operation error:`, error)
          }

          // Add delay between operations (except for the last one)
          if (i < aiOperations.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
        }

        if (failedOperations.length > 0) {
          console.warn("[v0] Some operations failed:", failedOperations)
        }

        onAiOperationsProcessed?.()
      }

      processOperationsSequentially()
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
      <AIStatusIndicator isAIWorking={isAIWorking} currentOperation={currentOperation} queueLength={queue.length} />
      <PresencePanel currentUser={{ userName, userColor }} otherUsers={otherUsers} />
      <Canvas canvasId={canvasId} objects={objects} onObjectsChange={syncObjects} onCursorMove={updateCursor}>
        <MultiplayerCursors users={otherUsers} />
      </Canvas>
    </div>
  )
}

function applyOperation(objects: CanvasObject[], operation: any): { objects: CanvasObject[]; error?: string } {
  let updatedObjects = [...objects]

  try {
    switch (operation.type) {
      case "create":
        updatedObjects.push({
          ...operation.object,
          fill_color: operation.object.fill_color || operation.object.color || "#3b82f6",
          stroke_color: operation.object.stroke_color || operation.object.color || "#1e40af",
          stroke_width: operation.object.stroke_width || 2,
        })
        break

      case "move": {
        const moveIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
        if (moveIndex < 0 || moveIndex >= updatedObjects.length) {
          return {
            objects,
            error: `Cannot move shape at index ${operation.shapeIndex}. Only ${updatedObjects.length} shapes exist.`,
          }
        }
        const obj = updatedObjects[moveIndex]
        const newX = operation.x !== undefined ? operation.x : obj.x + (operation.deltaX || 0)
        const newY = operation.y !== undefined ? operation.y : obj.y + (operation.deltaY || 0)

        if (newX < 0 || newX > 2000 || newY < 0 || newY > 2000) {
          return { objects, error: `Cannot move shape outside canvas bounds (0-2000).` }
        }

        updatedObjects[moveIndex] = { ...obj, x: newX, y: newY }
        console.log("[v0] Moved shape", moveIndex, "to", newX, newY)
        break
      }

      case "resize": {
        const resizeIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
        if (resizeIndex < 0 || resizeIndex >= updatedObjects.length) {
          return {
            objects,
            error: `Cannot resize shape at index ${operation.shapeIndex}. Only ${updatedObjects.length} shapes exist.`,
          }
        }
        const obj = updatedObjects[resizeIndex]
        const scale = operation.scale || 1
        const newWidth = operation.width !== undefined ? operation.width : obj.width * scale
        const newHeight = operation.height !== undefined ? operation.height : obj.height * scale

        if (newWidth <= 0 || newHeight <= 0) {
          return { objects, error: `Cannot resize shape to zero or negative dimensions.` }
        }
        if (newWidth > 2000 || newHeight > 2000) {
          return { objects, error: `Cannot resize shape larger than 2000 pixels.` }
        }

        updatedObjects[resizeIndex] = { ...obj, width: newWidth, height: newHeight }
        console.log("[v0] Resized shape", resizeIndex, "to", newWidth, "x", newHeight)
        break
      }

      case "rotate": {
        const rotateIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
        if (rotateIndex < 0 || rotateIndex >= updatedObjects.length) {
          return {
            objects,
            error: `Cannot rotate shape at index ${operation.shapeIndex}. Only ${updatedObjects.length} shapes exist.`,
          }
        }
        const obj = updatedObjects[rotateIndex]
        updatedObjects[rotateIndex] = {
          ...obj,
          rotation: operation.absolute ? operation.degrees : obj.rotation + operation.degrees,
        }
        console.log("[v0] Rotated shape", rotateIndex, "to", updatedObjects[rotateIndex].rotation, "degrees")
        break
      }

      case "delete": {
        if (operation.all) {
          console.log("[v0] Deleting all shapes")
          updatedObjects = []
        } else {
          const deleteIndex = operation.shapeIndex === -1 ? updatedObjects.length - 1 : operation.shapeIndex
          if (deleteIndex < 0 || deleteIndex >= updatedObjects.length) {
            return {
              objects,
              error: `Cannot delete shape at index ${operation.shapeIndex}. Only ${updatedObjects.length} shapes exist.`,
            }
          }
          console.log("[v0] Deleting shape", deleteIndex)
          updatedObjects.splice(deleteIndex, 1)
        }
        break
      }

      case "arrange": {
        console.log("[v0] Arranging shapes with pattern:", operation.pattern)
        const arrangeOp = {
          ...operation,
          spacing: operation.spacing || 100,
          centerX: operation.centerX || 1000,
          centerY: operation.centerY || 1000,
          columns: operation.columns || Math.ceil(Math.sqrt(updatedObjects.length)),
        }
        const result = handleArrange(updatedObjects, arrangeOp)
        if (result.error) {
          return { objects, error: result.error }
        }
        updatedObjects = result.objects
        break
      }

      case "distribute": {
        updatedObjects = handleDistribute(updatedObjects, operation)
        break
      }

      case "align": {
        updatedObjects = handleAlign(updatedObjects, operation)
        break
      }

      case "createLoginForm": {
        updatedObjects = createLoginForm(updatedObjects, operation)
        break
      }

      case "createDashboard": {
        updatedObjects = createDashboard(updatedObjects, operation)
        break
      }

      case "createNavBar": {
        updatedObjects = createNavBar(updatedObjects, operation)
        break
      }

      case "createCard": {
        updatedObjects = createCard(updatedObjects, operation)
        break
      }

      case "createButton": {
        updatedObjects = createButton(updatedObjects, operation)
        break
      }

      case "createForm": {
        updatedObjects = createForm(updatedObjects, operation)
        break
      }

      default:
        return { objects, error: `Unknown operation type: ${operation.type}` }
    }

    return { objects: updatedObjects }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error"
    console.error("[v0] Operation error:", errorMsg)
    return { objects, error: errorMsg }
  }
}

function handleArrange(objects: CanvasObject[], operation: any): { objects: CanvasObject[]; error?: string } {
  const indices = operation.shapeIndices || objects.map((_: any, i: number) => i)

  for (const idx of indices) {
    if (idx < 0 || idx >= objects.length) {
      return { objects, error: `Invalid shape index ${idx} in arrange operation.` }
    }
  }

  const shapesToArrange = indices.map((i: number) => objects[i]).filter(Boolean)

  if (shapesToArrange.length === 0) {
    return { objects, error: "No shapes to arrange." }
  }

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

    default:
      return { objects, error: `Unknown arrange pattern: ${pattern}` }
  }

  return { objects: updatedObjects }
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
