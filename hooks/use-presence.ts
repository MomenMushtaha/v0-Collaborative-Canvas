"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { UserPresence } from "@/lib/types"

interface UsePresenceProps {
  canvasId: string
  userId: string
  userName: string
  userColor: string
}

interface CursorUpdate {
  userId: string
  userName: string
  color: string
  x: number
  y: number
}

interface SelectionUpdate {
  userId: string
  userName: string
  color: string
  selectedObjectIds: string[]
}

export function usePresence({ canvasId, userId, userName, userColor }: UsePresenceProps) {
  const [otherUsers, setOtherUsers] = useState<Map<string, UserPresence>>(new Map())
  const supabase = createClient()
  const [presenceId, setPresenceId] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Initialize presence
  useEffect(() => {
    async function initPresence() {
      console.log("[v0] Initializing presence for user:", userName, userId)
      const { data, error } = await supabase
        .from("user_presence")
        .insert({
          canvas_id: canvasId,
          user_id: userId,
          user_name: userName,
          color: userColor,
          cursor_x: 0,
          cursor_y: 0,
          selected_object_ids: [],
        })
        .select()
        .single()

      if (error) {
        console.error("[v0] Error creating presence:", error)
        return
      }

      console.log("[v0] Presence created successfully:", data.id)
      setPresenceId(data.id)
    }

    initPresence()

    // Cleanup on unmount
    return () => {
      if (presenceId) {
        console.log("[v0] Cleaning up presence:", presenceId)
        supabase.from("user_presence").delete().eq("id", presenceId).then()
      }
    }
  }, [canvasId, userId, userName, userColor, supabase])

  useEffect(() => {
    async function loadPresence() {
      const { data } = await supabase.from("user_presence").select("*").eq("canvas_id", canvasId).neq("user_id", userId)

      console.log("[v0] Loaded other users:", data?.length || 0)

      setOtherUsers((prev) => {
        const userMap = new Map(prev)

        data?.forEach((user) => {
          console.log("[v0] Other user:", user.user_name, user.user_id)
          const existing = userMap.get(user.user_id)

          console.log(
            "[v0] Existing user data:",
            existing
              ? {
                  hasSelection: !!existing.selected_object_ids,
                  selectionLength: existing.selected_object_ids?.length || 0,
                  selection: existing.selected_object_ids,
                }
              : "no existing data",
          )
          console.log("[v0] Database user data:", {
            hasSelection: !!user.selected_object_ids,
            selectionLength: user.selected_object_ids?.length || 0,
            selection: user.selected_object_ids,
          })

          const preservedSelection = existing?.selected_object_ids ?? []
          console.log("[v0] Preserved selection for", user.user_name, ":", preservedSelection)

          userMap.set(user.user_id, {
            id: user.id,
            canvas_id: user.canvas_id,
            user_id: user.user_id,
            user_name: user.user_name,
            color: user.color,
            cursor_x: existing?.cursor_x ?? user.cursor_x,
            cursor_y: existing?.cursor_y ?? user.cursor_y,
            last_seen: user.last_seen,
            selected_object_ids: preservedSelection,
          })
        })

        // Remove users that are no longer in the database (disconnected)
        const currentUserIds = new Set(data?.map((u) => u.user_id) || [])
        for (const [uid] of userMap) {
          if (!currentUserIds.has(uid)) {
            userMap.delete(uid)
          }
        }

        return userMap
      })
    }

    loadPresence()

    // Refresh presence list every 5 seconds to detect new users
    const presenceInterval = setInterval(loadPresence, 5000)

    console.log("[v0] Setting up cursor broadcast channel for canvas:", canvasId)
    const channel = supabase
      .channel(`canvas:${canvasId}:cursors`, {
        config: {
          broadcast: { self: false },
        },
      })
      .on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorUpdate }) => {
        console.log("[v0] Received cursor broadcast from:", payload.userName, "at", payload.x, payload.y)

        setOtherUsers((prev) => {
          const newMap = new Map(prev)
          const existing = newMap.get(payload.userId)

          newMap.set(payload.userId, {
            id: existing?.id || payload.userId,
            canvas_id: canvasId,
            user_id: payload.userId,
            user_name: payload.userName,
            color: payload.color,
            cursor_x: payload.x,
            cursor_y: payload.y,
            selected_object_ids: existing?.selected_object_ids || [],
            last_seen: new Date().toISOString(),
          })

          console.log("[v0] Updated cursor for user:", payload.userName, "total users:", newMap.size)
          return newMap
        })
      })
      .on("broadcast", { event: "selection" }, ({ payload }: { payload: SelectionUpdate }) => {
        console.log("[v0] Received selection broadcast from:", payload.userName, "selected:", payload.selectedObjectIds)

        setOtherUsers((prev) => {
          const newMap = new Map(prev)
          const existing = newMap.get(payload.userId)

          newMap.set(payload.userId, {
            id: existing?.id || payload.userId,
            canvas_id: canvasId,
            user_id: payload.userId,
            user_name: payload.userName,
            color: payload.color,
            cursor_x: existing?.cursor_x || 0,
            cursor_y: existing?.cursor_y || 0,
            selected_object_ids: payload.selectedObjectIds,
            last_seen: new Date().toISOString(),
          })

          console.log("[v0] Updated selection for user:", payload.userName, "selected IDs:", payload.selectedObjectIds)
          return newMap
        })
      })
      .subscribe((status) => {
        console.log("[v0] Cursor channel subscription status:", status)
      })

    channelRef.current = channel

    return () => {
      console.log("[v0] Cleaning up cursor broadcast channel")
      clearInterval(presenceInterval)
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [canvasId, userId, userName, supabase])

  useEffect(() => {
    if (!presenceId) return

    const heartbeat = async () => {
      await supabase
        .from("user_presence")
        .update({
          last_seen: new Date().toISOString(),
        })
        .eq("id", presenceId)
    }

    // Send heartbeat every 30 seconds to keep user marked as online
    const heartbeatInterval = setInterval(heartbeat, 30000)

    return () => {
      clearInterval(heartbeatInterval)
    }
  }, [presenceId, supabase])

  const updateCursor = useCallback(
    async (x: number, y: number) => {
      if (!channelRef.current) {
        console.warn("[v0] Cannot send cursor update: channel not ready")
        return
      }

      console.log("[v0] Broadcasting cursor position:", x, y, "for user:", userName)
      channelRef.current.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          userId,
          userName,
          color: userColor,
          x,
          y,
        } as CursorUpdate,
      })

      if (presenceId) {
        await supabase
          .from("user_presence")
          .update({
            cursor_x: x,
            cursor_y: y,
            last_seen: new Date().toISOString(),
          })
          .eq("id", presenceId)
      }
    },
    [userId, userName, userColor, presenceId, supabase],
  )

  const updateSelection = useCallback(
    async (selectedObjectIds: string[]) => {
      console.log("[v0] Broadcasting selection:", selectedObjectIds, "for user:", userName)

      if (!channelRef.current) {
        console.error("[v0] Cannot send selection update: channel not ready")
        return
      }

      try {
        const broadcastResult = await channelRef.current.send({
          type: "broadcast",
          event: "selection",
          payload: {
            userId,
            userName,
            color: userColor,
            selectedObjectIds,
          } as SelectionUpdate,
        })

        console.log("[v0] Selection broadcast sent:", broadcastResult)
      } catch (error) {
        console.error("[v0] Selection broadcast error:", error)
      }

      if (presenceId) {
        const { error } = await supabase
          .from("user_presence")
          .update({
            selected_object_ids: selectedObjectIds,
            last_seen: new Date().toISOString(),
          })
          .eq("id", presenceId)

        if (error) {
          console.error("[v0] Selection database update error:", error)
        } else {
          console.log("[v0] Selection persisted to database")
        }
      }
    },
    [userId, userName, userColor, presenceId, supabase],
  )

  return {
    otherUsers: Array.from(otherUsers.values()),
    updateCursor,
    updateSelection,
  }
}
