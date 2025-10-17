import type { CanvasObject } from "@/lib/types"

interface ExportOptions {
  format: "png" | "svg"
  objects: CanvasObject[]
  backgroundColor?: string
  scale?: number
  viewport?: { x: number; y: number; zoom: number }
  canvasWidth?: number
  canvasHeight?: number
}

export function exportCanvas({
  format,
  objects,
  backgroundColor = "#ffffff",
  scale = 2,
  viewport,
  canvasWidth = 1920,
  canvasHeight = 1080,
}: ExportOptions) {
  const visibleBounds = viewport
    ? {
        x: -viewport.x / viewport.zoom,
        y: -viewport.y / viewport.zoom,
        width: canvasWidth / viewport.zoom,
        height: canvasHeight / viewport.zoom,
      }
    : null

  const visibleObjects = visibleBounds
    ? objects.filter((obj) => {
        const objRight = obj.x + obj.width
        const objBottom = obj.y + obj.height
        const boundsRight = visibleBounds.x + visibleBounds.width
        const boundsBottom = visibleBounds.y + visibleBounds.height

        return obj.x < boundsRight && objRight > visibleBounds.x && obj.y < boundsBottom && objBottom > visibleBounds.y
      })
    : objects

  if (visibleObjects.length === 0) {
    console.warn("[v0] No visible objects to export")
    return
  }

  if (format === "png") {
    exportPNG(visibleObjects, backgroundColor, scale, visibleBounds)
  } else {
    exportSVG(visibleObjects, backgroundColor, visibleBounds)
  }
}

function exportPNG(
  objects: CanvasObject[],
  backgroundColor: string,
  scale: number,
  visibleBounds: { x: number; y: number; width: number; height: number } | null,
) {
  const bounds = visibleBounds || calculateBounds(objects)
  const padding = 20

  const canvas = document.createElement("canvas")
  canvas.width = (bounds.width + padding * 2) * scale
  canvas.height = (bounds.height + padding * 2) * scale

  const ctx = canvas.getContext("2d")
  if (!ctx) return

  ctx.scale(scale, scale)

  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, bounds.width + padding * 2, bounds.height + padding * 2)

  ctx.translate(padding - bounds.x, padding - bounds.y)

  // Render objects
  objects.forEach((obj) => {
    ctx.save()
    renderObject(ctx, obj)
    ctx.restore()
  })

  // Download
  canvas.toBlob((blob) => {
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `canvas-export-${Date.now()}.png`
      a.click()
      URL.revokeObjectURL(url)
    }
  })
}

function exportSVG(
  objects: CanvasObject[],
  backgroundColor: string,
  visibleBounds: { x: number; y: number; width: number; height: number } | null,
) {
  const bounds = visibleBounds || calculateBounds(objects)
  const padding = 20

  const width = bounds.width + padding * 2
  const height = bounds.height + padding * 2

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
  svg += `  <rect width="${width}" height="${height}" fill="${backgroundColor}"/>\n`
  svg += `  <g transform="translate(${padding - bounds.x}, ${padding - bounds.y})">\n`

  objects.forEach((obj) => {
    svg += renderObjectSVG(obj)
  })

  svg += `  </g>\n`
  svg += `</svg>`

  const blob = new Blob([svg], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `canvas-export-${Date.now()}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

function calculateBounds(objects: CanvasObject[]) {
  if (objects.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 }
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

function renderObject(ctx: CanvasRenderingContext2D, obj: CanvasObject) {
  if (obj.type === "rectangle") {
    ctx.fillStyle = obj.fill_color
    ctx.strokeStyle = obj.stroke_color
    ctx.lineWidth = obj.stroke_width
    ctx.fillRect(obj.x, obj.y, obj.width, obj.height)
    ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
  } else if (obj.type === "circle") {
    ctx.fillStyle = obj.fill_color
    ctx.strokeStyle = obj.stroke_color
    ctx.lineWidth = obj.stroke_width
    const radius = Math.min(obj.width, obj.height) / 2
    ctx.beginPath()
    ctx.arc(obj.x + obj.width / 2, obj.y + obj.height / 2, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (obj.type === "triangle") {
    ctx.fillStyle = obj.fill_color
    ctx.strokeStyle = obj.stroke_color
    ctx.lineWidth = obj.stroke_width
    ctx.beginPath()
    ctx.moveTo(obj.x + obj.width / 2, obj.y)
    ctx.lineTo(obj.x, obj.y + obj.height)
    ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (obj.type === "line") {
    ctx.strokeStyle = obj.stroke_color
    ctx.lineWidth = obj.stroke_width
    ctx.beginPath()
    ctx.moveTo(obj.x, obj.y)
    ctx.lineTo(obj.x + obj.width, obj.y + obj.height)
    ctx.stroke()
  } else if (obj.type === "text") {
    ctx.font = `${obj.font_size || 16}px ${obj.font_family || "Arial"}`
    ctx.fillStyle = obj.fill_color
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.fillText(obj.text_content || "", obj.x + obj.width / 2, obj.y + obj.height / 2)
  }
}

function renderObjectSVG(obj: CanvasObject): string {
  if (obj.type === "rectangle") {
    return `    <rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="${obj.fill_color}" stroke="${obj.stroke_color}" stroke-width="${obj.stroke_width}"/>\n`
  } else if (obj.type === "circle") {
    const radius = Math.min(obj.width, obj.height) / 2
    const cx = obj.x + obj.width / 2
    const cy = obj.y + obj.height / 2
    return `    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${obj.fill_color}" stroke="${obj.stroke_color}" stroke-width="${obj.stroke_width}"/>\n`
  } else if (obj.type === "triangle") {
    const x1 = obj.x + obj.width / 2
    const y1 = obj.y
    const x2 = obj.x
    const y2 = obj.y + obj.height
    const x3 = obj.x + obj.width
    const y3 = obj.y + obj.height
    return `    <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="${obj.fill_color}" stroke="${obj.stroke_color}" stroke-width="${obj.stroke_width}"/>\n`
  } else if (obj.type === "line") {
    return `    <line x1="${obj.x}" y1="${obj.y}" x2="${obj.x + obj.width}" y2="${obj.y + obj.height}" stroke="${obj.stroke_color}" stroke-width="${obj.stroke_width}"/>\n`
  } else if (obj.type === "text") {
    return `    <text x="${obj.x + obj.width / 2}" y="${obj.y + obj.height / 2}" font-size="${obj.font_size || 16}" font-family="${obj.font_family || "Arial"}" fill="${obj.fill_color}" text-anchor="middle" dominant-baseline="middle">${obj.text_content || ""}</text>\n`
  }
  return ""
}
