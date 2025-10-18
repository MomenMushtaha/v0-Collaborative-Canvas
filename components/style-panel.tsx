"use client"

import { ColorPicker } from "@/components/color-picker"
import { Label } from "@/components/ui/label"
import type { CanvasObject } from "@/lib/types"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronRight, Palette } from "lucide-react"
import { useRecentColors } from "@/hooks/use-recent-colors"

interface StylePanelProps {
  selectedObjects: CanvasObject[]
  onStyleChange: (updates: Partial<CanvasObject>) => void
  topPosition?: number
  onCollapseChange?: (collapsed: boolean) => void
}

export function StylePanel({ selectedObjects, onStyleChange, topPosition = 640, onCollapseChange }: StylePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { recentColors, addRecentColor } = useRecentColors()

  const handleCollapseToggle = (collapsed: boolean) => {
    setIsCollapsed(collapsed)
    onCollapseChange?.(collapsed)
  }

  const handleStyleChange = (updates: Partial<CanvasObject>) => {
    if (updates.fill_color) {
      addRecentColor(updates.fill_color)
    }
    if (updates.stroke_color) {
      addRecentColor(updates.stroke_color)
    }
    onStyleChange(updates)
  }

  if (selectedObjects.length === 0 || isCollapsed) {
    return (
      <div className="absolute right-4 z-10" style={{ top: `${topPosition}px` }}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => selectedObjects.length > 0 && handleCollapseToggle(false)}
          disabled={selectedObjects.length === 0}
          className="bg-background/95 backdrop-blur-md shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-border/50 flex items-center justify-center"
        >
          <Palette className="h-4 w-4 mr-2" />
          <span className="text-xs font-medium">{selectedObjects.length === 0 ? "No Selection" : "Style"}</span>
          {selectedObjects.length > 0 && <ChevronRight className="h-4 w-4 ml-2" />}
        </Button>
      </div>
    )
  }

  // Get the first selected object's colors (for multi-select, we show the first object's values)
  const firstObject = selectedObjects[0]
  const fillColor = firstObject.fill_color || "#3b82f6"
  const strokeColor = firstObject.stroke_color || "#1e40af"

  return (
    <div
      className="absolute right-4 z-10 w-64 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl transition-all duration-200 hover:shadow-2xl overflow-hidden"
      style={{ top: `${topPosition}px` }}
    >
      {/* Header */}
      <div className="bg-gradient-to-b from-muted/30 to-transparent px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide flex-1 text-center">Style</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCollapseToggle(true)}
            className="h-7 w-7 p-0 hover:bg-background/80 transition-colors -mr-2"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Fill Color</Label>
          <ColorPicker
            color={fillColor}
            onChange={(color) => handleStyleChange({ fill_color: color })}
            label="Fill"
            recentColors={recentColors}
          />
        </div>

        <div className="space-y-2">
          <Label>Stroke Color</Label>
          <ColorPicker
            color={strokeColor}
            onChange={(color) => handleStyleChange({ stroke_color: color })}
            label="Stroke"
            recentColors={recentColors}
          />
        </div>

        {selectedObjects.length > 1 && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-center text-muted-foreground">Editing {selectedObjects.length} objects</p>
          </div>
        )}
      </div>
    </div>
  )
}
