"use client"

import { useEffect, useState, useCallback, useRef } from "react"
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

  const syncTimeoutRef = useRef<NodeJS.Timeout>()
  const pendingObjectsRef = useRef<CanvasObject[]>([])
  const channelRef = useRef<RealtimeChannel>()

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

  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        setObjects((prev) => {
          if (prev.some((obj) => obj.id === payload.id)) return prev
          return [...prev, payload as CanvasObject]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        setObjects((prev) => prev.map((obj) => (obj.id === payload.id ? (payload as CanvasObject) : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        setObjects((prev) => prev.filter((obj) => obj.id !== payload.id))
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [canvasId, supabase])

  const debouncedDatabaseSync = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      // Handle new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        await supabase.from("canvas_objects").insert(
          newObjects.map((o) => ({
            ...o,
            created_by: userId,
          })),
        )
      }

      // Handle updated objects (batch update)
      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
          await supabase
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
        }
      }

      // Handle deleted objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        await supabase.from("canvas_objects").delete().in("id", deletedIds)
      }
    },
    [objects, supabase, userId],
  )

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      // Update local state immediately
      setObjects(updatedObjects)

      // Store pending objects for debounced database sync
      pendingObjectsRef.current = updatedObjects

      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      // Broadcast changes immediately for real-time sync (<100ms)
      const channel = channelRef.current
      if (!channel) return

      // Broadcast new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      for (const obj of newObjects) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: obj,
        })
      }

      // Broadcast updated objects
      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
          channel.send({
            type: "broadcast",
            event: "object_updated",
            payload: obj,
          })
        }
      }

      // Broadcast deleted objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      for (const id of deletedIds) {
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: { id },
        })
      }

      // Debounce database writes (300ms after last change)
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)
    },
    [objects, debouncedDatabaseSync],
  )

  return {
    objects,
    isLoading,
    syncObjects,
  }
}
