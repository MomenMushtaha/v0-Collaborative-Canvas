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
import { exportCanvas } from "@/lib/export-utils"
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
  onSaveSnapshot?: (name?: string) => Promise<void> | void
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
  onSaveSnapshot,
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
    if (aiOperations.length === 0) {
      return
    }

    console.log("[v0] Processing AI operations:", aiOperations)

    const processOperationsSequentially = async () => {
      let updatedObjects = [...objects]
      let currentSelection = [...selectedObjectIds]
      let currentGridSettings = { enabled: gridEnabled, snap: snapEnabled, size: gridSize }
      let currentViewportState = viewport || { x: 0, y: 0, zoom: 1 }
      const failedOperations: string[] = []

      const selectObjectsFromAI = (ids: string[]) => {
        currentSelection = ids
        setSelectedObjectIds(ids)
        onSelectionChange?.(ids)
      }

      const updateGridSettingsFromAI = (settings: { enabled: boolean; snap: boolean; size: number }) => {
        currentGridSettings = settings
        onGridChange?.(settings.enabled, settings.snap, settings.size)
      }

      const updateViewportFromAI = (nextViewport: { x: number; y: number; zoom: number }) => {
        currentViewportState = nextViewport
        onViewportChange?.(nextViewport)
      }

      for (let i = 0; i < aiOperations.length; i++) {
        const operation = aiOperations[i]
        console.log(`[v0] Processing operation ${i + 1}/${aiOperations.length}:`, operation.type)

        try {
          const result = await applyOperation(updatedObjects, operation, {
            selectObjects: selectObjectsFromAI,
            getSelection: () => currentSelection,
            gridSettings: currentGridSettings,
            setGridSettings: updateGridSettingsFromAI,
            onCommentCreate,
            viewport: currentViewportState,
            setViewport: updateViewportFromAI,
            exportCanvas: (format, selectionOnly = false) => {
              const objectsToExport =
                selectionOnly && currentSelection.length > 0
                  ? updatedObjects.filter((obj) => currentSelection.includes(obj.id))
                  : updatedObjects

              if (objectsToExport.length === 0) {
                throw new Error("No objects available to export")
              }

              exportCanvas({
                format,
                objects: objectsToExport,
                backgroundColor: "#ffffff",
                scale: format === "png" ? 2 : 1,
                viewport: currentViewportState,
                canvasWidth: typeof window !== "undefined" ? window.innerWidth : 1920,
                canvasHeight: typeof window !== "undefined" ? window.innerHeight : 1080,
              })
            },
            onSaveSnapshot,
          })

          if (result.error) {
            failedOperations.push(`${operation.type}: ${result.error}`)
            console.warn(`[v0] Operation failed:`, result.error)
          } else {
            updatedObjects = result.objects
            syncObjects(updatedObjects)
            objectsRef.current = updatedObjects
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error"
          failedOperations.push(`${operation.type}: ${errorMsg}`)
          console.error(`[v0] Operation error:`, error)
        }

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
  }, [
    aiOperations,
    objects,
    selectedObjectIds,
    gridEnabled,
    snapEnabled,
    gridSize,
    viewport,
    onSelectionChange,
    onGridChange,
    onViewportChange,
    onCommentCreate,
    onSaveSnapshot,
    syncObjects,
  ])

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

interface OperationContext {
  selectObjects: (ids: string[]) => void
  getSelection: () => string[]
  gridSettings: { enabled: boolean; snap: boolean; size: number }
  setGridSettings: (settings: { enabled: boolean; snap: boolean; size: number }) => void
  onCommentCreate?: (x: number, y: number, content: string) => Promise<void> | void
  viewport: { x: number; y: number; zoom: number }
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void
  exportCanvas?: (format: "png" | "svg", selectionOnly?: boolean) => void
  onSaveSnapshot?: (name?: string) => Promise<void> | void
}

function resolveTargetIds(
  objects: CanvasObject[],
  operation: { targetIds?: string[]; shapeIndices?: number[]; applyToSelection?: boolean },
  selection: string[],
): string[] {
  const ids = new Set<string>()

  if (Array.isArray(operation.targetIds)) {
    for (const id of operation.targetIds) {
      if (objects.some((obj) => obj.id === id)) {
        ids.add(id)
      }
    }
  }

  if (Array.isArray(operation.shapeIndices)) {
    for (const index of operation.shapeIndices) {
      if (index >= 0 && index < objects.length) {
        ids.add(objects[index].id)
      }
    }
  }

  if (operation.applyToSelection) {
    selection.forEach((id) => ids.add(id))
  }

  return Array.from(ids)
}

function getTargetsByIds(objects: CanvasObject[], targetIds: string[]) {
  return targetIds
    .map((id) => {
      const index = objects.findIndex((obj) => obj.id === id)
      if (index === -1) {
        return null
      }
      return { index, object: objects[index] }
    })
    .filter((value): value is { index: number; object: CanvasObject } => value !== null)
}

async function applyOperation(
  objects: CanvasObject[],
  operation: any,
  context: OperationContext,
): Promise<{ objects: CanvasObject[]; error?: string }> {
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
          width: 200,
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
        const indices = Array.isArray(operation.shapeIndices)
          ? operation.shapeIndices
          : updatedObjects.map((_: any, i: number) => i)
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
        const indices = Array.isArray(operation.shapeIndices)
          ? operation.shapeIndices
          : updatedObjects.map((_: any, i: number) => i)
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

      case "updateStyle": {
        const targetIds = resolveTargetIds(updatedObjects, operation, context.getSelection())
        if (targetIds.length === 0) {
          return { objects, error: "No matching shapes found to style." }
        }

        const targets = getTargetsByIds(updatedObjects, targetIds)
        if (targets.length === 0) {
          return { objects, error: "Unable to locate shapes for style update." }
        }

        targets.forEach(({ index, object }) => {
          const isText = object.type === "text"
          updatedObjects[index] = {
            ...object,
            fill_color: isText
              ? operation.textColor || operation.fillColor || object.fill_color
              : operation.fillColor || object.fill_color,
            stroke_color: operation.strokeColor || object.stroke_color,
            stroke_width: operation.strokeWidth ?? object.stroke_width,
            font_size: isText ? operation.fontSize ?? object.font_size : object.font_size,
          }
        })
        break
      }

      case "updateText": {
        const targetIds = resolveTargetIds(updatedObjects, operation, context.getSelection())
        const targets = getTargetsByIds(updatedObjects, targetIds)
        if (targets.length === 0) {
          return { objects, error: "No text objects found to update." }
        }

        targets.forEach(({ index, object }) => {
          if (object.type !== "text") {
            return
          }
          updatedObjects[index] = {
            ...object,
            text_content: operation.text ?? object.text_content,
            font_size: operation.fontSize ?? object.font_size,
            fill_color: operation.textColor || object.fill_color,
          }
        })
        break
      }

      case "updateLayerState": {
        const targetIds = resolveTargetIds(updatedObjects, operation, context.getSelection())
        const targets = getTargetsByIds(updatedObjects, targetIds)
        if (targets.length === 0) {
          return { objects, error: "No objects found to update state." }
        }

        targets.forEach(({ index, object }) => {
          updatedObjects[index] = {
            ...object,
            visible: operation.visibility ?? object.visible,
            locked: operation.locked ?? object.locked,
          }
        })
        break
      }

      case "reorder": {
        const targetIds = resolveTargetIds(updatedObjects, operation, context.getSelection())
        const targets = getTargetsByIds(updatedObjects, targetIds)
        if (targets.length === 0) {
          return { objects, error: "No objects selected for reordering." }
        }

        switch (operation.action) {
          case "bringToFront": {
            const remaining = updatedObjects.filter((obj) => !targetIds.includes(obj.id))
            const reordered = targets.map((target) => target.object)
            updatedObjects = [...remaining, ...reordered]
            break
          }
          case "sendToBack": {
            const remaining = updatedObjects.filter((obj) => !targetIds.includes(obj.id))
            const reordered = targets.map((target) => target.object)
            updatedObjects = [...reordered, ...remaining]
            break
          }
          case "bringForward": {
            for (let i = updatedObjects.length - 2; i >= 0; i--) {
              const current = updatedObjects[i]
              if (targetIds.includes(current.id) && !targetIds.includes(updatedObjects[i + 1].id)) {
                const swap = updatedObjects[i + 1]
                updatedObjects[i + 1] = current
                updatedObjects[i] = swap
              }
            }
            break
          }
          case "sendBackward": {
            for (let i = 1; i < updatedObjects.length; i++) {
              const current = updatedObjects[i]
              if (targetIds.includes(current.id) && !targetIds.includes(updatedObjects[i - 1].id)) {
                const swap = updatedObjects[i - 1]
                updatedObjects[i - 1] = current
                updatedObjects[i] = swap
              }
            }
            break
          }
          default:
            return { objects, error: `Unknown reorder action: ${operation.action}` }
        }
        break
      }

      case "duplicate": {
        const targetIds = resolveTargetIds(updatedObjects, operation, context.getSelection())
        const targets = getTargetsByIds(updatedObjects, targetIds)
        if (targets.length === 0) {
          return { objects, error: "No objects available to duplicate." }
        }

        const offsetX = operation.offsetX ?? 20
        const offsetY = operation.offsetY ?? 20

        targets.forEach(({ object }) => {
          const clone: CanvasObject = {
            ...object,
            id: crypto.randomUUID(),
            x: object.x + offsetX,
            y: object.y + offsetY,
            created_at: undefined,
            updated_at: undefined,
          }
          updatedObjects.push(clone)
        })
        break
      }

      case "select": {
        if (operation.mode === "clear") {
          context.selectObjects([])
          break
        }

        if (operation.mode === "all") {
          context.selectObjects(updatedObjects.map((obj) => obj.id))
          break
        }

        if (operation.mode === "remove" && Array.isArray(operation.targetIds)) {
          const current = new Set(context.getSelection())
          operation.targetIds.forEach((id: string) => current.delete(id))
          context.selectObjects(Array.from(current))
          break
        }

        const targets = new Set(resolveTargetIds(updatedObjects, operation, context.getSelection()))

        if (typeof operation.shapeType === "string") {
          updatedObjects
            .filter((obj) => obj.type === operation.shapeType)
            .forEach((obj) => targets.add(obj.id))
        }

        if (typeof operation.fillColor === "string") {
          const normalized = operation.fillColor.toLowerCase()
          updatedObjects
            .filter((obj) => obj.fill_color?.toLowerCase() === normalized)
            .forEach((obj) => targets.add(obj.id))
        }

        const currentSelection = new Set(context.getSelection())
        const targetIds = Array.from(targets)

        if (operation.mode === "add") {
          targetIds.forEach((id) => currentSelection.add(id))
          context.selectObjects(Array.from(currentSelection))
        } else if (operation.mode === "remove") {
          targetIds.forEach((id) => currentSelection.delete(id))
          context.selectObjects(Array.from(currentSelection))
        } else {
          context.selectObjects(targetIds)
        }
        break
      }

      case "viewport": {
        const next = { ...context.viewport }
        if (typeof operation.x === "number") {
          next.x = operation.x
        }
        if (typeof operation.y === "number") {
          next.y = operation.y
        }
        if (typeof operation.deltaX === "number") {
          next.x += operation.deltaX
        }
        if (typeof operation.deltaY === "number") {
          next.y += operation.deltaY
        }
        if (typeof operation.zoom === "number") {
          next.zoom = Math.min(3, Math.max(1, operation.zoom))
        }
        if (typeof operation.deltaZoom === "number") {
          next.zoom = Math.min(3, Math.max(1, next.zoom + operation.deltaZoom))
        }

        context.setViewport(next)
        break
      }

      case "gridSettings": {
        const nextSettings = {
          enabled: operation.enabled ?? context.gridSettings.enabled,
          snap: operation.snap ?? context.gridSettings.snap,
          size: operation.size ?? context.gridSettings.size,
        }
        context.setGridSettings(nextSettings)
        break
      }

      case "comment": {
        if (!context.onCommentCreate) {
          return { objects, error: "Comment functionality is not available." }
        }

        await context.onCommentCreate(operation.x, operation.y, operation.content)
        break
      }

      case "export": {
        if (!context.exportCanvas) {
          return { objects, error: "Export functionality is not available." }
        }
        context.exportCanvas(operation.format, operation.selectionOnly)
        break
      }

      case "snapshot": {
        if (!context.onSaveSnapshot) {
          return { objects, error: "Snapshot functionality is not available." }
        }
        await context.onSaveSnapshot(operation.name)
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

      case "updateStyle": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided for style update." }
        }

        const targetIndices = Array.from(new Set(operation.shapeIndices))
        const invalidIndex = targetIndices.find((idx: number) => idx < 0 || idx >= updatedObjects.length)

        if (invalidIndex !== undefined) {
          return {
            objects,
            error: `Cannot style shape at index ${invalidIndex}. Only ${updatedObjects.length} shapes exist.`,
          }
        }

        const hasFill = typeof operation.fillColor === "string"
        const hasStroke = typeof operation.strokeColor === "string"
        const hasStrokeWidth = typeof operation.strokeWidth === "number"
        const hasTextColor = typeof operation.textColor === "string"

        if (!hasFill && !hasStroke && !hasStrokeWidth && !hasTextColor) {
          return { objects, error: "No style changes were provided." }
        }

        updatedObjects = updatedObjects.map((obj, idx) => {
          if (!targetIndices.includes(idx)) {
            return obj
          }

          const updates: Partial<CanvasObject> = {}

          if (hasFill) {
            updates.fill_color = operation.fillColor
          }

          if (hasStroke) {
            updates.stroke_color = operation.strokeColor
          }

          if (hasStrokeWidth) {
            updates.stroke_width = operation.strokeWidth
          }

          if (hasTextColor && obj.type === "text") {
            updates.fill_color = operation.textColor
            updates.stroke_color = operation.textColor
          }

          return { ...obj, ...updates }
        })

        break
      }

      case "duplicate": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided to duplicate." }
        }

        const uniqueIndices = Array.from(new Set(operation.shapeIndices))
        const invalidIndex = uniqueIndices.find((idx: number) => idx < 0 || idx >= updatedObjects.length)

        if (invalidIndex !== undefined) {
          return {
            objects,
            error: `Cannot duplicate shape at index ${invalidIndex}. Only ${updatedObjects.length} shapes exist.`,
          }
        }

        const offsetX = typeof operation.offsetX === "number" ? operation.offsetX : 20
        const offsetY = typeof operation.offsetY === "number" ? operation.offsetY : 20

        const duplicates = uniqueIndices
          .map((idx) => updatedObjects[idx])
          .filter(Boolean)
          .map((source) => ({
            ...source,
            id: crypto.randomUUID(),
            x: source.x + offsetX,
            y: source.y + offsetY,
          }))

        updatedObjects = [...updatedObjects, ...duplicates]

        break
      }

      case "bringToFront": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided to bring to front." }
        }

        const indexSet = new Set(operation.shapeIndices)
        const selected = updatedObjects.filter((_, idx) => indexSet.has(idx))
        if (selected.length === 0) {
          return { objects, error: "None of the specified shapes could be found." }
        }

        const remaining = updatedObjects.filter((_, idx) => !indexSet.has(idx))
        updatedObjects = [...remaining, ...selected]

        break
      }

      case "sendToBack": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided to send to back." }
        }

        const indexSet = new Set(operation.shapeIndices)
        const selected = updatedObjects.filter((_, idx) => indexSet.has(idx))
        if (selected.length === 0) {
          return { objects, error: "None of the specified shapes could be found." }
        }

        const remaining = updatedObjects.filter((_, idx) => !indexSet.has(idx))
        updatedObjects = [...selected, ...remaining]

        break
      }

      case "bringForward": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided to bring forward." }
        }

        const idSet = new Set(
          operation.shapeIndices
            .map((idx: number) => updatedObjects[idx])
            .filter(Boolean)
            .map((obj: CanvasObject) => obj.id),
        )

        if (idSet.size === 0) {
          return { objects, error: "None of the specified shapes could be found." }
        }

        for (let i = updatedObjects.length - 2; i >= 0; i--) {
          const current = updatedObjects[i]
          const next = updatedObjects[i + 1]
          if (idSet.has(current.id) && !idSet.has(next.id)) {
            updatedObjects[i] = next
            updatedObjects[i + 1] = current
          }
        }

        break
      }

      case "sendBackward": {
        if (!Array.isArray(operation.shapeIndices) || operation.shapeIndices.length === 0) {
          return { objects, error: "No shapes provided to send backward." }
        }

        const idSet = new Set(
          operation.shapeIndices
            .map((idx: number) => updatedObjects[idx])
            .filter(Boolean)
            .map((obj: CanvasObject) => obj.id),
        )

        if (idSet.size === 0) {
          return { objects, error: "None of the specified shapes could be found." }
        }

        for (let i = 1; i < updatedObjects.length; i++) {
          const current = updatedObjects[i]
          const previous = updatedObjects[i - 1]
          if (idSet.has(current.id) && !idSet.has(previous.id)) {
            updatedObjects[i] = previous
            updatedObjects[i - 1] = current
          }
        }

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

const CANVAS_LIMIT = 2000

function clampRectToCanvas(x: number, y: number, width: number, height: number) {
  const clampedX = Math.max(0, Math.min(CANVAS_LIMIT - width, x))
  const clampedY = Math.max(0, Math.min(CANVAS_LIMIT - height, y))
  return { x: clampedX, y: clampedY }
}

function createLoginForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const width = Math.min(Math.max(operation.width ?? 360, 260), 640)
  const height = Math.min(Math.max(operation.height ?? 320, 260), 640)
  const centerX = operation.x ?? CANVAS_LIMIT / 2
  const centerY = operation.y ?? CANVAS_LIMIT / 2
  const desiredLeft = centerX - width / 2
  const desiredTop = centerY - height / 2
  const { x, y } = clampRectToCanvas(desiredLeft, desiredTop, width, height)

  const backgroundColor = operation.backgroundColor ?? "#ffffff"
  const borderColor = operation.borderColor ?? "#e5e7eb"
  const fieldColor = operation.fieldColor ?? "#f3f4f6"
  const buttonColor = operation.buttonColor ?? "#3b82f6"
  const textColor = operation.textColor ?? "#111827"
  const mutedTextColor = operation.mutedTextColor ?? "#6b7280"
  const buttonTextColor = operation.buttonTextColor ?? "#ffffff"
  const titleText = operation.titleText ?? "Welcome back"
  const subtitleText = operation.subtitleText ?? "Please sign in to continue"
  const usernameLabel = operation.usernameLabel ?? "Email"
  const passwordLabel = operation.passwordLabel ?? "Password"
  const buttonText = operation.buttonText ?? "Sign In"
  const helpText = operation.helpText ?? "Forgot password?"

  const contentLeft = x + 20
  const contentWidth = width - 40
  const titleHeight = 36
  const subtitleHeight = 28
  const fieldHeight = 44
  const fieldSpacing = 70
  const firstFieldTop = y + 120
  const secondFieldTop = firstFieldTop + fieldSpacing
  const buttonWidth = Math.min(contentWidth, 220)
  const buttonLeft = x + (width - buttonWidth) / 2
  const buttonTop = y + height - 70

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: backgroundColor,
    stroke_color: borderColor,
    stroke_width: 2,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: contentLeft,
    y: y + 24,
    width: contentWidth,
    height: titleHeight,
    rotation: 0,
    fill_color: textColor,
    stroke_color: textColor,
    stroke_width: 0,
    text_content: titleText,
    font_size: 28,
    font_family: "Inter",
  })

  if (subtitleText) {
    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "text",
      x: contentLeft,
      y: y + 60,
      width: contentWidth,
      height: subtitleHeight,
      rotation: 0,
      fill_color: mutedTextColor,
      stroke_color: mutedTextColor,
      stroke_width: 0,
      text_content: subtitleText,
      font_size: 18,
      font_family: "Inter",
    })
  }

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: contentLeft,
    y: firstFieldTop - 30,
    width: contentWidth,
    height: 24,
    rotation: 0,
    fill_color: mutedTextColor,
    stroke_color: mutedTextColor,
    stroke_width: 0,
    text_content: usernameLabel,
    font_size: 16,
    font_family: "Inter",
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: contentLeft,
    y: firstFieldTop,
    width: contentWidth,
    height: fieldHeight,
    rotation: 0,
    fill_color: fieldColor,
    stroke_color: borderColor,
    stroke_width: 1,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: contentLeft,
    y: secondFieldTop - 30,
    width: contentWidth,
    height: 24,
    rotation: 0,
    fill_color: mutedTextColor,
    stroke_color: mutedTextColor,
    stroke_width: 0,
    text_content: passwordLabel,
    font_size: 16,
    font_family: "Inter",
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: contentLeft,
    y: secondFieldTop,
    width: contentWidth,
    height: fieldHeight,
    rotation: 0,
    fill_color: fieldColor,
    stroke_color: borderColor,
    stroke_width: 1,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 48,
    rotation: 0,
    fill_color: buttonColor,
    stroke_color: buttonColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 48,
    rotation: 0,
    fill_color: buttonTextColor,
    stroke_color: buttonTextColor,
    stroke_width: 0,
    text_content: buttonText,
    font_size: 18,
    font_family: "Inter",
  })

  if (helpText) {
    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "text",
      x: contentLeft,
      y: buttonTop + 56,
      width: contentWidth,
      height: 24,
      rotation: 0,
      fill_color: buttonColor,
      stroke_color: buttonColor,
      stroke_width: 0,
      text_content: helpText,
      font_size: 16,
      font_family: "Inter",
    })
  }

  return updatedObjects
}

