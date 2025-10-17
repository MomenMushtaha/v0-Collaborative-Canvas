"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { LamportClock } from "@/lib/realtime/lamport"
import {
  shouldApplyRemoteUpdate,
  toSerializableMap,
  mapFromObject,
  type LastEditorMeta,
} from "@/lib/realtime/conflict"
import {
  loadSnapshot,
  saveSnapshot,
  loadQueuedOperations,
  saveQueuedOperations,
  clearQueuedOperations,
  type PersistedQueuedOperation,
} from "@/lib/state-persistence"

interface UseRealtimeCanvasProps {
  canvasId: string
  userId: string
  userName: string
  onConnectionChange?: (connected: boolean, queuedOps: number) => void
}

interface BroadcastPayload {
  object?: CanvasObject
  objectId?: string
  version: number
  meta: LastEditorMeta
  event: "object_created" | "object_updated" | "object_deleted"
}

function stripMeta(object: CanvasObject) {
  const { version, last_edited_by, last_edited_by_name, last_edited_at, ...rest } = object
  return rest as CanvasObject
}

function ensureMeta(object: CanvasObject, version: number, meta: LastEditorMeta): CanvasObject {
  return {
    ...object,
    version,
    last_edited_by: meta.userId,
    last_edited_by_name: meta.userName,
    last_edited_at: new Date(meta.timestamp).toISOString(),
  }
}

