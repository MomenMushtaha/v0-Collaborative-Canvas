import type { SupabaseClient } from "@supabase/supabase-js"

export interface Comment {
  id: string
  canvas_id: string
  x: number
  y: number
  content: string
  created_by: string
  created_by_name: string
  created_at: string
  updated_at: string
  resolved: boolean
  resolved_by?: string
  resolved_at?: string
}

export async function loadComments(supabase: SupabaseClient, canvasId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("canvas_comments")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error loading comments:", error)
    return []
  }

  return data || []
}

export async function createComment(
  supabase: SupabaseClient,
  canvasId: string,
  x: number,
  y: number,
  content: string,
  userId: string,
  userName: string,
): Promise<Comment | null> {
  const { data, error } = await supabase
    .from("canvas_comments")
    .insert({
      canvas_id: canvasId,
      x,
      y,
      content,
      created_by: userId,
      created_by_name: userName,
      resolved: false, // Explicitly set to false for new comments
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Error creating comment:", error)
    return null
  }

  console.log("[v0] Created comment:", data)
  return data
}

export async function updateComment(supabase: SupabaseClient, commentId: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from("canvas_comments")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", commentId)

  if (error) {
    console.error("[v0] Error updating comment:", error)
    return false
  }

  return true
}

export async function resolveComment(supabase: SupabaseClient, commentId: string, userId: string): Promise<boolean> {
  console.log("[v0] resolveComment called with:", { commentId, userId })

  const { error } = await supabase
    .from("canvas_comments")
    .update({
      resolved: true,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", commentId)

  if (error) {
    console.error("[v0] Error resolving comment:", error)
    return false
  }

  console.log("[v0] Comment resolved successfully")
  return true
}

export async function deleteComment(supabase: SupabaseClient, commentId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("id", commentId)

  if (error) {
    console.error("[v0] Error deleting comment:", error)
    return false
  }

  return true
}

export async function clearAllComments(supabase: SupabaseClient, canvasId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("canvas_id", canvasId)

  if (error) {
    console.error("[v0] Error clearing all comments:", error)
    return false
  }

  return true
}

export async function clearResolvedComments(supabase: SupabaseClient, canvasId: string): Promise<boolean> {
  console.log("[v0] clearResolvedComments called with canvasId:", canvasId)

  const { error } = await supabase.from("canvas_comments").delete().eq("canvas_id", canvasId).eq("resolved", true)

  if (error) {
    console.error("[v0] Error clearing resolved comments:", error)
    return false
  }

  console.log("[v0] Resolved comments cleared successfully")
  return true
}

export type CommentRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE"
  comment: Comment
}

export function subscribeToComments(
  supabase: SupabaseClient,
  canvasId: string,
  callback: (event: CommentRealtimeEvent) => void,
) {
  const channel = supabase
    .channel(`comments:${canvasId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "canvas_comments",
        filter: `canvas_id=eq.${canvasId}`,
      },
      (payload) => {
        callback({
          type: "INSERT",
          comment: payload.new as Comment,
        })
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "canvas_comments",
        filter: `canvas_id=eq.${canvasId}`,
      },
      (payload) => {
        callback({
          type: "UPDATE",
          comment: payload.new as Comment,
        })
      },
    )
    .on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "canvas_comments",
        filter: `canvas_id=eq.${canvasId}`,
      },
      (payload) => {
        callback({
          type: "DELETE",
          comment: payload.old as Comment,
        })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
