import type { CanvasObject } from "./types"

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export function isPointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
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

/**
 * Get all objects of the same type as the selected objects
 */
export function getObjectsOfSameType(objects: CanvasObject[], selectedIds: string[]): string[] {
  if (selectedIds.length === 0) return []

  // Get the types of all selected objects
  const selectedTypes = new Set(objects.filter((obj) => selectedIds.includes(obj.id)).map((obj) => obj.type))

  // Return all objects that match any of the selected types
  return objects.filter((obj) => selectedTypes.has(obj.type)).map((obj) => obj.id)
}
