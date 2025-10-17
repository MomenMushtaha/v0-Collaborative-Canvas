"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type {
  CanvasObject,
  ObjectMetadata,
  RealtimeBroadcastMeta,
  RealtimeDeletePayload,
  RealtimeObjectPayload,
} from "@/lib/types"
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
  metadata?: ObjectMetadata
  timestamp: number
}

interface PersistedCanvasState {
  objects: CanvasObject[]
  metadata: Array<[string, ObjectMetadata]>
  tombstones: Array<[string, ObjectMetadata]>
  lastSyncedAt: number
}

const STORAGE_PREFIX = "collab:canvas:"
const QUEUE_PREFIX = "collab:queue:"

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    return window.localStorage
  } catch (error) {
    console.warn("[v0] Local storage unavailable", error)
    return null
  }
}

function stripMeta(payload: RealtimeObjectPayload): CanvasObject {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _meta, _timestamp, ...rest } = payload
  return rest
}

function normaliseIncomingMeta(
  incoming: RealtimeBroadcastMeta | undefined,
  fallback: ObjectMetadata | undefined,
): ObjectMetadata | undefined {
  if (!incoming && !fallback) {
    return undefined
  }

  const base: ObjectMetadata = fallback
    ? { ...fallback }
    : {
        version: incoming?.version ?? 1,
        lastEditedAt: incoming?.lastEditedAt ?? Date.now(),
        lastEditedBy: incoming?.lastEditedBy,
        lastEditedName: incoming?.lastEditedName,
        lastEditedColor: incoming?.lastEditedColor,
      }

  if (incoming) {
    base.version = incoming.version ?? base.version ?? 1
    base.lastEditedAt = incoming.lastEditedAt ?? base.lastEditedAt ?? Date.now()
    base.lastEditedBy = incoming.lastEditedBy ?? base.lastEditedBy
    base.lastEditedName = incoming.lastEditedName ?? base.lastEditedName
    base.lastEditedColor = incoming.lastEditedColor ?? base.lastEditedColor
  }

  if (!base.lastEditedBy) {
    base.lastEditedBy = "unknown"
  }
  if (!base.lastEditedName) {
    base.lastEditedName = "Unknown"
  }
  if (!base.lastEditedColor) {
    base.lastEditedColor = "#64748b"
  }
  if (!base.lastEditedAt) {
    base.lastEditedAt = Date.now()
  }

  return base
}

