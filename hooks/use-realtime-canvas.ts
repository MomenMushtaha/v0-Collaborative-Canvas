"use client"

import { useEffect, useState, useCallback, useRef, useMemo } from "react"
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
  version?: number
}

interface DeleteOperationMetadata {
  id: string
  version: number
}

const MAX_QUEUE_LENGTH = 200
const DEBOUNCE_DELAY = 300
const QUEUE_STORAGE_PREFIX = "v0:canvas:op-queue"

function getQueueStorageKey(canvasId: string, userId: string) {
  return `${QUEUE_STORAGE_PREFIX}:${canvasId}:${userId}`
}

function serializeQueue(queue: QueuedOperation[]): string {
  return JSON.stringify(
    queue.map((entry) => ({
      ...entry,
      object: entry.object
        ? {
            ...entry.object,
            // Functions/undefined values are stripped by JSON.stringify but we guard explicitly
            last_synced_at: entry.object.last_synced_at ?? new Date().toISOString(),
          }
        : undefined,
    })),
  )
}

function deserializeQueue(value: string | null): QueuedOperation[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as QueuedOperation[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) =>
      typeof item === "object" && item !== null && (item.type === "delete" ? !!item.objectId : !!item.object),
    )
  } catch (error) {
    console.warn("[v0] Failed to parse queued operations from storage", error)
    return []
  }
}

function hasObjectChanged(existing: CanvasObject | undefined, updated: CanvasObject) {
  if (!existing) return true

  return (
    existing.x !== updated.x ||
    existing.y !== updated.y ||
    existing.width !== updated.width ||
    existing.height !== updated.height ||
    existing.rotation !== updated.rotation ||
    existing.fill_color !== updated.fill_color ||
    existing.stroke_color !== updated.stroke_color ||
    existing.stroke_width !== updated.stroke_width ||
    existing.text_content !== updated.text_content ||
    existing.font_size !== updated.font_size ||
    existing.font_family !== updated.font_family ||
    existing.visible !== updated.visible ||
    existing.locked !== updated.locked ||
    existing.z !== updated.z
  )
}

