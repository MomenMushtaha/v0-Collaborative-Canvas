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
  _timestamp?: number
}

export function usePresence({ canvasId, userId, userName, userColor }: UsePresenceProps) {
  const [otherUsers, setOtherUsers] = useState<Map<string, UserPresence>>(new Map())
  const supabase = createClient()
  const [presenceId, setPresenceId] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number | null>(null)

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
    const presenceInterval = setInterval(loadPresence, 5000)

    console.log("[v0] Setting up cursor broadcast channel for canvas:", canvasId)
    const channel = supabase
      .channel(`canvas:${canvasId}:cursors`, {
        config: {
          broadcast: { self: false }, // Don't receive own broadcasts
        },
      })
      .on("broadcast", { event: "cursor" }, ({ payload }: { payload: CursorUpdate }) => {
        if (payload._timestamp) {
          const latency = Date.now() - payload._timestamp
          console.log(`[v0] [PERF] Cursor sync latency: ${latency}ms`)
        }

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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
      pendingCursorRef.current = null
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [canvasId, userId, userName, supabase])

  const updateCursor = useCallback(
    (x: number, y: number) => {
      pendingCursorRef.current = { x, y }

      if (rafRef.current !== null) {
        return
      }

      rafRef.current = requestAnimationFrame(() => {
        const pending = pendingCursorRef.current
        pendingCursorRef.current = null
        rafRef.current = null

        if (!pending) return

        if (!channelRef.current) {
          console.warn("[v0] Cannot send cursor update: channel not ready")
          return
        }

        console.log("[v0] Broadcasting cursor position:", pending.x, pending.y, "for user:", userName)
        channelRef.current.send({
          type: "broadcast",
          event: "cursor",
          payload: {
            userId,
            userName,
            color: userColor,
            x: pending.x,
            y: pending.y,
            _timestamp: Date.now(),
          } as CursorUpdate,
        })
      })
    },
    [userId, userName, userColor],
  )

  return {
    otherUsers: Array.from(otherUsers.values()),
    updateCursor,
  }
}
