import type { CanvasObject } from "./types"

export interface GridSettings {
  enabled: boolean
  snapEnabled: boolean
  size: number
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  enabled: false,
  snapEnabled: false,
  size: 20,
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

export function snapPointToGrid(x: number, y: number, gridSize: number): { x: number; y: number } {
  return {
    x: snapToGrid(x, gridSize),
    y: snapToGrid(y, gridSize),
  }
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridSize: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
) {
  ctx.save()
  ctx.strokeStyle = "rgba(200, 200, 200, 0.3)"
  ctx.lineWidth = 1 / zoom

  // Calculate visible grid range
  const startX = Math.floor(-offsetX / gridSize) * gridSize
  const endX = Math.ceil((width / zoom - offsetX) / gridSize) * gridSize
  const startY = Math.floor(-offsetY / gridSize) * gridSize
  const endY = Math.ceil((height / zoom - offsetY) / gridSize) * gridSize

  // Draw vertical lines
  for (let x = startX; x <= endX; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, startY)
    ctx.lineTo(x, endY)
    ctx.stroke()
  }

  // Draw horizontal lines
  for (let y = startY; y <= endY; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(startX, y)
    ctx.lineTo(endX, y)
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Check if an object's center point is inside the lasso path
 */
export function isObjectInLasso(obj: CanvasObject, lassoPath: { x: number; y: number }[]): boolean {
  if (lassoPath.length < 3) return false

  // Check if object's center is inside the lasso
  const centerX = obj.x + obj.width / 2
  const centerY = obj.y + obj.height / 2

  return isPointInPolygon({ x: centerX, y: centerY }, lassoPath)
}