export function useRealtimeCanvas({
  canvasId,
  userId,
  userName,
  userColor,
  onConnectionChange,
}: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [metadataSnapshot, setMetadataSnapshot] = useState<Record<string, ObjectMetadata>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const [queueLength, setQueueLength] = useState(0)
  const supabase = createClient()

  const objectsRef = useRef<CanvasObject[]>([])
  const metadataRef = useRef<Map<string, ObjectMetadata>>(new Map())
  const tombstonesRef = useRef<Map<string, ObjectMetadata>>(new Map())
  const syncTimeoutRef = useRef<NodeJS.Timeout>()
  const channelRef = useRef<RealtimeChannel>()
  const operationQueueRef = useRef<QueuedOperation[]>([])
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const onConnectionChangeRef = useRef(onConnectionChange)
  const lastStatusRef = useRef<string>("")

  const storageKey = `${STORAGE_PREFIX}${canvasId}`
  const queueKey = `${QUEUE_PREFIX}${canvasId}`

  const updateMetadataSnapshot = useCallback(() => {
    setMetadataSnapshot(Object.fromEntries(metadataRef.current.entries()))
  }, [])

  const persistState = useCallback(
    (nextObjects: CanvasObject[]) => {
      const storage = getStorage()
      if (!storage) return

      const payload: PersistedCanvasState = {
        objects: nextObjects,
        metadata: Array.from(metadataRef.current.entries()),
        tombstones: Array.from(tombstonesRef.current.entries()),
        lastSyncedAt: Date.now(),
      }

      storage.setItem(storageKey, JSON.stringify(payload))
    },
    [storageKey],
  )

  const persistQueue = useCallback(() => {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(queueKey, JSON.stringify(operationQueueRef.current))
  }, [queueKey])

  const updateObjects = useCallback(
    (updater: (prev: CanvasObject[]) => CanvasObject[]) => {
      setObjects((prev) => {
        const next = updater(prev)
        objectsRef.current = next
        persistState(next)
        return next
      })
    },
    [persistState],
  )

  const applyQueueToObjects = useCallback((base: CanvasObject[]) => {
    let result = [...base]

    for (const op of operationQueueRef.current) {
      if (op.type === "create" && op.object) {
        if (!result.some((obj) => obj.id === op.object!.id)) {
          result = [...result, op.object]
        }
      } else if (op.type === "update" && op.object) {
        result = result.map((obj) => (obj.id === op.object!.id ? op.object! : obj))
      } else if (op.type === "delete" && op.objectId) {
        result = result.filter((obj) => obj.id !== op.objectId)
      }
    }

    return result
  }, [])

  const shouldAcceptUpdate = useCallback(
    (objectId: string, incomingMeta: RealtimeBroadcastMeta | undefined) => {
      const tombstone = tombstonesRef.current.get(objectId)
      if (tombstone && incomingMeta) {
        if ((incomingMeta.version ?? 0) <= (tombstone.version ?? 0)) {
          return false
        }
      }

      const current = metadataRef.current.get(objectId)
      if (!current) {
        return true
      }

      if (!incomingMeta) {
        return true
      }

      const incomingVersion = incomingMeta.version ?? 0
      const currentVersion = current.version ?? 0

      if (incomingVersion > currentVersion) {
        return true
      }
      if (incomingVersion < currentVersion) {
        return false
      }

      const incomingTimestamp = incomingMeta.lastEditedAt ?? 0
      const currentTimestamp = current.lastEditedAt ?? 0

      return incomingTimestamp >= currentTimestamp
    },
    [],
  )

  const enqueueOperation = useCallback(
    (operation: QueuedOperation) => {
      operationQueueRef.current.push(operation)
      setQueueLength(operationQueueRef.current.length)
      persistQueue()
      onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
    },
    [persistQueue],
  )

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange
  }, [onConnectionChange])

  useEffect(() => {
    const storage = getStorage()
    if (!storage) return

    try {
      const persisted = storage.getItem(storageKey)
      if (persisted) {
        const parsed = JSON.parse(persisted) as PersistedCanvasState
        metadataRef.current = new Map(parsed.metadata ?? [])
        tombstonesRef.current = new Map(parsed.tombstones ?? [])
        objectsRef.current = parsed.objects ?? []
        setObjects(parsed.objects ?? [])
        updateMetadataSnapshot()
        setIsLoading(false)
      }

      const queue = storage.getItem(queueKey)
      if (queue) {
        operationQueueRef.current = JSON.parse(queue) as QueuedOperation[]
        setQueueLength(operationQueueRef.current.length)
      }
    } catch (error) {
      console.error("[v0] Failed to restore persisted canvas state", error)
    }
  }, [queueKey, storageKey, updateMetadataSnapshot])

  const hydrateMetadata = useCallback(
    (incomingObjects: CanvasObject[], fallbackTimestamp: number) => {
      let modified = false
      for (const obj of incomingObjects) {
        if (metadataRef.current.has(obj.id)) {
          tombstonesRef.current.delete(obj.id)
          continue
        }

        const lastEditedAt = obj.updated_at
          ? new Date(obj.updated_at).getTime()
          : obj.created_at
            ? new Date(obj.created_at).getTime()
            : fallbackTimestamp

        metadataRef.current.set(obj.id, {
          version: 1,
          lastEditedAt,
          lastEditedBy: obj.created_by || "unknown",
          lastEditedName: obj.created_by || "Unknown",
          lastEditedColor: "#64748b",
        })
        tombstonesRef.current.delete(obj.id)
        modified = true
      }

      if (modified) {
        updateMetadataSnapshot()
      }
    },
    [updateMetadataSnapshot],
  )

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    for (const op of queue) {
      try {
        if (op.type === "create" && op.object) {
          await supabase
            .from("canvas_objects")
            .insert({
              ...op.object,
              created_by: userId,
            })
          const payload = buildCreateOrUpdatePayload(op.object, Date.now())
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

          const payload = buildCreateOrUpdatePayload(op.object, Date.now())
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload,
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          const payload = buildDeletePayload(op.objectId, Date.now())
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

    persistQueue()
    setQueueLength(operationQueueRef.current.length)
    console.log("[v0] [RECONNECT] All queued operations processed")
    onConnectionChangeRef.current?.(true, operationQueueRef.current.length)
  }, [persistQueue, supabase, userId])

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

  const debouncedDatabaseSync = useCallback(
    async (nextObjects: CanvasObject[], previousObjects: CanvasObject[]) => {
      if (!isConnected) {
        console.log("[v0] [RECONNECT] Offline - operations will be queued")
        return
      }

      const dbWriteStart = performance.now()
      const existingIds = new Set(previousObjects.map((o) => o.id))
      const updatedIds = new Set(nextObjects.map((o) => o.id))

      const newObjects = nextObjects.filter((o) => !existingIds.has(o.id))
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
            enqueueOperation({
              type: "create",
              object: obj,
              metadata: metadataRef.current.get(obj.id),
              timestamp: Date.now(),
            })
          })
          return
        }
      }

      const toUpdate = nextObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = previousObjects.find((o) => o.id === obj.id)
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
            enqueueOperation({
              type: "update",
              object: obj,
              metadata: metadataRef.current.get(obj.id),
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
              metadata: tombstonesRef.current.get(id),
              timestamp: Date.now(),
            })
          })
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [enqueueOperation, isConnected, supabase, userId],
  )

  const buildCreateOrUpdatePayload = useCallback(
    (obj: CanvasObject, timestamp: number): RealtimeObjectPayload => {
      let meta = metadataRef.current.get(obj.id) || {
        version: 1,
        lastEditedBy: userId,
        lastEditedName: userName,
        lastEditedColor: userColor,
        lastEditedAt: timestamp,
      }

      if (!meta.lastEditedAt) {
        meta.lastEditedAt = timestamp
      }

      const wasMissing = !metadataRef.current.has(obj.id)
      metadataRef.current.set(obj.id, meta)
      if (wasMissing) {
        updateMetadataSnapshot()
      }

      return {
        ...obj,
        _timestamp: timestamp,
        _meta: {
          version: meta.version ?? 1,
          lastEditedBy: meta.lastEditedBy ?? userId,
          lastEditedName: meta.lastEditedName ?? userName,
          lastEditedColor: meta.lastEditedColor ?? userColor,
          lastEditedAt: meta.lastEditedAt ?? timestamp,
        },
      }
    },
    [updateMetadataSnapshot, userColor, userId, userName],
  )

  const buildDeletePayload = useCallback(
    (id: string, timestamp: number): RealtimeDeletePayload => {
      const meta = tombstonesRef.current.get(id) || {
        version: 1,
        lastEditedBy: userId,
        lastEditedName: userName,
        lastEditedColor: userColor,
        lastEditedAt: timestamp,
      }

      if (!meta.lastEditedAt) {
        meta.lastEditedAt = timestamp
      }

      return {
        id,
        _timestamp: timestamp,
        _meta: {
          version: meta.version ?? 1,
          lastEditedBy: meta.lastEditedBy ?? userId,
          lastEditedName: meta.lastEditedName ?? userName,
          lastEditedColor: meta.lastEditedColor ?? userColor,
          lastEditedAt: meta.lastEditedAt ?? timestamp,
        },
      }
    },
    [userColor, userId, userName],
  )

  const setupChannel = useCallback(() => {
    const channel: RealtimeChannel = supabase
      .channel(`canvas:${canvasId}`)
      .on("broadcast", { event: "object_created" }, ({ payload }) => {
        const typedPayload = payload as RealtimeObjectPayload
        if (!shouldAcceptUpdate(typedPayload.id, typedPayload._meta)) {
          return
        }

        const latency = typedPayload._timestamp ? Date.now() - typedPayload._timestamp : null
        if (latency !== null) {
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`) // eslint-disable-line no-console
        }

        const incomingMeta = normaliseIncomingMeta(
          typedPayload._meta,
          metadataRef.current.get(typedPayload.id),
        )
        if (incomingMeta) {
          metadataRef.current.set(typedPayload.id, incomingMeta)
          tombstonesRef.current.delete(typedPayload.id)
          updateMetadataSnapshot()
        }

        const stripped = stripMeta(typedPayload)
        updateObjects((prev) => {
          if (prev.some((obj) => obj.id === stripped.id)) {
            return prev.map((obj) => (obj.id === stripped.id ? stripped : obj))
          }
          return [...prev, stripped]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const typedPayload = payload as RealtimeObjectPayload
        if (!shouldAcceptUpdate(typedPayload.id, typedPayload._meta)) {
          return
        }

        const latency = typedPayload._timestamp ? Date.now() - typedPayload._timestamp : null
        if (latency !== null) {
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`) // eslint-disable-line no-console
        }

        const incomingMeta = normaliseIncomingMeta(
          typedPayload._meta,
          metadataRef.current.get(typedPayload.id),
        )
        if (incomingMeta) {
          metadataRef.current.set(typedPayload.id, incomingMeta)
          tombstonesRef.current.delete(typedPayload.id)
          updateMetadataSnapshot()
        }

        const stripped = stripMeta(typedPayload)
        updateObjects((prev) => prev.map((obj) => (obj.id === stripped.id ? stripped : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const typedPayload = payload as RealtimeDeletePayload
        if (!shouldAcceptUpdate(typedPayload.id, typedPayload._meta)) {
          return
        }

        const latency = typedPayload._timestamp ? Date.now() - typedPayload._timestamp : null
        if (latency !== null) {
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`) // eslint-disable-line no-console
        }

        const incomingMeta = normaliseIncomingMeta(
          typedPayload._meta,
          tombstonesRef.current.get(typedPayload.id) ?? metadataRef.current.get(typedPayload.id),
        )
        if (incomingMeta) {
          tombstonesRef.current.set(typedPayload.id, incomingMeta)
          metadataRef.current.delete(typedPayload.id)
          updateMetadataSnapshot()
        }

        updateObjects((prev) => prev.filter((obj) => obj.id !== typedPayload.id))
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
          onConnectionChangeRef.current?.(true, operationQueueRef.current.length)
          processQueuedOperations()
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.log("[v0] [RECONNECT] Connection lost, will retry")
          setIsConnected(false)
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
          attemptReconnect()
        }
      })

    channelRef.current = channel
  }, [
    attemptReconnect,
    canvasId,
    processQueuedOperations,
    shouldAcceptUpdate,
    supabase,
    updateMetadataSnapshot,
    updateObjects,
  ])

  useEffect(() => {
    let isMounted = true

    async function loadObjects() {
      const { data, error } = await supabase.from("canvas_objects").select("*").eq("canvas_id", canvasId)

      if (!isMounted) return

      if (error) {
        console.error("[v0] Error loading canvas objects:", error)
        setIsLoading(false)
        return
      }

      const remoteObjects = data || []
      const merged = applyQueueToObjects(remoteObjects)
      hydrateMetadata(merged, Date.now())
      objectsRef.current = merged
      updateObjects(() => merged)
      setIsLoading(false)
    }

    loadObjects()

    return () => {
      isMounted = false
    }
  }, [applyQueueToObjects, canvasId, hydrateMetadata, supabase, updateObjects])

  useEffect(() => {
    setupChannel()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [setupChannel, supabase])

  const syncObjects = useCallback(
    async (updatedObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()
      const previousObjects = objectsRef.current
      const existingIds = new Set(previousObjects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))
      const timestamp = Date.now()

      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      newObjects.forEach((obj) => {
        metadataRef.current.set(obj.id, {
          version: 1,
          lastEditedBy: userId,
          lastEditedName: userName,
          lastEditedColor: userColor,
          lastEditedAt: timestamp,
        })
        tombstonesRef.current.delete(obj.id)
      })

      const changedObjects: CanvasObject[] = []
      updatedObjects.forEach((obj) => {
        if (!existingIds.has(obj.id)) return
        const existing = previousObjects.find((prev) => prev.id === obj.id)
        if (!existing) return

        if (JSON.stringify(existing) !== JSON.stringify(obj)) {
          const prevMeta = metadataRef.current.get(obj.id)
          const nextVersion = (prevMeta?.version ?? 0) + 1
          metadataRef.current.set(obj.id, {
            version: nextVersion,
            lastEditedBy: userId,
            lastEditedName: userName,
            lastEditedColor: userColor,
            lastEditedAt: timestamp,
          })
          changedObjects.push(obj)
        }
      })

      const deletedIds = Array.from(existingIds).filter((id) => !updatedIds.has(id))
      deletedIds.forEach((id) => {
        const prevMeta = metadataRef.current.get(id)
        const nextVersion = (prevMeta?.version ?? 0) + 1
        const tombstoneMeta: ObjectMetadata = {
          version: nextVersion,
          lastEditedBy: userId,
          lastEditedName: userName,
          lastEditedColor: userColor,
          lastEditedAt: timestamp,
        }
        tombstonesRef.current.set(id, tombstoneMeta)
        metadataRef.current.delete(id)
      })

      updateMetadataSnapshot()
      updateObjects(() => updatedObjects)

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        newObjects.forEach((obj) => {
          enqueueOperation({
            type: "create",
            object: obj,
            metadata: metadataRef.current.get(obj.id),
            timestamp,
          })
        })

        changedObjects.forEach((obj) => {
          enqueueOperation({
            type: "update",
            object: obj,
            metadata: metadataRef.current.get(obj.id),
            timestamp,
          })
        })

        deletedIds.forEach((id) => {
          enqueueOperation({
            type: "delete",
            objectId: id,
            metadata: tombstonesRef.current.get(id),
            timestamp,
          })
        })

        return
      }

      for (const obj of newObjects) {
        const payload = buildCreateOrUpdatePayload(obj, timestamp)
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload,
        })
      }

      for (const obj of changedObjects) {
        const payload = buildCreateOrUpdatePayload(obj, timestamp)
        channel.send({
          type: "broadcast",
          event: "object_updated",
          payload,
        })
      }

      for (const id of deletedIds) {
        const payload = buildDeletePayload(id, timestamp)
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload,
        })
      }

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${newObjects.length + changedObjects.length + deletedIds.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(objectsRef.current, previousObjects)
      }, 300)
    },
    [
      buildCreateOrUpdatePayload,
      buildDeletePayload,
      debouncedDatabaseSync,
      enqueueOperation,
      isConnected,
      updateMetadataSnapshot,
      updateObjects,
      userColor,
      userId,
      userName,
    ],
  )

  return {
    objects,
    metadata: metadataSnapshot,
    isLoading,
    syncObjects,
    isConnected,
    queuedOperations: queueLength,
  }
}
