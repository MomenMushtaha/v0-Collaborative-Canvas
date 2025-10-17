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
    return null // Hide panel when nothing is selected instead of showing message
  }

  // Get the first selected object's colors (for multi-select, we show the first object's values)
  const firstObject = selectedObjects[0]
  const fillColor = firstObject.fill_color || "#3b82f6"
  const strokeColor = firstObject.stroke_color || "#1e40af"

  return (
    <div className="absolute right-4 top-20 z-10 w-64 rounded-lg border bg-background/95 backdrop-blur-md p-4 shadow-xl animate-in slide-in-from-right">
      <div className="mb-4 pb-3 border-b">
        <h3 className="font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Style Properties
        </h3>
        {selectedObjects.length > 1 && (
          <p className="text-xs text-muted-foreground mt-1">Editing {selectedObjects.length} objects</p>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Fill Color</Label>
          <ColorPicker color={fillColor} onChange={(color) => onStyleChange({ fill_color: color })} label="Fill" />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Stroke Color</Label>
          <ColorPicker
            color={strokeColor}
            onChange={(color) => onStyleChange({ stroke_color: color })}
            label="Stroke"
          />
        </div>
      </div>
    </div>
  )
}
