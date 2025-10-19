import type { CanvasObject, CanvasGroup } from "./types"

export function createGroup(objects: CanvasObject[], canvasId: string): CanvasGroup {
  const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  return {
    id: groupId,
    canvas_id: canvasId,
    object_ids: objects.map((obj) => obj.id),
    created_at: new Date().toISOString(),
  }
}

export function groupObjects(objects: CanvasObject[], groupId: string): CanvasObject[] {
  return objects.map((obj) => ({
    ...obj,
    group_id: groupId,
  }))
}

export function ungroupObjects(objects: CanvasObject[]): CanvasObject[] {
  return objects.map((obj) => ({
    ...obj,
    group_id: undefined,
  }))
}

export function getGroupedObjects(objects: CanvasObject[], groupId: string): CanvasObject[] {
  return objects.filter((obj) => obj.group_id === groupId)
}

export function getAllGroupIds(objects: CanvasObject[]): string[] {
  const groupIds = new Set<string>()
  objects.forEach((obj) => {
    if (obj.group_id) {
      groupIds.add(obj.group_id)
    }
  })
  return Array.from(groupIds)
}

export function isObjectInGroup(obj: CanvasObject): boolean {
  return !!obj.group_id
}

export function getGroupBounds(objects: CanvasObject[]): { x: number; y: number; width: number; height: number } {
  if (objects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  objects.forEach((obj) => {
    minX = Math.min(minX, obj.x)
    minY = Math.min(minY, obj.y)
    maxX = Math.max(maxX, obj.x + obj.width)
    maxY = Math.max(maxY, obj.y + obj.height)
  })

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function moveGroup(objects: CanvasObject[], deltaX: number, deltaY: number): CanvasObject[] {
  return objects.map((obj) => ({
    ...obj,
    x: obj.x + deltaX,
    y: obj.y + deltaY,
  }))
}

export function scaleGroup(
  objects: CanvasObject[],
  scaleX: number,
  scaleY: number,
  originX: number,
  originY: number,
): CanvasObject[] {
  return objects.map((obj) => {
    const relX = obj.x - originX
    const relY = obj.y - originY

    return {
      ...obj,
      x: originX + relX * scaleX,
      y: originY + relY * scaleY,
      width: obj.width * scaleX,
      height: obj.height * scaleY,
    }
  })
}
