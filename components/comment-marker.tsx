"use client"

import { MessageSquare } from "lucide-react"
import type { Comment } from "@/lib/comments-utils"

interface CommentMarkerProps {
  comment: Comment
  onClick?: () => void
}

export function CommentMarker({ comment, onClick }: CommentMarkerProps) {
  return (
    <div
      className="absolute cursor-pointer group"
      style={{
        left: `${comment.x}px`,
        top: `${comment.y}px`,
        transform: "translate(-50%, -50%)",
      }}
      onClick={onClick}
    >
      <div className="relative">
        <div
          className={`rounded-full p-2 shadow-lg transition-all ${
            comment.resolved
              ? "bg-muted/80 border-2 border-muted-foreground/30"
              : "bg-blue-500 border-2 border-blue-600 animate-pulse"
          } group-hover:scale-110`}
        >
          <MessageSquare className={`h-4 w-4 ${comment.resolved ? "text-muted-foreground" : "text-white"}`} />
        </div>
        {!comment.resolved && (
          <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 border-2 border-white" />
        )}
      </div>
    </div>
  )
}
