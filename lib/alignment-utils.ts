import type { CanvasObject } from "./types"

export type AlignmentType = "left" | "right" | "top" | "bottom" | "center-h" | "center-v"
export type DistributeType = "horizontal" | "vertical"

interface ObjectBounds {
  id: string
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
  width: number
  height: number
}

function getObjectBounds(obj: CanvasObject): ObjectBounds {
  const width = obj.width || 100
  const height = obj.height || 100
  const left = obj.x
  const top = obj.y
  const right = left + width
  const bottom = top + height
  const centerX = left + width / 2
  const centerY = top + height / 2

  return { id: obj.id, left, right, top, bottom, centerX, centerY, width, height }
}

export function alignObjects(objects: CanvasObject[], alignType: AlignmentType): Map<string, { x: number; y: number }> {
  if (objects.length < 2) return new Map()

  const bounds = objects.map(getObjectBounds)
  const updates = new Map<string, { x: number; y: number }>()

  switch (alignType) {
    case "left": {
      const minLeft = Math.min(...bounds.map((b) => b.left))
      bounds.forEach((b) => {
        updates.set(b.id, { x: minLeft, y: objects.find((o) => o.id === b.id)!.y })
      })
      break
    }
    case "right": {
      const maxRight = Math.max(...bounds.map((b) => b.right))
      bounds.forEach((b) => {
        updates.set(b.id, { x: maxRight - b.width, y: objects.find((o) => o.id === b.id)!.y })
      })
      break
    }
    case "top": {
      const minTop = Math.min(...bounds.map((b) => b.top))
      bounds.forEach((b) => {
        updates.set(b.id, { x: objects.find((o) => o.id === b.id)!.x, y: minTop })
      })
      break
    }
    case "bottom": {
      const maxBottom = Math.max(...bounds.map((b) => b.bottom))
      bounds.forEach((b) => {
        updates.set(b.id, { x: objects.find((o) => o.id === b.id)!.x, y: maxBottom - b.height })
      })
      break
    }
    case "center-h": {
      const avgCenterX = bounds.reduce((sum, b) => sum + b.centerX, 0) / bounds.length
      bounds.forEach((b) => {
        updates.set(b.id, { x: avgCenterX - b.width / 2, y: objects.find((o) => o.id === b.id)!.y })
      })
      break
    }
    case "center-v": {
      const avgCenterY = bounds.reduce((sum, b) => sum + b.centerY, 0) / bounds.length
      bounds.forEach((b) => {
        updates.set(b.id, { x: objects.find((o) => o.id === b.id)!.x, y: avgCenterY - b.height / 2 })
      })
      break
    }
  }

  return updates
}

export function distributeObjects(
  objects: CanvasObject[],
  distributeType: DistributeType,
): Map<string, { x: number; y: number }> {
  if (objects.length < 3) return new Map()

  const bounds = objects.map(getObjectBounds)
  const updates = new Map<string, { x: number; y: number }>()

  if (distributeType === "horizontal") {
    // Sort by x position
    const sorted = [...bounds].sort((a, b) => a.left - b.left)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const totalWidth = sorted.reduce((sum, b) => sum + b.width, 0)
    const availableSpace = last.right - first.left - totalWidth
    const spacing = availableSpace / (sorted.length - 1)

    let currentX = first.left
    sorted.forEach((b) => {
      updates.set(b.id, { x: currentX, y: objects.find((o) => o.id === b.id)!.y })
      currentX += b.width + spacing
    })
  } else {
    // Sort by y position
    const sorted = [...bounds].sort((a, b) => a.top - b.top)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const totalHeight = sorted.reduce((sum, b) => sum + b.height, 0)
    const availableSpace = last.bottom - first.top - totalHeight
    const spacing = availableSpace / (sorted.length - 1)

    let currentY = first.top
    sorted.forEach((b) => {
      updates.set(b.id, { x: objects.find((o) => o.id === b.id)!.x, y: currentY })
      currentY += b.height + spacing
    })
  }

  return updates
}
