"use client"

import type { UserPresence } from "@/lib/types"

interface PresencePanelProps {
  currentUser: {
    userName: string
    userColor: string
  }
  otherUsers: UserPresence[]
}

export function PresencePanel({ currentUser, otherUsers }: PresencePanelProps) {
  // Consider a user online if their last_seen is within the last 10 seconds
  const isUserOnline = (lastSeen: string) => {
    const lastSeenTime = new Date(lastSeen).getTime()
    const now = Date.now()
    return now - lastSeenTime < 10000 // 10 seconds
  }

  const onlineUsers = otherUsers.filter((user) => isUserOnline(user.last_seen))
  const offlineUsers = otherUsers.filter((user) => !isUserOnline(user.last_seen))

  return (
    <div className="absolute right-4 top-[300px] z-10 w-64 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
      <h3 className="mb-3 text-sm font-semibold">Active Users</h3>

      {/* Current User */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-2 w-2 items-center justify-center">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: currentUser.userColor }} />
          <div
            className="absolute h-2 w-2 animate-ping rounded-full"
            style={{ backgroundColor: currentUser.userColor }}
          />
        </div>
        <span className="text-sm font-medium">{currentUser.userName}</span>
        <span className="ml-auto text-xs text-muted-foreground">(you)</span>
      </div>

      {/* Online Users */}
      {onlineUsers.map((user) => (
        <div key={user.user_id} className="mb-2 flex items-center gap-2">
          <div className="flex h-2 w-2 items-center justify-center">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color }} />
            <div className="absolute h-2 w-2 animate-ping rounded-full" style={{ backgroundColor: user.color }} />
          </div>
          <span className="text-sm">{user.user_name}</span>
        </div>
      ))}

      {/* Offline Users */}
      {offlineUsers.length > 0 && (
        <>
          <div className="my-2 border-t" />
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Offline</h4>
          {offlineUsers.map((user) => (
            <div key={user.user_id} className="mb-2 flex items-center gap-2 opacity-50">
              <div className="h-2 w-2 rounded-full bg-muted-foreground" />
              <span className="text-sm">{user.user_name}</span>
            </div>
          ))}
        </>
      )}

      {/* User Count */}
      <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
        {onlineUsers.length + 1} online • {offlineUsers.length} offline
      </div>
    </div>
  )
}
