"use client"

import { ColorPicker } from "@/components/color-picker"
import { Label } from "@/components/ui/label"
import type { CanvasObject } from "@/lib/types"

interface StylePanelProps {
  selectedObjects: CanvasObject[]
  onStyleChange: (updates: Partial<CanvasObject>) => void
}

export function StylePanel({ selectedObjects, onStyleChange }: StylePanelProps) {
  if (selectedObjects.length === 0) {
    return (
      <div className="absolute right-4 top-[618px] z-10 w-64 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl transition-all duration-200 hover:shadow-2xl">
        <div className="bg-gradient-to-b from-muted/30 to-transparent px-4 py-3 text-center">
          <p className="text-sm text-muted-foreground">Select an object to edit its style</p>
        </div>
      </div>
    )
  }

  // Get the first selected object's colors (for multi-select, we show the first object's values)
  const firstObject = selectedObjects[0]
  const fillColor = firstObject.fill_color || "#3b82f6"
  const strokeColor = firstObject.stroke_color || "#1e40af"

  return (
    <div className="absolute right-4 top-[618px] z-10 w-64 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-xl transition-all duration-200 hover:shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-b from-muted/30 to-transparent px-4 py-3 text-center border-b border-border/50">
        <h3 className="text-sm font-semibold tracking-wide">Style</h3>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Fill Color</Label>
          <ColorPicker color={fillColor} onChange={(color) => onStyleChange({ fill_color: color })} label="Fill" />
        </div>

        <div className="space-y-2">
          <Label>Stroke Color</Label>
          <ColorPicker
            color={strokeColor}
            onChange={(color) => onStyleChange({ stroke_color: color })}
            label="Stroke"
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
