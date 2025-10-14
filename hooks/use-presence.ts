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

export function usePresence({ canvasId, userId, userName, userColor }: UsePresenceProps) {
  const [otherUsers, setOtherUsers] = useState<Map<string, UserPresence>>(new Map())
  const supabase = createClient()
  const [presenceId, setPresenceId] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Initialize presence
  useEffect(() => {
    async function initPresence() {
      // Insert presence record (without cursor position - that's handled by broadcast)
      const { data, error } = await supabase
        .from("user_presence")
        .insert({
          canvas_id: canvasId,
          user_id: userId,
          user_name: userName,
          color: userColor,
          cursor_x: 0,
          cursor_y: 0,
        })
        .select()
        .single()

      if (error) {
        console.error("[v0] Error creating presence:", error)
        return
      }

      setPresenceId(data.id)
    }

    initPresence()

    // Cleanup on unmount
    return () => {
      if (presenceId) {
        supabase.from("user_presence").delete().eq("id", presenceId).then()
      }
    }
  }, [canvasId, userId, userName, userColor, supabase])

  useEffect(() => {
    async function loadPresence() {
      const { data } = await supabase.from("user_presence").select("*").eq("canvas_id", canvasId).neq("user_id", userId)

      const userMap = new Map<string, UserPresence>()
      data?.forEach((user) => {
        userMap.set(user.user_id, user)
      })
      setOtherUsers(userMap)
    }

    loadPresence()

    const channel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorUpdate }) => {
        if (payload.userId === userId) return

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
            last_seen: new Date().toISOString(),
          })

          return newMap
        })
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_presence",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT" && payload.new.user_id !== userId) {
            setOtherUsers((prev) => {
              const newMap = new Map(prev)
              newMap.set(payload.new.user_id, payload.new as UserPresence)
              return newMap
            })
          } else if (payload.eventType === "DELETE") {
            setOtherUsers((prev) => {
              const newMap = new Map(prev)
              newMap.delete(payload.old.user_id)
              return newMap
            })
          }
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [canvasId, userId, supabase])

  const updateCursor = useCallback(
    (x: number, y: number) => {
      if (!channelRef.current) return

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
    },
    [userId, userName, userColor],
  )

  return {
    otherUsers: Array.from(otherUsers.values()),
    updateCursor,
  }
}
