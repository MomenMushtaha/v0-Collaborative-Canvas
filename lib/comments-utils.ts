import { createBrowserClient } from "@supabase/ssr"

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

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export async function loadComments(canvasId: string): Promise<Comment[]> {
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
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] Error creating comment:", error)
    return null
  }

  return data
}

export async function updateComment(commentId: string, content: string): Promise<boolean> {
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

export async function resolveComment(commentId: string, userId: string): Promise<boolean> {
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

  return true
}

export async function deleteComment(commentId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("id", commentId)

  if (error) {
    console.error("[v0] Error deleting comment:", error)
    return false
  }

  return true
}

export async function clearAllComments(canvasId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("canvas_id", canvasId)

  if (error) {
    console.error("[v0] Error clearing all comments:", error)
    return false
  }

  return true
}

export async function clearResolvedComments(canvasId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("canvas_id", canvasId).eq("resolved", true)

  if (error) {
    console.error("[v0] Error clearing resolved comments:", error)
    return false
  }

  return true
}

export function subscribeToComments(canvasId: string, callback: (comment: Comment) => void) {
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
        callback(payload.new as Comment)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
