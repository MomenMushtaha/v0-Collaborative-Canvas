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
      const userMap = new Map<string, UserPresence>()
      data?.forEach((user) => {
        console.log("[v0] Other user:", user.user_name, user.user_id)
        userMap.set(user.user_id, user)
      })
      setOtherUsers(userMap)
    }

    loadPresence()

    // Refresh presence list every 5 seconds to detect new users
    const presenceInterval = setInterval(loadPresence, 5000)

    console.log("[v0] Setting up cursor broadcast channel for canvas:", canvasId)
    const channel = supabase
      .channel(`canvas:${canvasId}:cursors`, {
        config: {
          broadcast: { self: false }, // Don't receive own broadcasts
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

          console.log("[v0] Updated selection for user:", payload.userName, "total users:", newMap.size)
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
      console.log("[v0] updateSelection START - selectedObjectIds:", selectedObjectIds)
      console.log("[v0] updateSelection - userId:", userId)
      console.log("[v0] updateSelection - userName:", userName)
      console.log("[v0] updateSelection - presenceId:", presenceId)
      console.log("[v0] updateSelection - channelRef exists:", !!channelRef.current)

      if (!channelRef.current) {
        console.error("[v0] updateSelection FAILED - channel not ready")
        return
      }

      console.log("[v0] updateSelection - broadcasting to channel...")

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

        console.log("[v0] updateSelection - broadcast result:", broadcastResult)
      } catch (error) {
        console.error("[v0] updateSelection - broadcast error:", error)
      }

      if (presenceId) {
        console.log("[v0] updateSelection - updating database...")
        const { error } = await supabase
          .from("user_presence")
          .update({
            selected_object_ids: selectedObjectIds,
            last_seen: new Date().toISOString(),
          })
          .eq("id", presenceId)

        if (error) {
          console.error("[v0] updateSelection - database error:", error)
        } else {
          console.log("[v0] updateSelection - database updated successfully")
        }
      } else {
        console.warn("[v0] updateSelection - presenceId is null, skipping database update")
      }

      console.log("[v0] updateSelection END")
    },
    [userId, userName, userColor, presenceId, supabase],
  )

  return {
    otherUsers: Array.from(otherUsers.values()),
    updateCursor,
    updateSelection,
  }
}
