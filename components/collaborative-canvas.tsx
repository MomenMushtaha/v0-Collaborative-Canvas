"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { PresencePanel } from "@/components/presence-panel"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useMemo, useEffect, useState, useCallback, type Dispatch, type SetStateAction } from "react"
import type { CanvasObject } from "@/lib/types"
import { useAIQueue } from "@/hooks/use-ai-queue"
import { ConnectionStatus } from "@/components/connection-status"
import { useHistory } from "@/hooks/use-history"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { StylePanel } from "@/components/style-panel"
import { LayersPanel } from "@/components/layers-panel"
import { alignObjects, distributeObjects } from "@/lib/alignment-utils"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"
import { useToast } from "@/hooks/use-toast"
import { CommentMarker } from "@/components/comment-marker"
import type { Comment } from "@/lib/comments-utils"

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
  onObjectsChange?: (objects: CanvasObject[]) => void
  onSelectionChange?: (selectedIds: string[]) => void
  viewport?: { x: number; y: number; zoom: number }
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
  onUndo?: Dispatch<SetStateAction<(() => void) | undefined>>
  onRedo?: Dispatch<SetStateAction<(() => void) | undefined>>
  canUndo?: (canUndo: boolean) => void
  canRedo?: (canRedo: boolean) => void
  onAlign?: Dispatch<SetStateAction<((type: AlignmentType) => void) | undefined>>
  onDistribute?: Dispatch<SetStateAction<((type: DistributeType) => void) | undefined>>
  gridEnabled?: boolean
  snapEnabled?: boolean
  gridSize?: number
  onGridChange?: (enabled: boolean, snap: boolean, size: number) => void
  commentMode?: boolean
  onCommentCreate?: (x: number, y: number, content: string) => void
  comments?: Comment[]
}

