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
      <div className="fixed right-4 top-[360px] z-40">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="bg-background/95 backdrop-blur shadow-lg hover:shadow-xl transition-all hover:scale-105 border-2"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed right-4 top-[360px] z-40 w-64 rounded-xl border-2 bg-background/95 backdrop-blur shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-muted/50 to-muted/30 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-wide">Layers</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(true)}
          className="h-7 w-7 p-0 hover:bg-background/80 transition-colors"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>

      {/* Layers List */}
      <ScrollArea className="h-[150px]">
        <div className="p-2 space-y-1">
          {sortedObjects.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 px-4">
              <div className="mb-2 opacity-50">
                <Square className="h-8 w-8 mx-auto" />
              </div>
              <p className="font-medium">No objects yet</p>
              <p className="text-xs mt-1">Start drawing on the canvas</p>
            </div>
          ) : (
            sortedObjects.map((obj) => {
              const isSelected = selectedIds.includes(obj.id)
              const isVisible = obj.visible !== false
              const isLocked = obj.locked === true

              return (
                <div
                  key={obj.id}
                  className={`
                    flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer
                    transition-all duration-200
                    ${
                      isSelected
                        ? "bg-primary/10 border border-primary/20 shadow-sm"
                        : "hover:bg-accent/50 border border-transparent"
                    }
                  `}
                  onClick={(e) => onSelectObject(obj.id, e.shiftKey)}
                >
                  {/* Icon */}
                  <div
                    className={`
                    flex-shrink-0 p-1.5 rounded-md transition-colors
                    ${isSelected ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"}
                  `}
                  >
                    {getObjectIcon(obj)}
                  </div>

                  {/* Label */}
                  <div
                    className={`
                    flex-1 text-sm truncate transition-colors
                    ${isSelected ? "font-medium text-foreground" : "text-foreground/80"}
                  `}
                  >
                    {getObjectLabel(obj)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {/* Visibility Toggle */}
                    {onToggleVisibility && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 hover:bg-background/80 transition-all"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleVisibility(obj.id)
                        }}
                      >
                        {isVisible ? (
                          <Eye className="h-3.5 w-3.5 text-foreground/70" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                      </Button>
                    )}

                    {/* Lock Toggle */}
                    {onToggleLock && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 hover:bg-background/80 transition-all"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleLock(obj.id)
                        }}
                      >
                        {isLocked ? (
                          <Lock className="h-3.5 w-3.5 text-foreground/70" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                      </Button>
                    )}

                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteObject(obj.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t bg-gradient-to-r from-muted/30 to-muted/50 px-4 py-2.5">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
          <span className="font-medium">
            {sortedObjects.length} object{sortedObjects.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
