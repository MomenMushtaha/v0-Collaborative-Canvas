"use client"

import { useState } from "react"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Triangle,
  Minus,
  Type,
} from "lucide-react"

interface LayersPanelProps {
  objects: CanvasObject[]
  selectedIds: string[]
  onSelectObject: (id: string, addToSelection: boolean) => void
  onDeleteObject: (id: string) => void
  onToggleVisibility?: (id: string) => void
  onToggleLock?: (id: string) => void
  onReorder?: (id: string, newIndex: number) => void
}

export function LayersPanel({
  objects,
  selectedIds,
  onSelectObject,
  onDeleteObject,
  onToggleVisibility,
  onToggleLock,
  onReorder,
}: LayersPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  const getObjectIcon = (obj: CanvasObject) => {
    if (obj.type === "text") return <Type className="h-4 w-4" />
    switch (obj.shape) {
      case "rectangle":
        return <Square className="h-4 w-4" />
      case "circle":
        return <Circle className="h-4 w-4" />
      case "triangle":
        return <Triangle className="h-4 w-4" />
      case "line":
        return <Minus className="h-4 w-4" />
      default:
        return <Square className="h-4 w-4" />
    }
  }

  const getObjectLabel = (obj: CanvasObject) => {
    if (obj.type === "text") {
      const preview = obj.content?.substring(0, 20) || "Text"
      return preview.length < (obj.content?.length || 0) ? `${preview}...` : preview
    }
    const shapeName = obj.shape?.charAt(0).toUpperCase() + obj.shape?.slice(1)
    return shapeName || "Object"
  }

  // Sort objects by z-index (reverse so highest z-index is at top)
  const sortedObjects = [...objects].sort((a, b) => (b.z || 0) - (a.z || 0))

  if (isCollapsed) {
    return (
      <div className="fixed right-4 top-[640px] z-40">
        <Button variant="outline" size="sm" onClick={() => setIsCollapsed(false)} className="bg-background shadow-lg">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed right-4 top-[640px] z-40 w-64 rounded-lg border bg-background shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-3">
        <h3 className="text-sm font-semibold">Layers</h3>
        <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(true)} className="h-6 w-6 p-0">
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Layers List */}
      <ScrollArea className="h-[150px]">
        <div className="p-2 space-y-1">
          {sortedObjects.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">No objects on canvas</div>
          ) : (
            sortedObjects.map((obj) => {
              const isSelected = selectedIds.includes(obj.id)
              const isVisible = obj.visible !== false
              const isLocked = obj.locked === true

              return (
                <div
                  key={obj.id}
                  className={`
                    flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer
                    hover:bg-accent transition-colors
                    ${isSelected ? "bg-accent" : ""}
                  `}
                  onClick={(e) => onSelectObject(obj.id, e.shiftKey)}
                >
                  {/* Icon */}
                  <div className="flex-shrink-0 text-muted-foreground">{getObjectIcon(obj)}</div>

                  {/* Label */}
                  <div className="flex-1 text-sm truncate">{getObjectLabel(obj)}</div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Visibility Toggle */}
                    {onToggleVisibility && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleVisibility(obj.id)
                        }}
                      >
                        {isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                    )}

                    {/* Lock Toggle */}
                    {onToggleLock && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleLock(obj.id)
                        }}
                      >
                        {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                    )}

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteObject(obj.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 text-xs text-muted-foreground text-center">
        {sortedObjects.length} object{sortedObjects.length !== 1 ? "s" : ""}
      </div>
    </div>
  )
}
