"use client"

import { useEffect, useState, useCallback } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { CanvasObject } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface UseRealtimeCanvasProps {
  canvasId: string
  userId: string
}

export function useRealtimeCanvas({ canvasId, userId }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = getSupabaseBrowserClient()

  // Load initial objects from database
  useEffect(() => {
    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        return
      }

      setObjects(data || [])
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase])

  // Subscribe to real-time changes
  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "canvas_objects",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          console.log("[v0] Real-time INSERT:", payload)
          setObjects((prev) => [...prev, payload.new as CanvasObject])
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "canvas_objects",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          console.log("[v0] Real-time UPDATE:", payload)
          setObjects((prev) => prev.map((obj) => (obj.id === payload.new.id ? (payload.new as CanvasObject) : obj)))
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "canvas_objects",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          console.log("[v0] Real-time DELETE:", payload)
          setObjects((prev) => prev.filter((obj) => obj.id !== payload.old.id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [canvasId, supabase])

  // Sync objects to database
  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      setObjects(updatedObjects)

      // Find new, updated, and deleted objects
      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      // Insert new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        const { error } = await supabase.from("canvas_objects").insert(
          newObjects.map((o) => ({
            ...o,
            created_by: userId,
          })),
        )
        if (error) console.error("[v0] Error inserting objects:", error)
      }

      // Update existing objects
      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
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
        }
      }

      // Delete removed objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        const { error } = await supabase.from("canvas_objects").delete().in("id", deletedIds)
        if (error) console.error("[v0] Error deleting objects:", error)
      }
    },
    [objects, supabase, userId],
  )

  return {
    objects,
    isLoading,
    syncObjects,
  }
}