function createDashboard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const width = Math.min(Math.max(operation.width ?? 800, 400), 1200)
  const height = Math.min(Math.max(operation.height ?? 600, 360), 1200)
  const { x, y } = clampRectToCanvas(operation.x ?? 160, operation.y ?? 80, width, height)

  const headerHeight = 60
  const sidebarWidth = Math.min(Math.max(operation.sidebarWidth ?? 220, 160), width / 2)
  const headerColor = operation.headerColor ?? "#1f2937"
  const sidebarColor = operation.sidebarColor ?? "#374151"
  const contentColor = operation.contentColor ?? "#f3f4f6"

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height: headerHeight,
    rotation: 0,
    fill_color: headerColor,
    stroke_color: headerColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y: y + headerHeight,
    width: sidebarWidth,
    height: height - headerHeight,
    rotation: 0,
    fill_color: sidebarColor,
    stroke_color: sidebarColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x + sidebarWidth,
    y: y + headerHeight,
    width: width - sidebarWidth,
    height: height - headerHeight,
    rotation: 0,
    fill_color: contentColor,
    stroke_color: contentColor,
    stroke_width: 0,
  })

  return updatedObjects
}

function createNavBar(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const items = Math.max(2, Math.min(operation.items ?? 4, 8))
  const width = Math.min(Math.max(operation.width ?? items * 140 + 80, 360), 960)
  const height = Math.min(Math.max(operation.height ?? 64, 48), 120)
  const initialX = operation.x ?? 40
  const initialY = operation.y ?? 40
  const { x, y } = clampRectToCanvas(initialX, initialY, width, height)

  const backgroundColor = operation.backgroundColor ?? "#111827"
  const itemColor = operation.itemColor ?? "#1f2937"
  const activeItemColor = operation.activeItemColor ?? "#3b82f6"
  const textColor = operation.textColor ?? "#f9fafb"
  const brandText = operation.brandText ?? "Product"
  const menuItems: string[] = Array.isArray(operation.menuItems)
    ? operation.menuItems.slice(0, items)
    : Array.from({ length: items }, (_, index) => (index === 0 ? "Home" : `Item ${index + 1}`))

  const horizontalPadding = 24
  const brandAreaWidth = Math.min(180, Math.max(120, Math.round(width * 0.22)))
  const menuAreaLeft = x + horizontalPadding + brandAreaWidth
  const menuAvailableWidth = width - horizontalPadding * 2 - brandAreaWidth
  const gap = 16
  let itemWidth = (menuAvailableWidth - gap * (items - 1)) / items
  itemWidth = Math.max(80, Math.min(140, itemWidth))
  const totalItemsWidth = itemWidth * items + gap * (items - 1)
  const startX = menuAreaLeft + Math.max(0, (menuAvailableWidth - totalItemsWidth) / 2)
  const itemHeight = Math.min(height - 20, 44)
  const itemTop = y + (height - itemHeight) / 2

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: backgroundColor,
    stroke_color: backgroundColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: x + horizontalPadding,
    y: y + (height - 40) / 2,
    width: brandAreaWidth - 16,
    height: 40,
    rotation: 0,
    fill_color: textColor,
    stroke_color: textColor,
    stroke_width: 0,
    text_content: brandText,
    font_size: 24,
    font_family: "Inter",
  })

  for (let i = 0; i < items; i++) {
    const itemX = startX + i * (itemWidth + gap)
    const label = menuItems[i] || `Item ${i + 1}`
    const fill = i === 0 ? activeItemColor : itemColor

    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "rectangle",
      x: itemX,
      y: itemTop,
      width: itemWidth,
      height: itemHeight,
      rotation: 0,
      fill_color: fill,
      stroke_color: fill,
      stroke_width: 0,
    })

    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "text",
      x: itemX,
      y: itemTop,
      width: itemWidth,
      height: itemHeight,
      rotation: 0,
      fill_color: textColor,
      stroke_color: textColor,
      stroke_width: 0,
      text_content: label,
      font_size: 16,
      font_family: "Inter",
    })
  }

  return updatedObjects
}

