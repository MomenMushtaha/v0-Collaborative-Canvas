"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface UseRealtimeCanvasProps {
  canvasId: string
  userId: string
}

export function useRealtimeCanvas({ canvasId, userId }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [realtimeError, setRealtimeError] = useState<string | null>(null)
  const supabase = createClient()

  // Load initial objects from database
  useEffect(() => {
    async function loadObjects() {
      console.log("[v0] Loading initial canvas objects for canvas:", canvasId)
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        return
      }

      console.log("[v0] Loaded", data?.length || 0, "objects")
      setObjects(data || [])
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase])

  // Subscribe to real-time changes
  useEffect(() => {
    console.log("[v0] Setting up real-time subscription for canvas:", canvasId)

    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: userId },
        },
      })
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "canvas_objects",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          console.log("[v0] Real-time event received:", payload.eventType, payload)

          if (payload.eventType === "INSERT") {
            setObjects((prev) => [...prev, payload.new as CanvasObject])
          } else if (payload.eventType === "UPDATE") {
            setObjects((prev) => prev.map((obj) => (obj.id === payload.new.id ? (payload.new as CanvasObject) : obj)))
          } else if (payload.eventType === "DELETE") {
            setObjects((prev) => prev.filter((obj) => obj.id !== payload.old.id))
          }
        },
      )
      .subscribe((status, err) => {
        console.log("[v0] Real-time subscription status:", status)

        if (status === "SUBSCRIBED") {
          console.log("[v0] Successfully subscribed to real-time updates")
          setRealtimeError(null)
        } else if (status === "CHANNEL_ERROR") {
          const errorMsg = "Realtime not enabled. Please enable replication in Supabase dashboard."
          console.error("[v0]", errorMsg, err)
          setRealtimeError(errorMsg)
        } else if (status === "TIMED_OUT") {
          console.error("[v0] Real-time subscription timed out")
          setRealtimeError("Connection timed out. Retrying...")
        } else if (status === "CLOSED") {
          console.log("[v0] Real-time subscription closed")
        }
      })

    return () => {
      console.log("[v0] Cleaning up real-time subscription")
      supabase.removeChannel(channel)
    }
  }, [canvasId, supabase, userId])

  // Sync objects to database
  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      console.log("[v0] Syncing", updatedObjects.length, "objects to database")
      setObjects(updatedObjects)

      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        console.log("[v0] Inserting", newObjects.length, "new objects")
        const { error } = await supabase.from("canvas_objects").insert(
          newObjects.map((o) => ({
            ...o,
            created_by: userId,
          })),
        )
        if (error) console.error("[v0] Error inserting objects:", error)
        else console.log("[v0] Successfully inserted new objects")
      }

      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
          console.log("[v0] Updating object:", obj.id)
          const { error } = await supabase
            .from("canvas_objects")
            .update({
              x: obj.x,
              y: obj.y,
              width: obj.width,
              height: obj.height,
              rotation: obj.rotation,
              fill_color: obj.fill_color,
              stroke_color: obj.stroke_color,
              stroke_width: obj.stroke_width,
              updated_at: new Date().toISOString(),
            })
            .eq("id", obj.id)

          if (error) console.error("[v0] Error updating object:", error)
          else console.log("[v0] Successfully updated object")
        }
      }

      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        console.log("[v0] Deleting", deletedIds.length, "objects")
        const { error } = await supabase.from("canvas_objects").delete().in("id", deletedIds)
        if (error) console.error("[v0] Error deleting objects:", error)
        else console.log("[v0] Successfully deleted objects")
      }
    },
    [objects, supabase, userId],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    realtimeError,
  }
}
