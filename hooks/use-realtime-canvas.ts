"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface UseRealtimeCanvasProps {
  canvasId: string
  userId: string
  onConnectionChange?: (connected: boolean, queuedOps: number) => void
}

interface QueuedOperation {
  type: "create" | "update" | "delete"
  object?: CanvasObject
  objectId?: string
  timestamp: number
}

export function useRealtimeCanvas({ canvasId, userId, onConnectionChange }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const supabase = createClient()

  const syncTimeoutRef = useRef<NodeJS.Timeout>()
  const pendingObjectsRef = useRef<CanvasObject[]>([])
  const channelRef = useRef<RealtimeChannel>()
  const operationQueueRef = useRef<QueuedOperation[]>([])
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()

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

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    for (const op of queue) {
      try {
        if (op.type === "create" && op.object) {
          await supabase.from("canvas_objects").insert({
            ...op.object,
            created_by: userId,
          })
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: { ...op.object, _timestamp: Date.now() },
          })
        } else if (op.type === "update" && op.object) {
          await supabase
            .from("canvas_objects")
            .update({
              x: op.object.x,
              y: op.object.y,
              width: op.object.width,
              height: op.object.height,
              rotation: op.object.rotation,
              fill_color: op.object.fill_color,
              stroke_color: op.object.stroke_color,
              stroke_width: op.object.stroke_width,
              text_content: op.object.text_content,
              font_size: op.object.font_size,
              font_family: op.object.font_family,
              updated_at: new Date().toISOString(),
            })
            .eq("id", op.object.id)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...op.object, _timestamp: Date.now() },
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: { id: op.objectId, _timestamp: Date.now() },
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
      }
    }

    console.log("[v0] [RECONNECT] All queued operations processed")
    onConnectionChange?.(true, 0)
  }, [supabase, userId, onConnectionChange])

  const attemptReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000) // Max 30s
    console.log(`[v0] [RECONNECT] Attempting reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`)

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptRef.current++

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }

      setupChannel()
    }, delay)
  }, [supabase])

  const setupChannel = useCallback(() => {
    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }

        setObjects((prev) => {
          if (prev.some((obj) => obj.id === payload.id)) return prev
          return [...prev, payload as CanvasObject]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        setObjects((prev) => prev.map((obj) => (obj.id === payload.id ? (payload as CanvasObject) : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }

        setObjects((prev) => prev.filter((obj) => obj.id !== payload.id))
      })
      .subscribe((status) => {
        console.log("[v0] [RECONNECT] Channel status:", status)

        if (status === "SUBSCRIBED") {
          console.log("[v0] [RECONNECT] Connected successfully")
          setIsConnected(true)
          reconnectAttemptRef.current = 0
          processQueuedOperations()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.log("[v0] [RECONNECT] Connection lost, will retry")
          setIsConnected(false)
          onConnectionChange?.(false, operationQueueRef.current.length)
          attemptReconnect()
        }
      })

    channelRef.current = channel
  }, [canvasId, supabase, processQueuedOperations, attemptReconnect, onConnectionChange])

  useEffect(() => {
    setupChannel()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [setupChannel, supabase])

  const debouncedDatabaseSync = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      if (!isConnected) {
        console.log("[v0] [RECONNECT] Offline - operations will be queued")
        return
      }

      const dbWriteStart = performance.now()

      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      // Handle new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        try {
          await supabase.from("canvas_objects").insert(
            newObjects.map((o) => ({
              ...o,
              created_by: userId,
            })),
          )
        } catch (error) {
          console.error("[v0] [RECONNECT] Database write failed, queueing operations")
          newObjects.forEach((obj) => {
            operationQueueRef.current.push({
              type: "create",
              object: obj,
              timestamp: Date.now(),
            })
          })
          onConnectionChange?.(false, operationQueueRef.current.length)
        }
      }

      // Handle updated objects
      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
          try {
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
                text_content: obj.text_content,
                font_size: obj.font_size,
                font_family: obj.font_family,
                updated_at: new Date().toISOString(),
              })
              .eq("id", obj.id)
          } catch (error) {
            console.error("[v0] [RECONNECT] Database update failed, queueing operation")
            operationQueueRef.current.push({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
            onConnectionChange?.(false, operationQueueRef.current.length)
          }
        }
      }

      // Handle deleted objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        try {
          await supabase.from("canvas_objects").delete().in("id", deletedIds)
        } catch (error) {
          console.error("[v0] [RECONNECT] Database delete failed, queueing operations")
          deletedIds.forEach((id) => {
            operationQueueRef.current.push({
              type: "delete",
              objectId: id,
              timestamp: Date.now(),
            })
          })
          onConnectionChange?.(false, operationQueueRef.current.length)
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [objects, supabase, userId, isConnected, onConnectionChange],
  )

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()

      // Update local state immediately
      setObjects(updatedObjects)

      // Store pending objects for debounced database sync
      pendingObjectsRef.current = updatedObjects

      const existingIds = new Set(objects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
        newObjects.forEach((obj) => {
          operationQueueRef.current.push({
            type: "create",
            object: obj,
            timestamp: Date.now(),
          })
        })

        const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
        toUpdate.forEach((obj) => {
          const existing = objects.find((o) => o.id === obj.id)
          if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
            operationQueueRef.current.push({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
          }
        })

        const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
        deletedIds.forEach((id) => {
          operationQueueRef.current.push({
            type: "delete",
            objectId: id,
            timestamp: Date.now(),
          })
        })

        onConnectionChange?.(false, operationQueueRef.current.length)
        return
      }

      const timestamp = Date.now()

      // Broadcast new objects
      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      for (const obj of newObjects) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: { ...obj, _timestamp: timestamp },
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
            payload: { ...obj, _timestamp: timestamp },
          })
        }
      }

      // Broadcast deleted objects
      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      for (const id of deletedIds) {
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: { id, _timestamp: timestamp },
        })
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${newObjects.length + toUpdate.length + deletedIds.length} operations)`,
      )

      // Debounce database writes (300ms after last change)
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)
    },
    [objects, debouncedDatabaseSync, isConnected, onConnectionChange],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
