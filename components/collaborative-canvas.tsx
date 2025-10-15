"use client"

import { Canvas } from "@/components/canvas"
import { MultiplayerCursors } from "@/components/multiplayer-cursors"
import { PresencePanel } from "@/components/presence-panel"
import { useRealtimeCanvas } from "@/hooks/use-realtime-canvas"
import { usePresence } from "@/hooks/use-presence"
import { useMemo, useCallback } from "react"

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

  const { otherUsers, updateCursor, updateSelection } = usePresence({
    canvasId,
    userId,
    userName,
    userColor,
  })

  const handleSelectionChange = useCallback(
    (selectedIds: string[]) => {
      console.log("[v0] handleSelectionChange called with:", selectedIds)
      updateSelection(selectedIds)
    },
    [updateSelection],
  )

  const onlineUsers = useMemo(() => {
    const isUserOnline = (lastSeen: string) => {
      const lastSeenTime = new Date(lastSeen).getTime()
      const now = Date.now()
      return now - lastSeenTime < 10000 // 10 seconds
    }

    return otherUsers.filter((user) => isUserOnline(user.last_seen))
  }, [otherUsers])

  const otherUsersSelections = useMemo(() => {
    return onlineUsers
      .filter((user) => user.selected_object_ids && user.selected_object_ids.length > 0)
      .map((user) => ({
        userId: user.user_id,
        userName: user.user_name,
        color: user.color,
        selectedIds: user.selected_object_ids || [],
      }))
  }, [onlineUsers])

  console.log("[v0] Other users selections:", otherUsersSelections)

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
      <Canvas
        canvasId={canvasId}
        objects={objects}
        onObjectsChange={syncObjects}
        onCursorMove={updateCursor}
        onSelectionChange={handleSelectionChange}
        otherUsersSelections={otherUsersSelections}
      >
        <MultiplayerCursors users={onlineUsers} />
      </Canvas>
    </div>
  )
}
