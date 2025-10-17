"use client"

import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import type { CanvasObject, ObjectMetadata } from "@/lib/types"
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
  version: number
  clientId: string
  userName: string
  userColor: string
}

export function useRealtimeCanvas({ canvasId, userId, userName, userColor, onConnectionChange }: UseRealtimeCanvasProps) {
  const [objects, setObjects] = useState<CanvasObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(true)
  const [objectMetadata, setObjectMetadata] = useState<Record<string, ObjectMetadata>>({})
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
  const objectClientRef = useRef<Map<string, string>>(new Map())
  const lamportClockRef = useRef<number>(Date.now())

  const queueStorageKey = useMemo(() => `v0.canvas.queue.${canvasId}.${userId}`, [canvasId, userId])
  const QUEUE_LIMIT = 100

  const stripMetadata = useCallback((obj: CanvasObject): CanvasObject => {
    const {
      last_modified_by,
      last_modified_by_name,
      last_modified_at,
      _timestamp,
      _version,
      _clientId,
      _userName,
      _userColor,
      ...rest
    } = obj as CanvasObject & {
      _timestamp?: number
      _version?: number
      _clientId?: string
      _userName?: string
      _userColor?: string
    }
    return { ...rest }
  }, [])

  const updateObjectMetadata = useCallback((id: string, metadata: ObjectMetadata | null) => {
    setObjectMetadata((prev) => {
      if (!metadata) {
        if (!(id in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[id]
        return next
      }

      const existing = prev[id]
      if (
        existing &&
        existing.lastEditedBy === metadata.lastEditedBy &&
        existing.lastEditedByName === metadata.lastEditedByName &&
        existing.lastEditedAt === metadata.lastEditedAt &&
        existing.lastEditedColor === metadata.lastEditedColor
      ) {
        return prev
      }

      return {
        ...prev,
        [id]: metadata,
      }
    })
  }, [])

  const persistQueue = useCallback(
    (queue: QueuedOperation[]) => {
      if (typeof window === "undefined") return

      if (queue.length === 0) {
        window.localStorage.removeItem(queueStorageKey)
      } else {
        try {
          window.localStorage.setItem(queueStorageKey, JSON.stringify(queue))
        } catch (error) {
          console.error("[v0] [RECONNECT] Failed to persist queue", error)
        }
      }
    },
    [queueStorageKey],
  )

  const enqueueOperation = useCallback(
    (operation: QueuedOperation) => {
      const queue = operationQueueRef.current
      queue.push(operation)
      if (queue.length > QUEUE_LIMIT) {
        queue.shift()
      }

      persistQueue(queue)
      onConnectionChangeRef.current?.(false, queue.length)
    },
    [persistQueue, QUEUE_LIMIT],
  )

  const loadPersistedQueue = useCallback(() => {
    if (typeof window === "undefined") return [] as QueuedOperation[]

    const raw = window.localStorage.getItem(queueStorageKey)
    if (!raw) return [] as QueuedOperation[]

    try {
      const parsed = JSON.parse(raw) as QueuedOperation[]
      operationQueueRef.current = parsed
      if (parsed.length > 0) {
        console.log(`[v0] [RECONNECT] Restored ${parsed.length} queued operations from storage`)
        onConnectionChangeRef.current?.(false, parsed.length)
      }
      return parsed
    } catch (error) {
      console.error("[v0] [RECONNECT] Failed to load persisted queue", error)
      return [] as QueuedOperation[]
    }
  }, [queueStorageKey])

  const applyQueuedOperationsToState = useCallback((baseObjects: CanvasObject[], queue: QueuedOperation[]) => {
    let current = [...baseObjects]

    for (const op of queue) {
      if (op.type === "create" && op.object) {
        const sanitized = stripMetadata(op.object)
        if (!current.some((obj) => obj.id === sanitized.id)) {
          current = [...current, sanitized]
        } else {
          current = current.map((obj) => (obj.id === sanitized.id ? sanitized : obj))
        }
        objectVersionsRef.current.set(sanitized.id, op.version)
        objectClientRef.current.set(sanitized.id, op.clientId)
        lamportClockRef.current = Math.max(lamportClockRef.current, op.version)
        updateObjectMetadata(sanitized.id, {
          lastEditedBy: op.clientId,
          lastEditedByName: op.userName,
          lastEditedAt: op.version,
          lastEditedColor: op.userColor,
        })
      } else if (op.type === "update" && op.object) {
        const sanitized = stripMetadata(op.object)
        current = current.map((obj) => (obj.id === sanitized.id ? sanitized : obj))
        objectVersionsRef.current.set(sanitized.id, op.version)
        objectClientRef.current.set(sanitized.id, op.clientId)
        lamportClockRef.current = Math.max(lamportClockRef.current, op.version)
        updateObjectMetadata(sanitized.id, {
          lastEditedBy: op.clientId,
          lastEditedByName: op.userName,
          lastEditedAt: op.version,
          lastEditedColor: op.userColor,
        })
      } else if (op.type === "delete" && op.objectId) {
        current = current.filter((obj) => obj.id !== op.objectId)
        objectVersionsRef.current.delete(op.objectId)
        objectClientRef.current.delete(op.objectId)
        updateObjectMetadata(op.objectId, null)
      }
    }

    return current
  }, [stripMetadata, updateObjectMetadata])

  const nextLamport = useCallback(() => {
    const now = Date.now()
    lamportClockRef.current = Math.max(lamportClockRef.current + 1, now)
    return lamportClockRef.current
  }, [])

  const recordVersion = useCallback((id: string, version: number, clientId?: string) => {
    objectVersionsRef.current.set(id, version)
    if (clientId) {
      objectClientRef.current.set(id, clientId)
    }
    lamportClockRef.current = Math.max(lamportClockRef.current, version)
  }, [])

  const shouldApplyIncoming = useCallback(
    (id: string, version: number, clientId?: string) => {
      const currentVersion = objectVersionsRef.current.get(id) ?? 0
      if (version > currentVersion) return true
      if (version < currentVersion) return false

      if (!clientId) return false
      const currentClient = objectClientRef.current.get(id)
      if (!currentClient) return true
      return clientId > currentClient
    },
    [],
  )

  const deriveMetadataForObject = useCallback(
    (obj: CanvasObject): ObjectMetadata => {
      const rawTimestamp = obj.last_modified_at || obj.updated_at || obj.created_at
      const version = rawTimestamp ? Date.parse(rawTimestamp) || Date.now() : Date.now()
      const editorId = obj.last_modified_by || obj.created_by || "unknown"
      const editorName =
        obj.last_modified_by_name ||
        (editorId === userId ? userName : editorId === "unknown" ? "Unknown" : "Collaborator")

      recordVersion(obj.id, version, editorId)

      return {
        lastEditedBy: editorId,
        lastEditedByName: editorName,
        lastEditedAt: version,
      }
    },
    [recordVersion, userId, userName],
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
        setIsLoading(false)
        return
      }

      const sanitized = (data || []).map(stripMetadata)

      const metadata: Record<string, ObjectMetadata> = {}
      sanitized.forEach((obj) => {
        metadata[obj.id] = deriveMetadataForObject(obj)
      })

      setObjectMetadata((prev) => ({ ...metadata, ...prev }))

      const restoredQueue = loadPersistedQueue()
      const withQueuedState = applyQueuedOperationsToState(sanitized, restoredQueue)

      setObjects(withQueuedState)
      pendingObjectsRef.current = withQueuedState
      setIsLoading(false)
    }

    loadObjects()
  }, [
    canvasId,
    supabase,
    stripMetadata,
    deriveMetadataForObject,
    applyQueuedOperationsToState,
    loadPersistedQueue,
  ])

  const processQueuedOperations = useCallback(async () => {
    if (operationQueueRef.current.length === 0) return

    console.log(`[v0] [RECONNECT] Processing ${operationQueueRef.current.length} queued operations`)

    const queue = [...operationQueueRef.current]
    operationQueueRef.current = []

    for (const op of queue) {
      try {
        if (op.type === "create" && op.object) {
          const sanitized = stripMetadata(op.object)
          await supabase.from("canvas_objects").insert({
            ...sanitized,
            created_by: op.clientId,
          })
          channelRef.current?.send({
            type: "broadcast",
            event: "object_created",
            payload: {
              ...sanitized,
              _timestamp: Date.now(),
              _version: op.version,
              _clientId: op.clientId,
              _userName: op.userName,
              _userColor: op.userColor,
            },
          })
        } else if (op.type === "update" && op.object) {
          const sanitized = stripMetadata(op.object)
          await supabase
            .from("canvas_objects")
            .update({
              x: sanitized.x,
              y: sanitized.y,
              width: sanitized.width,
              height: sanitized.height,
              rotation: sanitized.rotation,
              fill_color: sanitized.fill_color,
              stroke_color: sanitized.stroke_color,
              stroke_width: sanitized.stroke_width,
              text_content: sanitized.text_content,
              font_size: sanitized.font_size,
              font_family: sanitized.font_family,
              updated_at: new Date().toISOString(),
            })
            .eq("id", sanitized.id)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_updated",
            payload: {
              ...sanitized,
              _timestamp: Date.now(),
              _version: op.version,
              _clientId: op.clientId,
              _userName: op.userName,
              _userColor: op.userColor,
            },
          })
        } else if (op.type === "delete" && op.objectId) {
          await supabase.from("canvas_objects").delete().eq("id", op.objectId)
          channelRef.current?.send({
            type: "broadcast",
            event: "object_deleted",
            payload: { id: op.objectId, _timestamp: Date.now(), _version: op.version, _clientId: op.clientId },
          })
        }
      } catch (error) {
        console.error("[v0] [RECONNECT] Error processing queued operation:", error)
      }
    }

    console.log("[v0] [RECONNECT] All queued operations processed")
    persistQueue(operationQueueRef.current)
    onConnectionChangeRef.current?.(true, 0)
  }, [persistQueue, stripMetadata, supabase])

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
        const data = payload as CanvasObject & {
          _timestamp?: number
          _version?: number
          _clientId?: string
          _userName?: string
          _userColor?: string
        }

        if (data._timestamp) {
          const latency = Date.now() - data._timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (created)`)
        }

        const version = data._version ?? data._timestamp ?? Date.now()
        const clientId = data._clientId ?? "remote"

        if (!shouldApplyIncoming(data.id, version, clientId)) {
          return
        }

        recordVersion(data.id, version, clientId)

        updateObjectMetadata(data.id, {
          lastEditedBy: clientId,
          lastEditedByName: data._userName || (clientId === userId ? userName : "Collaborator"),
          lastEditedAt: version,
          lastEditedColor: data._userColor,
        })

        const sanitized = stripMetadata(data)

        setObjects((prev) => {
          if (prev.some((obj) => obj.id === sanitized.id)) {
            return prev.map((obj) => (obj.id === sanitized.id ? sanitized : obj))
          }
          return [...prev, sanitized]
        })
      })
      .on("broadcast", { event: "object_updated" }, ({ payload }) => {
        const data = payload as CanvasObject & {
          _timestamp?: number
          _version?: number
          _clientId?: string
          _userName?: string
          _userColor?: string
        }

        if (data._timestamp) {
          const latency = Date.now() - data._timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (updated)`)
        }

        const version = data._version ?? data._timestamp ?? Date.now()
        const clientId = data._clientId ?? "remote"

        if (!shouldApplyIncoming(data.id, version, clientId)) {
          return
        }

        recordVersion(data.id, version, clientId)

        updateObjectMetadata(data.id, {
          lastEditedBy: clientId,
          lastEditedByName: data._userName || (clientId === userId ? userName : "Collaborator"),
          lastEditedAt: version,
          lastEditedColor: data._userColor,
        })

        const sanitized = stripMetadata(data)

        setObjects((prev) => prev.map((obj) => (obj.id === sanitized.id ? sanitized : obj)))
      })
      .on("broadcast", { event: "object_deleted" }, ({ payload }) => {
        const data = payload as { id: string; _timestamp?: number; _version?: number; _clientId?: string }

        if (data._timestamp) {
          const latency = Date.now() - data._timestamp
          console.log(`[v0] [PERF] Object sync latency: ${latency}ms (deleted)`)
        }

        const version = data._version ?? data._timestamp ?? Date.now()
        const clientId = data._clientId ?? "remote"

        if (!shouldApplyIncoming(data.id, version, clientId)) {
          return
        }

        recordVersion(data.id, version, clientId)
        updateObjectMetadata(data.id, null)

        setObjects((prev) => prev.filter((obj) => obj.id !== data.id))
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
  }, [
    canvasId,
    supabase,
    processQueuedOperations,
    attemptReconnect,
    recordVersion,
    shouldApplyIncoming,
    stripMetadata,
    updateObjectMetadata,
    userId,
    userName,
  ])

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
          await supabase.from("canvas_objects").insert(
            newObjects.map((o) => ({
              ...o,
              created_by: userId,
            })),
          )
        } catch (error) {
          console.error("[v0] [RECONNECT] Database write failed, queueing operations")
          newObjects.forEach((obj) => {
            const version = objectVersionsRef.current.get(obj.id) ?? Date.now()
            enqueueOperation({
              type: "create",
              object: obj,
              timestamp: Date.now(),
              version,
              clientId: userId,
              userName,
              userColor,
            })
          })
        }
      }

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
            const version = objectVersionsRef.current.get(obj.id) ?? Date.now()
            enqueueOperation({
              type: "update",
              object: obj,
              timestamp: Date.now(),
              version,
              clientId: userId,
              userName,
              userColor,
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
            const version = objectVersionsRef.current.get(id) ?? Date.now()
            enqueueOperation({
              type: "delete",
              objectId: id,
              timestamp: Date.now(),
              version,
              clientId: userId,
              userName,
              userColor,
            })
          })
        }
      }

      const dbWriteTime = performance.now() - dbWriteStart
      console.log(
        `[v0] [PERF] Database write completed in ${dbWriteTime.toFixed(2)}ms (${newObjects.length} new, ${toUpdate.length} updated, ${deletedIds.length} deleted)`,
      )
    },
    [objects, supabase, userId, isConnected, enqueueOperation, userName, userColor],
  )

  const syncObjects = useCallback(
    async (incomingObjects: CanvasObject[]) => {
      const broadcastStart = performance.now()
      const sanitizedObjects = incomingObjects.map(stripMetadata)

      setObjects(sanitizedObjects)
      pendingObjectsRef.current = sanitizedObjects

      const existingById = new Map(objects.map((obj) => [obj.id, obj]))
      const incomingIds = new Set(sanitizedObjects.map((obj) => obj.id))

      const createdOps: QueuedOperation[] = []
      const updatedOps: QueuedOperation[] = []
      const deletedOps: QueuedOperation[] = []

      for (const obj of sanitizedObjects) {
        const existing = existingById.get(obj.id)
        if (!existing) {
          const version = nextLamport()
          recordVersion(obj.id, version, userId)
          updateObjectMetadata(obj.id, {
            lastEditedBy: userId,
            lastEditedByName: userName,
            lastEditedAt: version,
            lastEditedColor: userColor,
          })
          createdOps.push({
            type: "create",
            object: obj,
            timestamp: Date.now(),
            version,
            clientId: userId,
            userName,
            userColor,
          })
        } else if (JSON.stringify(existing) !== JSON.stringify(obj)) {
          const version = nextLamport()
          recordVersion(obj.id, version, userId)
          updateObjectMetadata(obj.id, {
            lastEditedBy: userId,
            lastEditedByName: userName,
            lastEditedAt: version,
            lastEditedColor: userColor,
          })
          updatedOps.push({
            type: "update",
            object: obj,
            timestamp: Date.now(),
            version,
            clientId: userId,
            userName,
            userColor,
          })
        }
      }

      const deletedIds = Array.from(existingById.keys()).filter((id) => !incomingIds.has(id))
      for (const id of deletedIds) {
        const version = nextLamport()
        recordVersion(id, version, userId)
        updateObjectMetadata(id, null)
        deletedOps.push({
          type: "delete",
          objectId: id,
          timestamp: Date.now(),
          version,
          clientId: userId,
          userName,
          userColor,
        })
      }

      const allOps = [...createdOps, ...updatedOps, ...deletedOps]
      const channel = channelRef.current

      if (!channel || !isConnected) {
        console.log("[v0] [RECONNECT] Offline - queueing operations")
        allOps.forEach((op) => enqueueOperation(op))
        return
      }

      const timestamp = Date.now()

      const sendOperation = (op: QueuedOperation) => {
        if (!channel) return
        if (op.type === "delete" && op.objectId) {
          channel.send({
            type: "broadcast",
            event: "object_deleted",
            payload: {
              id: op.objectId,
              _timestamp: timestamp,
              _version: op.version,
              _clientId: op.clientId,
            },
          })
          return
        }

        if (!op.object) return

        const payload = {
          ...op.object,
          _timestamp: timestamp,
          _version: op.version,
          _clientId: op.clientId,
          _userName: op.userName,
          _userColor: op.userColor,
        }

        channel.send({
          type: "broadcast",
          event: op.type === "create" ? "object_created" : "object_updated",
          payload,
        })
      }

      allOps.forEach(sendOperation)

      const broadcastTime = performance.now() - broadcastStart
      console.log(
        `[v0] [PERF] Broadcast completed in ${broadcastTime.toFixed(2)}ms (${allOps.length} operations)`,
      )

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        debouncedDatabaseSync(pendingObjectsRef.current)
      }, 300)

      onConnectionChangeRef.current?.(true, operationQueueRef.current.length)
    },
    [
      stripMetadata,
      objects,
      nextLamport,
      recordVersion,
      userId,
      userName,
      userColor,
      updateObjectMetadata,
      enqueueOperation,
      isConnected,
      debouncedDatabaseSync,
    ],
  )

  return {
    objects,
    isLoading,
    syncObjects,
    isConnected,
    objectMetadata,
    queuedOperations: operationQueueRef.current.length,
  }
}
