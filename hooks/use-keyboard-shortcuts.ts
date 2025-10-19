"use client"

import { useEffect } from "react"

interface KeyboardShortcutsProps {
  onUndo?: () => void
  onRedo?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onSelectAll?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onGroup?: () => void
  onUngroup?: () => void
  canUndo?: boolean
  canRedo?: boolean
  hasSelection?: boolean
}

export function useKeyboardShortcuts({
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
  onSelectAll,
  onCopy,
  onPaste,
  onGroup,
  onUngroup,
  canUndo = false,
  canRedo = false,
  hasSelection = false,
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
      const modifier = isMac ? e.metaKey : e.ctrlKey

      // Select All: Ctrl+A (Windows/Linux) or Cmd+A (Mac)
      if (modifier && e.key === "a" && onSelectAll) {
        e.preventDefault()
        onSelectAll()
        console.log("[v0] Keyboard shortcut: Select All")
        return
      }

      // Copy: Ctrl+C (Windows/Linux) or Cmd+C (Mac)
      if (modifier && e.key === "c" && hasSelection && onCopy) {
        e.preventDefault()
        onCopy()
        console.log("[v0] Keyboard shortcut: Copy")
        return
      }

      // Paste: Ctrl+V (Windows/Linux) or Cmd+V (Mac)
      if (modifier && e.key === "v" && onPaste) {
        e.preventDefault()
        onPaste()
        console.log("[v0] Keyboard shortcut: Paste")
        return
      }

      if (modifier && e.key === "g" && hasSelection && onGroup) {
        e.preventDefault()
        onGroup()
        console.log("[v0] Keyboard shortcut: Group")
        return
      }

      if (modifier && e.shiftKey && e.key === "g" && hasSelection && onUngroup) {
        e.preventDefault()
        onUngroup()
        console.log("[v0] Keyboard shortcut: Ungroup")
        return
      }

      // Undo: Ctrl+Z (Windows/Linux) or Cmd+Z (Mac)
      if (modifier && e.key === "z" && !e.shiftKey && canUndo && onUndo) {
        e.preventDefault()
        onUndo()
        console.log("[v0] Keyboard shortcut: Undo")
        return
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z (Windows/Linux) or Cmd+Shift+Z (Mac)
      if (((modifier && e.key === "y") || (modifier && e.shiftKey && e.key === "z")) && canRedo && onRedo) {
        e.preventDefault()
        onRedo()
        console.log("[v0] Keyboard shortcut: Redo")
        return
      }

      // Delete: Delete or Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && hasSelection && onDelete) {
        e.preventDefault()
        onDelete()
        console.log("[v0] Keyboard shortcut: Delete")
        return
      }

      // Duplicate: Ctrl+D (Windows/Linux) or Cmd+D (Mac)
      if (modifier && e.key === "d" && hasSelection && onDuplicate) {
        e.preventDefault()
        onDuplicate()
        console.log("[v0] Keyboard shortcut: Duplicate")
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    onUndo,
    onRedo,
    onDelete,
    onDuplicate,
    onSelectAll,
    onCopy,
    onPaste,
    onGroup,
    onUngroup,
    canUndo,
    canRedo,
    hasSelection,
  ])
}
