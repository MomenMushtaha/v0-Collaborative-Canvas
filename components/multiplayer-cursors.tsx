"use client"

import type { UserPresence } from "@/lib/types"
import { MousePointer2 } from "lucide-react"

interface MultiplayerCursorsProps {
  users: UserPresence[]
}

export function MultiplayerCursors({ users }: MultiplayerCursorsProps) {
  return (
    <>
      {users.map((user) => {
        if (user.cursor_x === null || user.cursor_y === null) return null

        return (
          <div
            key={user.id}
            className="absolute"
            style={{
              left: `${user.cursor_x}px`,
              top: `${user.cursor_y}px`,
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
    </>
  )
}
