import type { CanvasObject } from "./types"

export interface ExportOptions {
  format: "png" | "svg"
  objects: CanvasObject[]
  backgroundColor?: string
  scale?: number
}

export async function exportCanvas(options: ExportOptions): Promise<void> {
  const { format, objects, backgroundColor = "#ffffff", scale = 2 } = options

  if (objects.length === 0) {
    console.warn("[v0] No objects to export")
    return
  }

  // Calculate bounding box of all objects
  const bounds = calculateBounds(objects)
  const padding = 20
  const width = bounds.maxX - bounds.minX + padding * 2
  const height = bounds.maxY - bounds.minY + padding * 2

  if (format === "png") {
    await exportToPNG(objects, bounds, width, height, backgroundColor, scale)
  } else {
    await exportToSVG(objects, bounds, width, height, backgroundColor)
  }
}

function calculateBounds(objects: CanvasObject[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  objects.forEach((obj) => {
    const objMinX = obj.x
    const objMinY = obj.y
    const objMaxX = obj.x + obj.width
    const objMaxY = obj.y + obj.height

    minX = Math.min(minX, objMinX)
    minY = Math.min(minY, objMinY)
    maxX = Math.max(maxX, objMaxX)
    maxY = Math.max(maxY, objMaxY)
  })

  return { minX, minY, maxX, maxY }
}

async function exportToPNG(
  objects: CanvasObject[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  backgroundColor: string,
  scale: number,
) {
  const canvas = document.createElement("canvas")
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext("2d")

  if (!ctx) {
    console.error("[v0] Failed to get canvas context")
    return
  }

  // Scale context for high-DPI export
  ctx.scale(scale, scale)

  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)

  // Translate to account for bounds and padding
  const padding = 20
  ctx.translate(-bounds.minX + padding, -bounds.minY + padding)

  // Draw all objects
  objects.forEach((obj) => {
    drawObject(ctx, obj)
  })

  // Convert to blob and download
  canvas.toBlob((blob) => {
    if (blob) {
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `canvas-export-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
      console.log("[v0] PNG export complete")
    }
  }, "image/png")
}

async function exportToSVG(
  objects: CanvasObject[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  backgroundColor: string,
) {
  const padding = 20
  const svgWidth = width
  const svgHeight = height

  let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${backgroundColor}"/>
  <g transform="translate(${-bounds.minX + padding}, ${-bounds.minY + padding})">`

  objects.forEach((obj) => {
    svgContent += generateSVGElement(obj)
  })

  svgContent += `
  </g>
</svg>`

  // Download SVG
  const blob = new Blob([svgContent], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `canvas-export-${Date.now()}.svg`
  link.click()
  URL.revokeObjectURL(url)
  console.log("[v0] SVG export complete")
}

function drawObject(ctx: CanvasRenderingContext2D, obj: CanvasObject) {
  ctx.save()
  ctx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2)
  ctx.rotate((obj.rotation || 0) * (Math.PI / 180))
  ctx.translate(-obj.width / 2, -obj.height / 2)

  if (obj.type === "rectangle") {
    ctx.fillStyle = obj.fill || "#000000"
    ctx.strokeStyle = obj.stroke || "#000000"
    ctx.lineWidth = 2
    ctx.fillRect(0, 0, obj.width, obj.height)
    ctx.strokeRect(0, 0, obj.width, obj.height)
  } else if (obj.type === "circle") {
    const radius = Math.min(obj.width, obj.height) / 2
    ctx.fillStyle = obj.fill || "#000000"
    ctx.strokeStyle = obj.stroke || "#000000"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(obj.width / 2, obj.height / 2, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (obj.type === "triangle") {
    ctx.fillStyle = obj.fill || "#000000"
    ctx.strokeStyle = obj.stroke || "#000000"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(obj.width / 2, 0)
    ctx.lineTo(obj.width, obj.height)
    ctx.lineTo(0, obj.height)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (obj.type === "line") {
    ctx.strokeStyle = obj.stroke || "#000000"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, obj.height / 2)
    ctx.lineTo(obj.width, obj.height / 2)
    ctx.stroke()
  } else if (obj.type === "text") {
    ctx.fillStyle = obj.fill || "#000000"
    ctx.font = `${obj.fontSize || 16}px ${obj.fontFamily || "Arial"}`
    ctx.textBaseline = "top"
    const lines = (obj.content || "").split("\n")
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, i * (obj.fontSize || 16) * 1.2)
    })
  }

  ctx.restore()
}

function generateSVGElement(obj: CanvasObject): string {
  const transform = `transform="rotate(${obj.rotation || 0} ${obj.x + obj.width / 2} ${obj.y + obj.height / 2})"`
  const fill = obj.fill || "#000000"
  const stroke = obj.stroke || "#000000"

  if (obj.type === "rectangle") {
    return `
    <rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" 
          fill="${fill}" stroke="${stroke}" stroke-width="2" ${transform}/>`
  } else if (obj.type === "circle") {
    const radius = Math.min(obj.width, obj.height) / 2
    const cx = obj.x + obj.width / 2
    const cy = obj.y + obj.height / 2
    return `
    <circle cx="${cx}" cy="${cy}" r="${radius}" 
            fill="${fill}" stroke="${stroke}" stroke-width="2" ${transform}/>`
  } else if (obj.type === "triangle") {
    const points = `${obj.x + obj.width / 2},${obj.y} ${obj.x + obj.width},${obj.y + obj.height} ${obj.x},${obj.y + obj.height}`
    return `
    <polygon points="${points}" 
             fill="${fill}" stroke="${stroke}" stroke-width="2" ${transform}/>`
  } else if (obj.type === "line") {
    return `
    <line x1="${obj.x}" y1="${obj.y + obj.height / 2}" 
          x2="${obj.x + obj.width}" y2="${obj.y + obj.height / 2}" 
          stroke="${stroke}" stroke-width="2" ${transform}/>`
  } else if (obj.type === "text") {
    const lines = (obj.content || "").split("\n")
    return lines
      .map(
        (line, i) => `
    <text x="${obj.x}" y="${obj.y + i * (obj.fontSize || 16) * 1.2}" 
          font-size="${obj.fontSize || 16}" font-family="${obj.fontFamily || "Arial"}" 
          fill="${fill}" ${transform}>${line}</text>`,
      )
      .join("")
  }

  return ""
}
