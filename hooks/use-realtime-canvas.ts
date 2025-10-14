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

  useEffect(() => {
    console.log("[v0] Setting up broadcast subscription for canvas:", canvasId)

    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        console.log("[v0] Object created:", payload)
        setObjects((prev) => {
          // Avoid duplicates
          if (prev.some((obj) => obj.id === payload.id)) return prev
          return [...prev, payload as CanvasObject]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        console.log("[v0] Object updated:", payload)
        setObjects((prev) => prev.map((obj) => (obj.id === payload.id ? (payload as CanvasObject) : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        console.log("[v0] Object deleted:", payload)
        setObjects((prev) => prev.filter((obj) => obj.id !== payload.id))
      })
      .subscribe((status) => {
        console.log("[v0] Broadcast subscription status:", status)
        if (status === "SUBSCRIBED") {
          console.log("[v0] Successfully subscribed to broadcast updates")
        }
      })

    return () => {
      console.log("[v0] Cleaning up broadcast subscription")
      supabase.removeChannel(channel)
    }
  }, [canvasId, supabase])

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      console.log("[v0] Syncing", updatedObjects.length, "objects to database")

      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      // Handle new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        console.log("[v0] Inserting", newObjects.length, "new objects")
        const { error } = await supabase.from("canvas_objects").insert(
          newObjects.map((o) => ({
            ...o,
            created_by: userId,
          })),
        )
        if (error) {
          console.error("[v0] Error inserting objects:", error)
        } else {
          console.log("[v0] Successfully inserted new objects")
          // Broadcast to other clients
          for (const obj of newObjects) {
            await supabase.channel(`canvas:${canvasId}`).send({
              type: "broadcast",
              event: "object_created",
              payload: obj,
            })
          }
        }
      }

      // Handle updated objects
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

          if (error) {
            console.error("[v0] Error updating object:", error)
          } else {
            console.log("[v0] Successfully updated object")
            // Broadcast to other clients
            await supabase.channel(`canvas:${canvasId}`).send({
              type: "broadcast",
              event: "object_updated",
              payload: obj,
            })
          }
        }
      }

      // Handle deleted objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        console.log("[v0] Deleting", deletedIds.length, "objects")
        const { error } = await supabase.from("canvas_objects").delete().in("id", deletedIds)
        if (error) {
          console.error("[v0] Error deleting objects:", error)
        } else {
          console.log("[v0] Successfully deleted objects")
          // Broadcast to other clients
          for (const id of deletedIds) {
            await supabase.channel(`canvas:${canvasId}`).send({
              type: "broadcast",
              event: "object_deleted",
              payload: { id },
            })
          }
        }
      }

      // Update local state
      setObjects(updatedObjects)
    },
    [objects, supabase, userId, canvasId],
  )

  return {
    objects,
    isLoading,
    syncObjects,
  }
}
