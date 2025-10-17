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
  sentAt: number
}

export function usePresence({ canvasId, userId, userName, userColor }: UsePresenceProps) {
  const [otherUsers, setOtherUsers] = useState<Map<string, UserPresence>>(new Map())
  const supabase = createClient()
  const presenceIdRef = useRef<string | null>(null)
  const heartbeatRef = useRef<NodeJS.Timeout>()
  const lastCursorBroadcastRef = useRef<number>(0)
  const lastPresenceUpdateRef = useRef<number>(0)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const CURSOR_THROTTLE_MS = 16
  const HEARTBEAT_INTERVAL_MS = 5000
  const PRESENCE_REFRESH_MS = 5000

  const cleanupPresence = useCallback(() => {
    const presenceId = presenceIdRef.current
    if (!presenceId) return

    console.log("[v0] Cleaning up presence:", presenceId)
    supabase.from("user_presence").delete().eq("id", presenceId).then(() => {
      presenceIdRef.current = null
    })
  }, [supabase])

  // Initialize presence
  useEffect(() => {
    async function initPresence() {
      console.log("[v0] Initializing presence for user:", userName, userId)

       await supabase.from("user_presence").delete().eq("canvas_id", canvasId).eq("user_id", userId)

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

      console.log("[v0] Presence created successfully:", data.id)
      presenceIdRef.current = data.id

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }

      heartbeatRef.current = setInterval(() => {
        if (!presenceIdRef.current) return
        supabase
          .from("user_presence")
          .update({ last_seen: new Date().toISOString() })
          .eq("id", presenceIdRef.current)
          .catch((err) => console.warn("[v0] Failed heartbeat update", err))
      }, HEARTBEAT_INTERVAL_MS)
    }

    initPresence()

    // Cleanup on unmount
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }
      cleanupPresence()
    }
  }, [canvasId, cleanupPresence, supabase, userColor, userId, userName])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleBeforeUnload = () => cleanupPresence()
    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [cleanupPresence])

  useEffect(() => {
    async function loadPresence() {
      const { data } = await supabase.from("user_presence").select("*").eq("canvas_id", canvasId).neq("user_id", userId)

      console.log("[v0] Loaded other users:", data?.length || 0)
      const userMap = new Map<string, UserPresence>()

      data?.forEach((user) => {
        const existing = userMap.get(user.user_id)
        // Only add/update if this is a newer record or first time seeing this user
        if (!existing || new Date(user.last_seen) > new Date(existing.last_seen)) {
          console.log("[v0] Other user:", user.user_name, user.user_id)
          userMap.set(user.user_id, user)
        }
      })

      setOtherUsers(userMap)
    }

    loadPresence()

    // Refresh presence list every 5 seconds to detect new users
    const presenceInterval = setInterval(loadPresence, PRESENCE_REFRESH_MS)

    console.log("[v0] Setting up cursor broadcast channel for canvas:", canvasId)
    const channel = supabase
      .channel(`canvas:${canvasId}:cursors`, {
        config: {
          broadcast: { self: false }, // Don't receive own broadcasts
        },
      })
      .on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorUpdate }) => {
        const latency = Math.max(0, Date.now() - payload.sentAt)
        console.log(
          "[v0] Received cursor broadcast from:",
          payload.userName,
          "at",
          payload.x,
          payload.y,
          `(${latency}ms)`,
        )

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

          console.log("[v0] Updated cursor for user:", payload.userName, "total users:", newMap.size)
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
    (x: number, y: number) => {
      if (!channelRef.current) {
        console.warn("[v0] Cannot send cursor update: channel not ready")
        return
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now()
      if (now - lastCursorBroadcastRef.current < CURSOR_THROTTLE_MS) {
        return
      }

      lastCursorBroadcastRef.current = now

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
          sentAt: Date.now(),
        } as CursorUpdate,
      })

      if (presenceIdRef.current) {
        const lastUpdate = lastPresenceUpdateRef.current
        if (now - lastUpdate > 1000) {
          supabase
            .from("user_presence")
            .update({
              cursor_x: x,
              cursor_y: y,
              last_seen: new Date().toISOString(),
            })
            .eq("id", presenceIdRef.current)
            .catch((err) => console.warn("[v0] Failed to update presence cursor", err))
          lastPresenceUpdateRef.current = now
        }
      }
    },
    [CURSOR_THROTTLE_MS, userColor, userId, userName, supabase],
  )

  return {
    otherUsers: Array.from(otherUsers.values()),
    updateCursor,
  }
}