export function CollaborativeCanvas({
  canvasId,
  userId,
  userName,
  aiOperations = [],
  onAiOperationsProcessed,
  onObjectsChange,
  onSelectionChange,
  viewport,
  onViewportChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAlign,
  onDistribute,
  gridEnabled = false,
  snapEnabled = false,
  gridSize = 20,
  onGridChange,
  commentMode = false,
  onCommentCreate,
  comments = [],
}: CollaborativeCanvasProps) {
  const userColor = useMemo(() => generateUserColor(), [])
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [isUndoRedoOperation, setIsUndoRedoOperation] = useState(false)
  const [connectionState, setConnectionState] = useState({ isConnected: true, queuedOps: 0 })
  const [clipboard, setClipboard] = useState<CanvasObject[]>([]) // Added clipboard state
  const { toast } = useToast()

  const { objects, isLoading, syncObjects, isConnected, queuedOperations } = useRealtimeCanvas({
    canvasId,
    userId,
    onConnectionChange: (connected, queued) => {
      setConnectionState({ isConnected: connected, queuedOps: queued })
    },
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

  const { addCommand, undo, redo, canUndo: historyCanUndo, canRedo: historyCanRedo } = useHistory()
  const [previousObjects, setPreviousObjects] = useState<CanvasObject[]>([])
  const [newTextObjectIds, setNewTextObjectIds] = useState<Set<string>>(new Set()) // Track new text objects

  useEffect(() => {
    if (isUndoRedoOperation) {
      setPreviousObjects(objects)
      setIsUndoRedoOperation(false)
      return
    }

    if (objects.length !== previousObjects.length) {
      // Objects were added or removed
      if (objects.length > previousObjects.length) {
        // Objects added
        const newObjects = objects.filter((obj) => !previousObjects.find((prev) => prev.id === obj.id))
        if (newObjects.length > 0) {
          const newTextIds = newObjects
            .filter((obj) => obj.type === "text" && !obj.text_content?.trim())
            .map((obj) => obj.id)
          if (newTextIds.length > 0) {
            setNewTextObjectIds((prev) => new Set([...prev, ...newTextIds]))
          } else {
            // Non-text objects or text with content - add to history immediately
            addCommand({
              type: "create",
              objectIds: newObjects.map((obj) => obj.id),
              beforeState: previousObjects,
              afterState: objects,
              timestamp: Date.now(),
            })
          }
        }
      } else {
        // Objects deleted
        const deletedObjects = previousObjects.filter((prev) => !objects.find((obj) => obj.id === prev.id))
        if (deletedObjects.length > 0) {
          const deletedIds = deletedObjects.map((obj) => obj.id)
          setNewTextObjectIds((prev) => {
            const newSet = new Set(prev)
            deletedIds.forEach((id) => newSet.delete(id))
            return newSet
          })

          addCommand({
            type: "delete",
            objectIds: deletedIds,
            beforeState: previousObjects,
            afterState: objects,
            timestamp: Date.now(),
          })
        }
      }
    } else if (objects.length > 0 && previousObjects.length > 0) {
      // Check for updates
      const updatedObjects = objects.filter((obj, idx) => {
        const prev = previousObjects.find((p) => p.id === obj.id)
        if (!prev) return false

        return (
          obj.x !== prev.x ||
          obj.y !== prev.y ||
          obj.width !== prev.width ||
          obj.height !== prev.height ||
          obj.rotation !== prev.rotation ||
          obj.text_content !== prev.text_content
        )
      })

      if (updatedObjects.length > 0) {
        const firstEditTextObjects = updatedObjects.filter(
          (obj) => obj.type === "text" && newTextObjectIds.has(obj.id) && obj.text_content?.trim(),
        )

        if (firstEditTextObjects.length > 0) {
          // This is the first edit - combine creation + edit into one history entry
          const textIds = firstEditTextObjects.map((obj) => obj.id)

          // Find the state before the text object was created
          const beforeCreation = previousObjects.filter((obj) => !textIds.includes(obj.id))

          addCommand({
            type: "create", // Treat as creation, not update
            objectIds: textIds,
            beforeState: beforeCreation,
            afterState: objects,
            timestamp: Date.now(),
          })

          // Remove from tracking
          setNewTextObjectIds((prev) => {
            const newSet = new Set(prev)
            textIds.forEach((id) => newSet.delete(id))
            return newSet
          })
        } else {
          // Regular update
          addCommand({
            type: "update",
            objectIds: updatedObjects.map((obj) => obj.id),
            beforeState: previousObjects,
            afterState: objects,
            timestamp: Date.now(),
          })
        }
      }
    }

    setPreviousObjects(objects)
  }, [objects, isUndoRedoOperation, newTextObjectIds])

  const handleUndo = useCallback(() => {
    const newObjects = undo(objects)
    if (newObjects) {
      setIsUndoRedoOperation(true)
      syncObjects(newObjects)
    }
  }, [undo, objects, syncObjects])

  const handleRedo = useCallback(() => {
    const newObjects = redo(objects)
    if (newObjects) {
      setIsUndoRedoOperation(true)
      syncObjects(newObjects)
    }
  }, [redo, objects, syncObjects])

  const handleDelete = useCallback(() => {
    if (selectedObjectIds.length > 0) {
      const count = selectedObjectIds.length
      const updatedObjects = objects.filter((obj) => !selectedObjectIds.includes(obj.id))
      syncObjects(updatedObjects)
      setSelectedObjectIds([])
      console.log("[v0] Deleted selected objects via keyboard shortcut")

      toast({
        title: "Deleted",
        description: `${count} object${count > 1 ? "s" : ""} deleted`,
        variant: "destructive",
      })
    }
  }, [selectedObjectIds, objects, syncObjects, toast])

  const handleDuplicate = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
    const duplicatedObjects = selectedObjs.map((obj) => ({
      ...obj,
      id: crypto.randomUUID(),
      x: obj.x + 20, // Offset by 20px
      y: obj.y + 20, // Offset by 20px
    }))

    const updatedObjects = [...objects, ...duplicatedObjects]
    syncObjects(updatedObjects)

    setSelectedObjectIds(duplicatedObjects.map((obj) => obj.id))
    console.log("[v0] Duplicated", selectedObjectIds.length, "object(s)")

    toast({
      title: "Duplicated",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} duplicated`,
    })
  }, [selectedObjectIds, objects, syncObjects, toast])

  const handleCopy = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
    setClipboard(selectedObjs)
    console.log("[v0] Copied", selectedObjectIds.length, "object(s) to clipboard")

    toast({
      title: "Copied",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} copied to clipboard`,
    })
  }, [selectedObjectIds, objects, toast])

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return

    const pastedObjects = clipboard.map((obj) => ({
      ...obj,
      id: crypto.randomUUID(),
      x: obj.x + 20, // Offset by 20px
      y: obj.y + 20, // Offset by 20px
    }))

    const updatedObjects = [...objects, ...pastedObjects]
    syncObjects(updatedObjects)

    setSelectedObjectIds(pastedObjects.map((obj) => obj.id))
    console.log("[v0] Pasted", clipboard.length, "object(s) from clipboard")

    toast({
      title: "Pasted",
      description: `${clipboard.length} object${clipboard.length > 1 ? "s" : ""} pasted`,
    })
  }, [clipboard, objects, syncObjects, toast])

  const handleStyleChange = useCallback(
    (updates: Partial<CanvasObject>) => {
      if (selectedObjectIds.length === 0) return

      const updatedObjects = objects.map((obj) => {
        if (selectedObjectIds.includes(obj.id)) {
          return { ...obj, ...updates }
        }
        return obj
      })

      syncObjects(updatedObjects)
      console.log("[v0] Updated style for", selectedObjectIds.length, "object(s)")
    },
    [selectedObjectIds, objects, syncObjects],
  )

  const handleSelectAll = useCallback(() => {
    const allIds = objects.map((obj) => obj.id)
    setSelectedObjectIds(allIds)
    console.log("[v0] Selected all objects:", allIds.length)
  }, [objects])

  const selectedObjects = useMemo(() => {
    return objects.filter((obj) => selectedObjectIds.includes(obj.id))
  }, [objects, selectedObjectIds])

  useKeyboardShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    onSelectAll: handleSelectAll,
    onCopy: handleCopy,
    onPaste: handlePaste,
    canUndo: historyCanUndo,
    canRedo: historyCanRedo,
    hasSelection: selectedObjectIds.length > 0,
  })

  useEffect(() => {
    if (onUndo) {
      onUndo(() => handleUndo)
    }
    if (onRedo) {
      onRedo(() => handleRedo)
    }
  }, [handleUndo, handleRedo, onUndo, onRedo])

  useEffect(() => {
    canUndo?.(historyCanUndo)
    canRedo?.(historyCanRedo)
  }, [historyCanUndo, historyCanRedo, canUndo, canRedo])

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

  useEffect(() => {
    onObjectsChange?.(objects)
  }, [objects, onObjectsChange])

  const handleSelectionChange = (selectedIds: string[]) => {
    setSelectedObjectIds(selectedIds)
    onSelectionChange?.(selectedIds)
  }

  const handleLayerSelect = useCallback((id: string, addToSelection: boolean) => {
    if (addToSelection) {
      setSelectedObjectIds((prev) => {
        if (prev.includes(id)) {
          return prev.filter((selectedId) => selectedId !== id)
        }
        return [...prev, id]
      })
    } else {
      setSelectedObjectIds([id])
    }
  }, [])

  const handleLayerDelete = useCallback(
    (id: string) => {
      const updatedObjects = objects.filter((obj) => obj.id !== id)
      syncObjects(updatedObjects)
      setSelectedObjectIds((prev) => prev.filter((selectedId) => selectedId !== id))
      console.log("[v0] Deleted object from layers panel:", id)
    },
    [objects, syncObjects],
  )

  const handleToggleVisibility = useCallback(
    (id: string) => {
      const updatedObjects = objects.map((obj) => {
        if (obj.id === id) {
          return { ...obj, visible: obj.visible === false ? true : false }
        }
        return obj
      })
      syncObjects(updatedObjects)
      console.log("[v0] Toggled visibility for object:", id)
    },
    [objects, syncObjects],
  )

  const handleToggleLock = useCallback(
    (id: string) => {
      const updatedObjects = objects.map((obj) => {
        if (obj.id === id) {
          return { ...obj, locked: obj.locked === true ? false : true }
        }
        return obj
      })
      syncObjects(updatedObjects)
      console.log("[v0] Toggled lock for object:", id)
    },
    [objects, syncObjects],
  )

  const handleAlign = useCallback(
    (alignType: AlignmentType) => {
      if (selectedObjectIds.length < 2) return

      const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
      const updates = alignObjects(selectedObjs, alignType)

      const updatedObjects = objects.map((obj) => {
        const update = updates.get(obj.id)
        if (update) {
          return { ...obj, x: update.x, y: update.y }
        }
        return obj
      })

      syncObjects(updatedObjects)
      console.log("[v0] Aligned", selectedObjectIds.length, "objects:", alignType)
    },
    [selectedObjectIds, objects, syncObjects],
  )

  const handleDistribute = useCallback(
    (distributeType: DistributeType) => {
      if (selectedObjectIds.length < 3) return

      const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
      const updates = distributeObjects(selectedObjs, distributeType)

      const updatedObjects = objects.map((obj) => {
        const update = updates.get(obj.id)
        if (update) {
          return { ...obj, x: update.x, y: update.y }
        }
        return obj
      })

      syncObjects(updatedObjects)
      console.log("[v0] Distributed", selectedObjectIds.length, "objects:", distributeType)
    },
    [selectedObjectIds, objects, syncObjects],
  )

  useEffect(() => {
    if (onAlign) {
      onAlign(() => handleAlign)
    }
    if (onDistribute) {
      onDistribute(() => handleDistribute)
    }
  }, [handleAlign, handleDistribute, onAlign, onDistribute])

  const handleCommentCreate = useCallback(
    (x: number, y: number, content: string) => {
      if (onCommentCreate) {
        onCommentCreate(x, y, content)
      }
    },
    [onCommentCreate],
  )

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">Loading canvas...</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <ConnectionStatus isConnected={connectionState.isConnected} queuedOps={connectionState.queuedOps} />
      <PresencePanel currentUser={{ userName, userColor }} otherUsers={otherUsers} />
      <StylePanel selectedObjects={selectedObjects} onStyleChange={handleStyleChange} />
      <LayersPanel
        objects={objects}
        selectedIds={selectedObjectIds}
        onSelectObject={handleLayerSelect}
        onDeleteObject={handleLayerDelete}
        onToggleVisibility={handleToggleVisibility}
        onToggleLock={handleToggleLock}
      />
      <Canvas
        canvasId={canvasId}
        objects={objects}
        onObjectsChange={syncObjects}
        onCursorMove={updateCursor}
        onSelectionChange={handleSelectionChange}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onAlign={handleAlign}
        onDistribute={handleDistribute}
        selectedCount={selectedObjectIds.length}
        gridEnabled={gridEnabled}
        snapEnabled={snapEnabled}
        gridSize={gridSize}
        commentMode={commentMode}
        onCommentCreate={handleCommentCreate}
      >
        <MultiplayerCursors users={otherUsers} />
        {comments.map((comment) => (
          <CommentMarker key={comment.id} comment={comment} />
        ))}
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

      case "createText": {
        const newTextObject: CanvasObject = {
          id: crypto.randomUUID(),
          type: "text",
          x: operation.x,
          y: operation.y,
          width: 200, // Default width for text
          height: operation.fontSize || 16,
          rotation: 0,
          fill_color: operation.color || "#000000",
          stroke_color: operation.color || "#000000",
          stroke_width: 0,
          text_content: operation.text,
          font_size: operation.fontSize || 16,
          font_family: "Arial",
        }
        updatedObjects.push(newTextObject)
        console.log("[v0] Created text object:", operation.text)
        break
      }

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
        const indices = operation.shapeIndices || updatedObjects.map((_: any, i: number) => i)
        const shapesToDistribute = indices.map((i: number) => updatedObjects[i]).filter(Boolean)

        if (shapesToDistribute.length >= 2) {
          const distributeType: DistributeType = operation.direction === "horizontal" ? "horizontal" : "vertical"
          const updates = distributeObjects(shapesToDistribute, distributeType)

          updatedObjects = updatedObjects.map((obj) => {
            const update = updates.get(obj.id)
            if (update) {
              return { ...obj, x: update.x, y: update.y }
            }
            return obj
          })
        }
        break
      }

      case "align": {
        const indices = operation.shapeIndices || updatedObjects.map((_: any, i: number) => i)
        const shapesToAlign = indices.map((i: number) => updatedObjects[i]).filter(Boolean)

        if (shapesToAlign.length >= 2) {
          let alignType: AlignmentType
          switch (operation.alignment) {
            case "left":
              alignType = "left"
              break
            case "right":
              alignType = "right"
              break
            case "top":
              alignType = "top"
              break
            case "bottom":
              alignType = "bottom"
              break
            case "center":
            case "middle":
              alignType = "center-h"
              break
            default:
              alignType = "center-h"
          }

          const updates = alignObjects(shapesToAlign, alignType)

          updatedObjects = updatedObjects.map((obj) => {
            const update = updates.get(obj.id)
            if (update) {
              return { ...obj, x: update.x, y: update.y }
            }
            return obj
          })
        }
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
