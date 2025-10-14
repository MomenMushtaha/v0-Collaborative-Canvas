"use client"

import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

interface ToolbarProps {
  userName: string
  onSignOut: () => void
}

export function Toolbar({ userName, onSignOut }: ToolbarProps) {
  return (
    <div className="flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">CollabCanvas</h1>
        <span className="text-sm text-muted-foreground">MVP</span>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{userName}</span>
        <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign Out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
