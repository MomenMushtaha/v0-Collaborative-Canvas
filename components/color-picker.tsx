"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ColorPickerProps {
  color: string
  onChange: (color: string) => void
  label?: string
  recentColors?: string[]
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#000000", // black
  "#ffffff", // white
  "#6b7280", // gray
  "#9ca3af", // light gray
]

export function ColorPicker({ color, onChange, label, recentColors = [] }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(color)

  const handleHexChange = (value: string) => {
    setHexInput(value)
    // Validate hex color
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      onChange(value)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start gap-2 bg-transparent">
          <div className="h-5 w-5 rounded border" style={{ backgroundColor: color }} />
          <span className="text-sm">{label || "Color"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hex-input">Hex Color</Label>
            <Input
              id="hex-input"
              value={hexInput}
              onChange={(e) => handleHexChange(e.target.value)}
              placeholder="#000000"
              maxLength={7}
            />
          </div>

          {recentColors.length > 0 && (
            <div className="space-y-2">
              <Label>Recent</Label>
              <div className="grid grid-cols-6 gap-2">
                {recentColors.map((recentColor, index) => (
                  <button
                    key={`${recentColor}-${index}`}
                    className="h-8 w-8 rounded border-2 transition-all hover:scale-110"
                    style={{
                      backgroundColor: recentColor,
                      borderColor: color === recentColor ? "#000" : "transparent",
                    }}
                    onClick={() => {
                      onChange(recentColor)
                      setHexInput(recentColor)
                    }}
                    title={recentColor}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Presets</Label>
            <div className="grid grid-cols-5 gap-2">
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
                  className="h-8 w-8 rounded border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: presetColor,
                    borderColor: color === presetColor ? "#000" : "transparent",
                  }}
                  onClick={() => {
                    onChange(presetColor)
                    setHexInput(presetColor)
                  }}
                  title={presetColor}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
