"use client"

import { useCallback, useEffect, useRef } from "react"

import type { UiRect } from "@/lib/types"

function normalizeRect(rect: DOMRect): UiRect {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export function useBoundsReporter<TElement extends HTMLElement>(
  onBoundsChange?: (rect: UiRect | null) => void,
) {
  const observerRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [])

  return useCallback(
    (node: TElement | null) => {
      if (!onBoundsChange) {
        return
      }

      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }

      if (!node) {
        onBoundsChange(null)
        return
      }

      const reportBounds = () => {
        onBoundsChange(normalizeRect(node.getBoundingClientRect()))
      }

      observerRef.current = new ResizeObserver(reportBounds)
      observerRef.current.observe(node)
      reportBounds()
    },
    [onBoundsChange],
  )
}

