import type { CanvasObject } from "./types"

export function getGroupBounds(
  group: CanvasObject,
  allObjects: CanvasObject[],
): {
  x: number
  y: number
  width: number
  height: number
} {
  if (group.type !== "group" || !group.children_ids || group.children_ids.length === 0) {
    return { x: group.x, y: group.y, width: group.width, height: group.height }
  }

  const children = allObjects.filter((obj) => group.children_ids!.includes(obj.id))
  if (children.length === 0) {
    return { x: group.x, y: group.y, width: group.width, height: group.height }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  children.forEach((child) => {
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
    maxX = Math.max(maxX, child.x + child.width)
    maxY = Math.max(maxY, child.y + child.height)
  })

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function getAllChildrenIds(groupId: string, allObjects: CanvasObject[]): string[] {
  const group = allObjects.find((obj) => obj.id === groupId)
  if (!group || group.type !== "group" || !group.children_ids) {
    return []
  }

  const childIds: string[] = []

  group.children_ids.forEach((childId) => {
    childIds.push(childId)
    const child = allObjects.find((obj) => obj.id === childId)
    if (child && child.type === "group") {
      childIds.push(...getAllChildrenIds(childId, allObjects))
    }
  })

  return childIds
}

export function isObjectInGroup(objectId: string, allObjects: CanvasObject[]): boolean {
  return allObjects.some((obj) => obj.type === "group" && obj.children_ids && obj.children_ids.includes(objectId))
}