function createCard(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const width = Math.min(Math.max(operation.width ?? 320, 240), 520)
  const height = Math.min(Math.max(operation.height ?? 220, 180), 420)
  const centerX = operation.x ?? CANVAS_LIMIT / 2
  const centerY = operation.y ?? CANVAS_LIMIT / 2
  const desiredLeft = centerX - width / 2
  const desiredTop = centerY - height / 2
  const { x, y } = clampRectToCanvas(desiredLeft, desiredTop, width, height)

  const accentHeight = Math.min(Math.max(operation.mediaHeight ?? Math.round(height * 0.45), 80), height - 90)
  const backgroundColor = operation.backgroundColor ?? "#ffffff"
  const borderColor = operation.borderColor ?? "#e5e7eb"
  const accentColor = operation.accentColor ?? "#dbeafe"
  const textColor = operation.textColor ?? "#111827"
  const mutedTextColor = operation.mutedTextColor ?? "#6b7280"
  const buttonColor = operation.buttonColor ?? operation.accentColor ?? "#3b82f6"
  const buttonTextColor = operation.buttonTextColor ?? "#ffffff"
  const titleText = operation.titleText ?? "Card title"
  const descriptionText = operation.descriptionText ?? "Add supporting details here."
  const buttonText = operation.buttonText ?? "Learn more"

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: backgroundColor,
    stroke_color: borderColor,
    stroke_width: 2,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height: accentHeight,
    rotation: 0,
    fill_color: accentColor,
    stroke_color: accentColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: x + 20,
    y: y + accentHeight + 16,
    width: width - 40,
    height: 32,
    rotation: 0,
    fill_color: textColor,
    stroke_color: textColor,
    stroke_width: 0,
    text_content: titleText,
    font_size: 22,
    font_family: "Inter",
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: x + 20,
    y: y + accentHeight + 56,
    width: width - 40,
    height: 48,
    rotation: 0,
    fill_color: mutedTextColor,
    stroke_color: mutedTextColor,
    stroke_width: 0,
    text_content: descriptionText,
    font_size: 16,
    font_family: "Inter",
  })

  const buttonWidth = Math.min(width - 40, 200)
  const buttonLeft = x + width - buttonWidth - 20
  const buttonTop = y + height - 60

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 44,
    rotation: 0,
    fill_color: buttonColor,
    stroke_color: buttonColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 44,
    rotation: 0,
    fill_color: buttonTextColor,
    stroke_color: buttonTextColor,
    stroke_width: 0,
    text_content: buttonText,
    font_size: 16,
    font_family: "Inter",
  })

  return updatedObjects
}

