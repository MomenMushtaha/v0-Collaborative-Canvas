"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { History, RotateCcw, X } from "lucide-react"
import { loadHistorySnapshots, restoreHistorySnapshot, formatTimeAgo, type HistorySnapshot } from "@/lib/history-utils"

interface HistoryPanelProps {
  canvasId: string
  onRestore: (objects: any[]) => void
  onClose: () => void
}

export function HistoryPanel({ canvasId, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)

  useEffect(() => {
    loadSnapshots()
  }, [canvasId])

  const loadSnapshots = async () => {
    try {
      setIsLoading(true)
      const data = await loadHistorySnapshots(canvasId)
      setSnapshots(data)
    } catch (error) {
      console.error("[v0] Failed to load history:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async (snapshotId: string) => {
    try {
      setIsRestoring(snapshotId)
      const objects = await restoreHistorySnapshot(snapshotId)
      onRestore(objects)
      onClose()
    } catch (error) {
      console.error("[v0] Failed to restore snapshot:", error)
    } finally {
      setIsRestoring(null)
    }
  }

  return (
    <div className="fixed right-4 top-20 z-40 w-80 max-h-[600px] rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden flex flex-col transition-all duration-200 hover:shadow-2xl">
      {/* Header */}
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent border-b border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Version History</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Restore previous canvas states</p>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading history...</div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No history available yet</div>
          ) : (
            snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="group rounded-lg border border-border/50 bg-card/50 p-3 hover:bg-card/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{snapshot.created_by_name}</div>
                    <div className="text-xs text-muted-foreground">{formatTimeAgo(snapshot.created_at)}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(snapshot.id)}
                    disabled={isRestoring === snapshot.id}
                    className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {isRestoring === snapshot.id ? "Restoring..." : "Restore"}
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {snapshot.object_count} object{snapshot.object_count !== 1 ? "s" : ""}
                  {snapshot.description && ` • ${snapshot.description}`}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border/50 bg-gradient-to-t from-muted/20 to-transparent">
        <p className="text-xs text-muted-foreground text-center">
          Showing last {snapshots.length} version{snapshots.length !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  )
}
