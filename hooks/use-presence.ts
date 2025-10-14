"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { UserPresence } from "@/lib/types"

interface UsePresenceProps {
  canvasId: string
  userId: string
  userName: string
  userColor: string
}

export function usePresence({ canvasId, userId, userName, userColor }: UsePresenceProps) {
  const [otherUsers, setOtherUsers] = useState<UserPresence[]>([])
  const supabase = createClient()
  const [presenceId, setPresenceId] = useState<string | null>(null)

  // Initialize presence
  useEffect(() => {
    async function initPresence() {
      // Insert presence record
      const { data, error } = await supabase
        .from("user_presence")
        .insert({
          canvas_id: canvasId,
          user_id: userId,
          user_name: userName,
          color: userColor,
          cursor_x: null,
          cursor_y: null,
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

  // Subscribe to other users' presence
  useEffect(() => {
    async function loadPresence() {
      const { data } = await supabase.from("user_presence").select("*").eq("canvas_id", canvasId).neq("user_id", userId)

      setOtherUsers(data || [])
    }

    loadPresence()

    const channel = supabase
      .channel(`presence:${canvasId}`)
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
            setOtherUsers((prev) => [...prev, payload.new as UserPresence])
          } else if (payload.eventType === "UPDATE" && payload.new.user_id !== userId) {
            setOtherUsers((prev) =>
              prev.map((user) => (user.id === payload.new.id ? (payload.new as UserPresence) : user)),
            )
          } else if (payload.eventType === "DELETE") {
            setOtherUsers((prev) => prev.filter((user) => user.id !== payload.old.id))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [canvasId, userId, supabase])

  // Update cursor position
  const updateCursor = useCallback(
    async (x: number, y: number) => {
      if (!presenceId) return

      await supabase
        .from("user_presence")
        .update({
          cursor_x: x,
          cursor_y: y,
          last_seen: new Date().toISOString(),
        })
        .eq("id", presenceId)
    },
    [presenceId, supabase],
  )

  return {
    otherUsers,
    updateCursor,
  }
}
