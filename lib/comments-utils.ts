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

export type CommentChange =
  | { event: "INSERT"; new: Comment }
  | { event: "UPDATE"; new: Comment }
  | { event: "DELETE"; old: Comment }

export type CommentBroadcast =
  | { type: "comment_added"; comment: Comment }
  | { type: "comment_updated"; comment: Comment }
  | { type: "comment_deleted"; commentId: string }

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
      resolved: false,
    })
    .select()
    .single()

  if (error) {
    console.error("[v0] [COMMENTS] Error creating comment:", error)
    return null
  }

  console.log("[v0] [COMMENTS] Created comment:", data)

  const channel = supabase.channel(`canvas:${canvasId}:comments`)
  await channel.send({
    type: "broadcast",
    event: "comment_change",
    payload: { type: "comment_added", comment: data },
  })
  console.log("[v0] [COMMENTS] Broadcasted new comment to other users")

  return data
}

export async function updateComment(
  supabase: SupabaseClient,
  commentId: string,
  content: string,
  canvasId: string,
): Promise<Comment | null> {
  const { data, error } = await supabase
    .from("canvas_comments")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .select()
    .single()

  if (error) {
    console.error("[v0] [COMMENTS] Error updating comment:", error)
    return null
  }

  console.log("[v0] [COMMENTS] Updated comment:", data)

  const channel = supabase.channel(`canvas:${canvasId}:comments`)
  await channel.send({
    type: "broadcast",
    event: "comment_change",
    payload: { type: "comment_updated", comment: data },
  })
  console.log("[v0] [COMMENTS] Broadcasted comment update to other users")

  return data
}

export async function resolveComment(
  supabase: SupabaseClient,
  commentId: string,
  userId: string,
  canvasId: string,
): Promise<Comment | null> {
  console.log("[v0] [COMMENTS] resolveComment called with:", { commentId, userId })

  const { data, error } = await supabase
    .from("canvas_comments")
    .update({
      resolved: true,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", commentId)
    .select()
    .single()

  if (error) {
    console.error("[v0] [COMMENTS] Error resolving comment:", error)
    return null
  }

  console.log("[v0] [COMMENTS] Comment resolved successfully:", data)

  const channel = supabase.channel(`canvas:${canvasId}:comments`)
  await channel.send({
    type: "broadcast",
    event: "comment_change",
    payload: { type: "comment_updated", comment: data },
  })
  console.log("[v0] [COMMENTS] Broadcasted comment resolution to other users")

  return data
}

export async function deleteComment(supabase: SupabaseClient, commentId: string, canvasId: string): Promise<boolean> {
  const { error } = await supabase.from("canvas_comments").delete().eq("id", commentId)

  if (error) {
    console.error("[v0] [COMMENTS] Error deleting comment:", error)
    return false
  }

  console.log("[v0] [COMMENTS] Comment deleted successfully")

  const channel = supabase.channel(`canvas:${canvasId}:comments`)
  await channel.send({
    type: "broadcast",
    event: "comment_change",
    payload: { type: "comment_deleted", commentId },
  })
  console.log("[v0] [COMMENTS] Broadcasted comment deletion to other users")

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

export function subscribeToComments(
  supabase: SupabaseClient,
  canvasId: string,
  callback: (change: CommentChange) => void,
) {
  console.log("[v0] [COMMENTS] Creating subscription channel for canvas:", canvasId)

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
        console.log("[v0] [COMMENTS] Received INSERT from Supabase:", payload)
        callback({ event: "INSERT", new: payload.new as Comment })
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
        console.log("[v0] [COMMENTS] Received UPDATE from Supabase:", payload)
        callback({ event: "UPDATE", new: payload.new as Comment })
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
        console.log("[v0] [COMMENTS] Received DELETE from Supabase:", payload)
        callback({ event: "DELETE", old: payload.old as Comment })
      },
    )
    .subscribe((status) => {
      console.log("[v0] [COMMENTS] Subscription status changed:", status)

      if (status === "SUBSCRIBED") {
        console.log("[v0] [COMMENTS] ✅ Successfully subscribed to real-time comments")
      } else if (status === "CHANNEL_ERROR") {
        console.error("[v0] [COMMENTS] ❌ Channel error - subscription failed")
      } else if (status === "TIMED_OUT") {
        console.error("[v0] [COMMENTS] ❌ Subscription timed out")
      } else if (status === "CLOSED") {
        console.log("[v0] [COMMENTS] Subscription closed")
      }
    })

  console.log("[v0] [COMMENTS] Channel created and subscribing...")

  return () => {
    console.log("[v0] [COMMENTS] Unsubscribing from channel")
    supabase.removeChannel(channel)
  }
}

export function subscribeToCommentBroadcasts(
  supabase: SupabaseClient,
  canvasId: string,
  callback: (broadcast: CommentBroadcast) => void,
) {
  console.log("[v0] [COMMENTS] Setting up broadcast subscription for canvas:", canvasId)

  const channel = supabase
    .channel(`canvas:${canvasId}:comments`)
    .on("broadcast", { event: "comment_change" }, (payload) => {
      console.log("[v0] [COMMENTS] Received broadcast:", payload)
      callback(payload.payload as CommentBroadcast)
    })
    .subscribe((status) => {
      console.log("[v0] [COMMENTS] Broadcast subscription status:", status)

      if (status === "SUBSCRIBED") {
        console.log("[v0] [COMMENTS] ✅ Successfully subscribed to comment broadcasts")
      } else if (status === "CHANNEL_ERROR") {
        console.error("[v0] [COMMENTS] ❌ Broadcast channel error")
      } else if (status === "TIMED_OUT") {
        console.error("[v0] [COMMENTS] ❌ Broadcast subscription timed out")
      }
    })

  return () => {
    console.log("[v0] [COMMENTS] Unsubscribing from comment broadcasts")
    supabase.removeChannel(channel)
  }
}
