"use client"

import type { UserPresence } from "@/lib/types"
import { ScrollArea } from "@/components/ui/scroll-area"

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
    <div className="absolute right-4 top-20 z-10 w-64 max-h-[260px] rounded-xl border border-border/50 bg-background/95 shadow-xl backdrop-blur-md overflow-hidden flex flex-col transition-all duration-200 hover:shadow-2xl">
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent">
        <h3 className="mb-4 text-sm font-semibold tracking-tight">Active Users</h3>

        {/* Current User */}
        <div className="mb-2 flex items-center gap-3 rounded-md p-2 -mx-2 transition-colors hover:bg-accent/50">
          <div className="relative flex h-2 w-2 items-center justify-center">
            <div className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: currentUser.userColor }} />
            <div
              className="absolute h-2 w-2 animate-ping rounded-full opacity-75"
              style={{ backgroundColor: currentUser.userColor }}
            />
          </div>
          <span className="text-sm font-medium flex-1">{currentUser.userName}</span>
          <span className="text-xs text-muted-foreground font-medium">(you)</span>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-2">
        {/* Online Users */}
        {onlineUsers.length > 0 && (
          <div className="space-y-1">
            {onlineUsers.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center gap-3 rounded-md p-2 -mx-2 transition-all duration-150 hover:bg-accent/50 hover:translate-x-0.5"
              >
                <div className="relative flex h-2 w-2 items-center justify-center">
                  <div className="h-2 w-2 rounded-full shadow-sm" style={{ backgroundColor: user.color }} />
                  <div
                    className="absolute h-2 w-2 animate-ping rounded-full opacity-75"
                    style={{ backgroundColor: user.color }}
                  />
                </div>
                <span className="text-sm">{user.user_name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Offline Users */}
        {offlineUsers.length > 0 && (
          <>
            <div className="my-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <h4 className="mb-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Offline</h4>
            <div className="space-y-1">
              {offlineUsers.map((user) => (
                <div
                  key={user.user_id}
                  className="flex items-center gap-3 rounded-md p-2 -mx-2 opacity-60 transition-all duration-150 hover:opacity-80 hover:bg-accent/30"
                >
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                  <span className="text-sm text-muted-foreground">{user.user_name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      <div className="flex-shrink-0 px-4 py-3 border-t border-border/50 bg-muted/20">
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            {onlineUsers.length + 1} online
          </span>
          <span className="text-border">•</span>
          <span className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            {offlineUsers.length} offline
          </span>
        </div>
      </div>
    </div>
  )
}
