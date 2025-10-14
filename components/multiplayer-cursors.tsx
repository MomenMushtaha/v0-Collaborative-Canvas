"use client"

import type { UserPresence } from "@/lib/types"
import { MousePointer2 } from "lucide-react"

interface MultiplayerCursorsProps {
  users: UserPresence[]
  viewportX: number
  viewportY: number
  zoom: number
}

export function MultiplayerCursors({ users, viewportX, viewportY, zoom }: MultiplayerCursorsProps) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {users.map((user) => {
        if (user.cursor_x === null || user.cursor_y === null) return null

        const screenX = user.cursor_x * zoom + viewportX
        const screenY = user.cursor_y * zoom + viewportY

        return (
          <div
            key={user.id}
            className="absolute"
            style={{
              left: `${screenX}px`,
              top: `${screenY}px`,
              transform: "translate(-2px, -2px)",
            }}
          >
            <MousePointer2 className="h-5 w-5 drop-shadow-lg" style={{ color: user.color }} fill={user.color} />
            <div
              className="mt-1 rounded px-2 py-1 text-xs font-medium text-white shadow-lg"
              style={{ backgroundColor: user.color }}
            >
              {user.user_name}
            </div>
          </div>
        )
      })}
    </div>
  )
}
