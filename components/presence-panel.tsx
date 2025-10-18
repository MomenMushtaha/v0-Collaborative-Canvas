"use client"

import type { UserPresence } from "@/lib/types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Users } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PresencePanelProps {
  currentUser: {
    userName: string
    userColor: string
  }
  otherUsers: UserPresence[]
  topPosition?: number
  onCollapseChange?: (collapsed: boolean) => void
}

export function PresencePanel({ currentUser, otherUsers, topPosition = 80, onCollapseChange }: PresencePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  const handleCollapseToggle = (collapsed: boolean) => {
    setIsCollapsed(collapsed)
    onCollapseChange?.(collapsed)
  }

  // Consider a user online if their last_seen is within the last 10 seconds
  const isUserOnline = (lastSeen: string) => {
    const lastSeenTime = new Date(lastSeen).getTime()
    const now = Date.now()
    return now - lastSeenTime < 10000 // 10 seconds
  }

  const uniqueUsers = useMemo(() => {
    const userMap = new Map<string, UserPresence>()
    otherUsers.forEach((user) => {
      const existing = userMap.get(user.user_id)
      // Keep the most recent entry for each user_id
      if (!existing || new Date(user.last_seen) > new Date(existing.last_seen)) {
        userMap.set(user.user_id, user)
      }
    })
    return Array.from(userMap.values())
  }, [otherUsers])

  const onlineUsers = uniqueUsers.filter((user) => isUserOnline(user.last_seen))
  const offlineUsers = uniqueUsers.filter((user) => !isUserOnline(user.last_seen))

  if (isCollapsed) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleCollapseToggle(false)}
        className="absolute right-4 z-10 h-10 px-3 rounded-lg border-border/50 bg-background/95 backdrop-blur-md shadow-xl hover:shadow-2xl transition-all duration-200"
        style={{ top: `${topPosition}px` }}
      >
        <Users className="h-4 w-4 mr-2" />
        <span className="text-xs font-medium">{onlineUsers.length + 1} Active</span>
        <ChevronDown className="h-4 w-4 ml-2" />
      </Button>
    )
  }

  return (
    <div
      className="absolute right-4 z-10 w-64 max-h-[260px] rounded-xl border border-border/50 bg-background/95 shadow-xl backdrop-blur-md overflow-hidden flex flex-col transition-all duration-200 hover:shadow-2xl"
      style={{ top: `${topPosition}px` }}
    >
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold tracking-tight flex-1 text-center">Active Users</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCollapseToggle(true)}
            className="h-6 w-6 p-0 hover:bg-accent/50 -mr-2"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>

        {/* Current User */}
        <div className="mb-2 flex items-center gap-3 rounded-lg p-2.5 -mx-2 transition-all duration-150 hover:bg-accent/50 hover:shadow-sm">
          <div className="relative flex h-2.5 w-2.5 items-center justify-center">
            <div
              className="h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-background"
              style={{ backgroundColor: currentUser.userColor }}
            />
            <div
              className="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-75"
              style={{ backgroundColor: currentUser.userColor }}
            />
          </div>
          <span className="text-sm font-medium flex-1">{currentUser.userName}</span>
          <span className="text-xs text-muted-foreground font-medium bg-muted/50 px-2 py-0.5 rounded-full">(you)</span>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-2">
        {/* Online Users */}
        {onlineUsers.length > 0 && (
          <div className="space-y-1">
            {onlineUsers.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center gap-3 rounded-lg p-2.5 -mx-2 transition-all duration-150 hover:bg-accent/50 hover:translate-x-0.5 hover:shadow-sm"
              >
                <div className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <div
                    className="h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-background"
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

        {/* Offline Users */}
        {offlineUsers.length > 0 && (
          <>
            <div className="my-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
              Offline
            </h4>
            <div className="space-y-1">
              {offlineUsers.map((user) => (
                <div
                  key={user.user_id}
                  className="flex items-center gap-3 rounded-lg p-2.5 -mx-2 opacity-60 transition-all duration-150 hover:opacity-80 hover:bg-accent/30"
                >
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 ring-2 ring-background" />
                  <span className="text-sm text-muted-foreground">{user.user_name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </ScrollArea>

      <div className="flex-shrink-0 px-4 py-3 border-t border-border/50 bg-gradient-to-t from-muted/20 to-transparent">
        <div className="flex items-center justify-center gap-3 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shadow-sm shadow-green-500/50" />
            <span className="font-semibold">{onlineUsers.length + 1}</span> online
          </span>
          <span className="text-border/70">•</span>
          <span className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            <span className="font-semibold">{offlineUsers.length}</span> offline
          </span>
        </div>
      </div>
    </div>
  )
}
