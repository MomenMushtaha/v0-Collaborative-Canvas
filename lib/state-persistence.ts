import type { CanvasObject } from "./types"
import type { LastEditorMeta } from "./realtime/conflict"

const SNAPSHOT_PREFIX = "collabcanvas:snapshot:"
const QUEUE_PREFIX = "collabcanvas:queue:"

export interface PersistedSnapshot {
  objects: CanvasObject[]
  versions: Record<string, number>
  editors: Record<string, LastEditorMeta>
  savedAt: number
}

export interface PersistedQueuedOperation {
  type: "create" | "update" | "delete"
  object?: CanvasObject
  objectId?: string
  version: number
  meta: LastEditorMeta
  timestamp: number
}

function getSnapshotKey(canvasId: string) {
  return `${SNAPSHOT_PREFIX}${canvasId}`
}

function getQueueKey(canvasId: string) {
  return `${QUEUE_PREFIX}${canvasId}`
}

export function loadSnapshot(canvasId: string): PersistedSnapshot | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(getSnapshotKey(canvasId))
  if (!raw) return null

  try {
    return JSON.parse(raw) as PersistedSnapshot
  } catch (error) {
    console.warn("[v0] Failed to parse persisted snapshot", error)
    return null
  }
}

export function saveSnapshot(canvasId: string, snapshot: PersistedSnapshot) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(getSnapshotKey(canvasId), JSON.stringify(snapshot))
  } catch (error) {
    console.warn("[v0] Unable to persist snapshot", error)
  }
}

export function clearSnapshot(canvasId: string) {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(getSnapshotKey(canvasId))
}

export function loadQueuedOperations(canvasId: string): PersistedQueuedOperation[] {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(getQueueKey(canvasId))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as PersistedQueuedOperation[]
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn("[v0] Failed to parse queued operations", error)
    return []
  }
}

export function saveQueuedOperations(canvasId: string, queue: PersistedQueuedOperation[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(getQueueKey(canvasId), JSON.stringify(queue))
  } catch (error) {
    console.warn("[v0] Unable to persist queued operations", error)
  }
}

export function clearQueuedOperations(canvasId: string) {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(getQueueKey(canvasId))
}
