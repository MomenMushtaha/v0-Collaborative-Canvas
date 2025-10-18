"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject } from "@/lib/types"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface LWWMetadata {
  version: number
  timestamp: number
}

interface EditorMetadata {
  userId: string
  userName: string
  userColor: string
}

interface ReconciledState {
  next: CanvasObject[]
  created: CanvasObject[]
  updated: CanvasObject[]
  deleted: CanvasObject[]
}

function getLogicalTimestamp(object: Partial<CanvasObject>, fallback = 0): number {
  if (typeof object.last_modified_at === "number") {
    return object.last_modified_at
  }

  if (object.updated_at) {
    const parsed = new Date(object.updated_at).getTime()
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return fallback
}

function shouldAcceptUpdate(existing: CanvasObject | undefined, incoming: CanvasObject, metadata: LWWMetadata): boolean {
  if (!existing) return true

  const currentVersion = existing.version ?? 0
  const incomingVersion = incoming.version ?? metadata.version

  if (incomingVersion > currentVersion) {
    return true
  }

  if (incomingVersion < currentVersion) {
    return false
  }

  const existingTs = getLogicalTimestamp(existing, 0)
  const incomingTs = getLogicalTimestamp(incoming, metadata.timestamp)

  return incomingTs >= existingTs
}

function stripLocalOnlyFields<T extends CanvasObject>(object: T) {
  const { version, last_modified_at, last_modified_by, last_modified_color, last_modified_name, ...rest } = object
  return rest
}

function hasObjectChanged(previous: CanvasObject | undefined, next: CanvasObject): boolean {
  if (!previous) return true

  return (
    previous.x !== next.x ||
    previous.y !== next.y ||
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.rotation !== next.rotation ||
    previous.fill_color !== next.fill_color ||
    previous.stroke_color !== next.stroke_color ||
    previous.stroke_width !== next.stroke_width ||
    previous.text_content !== next.text_content ||
    previous.font_size !== next.font_size ||
    previous.font_family !== next.font_family ||
    previous.z !== next.z ||
    previous.visible !== next.visible ||
    previous.locked !== next.locked ||
    previous.shape !== next.shape ||
    previous.content !== next.content
  )
}

function reconcileObjects(
  previousObjects: CanvasObject[],
  proposedObjects: CanvasObject[],
  editor: EditorMetadata,
  timestamp: number,
): ReconciledState {
  const previousMap = new Map(previousObjects.map((obj) => [obj.id, obj]))
  const seenIds = new Set<string>()

  const created: CanvasObject[] = []
  const updated: CanvasObject[] = []

  const nextObjects = proposedObjects.map((candidate) => {
    const prev = previousMap.get(candidate.id)
    seenIds.add(candidate.id)

    if (!prev) {
      const createdObject: CanvasObject = {
        ...candidate,
        version: 1,
        last_modified_by: editor.userId,
        last_modified_name: editor.userName,
        last_modified_color: editor.userColor,
        last_modified_at: timestamp,
        updated_at: new Date(timestamp).toISOString(),
      }

      created.push(createdObject)
      return createdObject
    }

    if (!hasObjectChanged(prev, candidate)) {
      return prev
    }

    const nextVersion = (prev.version ?? 0) + 1

    const updatedObject: CanvasObject = {
      ...prev,
      ...candidate,
      version: nextVersion,
      last_modified_by: editor.userId,
      last_modified_name: editor.userName,
      last_modified_color: editor.userColor,
      last_modified_at: timestamp,
      updated_at: new Date(timestamp).toISOString(),
    }

    updated.push(updatedObject)
    return updatedObject
  })

  const deleted = previousObjects
    .filter((obj) => !seenIds.has(obj.id))
    .map((obj) => ({
      ...obj,
      version: (obj.version ?? 0) + 1,
      last_modified_by: editor.userId,
      last_modified_name: editor.userName,
      last_modified_color: editor.userColor,
      last_modified_at: timestamp,
      updated_at: new Date(timestamp).toISOString(),
    }))

  return {
    next: nextObjects,
    created,
    updated,
    deleted,
  }
}

function normaliseIncomingObject(payload: any): CanvasObject {
  const { _timestamp, ...rest } = payload || {}
  const candidate: CanvasObject = {
    ...(rest as CanvasObject),
  }

  if (candidate.last_modified_at && typeof candidate.last_modified_at === "string") {
    const parsed = Number(candidate.last_modified_at)
    candidate.last_modified_at = Number.isFinite(parsed) ? parsed : new Date(candidate.last_modified_at).getTime()
  }

  if (!candidate.version || candidate.version < 1) {
    candidate.version = 1
  }

  if (!candidate.last_modified_at && candidate.updated_at) {
    const parsed = new Date(candidate.updated_at).getTime()
    candidate.last_modified_at = Number.isFinite(parsed) ? parsed : undefined
  }

  return candidate
}

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
  version?: number
  timestamp: number
}

