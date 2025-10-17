import type { CanvasObject } from "./types"
import { createClient } from "./supabase/client"

export interface HistorySnapshot {
  id: string
  canvas_id: string
  snapshot: CanvasObject[]
  created_by: string
  created_by_name: string
  created_at: string
  description?: string
  object_count: number
}

export async function saveHistorySnapshot(
  canvasId: string,
  objects: CanvasObject[],
  userId: string,
  userName: string,
  description?: string,
): Promise<void> {
  const supabase = createClient()

  const { error } = await supabase.from("canvas_history").insert({
    canvas_id: canvasId,
    snapshot: objects,
    created_by: userId,
    created_by_name: userName,
    description,
    object_count: objects.length,
  })

  if (error) {
    console.error("[v0] Failed to save history snapshot:", error)
    throw error
  }

  console.log("[v0] History snapshot saved:", { canvasId, objectCount: objects.length, description })
}

export async function loadHistorySnapshots(canvasId: string, limit = 20): Promise<HistorySnapshot[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("canvas_history")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[v0] Failed to load history snapshots:", error)
    throw error
  }

  return (data || []) as HistorySnapshot[]
}

export async function restoreHistorySnapshot(snapshotId: string): Promise<CanvasObject[]> {
  const supabase = createClient()

  const { data, error } = await supabase.from("canvas_history").select("snapshot").eq("id", snapshotId).single()

  if (error) {
    console.error("[v0] Failed to restore history snapshot:", error)
    throw error
  }

  console.log("[v0] History snapshot restored:", snapshotId)
  return data.snapshot as CanvasObject[]
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}