function createButton(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const width = Math.min(Math.max(operation.width ?? 160, 80), 400)
  const height = Math.min(Math.max(operation.height ?? 48, 32), 160)
  const centerX = operation.x ?? CANVAS_LIMIT / 2
  const centerY = operation.y ?? CANVAS_LIMIT / 2
  const desiredLeft = centerX - width / 2
  const desiredTop = centerY - height / 2
  const { x, y } = clampRectToCanvas(desiredLeft, desiredTop, width, height)

  const color = operation.color ?? "#3b82f6"
  const textColor = operation.textColor ?? "#ffffff"
  const label = operation.text ?? "Button"

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: color,
    stroke_color: color,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: textColor,
    stroke_color: textColor,
    stroke_width: 0,
    text_content: label,
    font_size: Math.min(20, Math.max(14, height - 18)),
    font_family: "Inter",
  })

  return updatedObjects
}

function createForm(objects: CanvasObject[], operation: any): CanvasObject[] {
  const updatedObjects = [...objects]
  const fields = Math.max(1, Math.min(operation.fields ?? 2, 5))
  const width = Math.min(Math.max(operation.width ?? 420, 280), 640)
  const height = Math.min(Math.max(operation.height ?? fields * 70 + 160, 240), 720)
  const centerX = operation.x ?? CANVAS_LIMIT / 2
  const centerY = operation.y ?? CANVAS_LIMIT / 2
  const desiredLeft = centerX - width / 2
  const desiredTop = centerY - height / 2
  const { x, y } = clampRectToCanvas(desiredLeft, desiredTop, width, height)

  const backgroundColor = operation.backgroundColor ?? "#ffffff"
  const borderColor = operation.borderColor ?? "#e5e7eb"
  const fieldColor = operation.fieldColor ?? "#f3f4f6"
  const buttonColor = operation.buttonColor ?? "#3b82f6"
  const textColor = operation.textColor ?? "#111827"
  const buttonText = operation.buttonText ?? "Submit"

  const contentLeft = x + 24
  const contentWidth = width - 48
  const fieldHeight = 44
  const spacing = (height - 160) / Math.max(1, fields)

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill_color: backgroundColor,
    stroke_color: borderColor,
    stroke_width: 2,
  })

  for (let i = 0; i < fields; i++) {
    const fieldTop = y + 80 + i * spacing
    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "text",
      x: contentLeft,
      y: fieldTop - 28,
      width: contentWidth,
      height: 24,
      rotation: 0,
      fill_color: textColor,
      stroke_color: textColor,
      stroke_width: 0,
      text_content: operation.fieldLabels?.[i] || `Field ${i + 1}`,
      font_size: 16,
      font_family: "Inter",
    })

    updatedObjects.push({
      id: crypto.randomUUID(),
      type: "rectangle",
      x: contentLeft,
      y: fieldTop,
      width: contentWidth,
      height: fieldHeight,
      rotation: 0,
      fill_color: fieldColor,
      stroke_color: borderColor,
      stroke_width: 1,
    })
  }

  const buttonWidth = Math.min(contentWidth, 220)
  const buttonLeft = x + (width - buttonWidth) / 2
  const buttonTop = y + height - 80

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "rectangle",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 48,
    rotation: 0,
    fill_color: buttonColor,
    stroke_color: buttonColor,
    stroke_width: 0,
  })

  updatedObjects.push({
    id: crypto.randomUUID(),
    type: "text",
    x: buttonLeft,
    y: buttonTop,
    width: buttonWidth,
    height: 48,
    rotation: 0,
    fill_color: "#ffffff",
    stroke_color: "#ffffff",
    stroke_width: 0,
    text_content: buttonText,
    font_size: 18,
    font_family: "Inter",
  })

  return updatedObjects
}
