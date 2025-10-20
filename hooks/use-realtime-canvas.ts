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

const SYNC_DEBOUNCE_MS = 80

const objectKeysToPersist: (keyof CanvasObject)[] = [
  "id",
  "canvas_id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "fill_color",
  "stroke_color",
  "stroke_width",
  "text_content",
  "font_size",
  "font_family",
  "visible",
  "locked",
  "parent_group",
  "children_ids",
]

function hasObjectChanged(a: CanvasObject | undefined, b: CanvasObject | undefined) {
  if (!a || !b) return false

  return objectKeysToPersist.some((key) => {
    const aValue = a[key]
    const bValue = b[key]

    if (Array.isArray(aValue) || Array.isArray(bValue)) {
      return JSON.stringify(aValue) !== JSON.stringify(bValue)
    }

    return aValue !== bValue
  })
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
  const onConnectionChangeRef = useRef(onConnectionChange)
  const lastStatusRef = useRef<string>("")
  const objectsRef = useRef<CanvasObject[]>([])
  const lastPersistedRef = useRef<CanvasObject[]>([])

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange
  }, [onConnectionChange])

  useEffect(() => {
    objectsRef.current = objects
  }, [objects])

  // Load initial objects from database
  useEffect(() => {
    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        return
      }

      const initialObjects = data || []
      setObjects(initialObjects)
      objectsRef.current = initialObjects
      lastPersistedRef.current = initialObjects
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase])

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    const failedOps: QueuedOperation[] = []

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
              visible: op.object.visible,
              locked: op.object.locked,
              parent_group: op.object.parent_group,
              children_ids: op.object.children_ids,
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
        failedOps.push(op)
      }
    }

    if (failedOps.length > 0) {
      operationQueueRef.current.push(...failedOps)
      onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
    } else {
      console.log("[v0] [RECONNECT] All queued operations processed")
      lastPersistedRef.current = objectsRef.current
      onConnectionChangeRef.current?.(true, 0)
    }
  }, [supabase, userId])

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
          const next = [...prev, payload as CanvasObject]
          objectsRef.current = next
          lastPersistedRef.current = next
          return next
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        setObjects((prev) => {
          const next = prev.map((obj) => (obj.id === payload.id ? (payload as CanvasObject) : obj))
          objectsRef.current = next
          lastPersistedRef.current = next
          return next
        })
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }

        setObjects((prev) => {
          const next = prev.filter((obj) => obj.id !== payload.id)
          objectsRef.current = next
          lastPersistedRef.current = next
          return next
        })
      })
      .subscribe((status) => {
        if (status !== lastStatusRef.current) {
          console.log("[v0] [RECONNECT] Channel status:", status)
          lastStatusRef.current = status
        }

        if (status === "SUBSCRIBED") {
          console.log("[v0] [RECONNECT] Connected successfully")
          setIsConnected(true)
          reconnectAttemptRef.current = 0
          processQueuedOperations()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.log("[v0] [RECONNECT] Connection lost, will retry")
          setIsConnected(false)
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          attemptReconnect()
        }
      })

    channelRef.current = channel
  }, [canvasId, supabase, processQueuedOperations, attemptReconnect])

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

      const previousObjects = lastPersistedRef.current
      const previousIds = new Set(previousObjects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      let hadError = false
      const persistedById = new Map(previousObjects.map((obj) => [obj.id, obj]))

      const newObjects = updatedObjects.filter((o) => !previousIds.has(o.id))
      if (newObjects.length > 0) {
        try {
          await supabase.from("canvas_objects").insert(
            newObjects.map((o) => ({
              ...o,
              created_by: userId,
            })),
          )
          newObjects.forEach((obj) => {
            persistedById.set(obj.id, obj)
          })
        } catch (error) {
          console.error("[v0] [RECONNECT] Database write failed, queueing operations")
          newObjects.forEach((obj) => {
            operationQueueRef.current.push({
              type: "create",
              object: obj,
              timestamp: Date.now(),
            })
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          hadError = true
        }
      }

      const toUpdate = updatedObjects.filter((o) => previousIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = previousObjects.find((o) => o.id === obj.id)
        if (existing && hasObjectChanged(existing, obj)) {
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
                visible: obj.visible,
                locked: obj.locked,
                parent_group: obj.parent_group,
                children_ids: obj.children_ids,
                updated_at: new Date().toISOString(),
              })
              .eq("id", obj.id)
            persistedById.set(obj.id, obj)
          } catch (error) {
            console.error("[v0] [RECONNECT] Database update failed, queueing operation")
            operationQueueRef.current.push({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
            onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
            hadError = true
          }
        } else if (existing) {
          persistedById.set(obj.id, obj)
        }
      }

      const deletedObjects = previousObjects.filter((o) => !updatedIds.has(o.id))
      if (deletedObjects.length > 0) {
        try {
          await supabase
            .from("canvas_objects")
            .delete()
            .in(
              "id",
              deletedObjects.map((obj) => obj.id),
            )
          deletedObjects.forEach((obj) => {
            persistedById.delete(obj.id)
          })
        } catch (error) {
          console.error("[v0] [RECONNECT] Database delete failed, queueing operation")
          deletedObjects.forEach((obj) => {
            operationQueueRef.current.push({
              type: "delete",
              objectId: obj.id,
              timestamp: Date.now(),
            })
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          hadError = true
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedObjects.length} deleted)`,
      )

      if (!hadError) {
        lastPersistedRef.current = updatedObjects
      } else {
        lastPersistedRef.current = Array.from(persistedById.values())
      }
    },
    [supabase, userId, isConnected],
  )

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()

      const previousObjects = objectsRef.current
      setObjects(updatedObjects)

      objectsRef.current = updatedObjects
      pendingObjectsRef.current = updatedObjects

      const previousIds = new Set(previousObjects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        const newObjects = updatedObjects.filter((o) => !previousIds.has(o.id))
        newObjects.forEach((obj) => {
          operationQueueRef.current.push({
            type: "create",
            object: obj,
            timestamp: Date.now(),
          })
        })

        const toUpdate = updatedObjects.filter((o) => previousIds.has(o.id))
        toUpdate.forEach((obj) => {
          const existing = previousObjects.find((o) => o.id === obj.id)
          if (existing && hasObjectChanged(existing, obj)) {
            operationQueueRef.current.push({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
          }
        })

        const deletedObjects = previousObjects.filter((o) => !updatedIds.has(o.id))
        deletedObjects.forEach((obj) => {
          operationQueueRef.current.push({
            type: "delete",
            objectId: obj.id,
            timestamp: Date.now(),
          })
        })

        onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        return
      }

      const timestamp = Date.now()

      const newObjects = updatedObjects.filter((o) => !previousIds.has(o.id))
      for (const obj of newObjects) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: { ...obj, _timestamp: timestamp },
        })
      }

      const toUpdate = updatedObjects.filter((o) => previousIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = previousObjects.find((o) => o.id === obj.id)
        if (existing && hasObjectChanged(existing, obj)) {
          channel.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...obj, _timestamp: timestamp },
          })
        }
      }

      const deletedObjects = previousObjects.filter((o) => !updatedIds.has(o.id))
      for (const obj of deletedObjects) {
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: { id: obj.id, _timestamp: timestamp },
        })
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${newObjects.length + toUpdate.length + deletedObjects.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, SYNC_DEBOUNCE_MS)
    },
    [debouncedDatabaseSync, isConnected],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
