"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Check, Trash2, X } from "lucide-react"
import {
  resolveComment,
  deleteComment,
  clearAllComments,
  clearResolvedComments,
  type Comment,
} from "@/lib/comments-utils"
import { formatDistanceToNow } from "date-fns"

interface CommentsPanelProps {
  canvasId: string
  userId: string
  onCommentClick?: (x: number, y: number) => void
  comments: Comment[]
  onCommentsChange: () => void
}

export function CommentsPanel({ canvasId, userId, onCommentClick, comments, onCommentsChange }: CommentsPanelProps) {
  const [showResolved, setShowResolved] = useState(false)

  const filteredComments = showResolved ? comments : comments.filter((c) => !c.resolved)

  const handleResolve = async (commentId: string) => {
    const success = await resolveComment(commentId, userId)
    if (success) {
      onCommentsChange()
    }
  }

  const handleDelete = async (commentId: string) => {
    const success = await deleteComment(commentId)
    if (success) {
      onCommentsChange()
    }
  }

  const handleClearAll = async () => {
    if (!confirm("Are you sure you want to delete all comments? This action cannot be undone.")) {
      return
    }

    const success = await clearAllComments(canvasId)
    if (success) {
      onCommentsChange()
    }
  }

  const handleClearResolved = async () => {
    const resolvedCount = comments.filter((c) => c.resolved).length
    if (resolvedCount === 0) {
      alert("No resolved comments to clear.")
      return
    }

    if (
      !confirm(`Are you sure you want to delete ${resolvedCount} resolved comment(s)? This action cannot be undone.`)
    ) {
      return
    }

    const success = await clearResolvedComments(canvasId)
    if (success) {
      onCommentsChange()
    }
  }

  return (
    <div className="fixed left-4 bottom-4 z-40 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden transition-all duration-200 hover:shadow-2xl flex flex-col w-4/12">
      {/* Header */}
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent">
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-center">Comments</h3>
        {comments.length > 0 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant={showResolved ? "ghost" : "default"}
              size="sm"
              onClick={() => setShowResolved(false)}
              className="text-xs"
            >
              Active ({comments.filter((c) => !c.resolved).length})
            </Button>
            <Button
              variant={showResolved ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowResolved(true)}
              className="text-xs"
            >
              Resolved ({comments.filter((c) => c.resolved).length})
            </Button>
          </div>
        )}
      </div>

      {comments.length > 0 ? (
        <ScrollArea className="flex-1 h-[200px]">
          <div className="space-y-2 p-4">
            {filteredComments.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {showResolved ? "No resolved comments" : "No active comments"}
              </div>
            ) : (
              filteredComments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-border/50 bg-card/50 p-3 hover:bg-card/80 transition-colors cursor-pointer space-y-2"
                  onClick={() => onCommentClick?.(comment.x, comment.y)}
                >
                  <div className="flex items-start justify-between gap-2 mx-2.5 my-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate mx-0">{comment.created_by_name}</p>
                      <p className="text-xs text-muted-foreground px-0">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {!comment.resolved && (
                      <div className="flex items-center gap-0.5 my-0 mx-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleResolve(comment.id)
                          }}
                          title="Resolve"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        {comment.created_by === userId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(comment.id)
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-sm break-words max-h-20 overflow-y-auto bg-muted/30 p-2 py-1.5 rounded-none leading-5 px-0 mx-5">
                    {comment.content}
                  </p>
                  {comment.resolved && (
                    <p className="text-xs text-muted-foreground italic">
                      Resolved {formatDistanceToNow(new Date(comment.resolved_at!), { addSuffix: true })}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="p-4 text-center text-sm text-muted-foreground">No comments yet</div>
      )}

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border/50 bg-gradient-to-t from-muted/20 to-transparent space-y-2">
        {comments.length > 0 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearResolved}
              className="text-xs text-muted-foreground hover:text-foreground"
              disabled={comments.filter((c) => c.resolved).length === 0}
            >
              <X className="h-3 w-3 mr-1" />
              Clear Resolved
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="text-xs text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          </div>
        )}
        <p className="text-xs text-center text-muted-foreground">Click canvas to add comment (C key)</p>
      </div>
    </div>
  )
}
