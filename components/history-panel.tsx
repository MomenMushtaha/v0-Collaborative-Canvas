"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { History, RefreshCcw, RotateCcw, X } from "lucide-react"
import { loadHistorySnapshots, restoreHistorySnapshot, formatTimeAgo, type HistorySnapshot } from "@/lib/history-utils"
import type { CanvasObject } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface HistoryPanelProps {
  canvasId: string
  onRestore: (objects: CanvasObject[]) => void
  onClose: () => void
}

export function HistoryPanel({ canvasId, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const { toast } = useToast()

  const loadSnapshots = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await loadHistorySnapshots(canvasId)
      setSnapshots(
        (data || []).map((snapshot) => ({
          ...snapshot,
          object_count:
            snapshot.object_count ??
            (Array.isArray(snapshot.snapshot) ? snapshot.snapshot.length : snapshot.object_count ?? 0),
        })),
      )
      setLastUpdated(new Date().toISOString())
    } catch (error) {
      console.error("[v0] Failed to load history:", error)
      setError("Unable to load version history. Please try again.")
      toast({
        title: "Could not load history",
        description: "Check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [canvasId, toast])

  useEffect(() => {
    loadSnapshots()
  }, [loadSnapshots])

  const handleRestore = async (snapshotId: string) => {
    try {
      setIsRestoring(snapshotId)
      const objects = await restoreHistorySnapshot(snapshotId)
      onRestore(objects)
      onClose()
    } catch (error) {
      console.error("[v0] Failed to restore snapshot:", error)
      toast({
        title: "Restore failed",
        description: "We couldn't apply that version. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsRestoring(null)
    }
  }

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return null
    return formatTimeAgo(lastUpdated)
  }, [lastUpdated])

  return (
    <div className="fixed right-4 top-20 z-40 w-80 max-h-[600px] rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden flex flex-col transition-all duration-200 hover:shadow-2xl">
      {/* Header */}
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent border-b border-border/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Version History</h3>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadSnapshots()}
              className="h-6 w-6"
              disabled={isLoading}
              aria-label="Refresh history"
            >
              <RefreshCcw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6" aria-label="Close history panel">
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Restore previous canvas states</p>
          {lastUpdatedLabel && (
            <span className="text-[10px] text-muted-foreground/80">Updated {lastUpdatedLabel}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading history...</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm">
              <p className="max-w-[220px] text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadSnapshots()} disabled={isLoading}>
                Try again
              </Button>
            </div>
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
                    <div className="text-xs text-muted-foreground" title={new Date(snapshot.created_at).toLocaleString()}>
                      {formatTimeAgo(snapshot.created_at)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestore(snapshot.id)}
                    disabled={Boolean(isRestoring)}
                    className="h-7 px-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  >
                    <RotateCcw className={cn("h-3 w-3 mr-1", isRestoring === snapshot.id && "animate-spin")} />
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
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>Showing last {snapshots.length} version{snapshots.length !== 1 ? "s" : ""}</p>
          {lastUpdatedLabel && <p className="text-[10px] text-muted-foreground/80">Last refreshed {lastUpdatedLabel}</p>}
        </div>
      </div>
    </div>
  )
}
