"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { PresencePanel } from "@/components/presence-panel"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useMemo, useEffect, useState, useCallback, useRef, type Dispatch, type SetStateAction } from "react"
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
  onBringToFront?: Dispatch<SetStateAction<(() => void) | undefined>>
  onSendToBack?: Dispatch<SetStateAction<(() => void) | undefined>>
  onBringForward?: Dispatch<SetStateAction<(() => void) | undefined>>
  onSendBackward?: Dispatch<SetStateAction<(() => void) | undefined>>
  lassoMode?: boolean // Added lassoMode prop type
  onSelectAllOfType?: Dispatch<SetStateAction<(() => void) | undefined>> // Added onSelectAllOfType prop type
  historyRestore?: CanvasObject[] | null
  onHistoryRestoreComplete?: (result: "success" | "error") => void
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
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  lassoMode = false,
  onSelectAllOfType,
  historyRestore = null,
  onHistoryRestoreComplete,
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
  const objectsRef = useRef<CanvasObject[]>(objects)

  useEffect(() => {
    objectsRef.current = objects
  }, [objects])

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

  useEffect(() => {
    if (!historyRestore) return

    const applyRestore = async () => {
      const previousState = objectsRef.current || []

      console.log(
        "[v0] Applying history restore:",
        historyRestore.length,
        "object(s) replacing",
        previousState.length,
        "object(s)",
      )

      const uniqueIds = Array.from(
        new Set([
          ...previousState.map((obj) => obj.id),
          ...historyRestore.map((obj) => obj.id),
        ]),
      )

      setIsUndoRedoOperation(true)

      try {
        await syncObjects(historyRestore)

        addCommand({
          type: "restore",
          objectIds: uniqueIds,
          beforeState: previousState,
          afterState: historyRestore,
          timestamp: Date.now(),
        })

        setNewTextObjectIds(new Set())
        setPreviousObjects(historyRestore)
        setSelectedObjectIds([])
        onSelectionChange?.([])

        console.log("[v0] History restore applied successfully")

        onHistoryRestoreComplete?.("success")
      } catch (error) {
        console.error("[v0] Failed to apply history restore:", error)
        setIsUndoRedoOperation(false)
        onHistoryRestoreComplete?.("error")
      }
    }

    void applyRestore()
  }, [historyRestore, addCommand, syncObjects, onSelectionChange, onHistoryRestoreComplete])

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

  const handleSelectAllOfType = useCallback(() => {
    console.log("[v0] handleSelectAllOfType called")
    console.log("[v0] selectedObjectIds:", selectedObjectIds)
    console.log("[v0] objects:", objects.length)

    if (selectedObjectIds.length === 0) {
      console.log("[v0] No objects selected, returning")
      return
    }

    // Get the types of all currently selected objects
    const selectedTypes = new Set(objects.filter((obj) => selectedObjectIds.includes(obj.id)).map((obj) => obj.type))
    console.log("[v0] selectedTypes:", Array.from(selectedTypes))

    // Select all objects that match any of the selected types
    const matchingIds = objects.filter((obj) => selectedTypes.has(obj.type)).map((obj) => obj.id)
    console.log("[v0] matchingIds:", matchingIds)

    setSelectedObjectIds(matchingIds)
    onSelectionChange?.(matchingIds) // Sync to parent component
    console.log("[v0] Updated selection to:", matchingIds.length, "objects")

    toast({
      title: "Selected by Type",
      description: `Selected ${matchingIds.length} ${Array.from(selectedTypes).join(", ")} object${matchingIds.length > 1 ? "s" : ""}`,
    })
  }, [selectedObjectIds, objects, toast, onSelectionChange])

  const selectedObjects = useMemo(() => {
    return objects.filter((obj) => selectedObjectIds.includes(obj.id))
  }, [objects, selectedObjectIds])

  useKeyboardShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    onSelectAll: handleSelectAll,
    onSelectAllOfType: handleSelectAllOfType, // Added select all of type to keyboard shortcuts
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

  const handleBringToFront = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
    const otherObjs = objects.filter((obj) => !selectedObjectIds.includes(obj.id))

    // Move selected objects to the end (highest z-index)
    const updatedObjects = [...otherObjs, ...selectedObjs]
    syncObjects(updatedObjects)
    console.log("[v0] Brought", selectedObjectIds.length, "object(s) to front")

    toast({
      title: "Brought to Front",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} moved to front`,
    })
  }, [selectedObjectIds, objects, syncObjects, toast])

  const handleSendToBack = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const selectedObjs = objects.filter((obj) => selectedObjectIds.includes(obj.id))
    const otherObjs = objects.filter((obj) => !selectedObjectIds.includes(obj.id))

    // Move selected objects to the beginning (lowest z-index)
    const updatedObjects = [...selectedObjs, ...otherObjs]
    syncObjects(updatedObjects)
    console.log("[v0] Sent", selectedObjectIds.length, "object(s) to back")

    toast({
      title: "Sent to Back",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} moved to back`,
    })
  }, [selectedObjectIds, objects, syncObjects, toast])

  const handleBringForward = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const updatedObjects = [...objects]

    // Move each selected object one position forward (higher z-index)
    // Process from end to start to avoid conflicts
    for (let i = updatedObjects.length - 2; i >= 0; i--) {
      if (selectedObjectIds.includes(updatedObjects[i].id) && !selectedObjectIds.includes(updatedObjects[i + 1].id)) {
        // Swap with next object
        const temp = updatedObjects[i]
        updatedObjects[i] = updatedObjects[i + 1]
        updatedObjects[i + 1] = temp
      }
    }

    syncObjects(updatedObjects)
    console.log("[v0] Brought", selectedObjectIds.length, "object(s) forward")

    toast({
      title: "Brought Forward",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} moved forward`,
    })
  }, [selectedObjectIds, objects, syncObjects, toast])

  const handleSendBackward = useCallback(() => {
    if (selectedObjectIds.length === 0) return

    const updatedObjects = [...objects]

    // Move each selected object one position backward (lower z-index)
    // Process from start to end to avoid conflicts
    for (let i = 1; i < updatedObjects.length; i++) {
      if (selectedObjectIds.includes(updatedObjects[i].id) && !selectedObjectIds.includes(updatedObjects[i - 1].id)) {
        // Swap with previous object
        const temp = updatedObjects[i]
        updatedObjects[i] = updatedObjects[i - 1]
        updatedObjects[i - 1] = temp
      }
    }

    syncObjects(updatedObjects)
    console.log("[v0] Sent", selectedObjectIds.length, "object(s) backward")

    toast({
      title: "Sent Backward",
      description: `${selectedObjectIds.length} object${selectedObjectIds.length > 1 ? "s" : ""} moved backward`,
    })
  }, [selectedObjectIds, objects, syncObjects, toast])

  useEffect(() => {
    if (onAlign) {
      onAlign(() => handleAlign)
    }
    if (onDistribute) {
      onDistribute(() => handleDistribute)
    }
  }, [handleAlign, handleDistribute, onAlign, onDistribute])

  useEffect(() => {
    if (onBringToFront) {
      onBringToFront(() => handleBringToFront)
    }
    if (onSendToBack) {
      onSendToBack(() => handleSendToBack)
    }
    if (onBringForward) {
      onBringForward(() => handleBringForward)
    }
    if (onSendBackward) {
      onSendBackward(() => handleSendBackward)
    }
  }, [
    handleBringToFront,
    handleSendToBack,
    handleBringForward,
    handleSendBackward,
    onBringToFront,
    onSendToBack,
    onBringForward,
    onSendBackward,
  ])

  useEffect(() => {
    if (onSelectAllOfType) {
      onSelectAllOfType(() => handleSelectAllOfType)
    }
  }, [handleSelectAllOfType, onSelectAllOfType])

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
        selectedIds={selectedObjectIds}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onAlign={handleAlign}
        onDistribute={handleDistribute}
        selectedCount={selectedObjectIds.length}
        gridEnabled={gridEnabled}
        snapEnabled={snapEnabled}
        gridSize={gridSize}
        commentMode={commentMode}
        onCommentCreate={onCommentCreate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onBringForward={handleBringForward}
        onSendBackward={handleSendBackward}
        lassoMode={lassoMode} // Pass lassoMode to Canvas
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

      case "createHeroSection": {
        updatedObjects = createHeroSection(updatedObjects, operation)
        break
      }

      case "createPricingTable": {
        updatedObjects = createPricingTable(updatedObjects, operation)
        break
      }

      case "createButtonRow": {
        updatedObjects = createButtonRow(updatedObjects, operation)
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth = 2,
): CanvasObject {
  return {
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: fill,
    stroke_color: stroke,
    stroke_width: strokeWidth,
  }
}

function createTextLayer(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  width?: number,
  fontFamily = "Inter",
): CanvasObject {
  const computedWidth = width ?? Math.max(140, Math.round(text.length * fontSize * 0.6) + 40)
  const computedHeight = Math.max(fontSize * 1.4, fontSize + 12)

  return {
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    width: computedWidth,
    height: computedHeight,
    rotation: 0,
    fill_color: color,
    stroke_color: color,
    stroke_width: 0,
    text_content: text,
    font_size: fontSize,
    font_family: fontFamily,
  }
}

function createLoginForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, theme = "light", title = "Welcome back", subtitle = "Please sign in to continue" } = operation
  const palette =
    theme === "dark"
      ? {
          card: "#111827",
          stroke: "#1f2937",
          field: "#1f2937",
          accent: "#2563eb",
          textPrimary: "#f9fafb",
          textSecondary: "#9ca3af",
        }
      : {
          card: "#ffffff",
          stroke: "#e5e7eb",
          field: "#f3f4f6",
          accent: "#2563eb",
          textPrimary: "#111827",
          textSecondary: "#6b7280",
        }

  const centerX = clamp(x, 100, 1900)
  const centerY = clamp(y, 120, 1880)
  const cardWidth = 360
  const cardHeight = 320
  const left = centerX - cardWidth / 2
  const top = centerY - cardHeight / 2
  const fieldWidth = cardWidth - 48
  const fieldHeight = 48

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, cardWidth, cardHeight, palette.card, palette.stroke, 2))
  updatedObjects.push(createTextLayer(title, left + 24, top + 24, 26, palette.textPrimary, cardWidth - 48))
  updatedObjects.push(createTextLayer(subtitle, left + 24, top + 64, 16, palette.textSecondary, cardWidth - 48))

  const labels = ["Email", "Password"]
  labels.forEach((label, index) => {
    const labelTop = top + 110 + index * 78
    updatedObjects.push(createTextLayer(label, left + 24, labelTop, 14, palette.textSecondary, fieldWidth))
    updatedObjects.push(createRectangle(left + 24, labelTop + 22, fieldWidth, fieldHeight, palette.field, palette.stroke, 1))
    const placeholder = index === 0 ? "you@example.com" : "••••••••"
    updatedObjects.push(createTextLayer(placeholder, left + 36, labelTop + 32, 15, palette.textSecondary, fieldWidth - 24))
  })

  updatedObjects.push(createRectangle(left + 24, top + cardHeight - 72, fieldWidth, 48, palette.accent, palette.accent, 0))
  updatedObjects.push(createTextLayer("Sign in", centerX - 32, top + cardHeight - 62, 18, "#ffffff", 120))

  updatedObjects.push(
    createTextLayer("Forgot your password?", left + 24, top + cardHeight - 24, 14, palette.textSecondary, fieldWidth),
  )

  return updatedObjects
}

function createDashboard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, theme = "light" } = operation
  const palette =
    theme === "dark"
      ? {
          background: "#0f172a",
          stroke: "#1e293b",
          header: "#1e293b",
          sidebar: "#111827",
          card: "#1f2937",
          textPrimary: "#f1f5f9",
          textSecondary: "#94a3b8",
          accent: "#38bdf8",
        }
      : {
          background: "#ffffff",
          stroke: "#e2e8f0",
          header: "#f1f5f9",
          sidebar: "#f8fafc",
          card: "#ffffff",
          textPrimary: "#0f172a",
          textSecondary: "#64748b",
          accent: "#2563eb",
        }

  const centerX = clamp(x, 200, 1800)
  const centerY = clamp(y, 240, 1760)
  const layoutWidth = 900
  const layoutHeight = 540
  const left = centerX - layoutWidth / 2
  const top = centerY - layoutHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, layoutWidth, layoutHeight, palette.background, palette.stroke, 2))
  updatedObjects.push(createRectangle(left, top, layoutWidth, 72, palette.header, palette.stroke, 1))
  updatedObjects.push(createRectangle(left, top + 72, 220, layoutHeight - 72, palette.sidebar, palette.stroke, 1))
  updatedObjects.push(createTextLayer("Team Analytics", left + 28, top + 26, 22, palette.textPrimary, 300))
  updatedObjects.push(createTextLayer("Overview", left + 28, top + 116, 16, palette.textSecondary, 180))

  const cardWidth = 200
  const cardHeight = 120
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const cardLeft = left + 260 + col * (cardWidth + 24)
      const cardTop = top + 108 + row * (cardHeight + 24)
      updatedObjects.push(createRectangle(cardLeft, cardTop, cardWidth, cardHeight, palette.card, palette.stroke, 1))
      updatedObjects.push(createTextLayer(`Metric ${row * 3 + col + 1}`, cardLeft + 16, cardTop + 16, 14, palette.textSecondary, cardWidth - 32))
      updatedObjects.push(createTextLayer("1,248", cardLeft + 16, cardTop + 44, 26, palette.textPrimary, cardWidth - 32))
    }
  }

  updatedObjects.push(createTextLayer("Navigation", left + 28, top + 156, 14, palette.textSecondary, 160))
  const navItems = ["Dashboard", "Reports", "Integrations", "Settings"]
  navItems.forEach((item, idx) => {
    updatedObjects.push(createTextLayer(item, left + 28, top + 188 + idx * 36, 15, palette.textPrimary, 160))
  })

  updatedObjects.push(
    createRectangle(left + layoutWidth - 220, top + 72 + 24, 200, layoutHeight - 72 - 48, palette.sidebar, palette.stroke, 1),
  )
  updatedObjects.push(
    createTextLayer("Team tasks", left + layoutWidth - 200, top + 108, 16, palette.textPrimary, 160),
  )

  return updatedObjects
}

function createNavBar(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { items = 4, x, y, theme = "dark", brand = "Acme" } = operation
  const clampedItems = clamp(items, 2, 7)
  const palette =
    theme === "dark"
      ? { background: "#111827", stroke: "#1f2937", item: "#2563eb", text: "#f9fafb", muted: "#9ca3af" }
      : { background: "#ffffff", stroke: "#e5e7eb", item: "#2563eb", text: "#111827", muted: "#6b7280" }

  const centerX = clamp(x, 160, 1840)
  const centerY = clamp(y, 80, 1920)
  const navWidth = clampedItems * 140 + 160
  const navHeight = 70
  const left = centerX - navWidth / 2
  const top = centerY - navHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, navWidth, navHeight, palette.background, palette.stroke, 2))
  updatedObjects.push(createTextLayer(brand, left + 32, top + 22, 22, palette.text, 180))

  for (let i = 0; i < clampedItems; i++) {
    const itemLeft = left + 220 + i * 140
    updatedObjects.push(createRectangle(itemLeft, top + 18, 120, 34, "transparent", "transparent", 0))
    updatedObjects.push(createTextLayer(`Menu ${i + 1}`, itemLeft + 12, top + 22, 16, palette.muted, 120))
  }

  updatedObjects.push(createRectangle(left + navWidth - 152, top + 16, 136, 40, palette.item, palette.item, 0))
  updatedObjects.push(createTextLayer("Get started", left + navWidth - 140, top + 24, 16, "#ffffff", 120))

  return updatedObjects
}

function createCard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, width = 320, height = 360, theme = "light" } = operation
  const palette =
    theme === "dark"
      ? { card: "#111827", stroke: "#1f2937", header: "#1f2937", accent: "#2563eb", text: "#f9fafb", muted: "#9ca3af" }
      : { card: "#ffffff", stroke: "#e5e7eb", header: "#dbeafe", accent: "#2563eb", text: "#111827", muted: "#6b7280" }

  const centerX = clamp(x, width / 2, 2000 - width / 2)
  const centerY = clamp(y, height / 2, 2000 - height / 2)
  const left = centerX - width / 2
  const top = centerY - height / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, width, height, palette.card, palette.stroke, 2))
  updatedObjects.push(createRectangle(left, top, width, 160, palette.header, palette.stroke, 1))
  updatedObjects.push(createRectangle(left + 24, top + 24, width - 48, 112, "transparent", palette.stroke, 2))
  updatedObjects.push(createTextLayer("Card Title", left + 24, top + 184, 22, palette.text, width - 48))
  updatedObjects.push(createTextLayer("Short description that explains the value proposition.", left + 24, top + 224, 16, palette.muted, width - 48))
  updatedObjects.push(createRectangle(left + 24, top + height - 72, 140, 44, palette.accent, palette.accent, 0))
  updatedObjects.push(createTextLayer("Learn more", left + 36, top + height - 64, 16, "#ffffff", 120))

  return updatedObjects
}

function createButton(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, width = 160, height = 48, label = "Button", color = "#2563eb" } = operation
  const centerX = clamp(x, width / 2, 2000 - width / 2)
  const centerY = clamp(y, height / 2, 2000 - height / 2)
  const left = centerX - width / 2
  const top = centerY - height / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, width, height, color, color, 0))
  updatedObjects.push(createTextLayer(label, left + 20, top + 12, 16, "#ffffff", width - 40))

  return updatedObjects
}

function createForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { fields = 3, x, y, theme = "light", title = "Contact Us", subtitle = "We usually respond within 24 hours." } = operation
  const clampedFields = clamp(fields, 2, 5)
  const palette =
    theme === "dark"
      ? { card: "#0f172a", stroke: "#1e293b", field: "#1f2937", text: "#f8fafc", muted: "#94a3b8", accent: "#38bdf8" }
      : { card: "#ffffff", stroke: "#e2e8f0", field: "#f8fafc", text: "#0f172a", muted: "#64748b", accent: "#2563eb" }

  const formWidth = 440
  const formHeight = clampedFields * 86 + 180
  const centerX = clamp(x, formWidth / 2, 2000 - formWidth / 2)
  const centerY = clamp(y, formHeight / 2, 2000 - formHeight / 2)
  const left = centerX - formWidth / 2
  const top = centerY - formHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, formWidth, formHeight, palette.card, palette.stroke, 2))
  updatedObjects.push(createTextLayer(title, left + 28, top + 28, 24, palette.text, formWidth - 56))
  updatedObjects.push(createTextLayer(subtitle, left + 28, top + 68, 16, palette.muted, formWidth - 56))

  for (let i = 0; i < clampedFields; i++) {
    const labelTop = top + 120 + i * 86
    updatedObjects.push(createTextLayer(`Field ${i + 1}`, left + 28, labelTop, 14, palette.muted, formWidth - 56))
    updatedObjects.push(createRectangle(left + 28, labelTop + 22, formWidth - 56, 50, palette.field, palette.stroke, 1))
  }

  updatedObjects.push(createRectangle(left + 28, top + formHeight - 76, 160, 48, palette.accent, palette.accent, 0))
  updatedObjects.push(createTextLayer("Submit", left + 48, top + formHeight - 70, 18, "#ffffff", 120))

  return updatedObjects
}

function createHeroSection(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, theme = "light" } = operation
  const palette =
    theme === "dark"
      ? { background: "#0f172a", stroke: "#1e293b", text: "#f8fafc", muted: "#94a3b8", accent: "#38bdf8" }
      : { background: "#f8fafc", stroke: "#e2e8f0", text: "#0f172a", muted: "#475569", accent: "#2563eb" }

  const heroWidth = 960
  const heroHeight = 420
  const centerX = clamp(x, heroWidth / 2, 2000 - heroWidth / 2)
  const centerY = clamp(y, heroHeight / 2, 2000 - heroHeight / 2)
  const left = centerX - heroWidth / 2
  const top = centerY - heroHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, heroWidth, heroHeight, palette.background, palette.stroke, 2))
  updatedObjects.push(createTextLayer("Design faster with AI", left + 56, top + 64, 42, palette.text, heroWidth / 2 - 80))
  updatedObjects.push(
    createTextLayer(
      "Generate polished layouts, iterate with natural language, and collaborate in real-time with your team.",
      left + 56,
      top + 132,
      18,
      palette.muted,
      heroWidth / 2 - 80,
    ),
  )
  updatedObjects.push(createRectangle(left + 56, top + 220, 180, 54, palette.accent, palette.accent, 0))
  updatedObjects.push(createTextLayer("Start building", left + 72, top + 228, 18, "#ffffff", 160))
  updatedObjects.push(createRectangle(left + 260, top + 220, 180, 54, "transparent", palette.stroke, 2))
  updatedObjects.push(createTextLayer("View templates", left + 276, top + 228, 18, palette.text, 160))

  const imageLeft = left + heroWidth / 2 + 32
  updatedObjects.push(createRectangle(imageLeft, top + 56, heroWidth / 2 - 88, heroHeight - 112, "#ffffff20", palette.stroke, 2))
  updatedObjects.push(createRectangle(imageLeft + 40, top + 96, heroWidth / 2 - 168, heroHeight - 192, "#ffffff30", palette.stroke, 2))

  return updatedObjects
}

function createPricingTable(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, tiers = 3, theme = "light" } = operation
  const clampedTiers = clamp(tiers, 2, 4)
  const palette =
    theme === "dark"
      ? {
          background: "#0f172a",
          stroke: "#1e293b",
          card: "#111827",
          accent: "#38bdf8",
          text: "#f8fafc",
          muted: "#94a3b8",
        }
      : {
          background: "#ffffff",
          stroke: "#e2e8f0",
          card: "#f8fafc",
          accent: "#2563eb",
          text: "#0f172a",
          muted: "#64748b",
        }

  const tableWidth = clampedTiers * 260 + (clampedTiers + 1) * 24
  const tableHeight = 420
  const centerX = clamp(x, tableWidth / 2, 2000 - tableWidth / 2)
  const centerY = clamp(y, tableHeight / 2, 2000 - tableHeight / 2)
  const left = centerX - tableWidth / 2
  const top = centerY - tableHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, tableWidth, tableHeight, palette.background, palette.stroke, 2))
  updatedObjects.push(createTextLayer("Simple pricing", left + 32, top + 32, 28, palette.text, tableWidth - 64))
  updatedObjects.push(createTextLayer("Choose the plan that fits your team.", left + 32, top + 72, 18, palette.muted, tableWidth - 64))

  for (let tier = 0; tier < clampedTiers; tier++) {
    const cardLeft = left + 24 + tier * (260 + 24)
    const cardTop = top + 120
    updatedObjects.push(createRectangle(cardLeft, cardTop, 260, 260, palette.card, palette.stroke, 2))
    updatedObjects.push(createTextLayer(`Plan ${tier + 1}`, cardLeft + 24, cardTop + 24, 18, palette.text, 212))
    updatedObjects.push(createTextLayer(`$${(tier + 1) * 19}/mo`, cardLeft + 24, cardTop + 64, 26, palette.text, 212))
    const features = ["Unlimited boards", "Real-time AI", "Export to Figma"]
    features.forEach((feature, idx) => {
      updatedObjects.push(createTextLayer(feature, cardLeft + 24, cardTop + 112 + idx * 32, 14, palette.muted, 212))
    })
    updatedObjects.push(createRectangle(cardLeft + 24, cardTop + 200, 212, 46, palette.accent, palette.accent, 0))
    updatedObjects.push(createTextLayer("Choose plan", cardLeft + 44, cardTop + 206, 16, "#ffffff", 180))
  }

  return updatedObjects
}

function createButtonRow(objects: CanvasObject[], operation: any): CanvasObject[] {
  const { x, y, buttons = 3, theme = "light" } = operation
  const clampedButtons = clamp(buttons, 2, 5)
  const palette =
    theme === "dark"
      ? { background: "#111827", stroke: "#1f2937", accent: "#38bdf8", text: "#f8fafc" }
      : { background: "#ffffff", stroke: "#e5e7eb", accent: "#2563eb", text: "#0f172a" }

  const rowWidth = clampedButtons * 180 + (clampedButtons + 1) * 20
  const rowHeight = 80
  const centerX = clamp(x, rowWidth / 2, 2000 - rowWidth / 2)
  const centerY = clamp(y, rowHeight / 2, 2000 - rowHeight / 2)
  const left = centerX - rowWidth / 2
  const top = centerY - rowHeight / 2

  const updatedObjects = [...objects]
  updatedObjects.push(createRectangle(left, top, rowWidth, rowHeight, palette.background, palette.stroke, 2))

  for (let i = 0; i < clampedButtons; i++) {
    const buttonLeft = left + 20 + i * 200
    updatedObjects.push(createRectangle(buttonLeft, top + 18, 180, 44, palette.accent, palette.accent, 0))
    updatedObjects.push(createTextLayer(`Action ${i + 1}`, buttonLeft + 28, top + 26, 16, "#ffffff", 140))
  }

  return updatedObjects
}
