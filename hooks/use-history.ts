"use client"

import { useState, useCallback } from "react"
import type { CanvasObject, HistoryCommand } from "@/lib/types"

const MAX_HISTORY_SIZE = 50

export function useHistory() {
  const [undoStack, setUndoStack] = useState<HistoryCommand[]>([])
  const [redoStack, setRedoStack] = useState<HistoryCommand[]>([])

  const addCommand = useCallback((command: HistoryCommand) => {
    setUndoStack((prev) => {
      const newStack = [...prev, command]
      // Keep only last MAX_HISTORY_SIZE commands
      if (newStack.length > MAX_HISTORY_SIZE) {
        return newStack.slice(-MAX_HISTORY_SIZE)
      }
      return newStack
    })
    // Clear redo stack when new command is added
    setRedoStack([])

    console.log("[v0] [HISTORY] Added command:", command.type, "affecting", command.objectIds.length, "object(s)")
  }, [])

  const undo = useCallback(
    (currentObjects: CanvasObject[]): CanvasObject[] | null => {
      if (undoStack.length === 0) {
        console.log("[v0] [HISTORY] Nothing to undo")
        return null
      }

      const command = undoStack[undoStack.length - 1]
      setUndoStack((prev) => prev.slice(0, -1))

      setRedoStack((prev) => [...prev, command])

      console.log("[v0] [HISTORY] Undo:", command.type, "affecting", command.objectIds.length, "object(s)")

      if (command.beforeState) {
        return command.beforeState
      }

      return currentObjects
    },
    [undoStack],
  )

  const redo = useCallback(
    (currentObjects: CanvasObject[]): CanvasObject[] | null => {
      if (redoStack.length === 0) {
        console.log("[v0] [HISTORY] Nothing to redo")
        return null
      }

      const command = redoStack[redoStack.length - 1]
      setRedoStack((prev) => prev.slice(0, -1))

      setUndoStack((prev) => [...prev, command])

      console.log("[v0] [HISTORY] Redo:", command.type, "affecting", command.objectIds.length, "object(s)")

      if (command.afterState) {
        return command.afterState
      }

      return currentObjects
    },
    [redoStack],
  )

  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  const clearHistory = useCallback(() => {
    setUndoStack([])
    setRedoStack([])
    console.log("[v0] [HISTORY] Cleared history")
  }, [])

  return {
    addCommand,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  }
}
