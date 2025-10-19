"use client"

import { useState } from "react"
import type { CanvasObject } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Triangle,
  Minus,
  Type,
  Folder,
  FolderOpen,
} from "lucide-react"

interface LayersPanelProps {
  objects: CanvasObject[]
  selectedIds: string[]
  onSelectObject: (id: string, addToSelection: boolean) => void
  onDeleteObject: (id: string) => void
  onReorder?: (id: string, newIndex: number) => void
  topPosition?: number
  onCollapseChange?: (collapsed: boolean) => void
}

export function LayersPanel({
  objects,
  selectedIds,
  onSelectObject,
  onDeleteObject,
  onReorder,
  topPosition = 360,
  onCollapseChange,
}: LayersPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const handleCollapseToggle = (collapsed: boolean) => {
    setIsCollapsed(collapsed)
    onCollapseChange?.(collapsed)
  }

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const getObjectIcon = (obj: CanvasObject) => {
    if (obj.type === "group") {
      const isExpanded = expandedGroups.has(obj.id)
      return isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />
    }
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
    if (obj.type === "group") {
      const childCount = obj.children_ids?.length || 0
      return `Group (${childCount})`
    }
    if (obj.type === "text") {
      return "Text"
    }

    return obj.type.charAt(0).toUpperCase() + obj.type.slice(1)
  }

  // Sort objects by z-index (reverse so highest z-index is at top)
  const sortedObjects = [...objects].sort((a, b) => (b.z || 0) - (a.z || 0))

  const topLevelObjects = sortedObjects.filter((obj) => {
    return !objects.some((other) => other.type === "group" && other.children_ids?.includes(obj.id))
  })

  const renderObject = (obj: CanvasObject, depth = 0) => {
    const isSelected = selectedIds.includes(obj.id)
    const isGroup = obj.type === "group"
    const isExpanded = expandedGroups.has(obj.id)

    return (
      <div key={obj.id}>
        <div
          className={`
            flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer
            transition-all duration-200
            ${
              isSelected
                ? "bg-primary/10 border border-primary/20 shadow-sm"
                : "hover:bg-accent/50 border border-transparent"
            }
          `}
          style={{ marginLeft: `${depth * 16}px` }}
          onClick={(e) => onSelectObject(obj.id, e.shiftKey)}
        >
          {isGroup && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-background/80"
              onClick={(e) => {
                e.stopPropagation()
                toggleGroupExpansion(obj.id)
              }}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button>
          )}

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

        {isGroup && isExpanded && obj.children_ids && obj.children_ids.length > 0 && (
          <div className="mt-1">
            {obj.children_ids.map((childId) => {
              const child = objects.find((o) => o.id === childId)
              return child ? renderObject(child, depth + 1) : null
            })}
          </div>
        )}
      </div>
    )
  }

  if (isCollapsed) {
    return (
      <div className="fixed right-4 z-40" style={{ top: `${topPosition}px` }}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleCollapseToggle(false)}
          className="bg-background/95 backdrop-blur-md shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-border/50 flex items-center justify-center"
        >
          <Square className="h-4 w-4 mr-2" />
          <span className="text-xs font-medium">
            {sortedObjects.length} Layer{sortedObjects.length !== 1 ? "s" : ""}
          </span>
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className="fixed right-4 z-40 w-64 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden flex flex-col transition-all duration-200 hover:shadow-2xl"
      style={{ top: `${topPosition}px` }}
    >
      <div className="p-4 flex-shrink-0 bg-gradient-to-b from-muted/30 to-transparent">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold tracking-tight flex-1 text-center">Layers</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCollapseToggle(true)}
            className="h-7 w-7 p-0 hover:bg-background/80 transition-colors"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Layers List */}
      <ScrollArea className="h-[150px]">
        <div className="p-2 space-y-1">
          {topLevelObjects.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 px-4">
              <div className="mb-2 opacity-50">
                <Square className="h-8 w-8 mx-auto" />
              </div>
              <p className="font-medium">No objects yet</p>
              <p className="text-xs mt-1">Start drawing on the canvas</p>
            </div>
          ) : (
            topLevelObjects.map((obj) => renderObject(obj, 0))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-border/50 bg-gradient-to-t from-muted/20 to-transparent px-4 py-3">
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
