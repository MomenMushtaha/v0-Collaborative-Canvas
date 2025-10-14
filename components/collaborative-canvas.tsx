"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useCanvas } from "@/hooks/use-canvas"
import { useMemo } from "react"

interface CollaborativeCanvasProps {
  canvasId: string
  userId: string
  userName: string
}

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

export function CollaborativeCanvas({ canvasId, userId, userName }: CollaborativeCanvasProps) {
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

  const { canvasRef, viewport } = useCanvas({
    canvasId,
    objects,
    onObjectsChange: syncObjects,
    onCursorMove: updateCursor,
  })

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground">Loading canvas...</div>
      </div>
    )
  }

  return (
    <Canvas canvasId={canvasId} objects={objects} onObjectsChange={syncObjects} onCursorMove={updateCursor}>
      <MultiplayerCursors users={otherUsers} viewportX={viewport.x} viewportY={viewport.y} zoom={viewport.zoom} />
    </Canvas>
  )
}
