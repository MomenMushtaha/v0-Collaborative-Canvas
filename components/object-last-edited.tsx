"use client"

import { useMemo } from "react"
import type { CanvasObject, ObjectMetadata } from "@/lib/types"

interface ObjectLastEditedBadgesProps {
  objects: CanvasObject[]
  metadata: Record<string, ObjectMetadata>
  selectedIds: string[]
  recentWindowMs?: number
}

const DEFAULT_RECENT_WINDOW_MS = 8000

function formatRelativeTime(timestamp: number) {
  const now = Date.now()
  const delta = Math.max(0, now - timestamp)

  if (delta < 1000) return "just now"
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  return `${Math.floor(delta / 3_600_000)}h ago`
}

export function ObjectLastEditedBadges({
  objects,
  metadata,
  selectedIds,
  recentWindowMs = DEFAULT_RECENT_WINDOW_MS,
}: ObjectLastEditedBadgesProps) {
  const badges = useMemo(() => {
    const entries: Array<{ object: CanvasObject; meta: ObjectMetadata }> = []
    const selectedSet = new Set(selectedIds)
    const now = Date.now()

    for (const object of objects) {
      const meta = metadata[object.id]
      if (!meta || !meta.lastEditedAt) continue

      const isSelected = selectedSet.has(object.id)
      const isRecent = now - meta.lastEditedAt <= recentWindowMs

      if (!isSelected && !isRecent) continue

      entries.push({ object, meta })
    }

    return entries
  }, [metadata, objects, recentWindowMs, selectedIds])

  if (badges.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {badges.map(({ object, meta }) => {
        const left = object.x + object.width + 12
        const top = Math.max(0, object.y - 28)
        const name = meta.lastEditedName || "Someone"
        const color = meta.lastEditedColor || "#64748b"
        const timestamp = meta.lastEditedAt || Date.now()

        return (
          <div
            key={object.id}
            className="absolute flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-lg ring-1 ring-border/40"
            style={{ left, top }}
          >
            <span
              className="inline-flex h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="font-semibold">{name}</span>
            <span className="text-muted-foreground">· {formatRelativeTime(timestamp)}</span>
          </div>
        )
      })}
    </div>
  )
}