export function useRealtimeCanvas({ canvasId, userId, userName, userColor, onConnectionChange }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const supabase = createClient()

  const syncTimeoutRef = useRef<NodeJS.Timeout>()
  const pendingObjectsRef = useRef<CanvasObject[]>([])
  const objectsRef = useRef<CanvasObject[]>([])
  const channelRef = useRef<RealtimeChannel>()
  const operationQueueRef = useRef<QueuedOperation[]>([])
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const onConnectionChangeRef = useRef(onConnectionChange)
  const lastStatusRef = useRef<string>("")
  const editorRef = useRef<EditorMetadata>({ userId, userName, userColor })

  useEffect(() => {
    editorRef.current = { userId, userName, userColor }
  }, [userId, userName, userColor])

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

      const initialObjects = (data || []).map((row) => {
        const candidate = normaliseIncomingObject(row)
        if (!candidate.last_modified_at && candidate.updated_at) {
          const parsed = new Date(candidate.updated_at).getTime()
          candidate.last_modified_at = Number.isFinite(parsed) ? parsed : undefined
        }
        return candidate
      })

      objectsRef.current = initialObjects
      setObjects(initialObjects)
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
        const now = Date.now()

        if (op.type === "create" && op.object) {
          await supabase.from("canvas_objects").insert({
            ...stripLocalOnlyFields(op.object),
            created_by: userId,
          })
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: { ...op.object, _timestamp: now },
          })
        } else if (op.type === "update" && op.object) {
          await supabase
            .from("canvas_objects")
            .update({
              ...stripLocalOnlyFields(op.object),
              updated_at: op.object.updated_at ?? new Date(now).toISOString(),
            })
            .eq("id", op.object.id)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: { ...op.object, _timestamp: now },
          })
        } else if (op.type === "delete") {
          const objectId = op.objectId ?? op.object?.id
          if (!objectId) continue

          await supabase.from("canvas_objects").delete().eq("id", objectId)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: {
              id: objectId,
              version: op.version ?? op.object?.version,
              last_modified_by: op.object?.last_modified_by ?? editorRef.current.userId,
              last_modified_name: op.object?.last_modified_name ?? editorRef.current.userName,
              last_modified_color: op.object?.last_modified_color ?? editorRef.current.userColor,
              last_modified_at: op.object?.last_modified_at ?? now,
              _timestamp: now,
            },
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
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }

        const incoming = normaliseIncomingObject(payload)
        const metadata: LWWMetadata = {
          version: incoming.version ?? 1,
          timestamp: timestamp ?? incoming.last_modified_at ?? Date.now(),
        }

        setObjects((prev) => {
          const existing = prev.find((obj) => obj.id === incoming.id)
          if (!shouldAcceptUpdate(existing, incoming, metadata)) {
            return prev
          }

          const next = existing
            ? prev.map((obj) => (obj.id === incoming.id ? { ...obj, ...incoming } : obj))
            : [...prev, incoming]

          objectsRef.current = next
          pendingObjectsRef.current = next
          return next
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const timestamp = (payload as any)._timestamp
        if (timestamp) {
          const latency = Date.now() - timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        const incoming = normaliseIncomingObject(payload)
        const metadata: LWWMetadata = {
          version: incoming.version ?? 1,
          timestamp: timestamp ?? incoming.last_modified_at ?? Date.now(),
        }

        setObjects((prev) => {
          const existing = prev.find((obj) => obj.id === incoming.id)
          if (!shouldAcceptUpdate(existing, incoming, metadata)) {
            return prev
          }

          const next = prev.map((obj) => (obj.id === incoming.id ? { ...obj, ...incoming } : obj))
          objectsRef.current = next
          pendingObjectsRef.current = next
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
          const existing = prev.find((obj) => obj.id === payload.id)
          if (!existing) return prev

          const incomingTimestamp =
            (payload as any).last_modified_at ?? timestamp ?? existing.last_modified_at ?? Date.now()
          const incomingVersion = (payload as any).version ?? (existing.version ?? 0) + 1

          const incoming: CanvasObject = {
            ...existing,
            version: incomingVersion,
            last_modified_by: (payload as any).last_modified_by ?? existing.last_modified_by,
            last_modified_name: (payload as any).last_modified_name ?? existing.last_modified_name,
            last_modified_color: (payload as any).last_modified_color ?? existing.last_modified_color,
            last_modified_at: incomingTimestamp,
          }

          if (!shouldAcceptUpdate(existing, incoming, { version: incomingVersion, timestamp: incomingTimestamp })) {
            return prev
          }

          const next = prev.filter((obj) => obj.id !== payload.id)
          objectsRef.current = next
          pendingObjectsRef.current = next
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

      const currentObjects = objectsRef.current
      const existingIds = new Set(currentObjects.map((o) => o.id))
      const updatedIds = new Set(updatedObjects.map((o) => o.id))

      const newObjects = updatedObjects.filter((o) => !existingIds.has(o.id))
      if (newObjects.length > 0) {
        try {
          await supabase.from("canvas_objects").insert(
            newObjects.map((o) => ({
              ...stripLocalOnlyFields(o),
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
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const toUpdate = updatedObjects.filter((o) => existingIds.has(o.id))
      for (const obj of toUpdate) {
        const existing = currentObjects.find((o) => o.id === obj.id)
        if (existing && hasObjectChanged(existing, obj)) {
          try {
            await supabase
              .from("canvas_objects")
              .update({
                ...stripLocalOnlyFields(obj),
                updated_at: obj.updated_at ?? new Date().toISOString(),
              })
              .eq("id", obj.id)
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
      }

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
          onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [objects, supabase, userId, isConnected],
  )

  const syncObjects = useCallback(
    async (proposedObjects: CanvasObject[]) => {
      const previousObjects = objectsRef.current
      const now = Date.now()
      const editor = editorRef.current

      const { next, created, updated, deleted } = reconcileObjects(previousObjects, proposedObjects, editor, now)

      if (created.length === 0 && updated.length === 0 && deleted.length === 0 && previousObjects.length === proposedObjects.length) {
        return
      }

      objectsRef.current = next
      pendingObjectsRef.current = next
      setObjects(next)

      const channel = channelRef.current
      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")

        created.forEach((obj) => {
          operationQueueRef.current.push({
            type: "create",
            object: obj,
            timestamp: now,
          })
        })

        updated.forEach((obj) => {
          operationQueueRef.current.push({
            type: "update",
            object: obj,
            timestamp: now,
          })
        })

        deleted.forEach((obj) => {
          operationQueueRef.current.push({
            type: "delete",
            objectId: obj.id,
            object: obj,
            version: obj.version,
            timestamp: now,
          })
        })

        onConnectionChangeRef.current?.(false, operationQueueRef.current.length)
        return
      }

      const broadcastStart = performance.now()

      for (const obj of created) {
        channel.send({
          type: "broadcast",
          event: "object_created",
          payload: { ...obj, _timestamp: now },
        })
      }

      for (const obj of updated) {
        channel.send({
          type: "broadcast",
          event: "object_updated",
          payload: { ...obj, _timestamp: now },
        })
      }

      for (const obj of deleted) {
        channel.send({
          type: "broadcast",
          event: "object_deleted",
          payload: {
            id: obj.id,
            version: obj.version,
            last_modified_by: obj.last_modified_by,
            last_modified_name: obj.last_modified_name,
            last_modified_color: obj.last_modified_color,
            last_modified_at: obj.last_modified_at,
            _timestamp: now,
          },
        })
      }

      const operationsCount = created.length + updated.length + deleted.length
      const broadcastTime = performance.now() - broadcastStart
      console.log(`[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${operationsCount} operations)`)

      if (operationsCount === 0) {
        return
      }

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)
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
