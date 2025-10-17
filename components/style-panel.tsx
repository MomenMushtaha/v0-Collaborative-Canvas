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
      <div className="absolute right-4 top-[610px] z-10 w-64 rounded-lg border bg-card p-4 shadow-lg">
        <p className="text-sm text-muted-foreground">Select an object to edit its style</p>
      </div>
    )
  }

  // Get the first selected object's colors (for multi-select, we show the first object's values)
  const firstObject = selectedObjects[0]
  const fillColor = firstObject.fill_color || "#3b82f6"
  const strokeColor = firstObject.stroke_color || "#1e40af"

  return (
    <div className="absolute right-4 top-[610px] z-10 w-64 rounded-lg border bg-card p-4 shadow-lg">
      <h3 className="mb-4 font-semibold">Style</h3>
      <div className="space-y-4">
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
          <p className="text-xs text-muted-foreground">Editing {selectedObjects.length} objects</p>
        )}
      </div>
    </div>
  )
}
