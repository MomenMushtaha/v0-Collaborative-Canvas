"use client"

import { useState, useEffect } from "react"

const MAX_RECENT_COLORS = 12
const STORAGE_KEY = "collabcanvas-recent-colors"

export function useRecentColors() {
  const [recentColors, setRecentColors] = useState<string[]>([])

  // Load recent colors from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setRecentColors(parsed)
        }
      }
    } catch (error) {
      console.error("Failed to load recent colors:", error)
    }
  }, [])

  const addRecentColor = (color: string) => {
    setRecentColors((prev) => {
      // Remove the color if it already exists
      const filtered = prev.filter((c) => c.toLowerCase() !== color.toLowerCase())
      // Add to the beginning
      const updated = [color, ...filtered].slice(0, MAX_RECENT_COLORS)

      // Save to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      } catch (error) {
        console.error("Failed to save recent colors:", error)
      }

      return updated
    })
  }

  return { recentColors, addRecentColor }
}