function applyQueuedOperation(objects: CanvasObject[], operation: QueuedOperation): CanvasObject[] {
  switch (operation.type) {
    case "create": {
      if (!operation.object) return objects
      const filtered = objects.filter((obj) => obj.id !== operation.object?.id)
      return [...filtered, operation.object]
    }
    case "update": {
      if (!operation.object) return objects
      let replaced = false
      const updated = objects.map((obj) => {
        if (obj.id !== operation.object?.id) return obj
        replaced = true
        return operation.object!
      })

      if (!replaced) {
        return [...objects, operation.object]
      }

      return updated
    }
    case "delete": {
      if (!operation.objectId) return objects
      return objects.filter((obj) => obj.id !== operation.objectId)
    }
    default:
      return objects
  }
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
  const objectVersionsRef = useRef<Map<string, number>>(new Map())
  const pendingReplayRef = useRef<QueuedOperation[] | null>(null)
  const setupChannelRef = useRef<() => void>(() => {})

  const queueStorageKey = useMemo(() => getQueueStorageKey(canvasId, userId), [canvasId, userId])

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange
  }, [onConnectionChange])

  const notifyConnectionChange = useCallback(
    (connected: boolean) => {
      onConnectionChangeRef.current?.(connected, operationQueueRef.current.length)
    },
    [],
  )

  const persistQueue = useCallback(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(queueStorageKey, serializeQueue(operationQueueRef.current))
    } catch (error) {
      console.warn("[v0] Unable to persist queued operations", error)
    }
  }, [queueStorageKey])

  const loadQueueFromStorage = useCallback(() => {
    if (typeof window === "undefined") return

    const storedQueue = deserializeQueue(window.localStorage.getItem(queueStorageKey))
    if (storedQueue.length > 0) {
      operationQueueRef.current = storedQueue.slice(-MAX_QUEUE_LENGTH)
      pendingReplayRef.current = [...operationQueueRef.current]
      notifyConnectionChange(false)
    } else {
      operationQueueRef.current = []
      pendingReplayRef.current = null
    }
  }, [notifyConnectionChange, queueStorageKey])

  useEffect(() => {
    loadQueueFromStorage()

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [loadQueueFromStorage])

  // Load initial objects from database
  useEffect(() => {
    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        setIsLoading(false)
        return
      }

      const initialObjects = (data || []).map((obj) => {
        const version = obj.version ?? 0
        objectVersionsRef.current.set(obj.id, version)
        return {
          ...obj,
          version,
        }
      })

      let hydratedObjects = initialObjects
      if (pendingReplayRef.current && pendingReplayRef.current.length > 0) {
        hydratedObjects = pendingReplayRef.current.reduce((acc, op) => applyQueuedOperation(acc, op), initialObjects)
      }

      setObjects(hydratedObjects)
      pendingObjectsRef.current = hydratedObjects
      pendingReplayRef.current = null
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase])

  const enqueueOperation = useCallback(
    (operation: QueuedOperation) => {
      if (operationQueueRef.current.length >= MAX_QUEUE_LENGTH) {
        operationQueueRef.current.shift()
      }
      operationQueueRef.current.push(operation)
      persistQueue()
      notifyConnectionChange(false)
    },
    [notifyConnectionChange, persistQueue],
  )

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    const failedOperations: QueuedOperation[] = []

    for (const op of queue) {
      try {
        if (op.type === "create" && op.object) {
          const objectPayload = {
            ...op.object,
            canvas_id: canvasId,
            created_by: userId,
            last_modified_by: userId,
            updated_at: new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
            version: op.object.version ?? (objectVersionsRef.current.get(op.object.id) ?? 1),
          }

          await supabase.from("canvas_objects").upsert(objectPayload, { onConflict: "id" })
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: { ...objectPayload, _timestamp: Date.now() },
          })
        } else if (op.type === "update" && op.object) {
          const version = op.object.version ?? (objectVersionsRef.current.get(op.object.id) ?? 1)
          const updatePayload = {
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
            z: op.object.z,
            updated_at: new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
            last_modified_by: userId,
            version,
          }

          await supabase.from("canvas_objects").update(updatePayload).eq("id", op.object.id)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...op.object, ...updatePayload, id: op.object.id, _timestamp: Date.now(), version },
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: { id: op.objectId, version: op.version ?? 0, _timestamp: Date.now() },
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
        failedOperations.push(op)
      }
    }

    operationQueueRef.current = failedOperations
    pendingReplayRef.current = failedOperations.length > 0 ? failedOperations : null
    persistQueue()

    if (failedOperations.length === 0) {
      console.log("[v0] [RECONNECT] All queued operations processed")
      notifyConnectionChange(true)
    } else {
      console.warn(`[v0] [RECONNECT] ${failedOperations.length} operations failed to process and remain queued`)
      notifyConnectionChange(false)
    }
  }, [canvasId, notifyConnectionChange, persistQueue, supabase, userId])

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

      setupChannelRef.current()
    }, delay)
  }, [supabase])

  const applyIncomingObject = useCallback((payload: CanvasObject & { _timestamp?: number }) => {
    const incomingVersion = payload.version ?? 0

    setObjects((prev) => {
      const existing = prev.find((obj) => obj.id === payload.id)
      const existingVersion = existing?.version ?? 0

      if (existing && incomingVersion !== 0 && existingVersion > incomingVersion) {
        console.log("[v0] Ignoring stale update for object", payload.id, incomingVersion, existingVersion)
        return prev
      }

      objectVersionsRef.current.set(payload.id, Math.max(incomingVersion, existingVersion))

      const merged = {
        ...existing,
        ...payload,
        version: Math.max(incomingVersion, existingVersion),
        last_synced_at: new Date().toISOString(),
      }

      const updated = existing ? prev.map((obj) => (obj.id === payload.id ? merged : obj)) : [...prev, merged]
      pendingObjectsRef.current = updated
      return updated
    })
  }, [])

  const applyIncomingDelete = useCallback((payload: DeleteOperationMetadata & { _timestamp?: number }) => {
    setObjects((prev) => {
      const existing = prev.find((obj) => obj.id === payload.id)
      if (!existing) {
        return prev
      }

      const existingVersion = existing.version ?? 0
      if (payload.version && existingVersion > payload.version) {
        console.log("[v0] Ignoring stale delete for object", payload.id)
        return prev
      }

      const updated = prev.filter((obj) => obj.id !== payload.id)
      objectVersionsRef.current.delete(payload.id)
      pendingObjectsRef.current = updated
      return updated
    })
  }, [])

  const setupChannel = useCallback(() => {
    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }

        applyIncomingObject(payload as CanvasObject)
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        applyIncomingObject(payload as CanvasObject)
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }

        applyIncomingDelete(payload as DeleteOperationMetadata)
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
          notifyConnectionChange(false)
          attemptReconnect()
        }
      })

    channelRef.current = channel
  }, [applyIncomingDelete, applyIncomingObject, attemptReconnect, canvasId, notifyConnectionChange, processQueuedOperations, supabase])

  useEffect(() => {
    setupChannelRef.current = setupChannel
  }, [setupChannel])

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

      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        try {
          await supabase.from("canvas_objects").upsert(
            newObjects.map((o) => ({
              ...o,
              canvas_id: canvasId,
              created_by: userId,
              last_modified_by: userId,
              updated_at: new Date().toISOString(),
              last_synced_at: o.last_synced_at ?? new Date().toISOString(),
              version: o.version ?? objectVersionsRef.current.get(o.id) ?? 1,
            })),
            { onConflict: "id" },
          )
        } catch (error) {
          console.error("[v0] [RECONNECT] Database write failed, queueing operations")
          newObjects.forEach((obj) => {
            enqueueOperation({
              type: "create",
              object: obj,
              timestamp: Date.now(),
            })
          })
        }
      }

      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = objects.find((o) => o.id === obj.id)
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
                z: obj.z,
                updated_at: new Date().toISOString(),
                last_modified_by: userId,
                last_synced_at: obj.last_synced_at ?? new Date().toISOString(),
                version: obj.version ?? (existing.version ?? 0) + 1,
              })
              .eq("id", obj.id)
          } catch (error) {
            console.error("[v0] [RECONNECT] Database update failed, queueing operation")
            enqueueOperation({
              type: "update",
              object: obj,
              timestamp: Date.now(),
            })
          }
        }
      }

      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      if (deletedIds.length > 0) {
        try {
          await supabase.from("canvas_objects").delete().in("id", deletedIds)
        } catch (error) {
          console.error("[v0] [RECONNECT] Database delete failed, queueing operations")
          deletedIds.forEach((id) => {
            enqueueOperation({
              type: "delete",
              objectId: id,
              timestamp: Date.now(),
              version: objectVersionsRef.current.get(id),
            })
          })
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [canvasId, enqueueOperation, isConnected, objects, supabase, userId],
  )

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()

      const existingMap = new Map(objects.map((o) => [o.id, o]))
      const timestamp = Date.now()
      const nextObjects: CanvasObject[] = []
      const newBroadcasts: CanvasObject[] = []
      const updateBroadcasts: CanvasObject[] = []

      for (const obj of updatedObjects) {
        const existing = existingMap.get(obj.id)
        if (!existing) {
          const version = Math.max(obj.version ?? 1, 1)
          objectVersionsRef.current.set(obj.id, version)
          const enriched: CanvasObject = {
            ...obj,
            version,
            last_modified_by: userId,
            last_synced_at: new Date().toISOString(),
          }
          nextObjects.push(enriched)
          newBroadcasts.push(enriched)
          continue
        }

        if (!hasObjectChanged(existing, obj)) {
          nextObjects.push({ ...existing, ...obj, version: existing.version })
          continue
        }

        const nextVersion = (existing.version ?? 0) + 1
        objectVersionsRef.current.set(obj.id, nextVersion)
        const enriched: CanvasObject = {
          ...existing,
          ...obj,
          version: nextVersion,
          last_modified_by: userId,
          last_synced_at: new Date().toISOString(),
        }
        nextObjects.push(enriched)
        updateBroadcasts.push(enriched)
      }

      // Ensure deleted objects removed locally
      const updatedIds = new Set(updatedObjects.map((obj) => obj.id))
      const deletedIds = objects.filter((obj) => !updatedIds.has(obj.id)).map((obj) => obj.id)

      const finalObjects = nextObjects.filter((obj, index, array) => array.findIndex((o) => o.id === obj.id) === index)
      setObjects(finalObjects)
      pendingObjectsRef.current = finalObjects

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        newBroadcasts.forEach((obj) => {
          enqueueOperation({
            type: "create",
            object: obj,
            timestamp,
          })
        })

        updateBroadcasts.forEach((obj) => {
          enqueueOperation({
            type: "update",
            object: obj,
            timestamp,
          })
        })

        deletedIds.forEach((id) => {
          enqueueOperation({
            type: "delete",
            objectId: id,
            timestamp,
            version: objectVersionsRef.current.get(id),
          })
          objectVersionsRef.current.delete(id)
        })

        return
      }

      for (const obj of newBroadcasts) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: { ...obj, _timestamp: timestamp },
        })
      }

      for (const obj of updateBroadcasts) {
        channel.send({
          type: "broadcast",
          event: "object_updated",
          payload: { ...obj, _timestamp: timestamp },
        })
      }

      for (const id of deletedIds) {
        const deleteVersion = objectVersionsRef.current.get(id) ?? 0
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: { id, version: deleteVersion, _timestamp: timestamp },
        })
        objectVersionsRef.current.delete(id)
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${newBroadcasts.length + updateBroadcasts.length + deletedIds.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, DEBOUNCE_DELAY)
    },
    [debouncedDatabaseSync, enqueueOperation, isConnected, objects, userId],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
