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
    <div className="absolute right-4 top-20 z-10 w-72 max-h-[280px] rounded-xl border border-border/40 bg-card/95 shadow-2xl backdrop-blur-lg overflow-hidden flex flex-col transition-all duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)]">
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/40 to-transparent border-b border-border/30">
        <h3 className="text-center text-sm font-semibold tracking-wide text-foreground/90 uppercase">Active Users</h3>
      </div>

      <div className="p-4 flex-shrink-0">
        <div className="mb-3 flex items-center gap-3 rounded-lg p-3 bg-primary/5 border border-primary/10 transition-all duration-200 hover:bg-primary/10 hover:border-primary/20">
          <div className="relative flex h-2.5 w-2.5 items-center justify-center">
            <div
              className="h-2.5 w-2.5 rounded-full shadow-lg ring-2 ring-background"
              style={{ backgroundColor: currentUser.userColor }}
            />
            <div
              className="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-75"
              style={{ backgroundColor: currentUser.userColor }}
            />
          </div>
          <span className="text-sm font-semibold flex-1">{currentUser.userName}</span>
          <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-muted/50">(you)</span>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-2">
        {onlineUsers.length > 0 && (
          <div className="space-y-1.5">
            {onlineUsers.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center gap-3 rounded-lg p-2.5 transition-all duration-200 hover:bg-accent/60 hover:translate-x-1 hover:shadow-sm"
              >
                <div className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <div
                    className="h-2.5 w-2.5 rounded-full shadow-md ring-2 ring-background"
                    style={{ backgroundColor: user.color }}
                  />
                  <div
                    className="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-75"
                    style={{ backgroundColor: user.color }}
                  />
                </div>
                <span className="text-sm font-medium">{user.user_name}</span>
              </div>
            ))}
          </div>
        )}

        {offlineUsers.length > 0 && (
          <>
            <div className="my-4 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
            <h4 className="mb-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Offline
            </h4>
            <div className="space-y-1.5">
              {offlineUsers.map((user) => (
                <div
                  key={user.user_id}
                  className="flex items-center gap-3 rounded-lg p-2.5 opacity-50 transition-all duration-200 hover:opacity-70 hover:bg-accent/40 hover:translate-x-0.5"
                >
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 ring-2 ring-background" />
                  <span className="text-sm text-muted-foreground">{user.user_name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      <div className="flex-shrink-0 px-4 py-3 border-t border-border/40 bg-gradient-to-t from-muted/30 to-transparent">
        <div className="flex items-center justify-center gap-3 text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 shadow-sm shadow-green-500/50 animate-pulse" />
            <span>{onlineUsers.length + 1} online</span>
          </span>
          <span className="text-border/60">•</span>
          <span className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span>{offlineUsers.length} offline</span>
          </span>
        </div>
      </div>
    </div>
  )
}
