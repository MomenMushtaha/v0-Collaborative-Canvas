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
      console.log("[v0] CollaborativeCanvas - handleSelectionChange called with:", selectedIds)
      console.log("[v0] CollaborativeCanvas - updateSelection function exists:", !!updateSelection)
      updateSelection(selectedIds)
    },
    [updateSelection],
  )

  const onlineUsers = useMemo(() => {
    const isUserOnline = (lastSeen: string) => {
      const lastSeenTime = new Date(lastSeen).getTime()
      const now = Date.now()
      return now - lastSeenTime < 300000 // 5 minutes
    }

    const online = otherUsers.filter((user) => isUserOnline(user.last_seen))
    console.log("[v0] CollaborativeCanvas - online users count:", online.length)
    return online
  }, [otherUsers])

  const usersWithCursors = useMemo(() => {
    return otherUsers.filter((user) => user.cursor_x !== null && user.cursor_y !== null)
  }, [otherUsers])

  const otherUsersSelections = useMemo(() => {
    console.log("[v0] CollaborativeCanvas - Computing otherUsersSelections from onlineUsers:", onlineUsers.length)
    onlineUsers.forEach((user) => {
      console.log("[v0] CollaborativeCanvas - User:", user.user_name, "selected_object_ids:", user.selected_object_ids)
    })

    const selections = onlineUsers
      .filter((user) => user.selected_object_ids && user.selected_object_ids.length > 0)
      .map((user) => ({
        userId: user.user_id,
        userName: user.user_name,
        color: user.color,
        selectedIds: user.selected_object_ids || [],
      }))

    console.log("[v0] CollaborativeCanvas - Computed otherUsersSelections:", selections)
    return selections
  }, [onlineUsers])

  console.log("[v0] CollaborativeCanvas - Final otherUsersSelections being passed to Canvas:", otherUsersSelections)

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
        <MultiplayerCursors users={usersWithCursors} />
      </Canvas>
    </div>
  )
}
