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
  const onConnectionChangeRef = useRef(onConnectionChange)
  const lastStatusRef = useRef<string>("")
  const objectsRef = useRef<CanvasObject[]>([])
  const persistedObjectsRef = useRef<Map<string, CanvasObject>>(new Map())
  const lastUpdateTimestampRef = useRef<Map<string, number>>(new Map())

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
      persistedObjectsRef.current = new Map(initialObjects.map((object) => [object.id, object]))
      lastUpdateTimestampRef.current = new Map(
        initialObjects.map((object) => {
          const parsed = Date.parse(object.updated_at ?? object.created_at ?? "")
          return [object.id, Number.isNaN(parsed) ? Date.now() : parsed]
        }),
      )
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase])

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    for (let i = 0; i < queue.length; i++) {
      const op = queue[i]
      try {
        if (op.type === "create" && op.object) {
          const { data: inserted, error: insertError } = await supabase
            .from("canvas_objects")
            .insert({
              ...op.object,
              created_by: userId,
            })
            .select()

          if (insertError) {
            throw insertError
          }

          const createdObject = inserted?.[0] ?? op.object
          persistedObjectsRef.current.set(createdObject.id, createdObject)
          lastUpdateTimestampRef.current.set(createdObject.id, Date.now())
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: { ...createdObject, _timestamp: Date.now(), _source: userId },
          })
        } else if (op.type === "update" && op.object) {
          const updates = {
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
            z: op.object.z,
            shape: op.object.shape,
            content: op.object.content,
            updated_at: new Date().toISOString(),
          }

          const { data: updated, error: updateError } = await supabase
            .from("canvas_objects")
            .update(updates)
            .eq("id", op.object.id)
            .select()

          if (updateError) {
            throw updateError
          }

          const persistedObject = { ...op.object, ...(updated?.[0] ?? {}), ...updates }
          persistedObjectsRef.current.set(op.object.id, persistedObject)
          lastUpdateTimestampRef.current.set(op.object.id, Date.now())
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...persistedObject, _timestamp: Date.now(), _source: userId },
          })
        } else if (op.type === "delete" && op.objectId) {
          const { error: deleteError } = await supabase.from("canvas_objects").delete().eq("id", op.objectId)

          if (deleteError) {
            throw deleteError
          }

          persistedObjectsRef.current.delete(op.objectId)
          lastUpdateTimestampRef.current.set(op.objectId, Date.now())
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: { id: op.objectId, _timestamp: Date.now(), _source: userId },
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
        operationQueueRef.current = [op, ...queue.slice(i + 1)]
        onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        break
      }
    }

    if (operationQueueRef.current.length === 0) {
      console.log("[v0] [RECONNECT] All queued operations processed")
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
    function shouldApplyUpdate(objectId: string, timestamp?: number) {
      if (!timestamp) return true
      const lastTimestamp = lastUpdateTimestampRef.current.get(objectId)
      if (!lastTimestamp || timestamp > lastTimestamp) {
        lastUpdateTimestampRef.current.set(objectId, timestamp)
        return true
      }
      return false
    }

    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        const { _timestamp, _source, ...object } = payload as CanvasObject & { _timestamp?: number; _source?: string }
        const timestamp = _timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }

        if (_source === userId) {
          if (object.id && timestamp) {
            lastUpdateTimestampRef.current.set(object.id, timestamp)
          }
          return
        }

        if (!object.id || !shouldApplyUpdate(object.id, timestamp)) {
          return
        }

        persistedObjectsRef.current.set(object.id, object)

        setObjects((prev) => {
          if (prev.some((obj) => obj.id === object.id)) {
            return prev.map((obj) => (obj.id === object.id ? object : obj))
          }
          return [...prev, object]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const { _timestamp, _source, ...object } = payload as CanvasObject & { _timestamp?: number; _source?: string }
        const timestamp = _timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        if (_source === userId) {
          if (object.id && timestamp) {
            lastUpdateTimestampRef.current.set(object.id, timestamp)
          }
          return
        }

        if (!object.id || !shouldApplyUpdate(object.id, timestamp)) {
          return
        }

        persistedObjectsRef.current.set(object.id, object)

        setObjects((prev) => prev.map((obj) => (obj.id === object.id ? object : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const { id, _timestamp, _source } = payload as { id: string; _timestamp?: number; _source?: string }
        const timestamp = _timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }

        if (_source === userId) {
          if (id && timestamp) {
            lastUpdateTimestampRef.current.set(id, timestamp)
          }
          return
        }

        if (!id || !shouldApplyUpdate(id, timestamp)) {
          return
        }

        persistedObjectsRef.current.delete(id)
        setObjects((prev) => prev.filter((obj) => obj.id !== id))
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
  }, [canvasId, supabase, processQueuedOperations, attemptReconnect, userId])

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

      const persistedMap = persistedObjectsRef.current
      const updatedMap = new Map(updatedObjects.map((object) => [object.id, object]))

      const newObjects = updatedObjects.filter((object) => !persistedMap.has(object.id))
      if (newObjects.length > 0) {
        try {
          const { data: inserted, error } = await supabase
            .from("canvas_objects")
            .insert(
              newObjects.map((object) => ({
                id: object.id,
                canvas_id: object.canvas_id,
                type: object.type,
                x: object.x,
                y: object.y,
                width: object.width,
                height: object.height,
                rotation: object.rotation ?? 0,
                fill_color: object.fill_color,
                stroke_color: object.stroke_color,
                stroke_width: object.stroke_width ?? 1,
                text_content: object.text_content,
                font_size: object.font_size,
                font_family: object.font_family,
                visible: object.visible ?? true,
                locked: object.locked ?? false,
                parent_group: object.parent_group,
                children_ids: object.children_ids ?? [],
                z: object.z ?? 0,
                shape: object.shape,
                content: object.content,
                created_by: userId,
              })),
            )
            .select()

          if (error) {
            console.error("[v0] [DB] Insert error:", error)
            throw error
          }

          console.log(`[v0] [DB] Successfully inserted ${newObjects.length} object(s)`)

          newObjects.forEach((object) => {
            const rawPersisted = inserted?.find((item) => item.id === object.id)
            const persistedRecord = { ...object, ...(rawPersisted ?? {}) } as CanvasObject
            if (persistedRecord.id) {
              persistedMap.set(persistedRecord.id, persistedRecord)
              lastUpdateTimestampRef.current.set(persistedRecord.id, Date.now())
            }
          })
        } catch (error) {
          console.error("[v0] [RECONNECT] Database write failed, queueing operations", error)
          newObjects.forEach((obj) => {
            operationQueueRef.current.push({
              type: "create",
              object: obj,
              timestamp: Date.now(),
            })
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          return // Return early to prevent processing updates/deletes if inserts failed
        }
      }

      const toUpdate = updatedObjects.filter((object) => {
        const persisted = persistedMap.get(object.id)
        if (!persisted) return false

        const fieldsToCompare: (keyof CanvasObject)[] = [
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
          "z",
          "shape",
          "content",
        ]

        return fieldsToCompare.some((field) => {
          const persistedValue = persisted[field]
          const updatedValue = object[field]

          if (Array.isArray(persistedValue) || Array.isArray(updatedValue)) {
            return JSON.stringify(persistedValue ?? []) !== JSON.stringify(updatedValue ?? [])
          }

          return persistedValue !== updatedValue
        })
      })
      for (const obj of toUpdate) {
        try {
          const updates = {
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
            z: obj.z,
            shape: obj.shape,
            content: obj.content,
            updated_at: new Date().toISOString(),
          }

          const { error } = await supabase.from("canvas_objects").update(updates).eq("id", obj.id)

          if (error) {
            throw error
          }

          const persisted = { ...persistedMap.get(obj.id), ...obj, ...updates }
          persistedMap.set(obj.id, persisted)
          lastUpdateTimestampRef.current.set(obj.id, Date.now())
        } catch (error) {
          console.error("[v0] [RECONNECT] Database update failed, queueing operation")
          operationQueueRef.current.push({
            type: "update",
            object: obj,
            timestamp: Date.now(),
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const deletedIds = Array.from(persistedMap.keys()).filter((id) => !updatedMap.has(id))
      if (deletedIds.length > 0) {
        try {
          const { error } = await supabase.from("canvas_objects").delete().in("id", deletedIds)

          if (error) {
            throw error
          }

          deletedIds.forEach((id) => {
            persistedMap.delete(id)
            lastUpdateTimestampRef.current.set(id, Date.now())
          })
        } catch (error) {
          console.error("[v0] [RECONNECT] Database delete failed, queueing operation")
          deletedIds.forEach((id) => {
            operationQueueRef.current.push({
              type: "delete",
              objectId: id,
              timestamp: Date.now(),
            })
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [supabase, userId, isConnected],
  )

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()

      const previousObjects = objectsRef.current
      const previousIds = new Set(previousObjects.map((object) => object.id))
      const updatedIds = new Set(updatedObjects.map((object) => object.id))

      objectsRef.current = updatedObjects
      setObjects(updatedObjects)

      pendingObjectsRef.current = updatedObjects

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        const newObjects = updatedObjects.filter((object) => !previousIds.has(object.id))
        newObjects.forEach((obj) => {
          operationQueueRef.current.push({
            type: "create",
            object: obj,
            timestamp: Date.now(),
          })
        })

        const toUpdate = updatedObjects.filter((object) => previousIds.has(object.id))
        toUpdate.forEach((obj) => {
          const existing = previousObjects.find((prev) => prev.id === obj.id)
          if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
            operationQueueRef.current.push({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
          }
        })

        const deletedIds = Array.from(previousIds).filter((id) => !updatedIds.has(id))
        deletedIds.forEach((id) => {
          operationQueueRef.current.push({
            type: "delete",
            objectId: id,
            timestamp: Date.now(),
          })
        })

        onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        return
      }

      const timestamp = Date.now()

      const newObjects = updatedObjects.filter((object) => !previousIds.has(object.id))
      for (const obj of newObjects) {
        lastUpdateTimestampRef.current.set(obj.id, timestamp)
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: { ...obj, _timestamp: timestamp, _source: userId },
        })
      }

      const toUpdate = updatedObjects.filter((object) => previousIds.has(object.id))
      for (const obj of toUpdate) {
        const existing = previousObjects.find((o) => o.id === obj.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
          lastUpdateTimestampRef.current.set(obj.id, timestamp)
          channel.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...obj, _timestamp: timestamp, _source: userId },
          })
        }
      }

      const deletedIds = Array.from(previousIds).filter((id) => !updatedIds.has(id))
      for (const id of deletedIds) {
        lastUpdateTimestampRef.current.set(id, timestamp)
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: { id, _timestamp: timestamp, _source: userId },
        })
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${newObjects.length + toUpdate.length + deletedIds.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)
    },
    [debouncedDatabaseSync, isConnected, userId],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
