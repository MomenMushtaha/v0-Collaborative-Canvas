"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject, CanvasObjectMetadata } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface UseRealtimeCanvasProps {
  canvasId: string
  userId: string
  userName: string
  userColor: string
  onConnectionChange?: (connected: boolean, queuedOps: number) => void
}

interface QueuedOperation {
  type: "create" | "update" | "delete"
  object?: CanvasObject
  objectId?: string
  timestamp: number
  meta: CanvasObjectMetadata
}

function stripMetadata(object: CanvasObject): CanvasObject {
  const { meta: _meta, ...rest } = object as CanvasObject & { meta?: CanvasObjectMetadata }
  return rest
}

function applyMetadata(object: CanvasObject, meta: CanvasObjectMetadata): CanvasObject {
  return {
    ...stripMetadata(object),
    meta: { ...meta },
  }
}

function snapshotWithoutMeta(object: CanvasObject): string {
  return JSON.stringify(stripMetadata(object))
}

interface BroadcastEnvelope {
  object: CanvasObject
  meta: CanvasObjectMetadata
}

interface DeleteBroadcastEnvelope {
  id: string
  meta: CanvasObjectMetadata
}

export function useRealtimeCanvas({ canvasId, userId, userName, userColor, onConnectionChange }: UseRealtimeCanvasProps) {
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
  const versionRef = useRef<Map<string, number>>(new Map())
  const tombstoneRef = useRef<Map<string, number>>(new Map())

  const commitObjectsUpdate = useCallback(
    (updater: CanvasObject[] | ((prev: CanvasObject[]) => CanvasObject[])) => {
      if (typeof updater === "function") {
        setObjects((prev) => {
          const next = (updater as (prev: CanvasObject[]) => CanvasObject[])(prev)
          objectsRef.current = next
          return next
        })
      } else {
        objectsRef.current = updater
        setObjects(updater)
      }
    },
    [],
  )

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange
  }, [onConnectionChange])

  // Load initial objects from database
  useEffect(() => {
    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        return
      }

      const initialized = (data || []).map((obj) => {
        const base = stripMetadata(obj)
        const lastModifiedAt = obj.updated_at
          ? new Date(obj.updated_at).getTime()
          : obj.created_at
            ? new Date(obj.created_at).getTime()
            : Date.now()
        versionRef.current.set(obj.id, lastModifiedAt)
        tombstoneRef.current.delete(obj.id)
        return applyMetadata(base, {
          lastModifiedAt,
          lastOperation: "create",
        })
      })

      commitObjectsUpdate(initialized)
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, supabase, commitObjectsUpdate])

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
          const payload: BroadcastEnvelope = {
            object: op.object,
            meta: op.meta,
          }
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload,
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
          const payload: BroadcastEnvelope = {
            object: op.object,
            meta: op.meta,
          }
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload,
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          const payload: DeleteBroadcastEnvelope = {
            id: op.objectId,
            meta: op.meta,
          }
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload,
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
      }
    }

    console.log("[v0] [RECONNECT] All queued operations processed")
    onConnectionChangeRef.current?.(true, 0)
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
        const { object, meta } = payload as BroadcastEnvelope
        const version = meta?.lastModifiedAt ?? Date.now()
        if (meta?.lastModifiedAt) {
          const latency = Date.now() - meta.lastModifiedAt
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }
        const currentVersion = versionRef.current.get(object.id) ?? 0
        const tombstoneVersion = tombstoneRef.current.get(object.id) ?? 0
        if (version < Math.max(currentVersion, tombstoneVersion)) {
          return
        }

        versionRef.current.set(object.id, version)
        tombstoneRef.current.delete(object.id)

        commitObjectsUpdate((prev) => {
          if (prev.some((obj) => obj.id === object.id)) {
            return prev.map((obj) => (obj.id === object.id ? applyMetadata(object, meta) : obj))
          }
          return [...prev, applyMetadata(object, meta)]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const { object, meta } = payload as BroadcastEnvelope
        const version = meta?.lastModifiedAt ?? Date.now()
        if (meta?.lastModifiedAt) {
          const latency = Date.now() - meta.lastModifiedAt
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }
        const currentVersion = versionRef.current.get(object.id) ?? 0
        const tombstoneVersion = tombstoneRef.current.get(object.id) ?? 0

        if (version < Math.max(currentVersion, tombstoneVersion)) {
          return
        }

        versionRef.current.set(object.id, version)
        tombstoneRef.current.delete(object.id)

        commitObjectsUpdate((prev) =>
          prev.map((obj) => (obj.id === object.id ? applyMetadata(object, meta) : obj)),
        )
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const { id, meta } = payload as DeleteBroadcastEnvelope
        const version = meta?.lastModifiedAt ?? Date.now()
        if (meta?.lastModifiedAt) {
          const latency = Date.now() - meta.lastModifiedAt
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }
        const currentVersion = versionRef.current.get(id) ?? 0

        if (version < currentVersion) {
          return
        }

        versionRef.current.delete(id)
        tombstoneRef.current.set(id, version)

        commitObjectsUpdate((prev) => prev.filter((obj) => obj.id !== id))
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

      const currentObjects = objectsRef.current
      const currentMap = new Map(currentObjects.map((o) => [o.id, stripMetadata(o)]))
      const updatedSanitizedMap = new Map(updatedObjects.map((o) => [o.id, stripMetadata(o)]))
      const metaById = new Map(updatedObjects.map((o) => [o.id, o.meta ?? {}]))

      const currentIds = new Set(currentMap.keys())
      const updatedIds = new Set(updatedSanitizedMap.keys())

      const newObjects = Array.from(updatedSanitizedMap.values()).filter((obj) => !currentIds.has(obj.id))
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
              meta: metaById.get(obj.id) ?? {},
            })
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const toUpdate: CanvasObject[] = []
      for (const [id, obj] of updatedSanitizedMap.entries()) {
        if (currentIds.has(id)) {
          const existing = currentMap.get(id)
          if (existing && JSON.stringify(existing) !== JSON.stringify(obj)) {
            toUpdate.push(obj)
          }
        }
      }

      for (const obj of toUpdate) {
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
            meta: metaById.get(obj.id) ?? {},
          })
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const deletedIds = Array.from(currentIds).filter((id) => !updatedIds.has(id))
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
              meta: {
                lastModifiedAt: Date.now(),
                lastModifiedBy: userId,
                lastModifiedByName: userName,
                lastModifiedColor: userColor,
                lastOperation: "delete",
              },
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
    [isConnected, supabase, userColor, userId, userName],
  )

  const syncObjects = useCallback(
    async (incomingObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()
      const previousObjects = objectsRef.current
      const previousMap = new Map(previousObjects.map((obj) => [obj.id, obj]))
      const incomingIds = new Set(incomingObjects.map((obj) => obj.id))
      const nextObjects: CanvasObject[] = []
      const creates: BroadcastEnvelope[] = []
      const updates: BroadcastEnvelope[] = []
      const deletes: DeleteBroadcastEnvelope[] = []
      const now = Date.now()
      let logicalClock = 0

      for (const object of incomingObjects) {
        const base = stripMetadata(object)
        const existing = previousMap.get(object.id)
        const currentSnapshot = JSON.stringify(base)
        const existingSnapshot = existing ? snapshotWithoutMeta(existing) : null

        if (!existing) {
          const timestamp = now + logicalClock++
          const meta: CanvasObjectMetadata = {
            lastModifiedAt: timestamp,
            lastModifiedBy: userId,
            lastModifiedByName: userName,
            lastModifiedColor: userColor,
            lastOperation: "create",
          }
          versionRef.current.set(object.id, timestamp)
          tombstoneRef.current.delete(object.id)
          const created = applyMetadata(base, meta)
          nextObjects.push(created)
          creates.push({ object: stripMetadata(created), meta })
        } else if (existingSnapshot !== currentSnapshot) {
          const timestamp = now + logicalClock++
          const meta: CanvasObjectMetadata = {
            lastModifiedAt: timestamp,
            lastModifiedBy: userId,
            lastModifiedByName: userName,
            lastModifiedColor: userColor,
            lastOperation: "update",
          }
          versionRef.current.set(object.id, timestamp)
          tombstoneRef.current.delete(object.id)
          const updated = applyMetadata(base, meta)
          nextObjects.push(updated)
          updates.push({ object: stripMetadata(updated), meta })
        } else {
          nextObjects.push(existing)
        }
      }

      const deletedIds = previousObjects.filter((obj) => !incomingIds.has(obj.id)).map((obj) => obj.id)
      for (const id of deletedIds) {
        const timestamp = now + logicalClock++
        const meta: CanvasObjectMetadata = {
          lastModifiedAt: timestamp,
          lastModifiedBy: userId,
          lastModifiedByName: userName,
          lastModifiedColor: userColor,
          lastOperation: "delete",
        }
        versionRef.current.delete(id)
        tombstoneRef.current.set(id, timestamp)
        deletes.push({ id, meta })
      }

      commitObjectsUpdate(nextObjects)
      pendingObjectsRef.current = nextObjects

      if (creates.length === 0 && updates.length === 0 && deletes.length === 0) {
        return
      }

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        creates.forEach(({ object, meta }) => {
          operationQueueRef.current.push({
            type: "create",
            object,
            timestamp: meta.lastModifiedAt ?? Date.now(),
            meta,
          })
        })

        updates.forEach(({ object, meta }) => {
          operationQueueRef.current.push({
            type: "update",
            object,
            timestamp: meta.lastModifiedAt ?? Date.now(),
            meta,
          })
        })

        deletes.forEach(({ id, meta }) => {
          operationQueueRef.current.push({
            type: "delete",
            objectId: id,
            timestamp: meta.lastModifiedAt ?? Date.now(),
            meta,
          })
        })

        onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        return
      }

      for (const envelope of creates) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: envelope,
        })
      }

      for (const envelope of updates) {
        channel.send({
          type: "broadcast",
          event: "object_updated",
          payload: envelope,
        })
      }

      for (const envelope of deletes) {
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: envelope,
        })
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${creates.length + updates.length + deletes.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)
    },
    [commitObjectsUpdate, debouncedDatabaseSync, isConnected, userColor, userId, userName],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