export function useRealtimeCanvas({ canvasId, userId, userName, onConnectionChange }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const supabase = createClient()

  const lamportRef = useRef(new LamportClock())
  const objectVersionsRef = useRef(new Map<string, number>())
  const deletedVersionsRef = useRef(new Map<string, number>())
  const lastEditorsRef = useRef(new Map<string, LastEditorMeta>())
  const objectsRef = useRef<CanvasObject[]>([])

  const syncTimeoutRef = useRef<NodeJS.Timeout>()
  const persistTimeoutRef = useRef<number>()
  const pendingObjectsRef = useRef<CanvasObject[]>([])
  const pendingDbOperationsRef = useRef<PersistedQueuedOperation[]>([])
  const channelRef = useRef<RealtimeChannel>()
  const operationQueueRef = useRef<PersistedQueuedOperation[]>([])
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const onConnectionChangeRef = useRef(onConnectionChange)
  const lastStatusRef = useRef<string>("")

  const commitObjects = useCallback(
    (nextObjects: CanvasObject[]) => {
      objectsRef.current = nextObjects
      pendingObjectsRef.current = nextObjects
      setObjects(nextObjects)

      if (typeof window !== "undefined") {
        if (persistTimeoutRef.current) {
          window.clearTimeout(persistTimeoutRef.current)
        }
        persistTimeoutRef.current = window.setTimeout(() => {
          saveSnapshot(canvasId, {
            objects: nextObjects,
            versions: Object.fromEntries(objectVersionsRef.current.entries()),
            editors: toSerializableMap(lastEditorsRef.current),
            savedAt: Date.now(),
          })
        }, 100)
      }
    },
    [canvasId],
  )

  const persistQueue = useCallback(() => {
    saveQueuedOperations(canvasId, operationQueueRef.current)
  }, [canvasId])

  const flushDatabaseOperations = useCallback(async () => {
    if (!isConnected) return
    if (pendingDbOperationsRef.current.length === 0) return

    const operations = pendingDbOperationsRef.current
    pendingDbOperationsRef.current = []

    const dedupedMap = new Map<string, PersistedQueuedOperation>()

    for (const op of operations) {
      if (op.type === "delete" && op.objectId) {
        dedupedMap.set(op.objectId, op)
      } else if (op.object) {
        dedupedMap.set(op.object.id, op)
      }
    }

    const dedupedOps = Array.from(dedupedMap.values()).sort((a, b) => a.timestamp - b.timestamp)

    for (const op of dedupedOps) {
      try {
        if (op.type === "create" && op.object) {
          await supabase
            .from("canvas_objects")
            .upsert({
              ...stripMeta(op.object),
              created_by: op.meta.userId,
              updated_at: new Date(op.meta.timestamp).toISOString(),
            })
        } else if (op.type === "update" && op.object) {
          await supabase
            .from("canvas_objects")
            .update({
              ...stripMeta(op.object),
              updated_at: new Date(op.meta.timestamp).toISOString(),
            })
            .eq("id", op.object.id)
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Database sync failed, re-queueing", error)
        pendingDbOperationsRef.current.push(op)
      }
    }
  }, [isConnected, supabase])

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange
  }, [onConnectionChange])

  useEffect(() => {
    if (typeof window === "undefined") return

    const snapshot = loadSnapshot(canvasId)
    if (snapshot) {
      objectVersionsRef.current = new Map(Object.entries(snapshot.versions).map(([id, version]) => [id, Number(version)]))
      lastEditorsRef.current = mapFromObject(snapshot.editors)
      const maxVersion = Math.max(0, ...objectVersionsRef.current.values())
      lamportRef.current.observe(maxVersion)
      commitObjects(snapshot.objects)
      setIsLoading(false)
    }

    const queued = loadQueuedOperations(canvasId)
    if (queued.length > 0) {
      operationQueueRef.current = queued
      onConnectionChangeRef.current?.(false, queued.length)
    }

    const handleOnline = () => {
      setIsConnected(true)
      onConnectionChangeRef.current?.(true, operationQueueRef.current.length)
    }

    const handleOffline = () => {
      setIsConnected(false)
      onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [canvasId, commitObjects])

  useEffect(() => {
    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        setIsLoading(false)
        return
      }

      const fetched = (data || []).map((obj) => {
        const version = obj.version ?? lamportRef.current.tickFromTimestamp(Date.now())
        const meta: LastEditorMeta = {
          userId: obj.last_edited_by || obj.created_by || "unknown",
          userName: obj.last_edited_by_name || "Unknown",
          timestamp: obj.last_edited_at ? Date.parse(obj.last_edited_at) : Date.now(),
        }
        objectVersionsRef.current.set(obj.id, version)
        lastEditorsRef.current.set(obj.id, meta)
        return ensureMeta(obj, version, meta)
      })

      commitObjects(fetched)
      setIsLoading(false)
    }

    loadObjects()
  }, [canvasId, commitObjects, supabase])

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []
    persistQueue()

    for (const op of queue) {
      try {
        if (op.type === "create" && op.object) {
          await supabase
            .from("canvas_objects")
            .upsert({
              ...stripMeta(op.object),
              created_by: op.meta.userId,
              updated_at: new Date(op.meta.timestamp).toISOString(),
            })
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: {
              ...ensureMeta(op.object, op.version, op.meta),
              _timestamp: op.meta.timestamp,
              _version: op.version,
              _editedBy: op.meta,
            },
          })
        } else if (op.type === "update" && op.object) {
          await supabase
            .from("canvas_objects")
            .update({
              ...stripMeta(op.object),
              updated_at: new Date(op.meta.timestamp).toISOString(),
            })
            .eq("id", op.object.id)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: {
              ...ensureMeta(op.object, op.version, op.meta),
              _timestamp: op.meta.timestamp,
              _version: op.version,
              _editedBy: op.meta,
            },
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: {
              id: op.objectId,
              _timestamp: op.meta.timestamp,
              _version: op.version,
              _editedBy: op.meta,
            },
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
        operationQueueRef.current.push(op)
      }
    }

    if (operationQueueRef.current.length === 0) {
      clearQueuedOperations(canvasId)
      onConnectionChangeRef.current?.(true, 0)
    } else {
      persistQueue()
      onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
    }
  }, [canvasId, persistQueue, supabase])

  const attemptReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000)
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
    const parsePayload = (payload: any): BroadcastPayload => {
      const { _timestamp, _version, _editedBy, ...rest } = payload || {}
      const meta: LastEditorMeta = _editedBy || {
        userId: rest.last_edited_by || "unknown",
        userName: rest.last_edited_by_name || "Unknown",
        timestamp: typeof _timestamp === "number" ? _timestamp : Date.now(),
      }

      const version = typeof _version === "number" ? _version : lamportRef.current.tickFromTimestamp(meta.timestamp)

      return {
        object: rest.id ? (rest as CanvasObject) : undefined,
        objectId: rest.id,
        version,
        meta,
        event: payload?.event || "object_updated",
      }
    }

    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        const { object, version, meta } = parsePayload(payload)
        if (!object) return

        const currentVersion = objectVersionsRef.current.get(object.id)
        const deletedVersion = deletedVersionsRef.current.get(object.id)
        if (deletedVersion && deletedVersion >= version) {
          return
        }

        if (!shouldApplyRemoteUpdate({
          currentVersion,
          incomingVersion: version,
          currentUserId: lastEditorsRef.current.get(object.id)?.userId,
          incomingUserId: meta.userId,
        })) {
          return
        }

        lamportRef.current.observe(version)
        objectVersionsRef.current.set(object.id, version)
        lastEditorsRef.current.set(object.id, meta)
        deletedVersionsRef.current.delete(object.id)

        commitObjects([
          ...objectsRef.current.filter((o) => o.id !== object.id),
          ensureMeta(object, version, meta),
        ])
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const { object, version, meta } = parsePayload(payload)
        if (!object) return

        const currentVersion = objectVersionsRef.current.get(object.id)

        if (
          !shouldApplyRemoteUpdate({
            currentVersion,
            incomingVersion: version,
            currentUserId: lastEditorsRef.current.get(object.id)?.userId,
            incomingUserId: meta.userId,
          })
        ) {
          return
        }

        lamportRef.current.observe(version)
        objectVersionsRef.current.set(object.id, version)
        lastEditorsRef.current.set(object.id, meta)
        deletedVersionsRef.current.delete(object.id)

        commitObjects(
          objectsRef.current.map((obj) => (obj.id === object.id ? ensureMeta(object, version, meta) : obj)),
        )
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const { objectId, version, meta } = parsePayload(payload)
        if (!objectId) return

        const currentVersion = objectVersionsRef.current.get(objectId)

        if (
          !shouldApplyRemoteUpdate({
            currentVersion,
            incomingVersion: version,
            currentUserId: lastEditorsRef.current.get(objectId)?.userId,
            incomingUserId: meta.userId,
          })
        ) {
          return
        }

        lamportRef.current.observe(version)
        objectVersionsRef.current.delete(objectId)
        deletedVersionsRef.current.set(objectId, version)
        lastEditorsRef.current.set(objectId, meta)

        commitObjects(objectsRef.current.filter((obj) => obj.id !== objectId))
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
          flushDatabaseOperations()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.log("[v0] [RECONNECT] Connection lost, will retry")
          setIsConnected(false)
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          attemptReconnect()
        }
      })

    channelRef.current = channel
  }, [attemptReconnect, canvasId, commitObjects, flushDatabaseOperations, processQueuedOperations, supabase])

  useEffect(() => {
    setupChannel()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current)
      }
    }
  }, [setupChannel, supabase])

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const existingMap = new Map(objectsRef.current.map((obj) => [obj.id, obj]))
      const nextMap = new Map(updatedObjects.map((obj) => [obj.id, obj]))
      const nextObjects: CanvasObject[] = []
      const operations: PersistedQueuedOperation[] = []

      const timestampBase = Date.now()

      updatedObjects.forEach((obj, index) => {
        const previous = existingMap.get(obj.id)
        const sanitizedPrev = previous ? stripMeta(previous) : undefined
        const sanitizedNext = stripMeta(obj)

        const hasChanged =
          !previous ||
          JSON.stringify(sanitizedPrev) !== JSON.stringify(sanitizedNext)

        if (hasChanged) {
          const timestamp = timestampBase + index
          const version = lamportRef.current.tick()
          const meta: LastEditorMeta = { userId, userName, timestamp }

          objectVersionsRef.current.set(obj.id, version)
          lastEditorsRef.current.set(obj.id, meta)
          deletedVersionsRef.current.delete(obj.id)

          const enriched = ensureMeta({ ...sanitizedNext }, version, meta)
          nextObjects.push(enriched)

          operations.push({
            type: previous ? "update" : "create",
            object: enriched,
            version,
            meta,
            timestamp,
          })
        } else if (previous) {
          const version = objectVersionsRef.current.get(obj.id) ?? previous.version ?? lamportRef.current.tick()
          const meta =
            lastEditorsRef.current.get(obj.id) ||
            ({
              userId: previous.last_edited_by || previous.created_by || "unknown",
              userName: previous.last_edited_by_name || "Unknown",
              timestamp: previous.last_edited_at ? Date.parse(previous.last_edited_at) : timestampBase,
            } satisfies LastEditorMeta)

          objectVersionsRef.current.set(obj.id, version)
          lastEditorsRef.current.set(obj.id, meta)
          nextObjects.push(ensureMeta(stripMeta(obj), version, meta))
        }
      })

      existingMap.forEach((value, id) => {
        if (!nextMap.has(id)) {
          const timestamp = Date.now()
          const version = lamportRef.current.tick()
          const meta: LastEditorMeta = { userId, userName, timestamp }
          deletedVersionsRef.current.set(id, version)
          objectVersionsRef.current.delete(id)
          lastEditorsRef.current.set(id, meta)

          operations.push({
            type: "delete",
            objectId: id,
            version,
            meta,
            timestamp,
          })
        }
      })

      commitObjects(nextObjects)

      if (!channelRef.current || !isConnected) {
        if (operations.length > 0) {
          operationQueueRef.current.push(...operations)
          persistQueue()
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
        return
      }

      for (const op of operations) {
        if (op.type === "delete" && op.objectId) {
          channelRef.current.send({
            type: "broadcast",
            event: "object_deleted",
            payload: {
              id: op.objectId,
              _timestamp: op.meta.timestamp,
              _version: op.version,
              _editedBy: op.meta,
            },
          })
        } else if (op.object) {
          const payload = {
            ...op.object,
            _timestamp: op.meta.timestamp,
            _version: op.version,
            _editedBy: op.meta,
          }
          channelRef.current.send({
            type: "broadcast",
            event: op.type === "create" ? "object_created" : "object_updated",
            payload,
          })
        }
      }

      pendingDbOperationsRef.current.push(...operations)

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        flushDatabaseOperations()
      }, 250)
    },
    [commitObjects, flushDatabaseOperations, isConnected, persistQueue, userId, userName],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: operationQueueRef.current.length,
  }
}
