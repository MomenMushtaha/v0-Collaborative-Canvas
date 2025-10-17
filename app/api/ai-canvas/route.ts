import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { generateText, tool } from "ai"
import { z } from "zod"

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/

const COLOR_NAME_MAP: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  purple: "#a855f7",
  pink: "#ec4899",
  orange: "#f97316",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  indigo: "#6366f1",
  gray: "#6b7280",
  slate: "#64748b",
  zinc: "#52525b",
  emerald: "#10b981",
  sky: "#0ea5e9",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  rose: "#f43f5e",
}

function isValidColorInput(color?: string): boolean {
  if (color === undefined) return true
  if (typeof color !== "string") return false
  const trimmed = color.trim()
  if (HEX_COLOR_REGEX.test(trimmed)) return true
  return COLOR_NAME_MAP[trimmed.toLowerCase()] !== undefined
}

function normalizeColorInput(color: string | undefined, fallback: string): string {
  if (!color) return fallback
  const trimmed = color.trim()
  if (HEX_COLOR_REGEX.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  const normalized = trimmed.toLowerCase()
  return COLOR_NAME_MAP[normalized] || fallback
}

export const maxDuration = 30

export async function POST(request: Request) {
  console.log("[v0] ===== AI Canvas API Route Called =====")

  try {
    const body = await request.json()
    const { message, currentObjects, selectedObjectIds, canvasId, userId, userName, viewport } = body

    console.log("[v0] Message:", message)
    console.log("[v0] Current objects count:", currentObjects?.length || 0)
    console.log("[v0] Selected objects count:", selectedObjectIds?.length || 0)
    console.log("[v0] Canvas ID:", canvasId)
    console.log("[v0] User:", userName)

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    if (currentObjects && !Array.isArray(currentObjects)) {
      return NextResponse.json(
        { error: "Invalid currentObjects format", details: "currentObjects must be an array" },
        { status: 400 },
      )
    }

    let queueItemId: string | null = null
    if (canvasId && userId && userName) {
      try {
        const supabase = await createServerClient()
        const { data: queueItem, error: queueError } = await supabase
          .from("ai_operations_queue")
          .insert({
            canvas_id: canvasId,
            user_id: userId,
            user_name: userName,
            status: "processing",
            prompt: message,
            started_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (queueError) {
          console.warn("[v0] Queue management unavailable (table may not exist):", queueError.message)
        } else {
          queueItemId = queueItem.id
          console.log("[v0] Added to queue with ID:", queueItemId)
        }
      } catch (queueErr) {
        console.warn("[v0] Queue management error (continuing without queue):", queueErr)
      }
    }

    console.log("[v0] Calling AI SDK with function calling...")

    const canvasContext =
      currentObjects?.map((obj: any, idx: number) => ({
        index: idx,
        id: obj.id,
        type: obj.type,
        color: obj.fill_color,
        x: Math.round(obj.x),
        y: Math.round(obj.y),
        width: Math.round(obj.width),
        height: Math.round(obj.height),
        rotation: obj.rotation,
      })) || []

    const selectedObjects = canvasContext.filter((obj: any) => selectedObjectIds?.includes(obj.id))
    const selectedIndices = selectedObjects.map((obj: any) => obj.index)

    const canvasStats = {
      totalShapes: currentObjects?.length || 0,
      shapeTypes: currentObjects?.reduce(
        (acc: any, obj: any) => {
          acc[obj.type] = (acc[obj.type] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
      colorGroups: currentObjects?.reduce(
        (acc: any, obj: any) => {
          const color = obj.fill_color
          acc[color] = (acc[color] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
    }

    const operations: any[] = []
    const validationErrors: string[] = []

    const tools = {
      getCanvasState: tool({
        description:
          "Query information about the current canvas state. Use this to answer questions about shapes, count objects, or get information before making changes.",
        inputSchema: z.object({
          query: z.string().describe("What information to retrieve (e.g., 'count', 'list all', 'find blue shapes')"),
        }),
        execute: async ({ query }) => {
          return { query, canvasContext, canvasStats }
        },
      }),
      createText: tool({
        description: "Create a text layer on the canvas with customizable content, position, size, and color",
        inputSchema: z.object({
          text: z.string().describe("The text content to display"),
          x: z.number().describe("X coordinate position on the canvas"),
          y: z.number().describe("Y coordinate position on the canvas"),
          fontSize: z.number().optional().describe("Font size in pixels (default: 16)"),
          color: z.string().optional().describe("Text color as hex code (e.g., #000000 for black)"),
        }),
        execute: async ({ text, x, y, fontSize, color }) => {
          const validation = validateCreateText({ text, x, y, fontSize, color })
          if (!validation.valid) {
            validationErrors.push(`createText: ${validation.error}`)
            return { error: validation.error }
          }

          const resolvedColor = normalizeColorInput(color, "#000000")
          pushTextOperation({ text, x, y, fontSize: fontSize || 16, color: resolvedColor })

          return { success: true, text, x, y, fontSize: fontSize || 16, color: resolvedColor }
        },
      }),
      createShape: tool({
        description: "Create a new shape on the canvas",
        inputSchema: z.object({
          shape: z.enum(["rectangle", "circle", "triangle", "line"]).describe("The type of shape to create"),
          x: z.number().describe("X coordinate position on the canvas"),
          y: z.number().describe("Y coordinate position on the canvas"),
          width: z.number().describe("Width of the shape in pixels"),
          height: z.number().describe("Height of the shape in pixels"),
          color: z.string().describe("Hex color code (e.g., #ff0000 for red, #3b82f6 for blue)"),
        }),
        execute: async ({ shape, x, y, width, height, color }) => {
          const validation = validateCreateShape({ shape, x, y, width, height, color })
          if (!validation.valid) {
            validationErrors.push(`createShape: ${validation.error}`)
            return { error: validation.error }
          }

          const fillColor = normalizeColorInput(color, "#3b82f6")
          pushShapeOperation({
            shape,
            x,
            y,
            width,
            height,
            fill: fillColor,
            stroke: fillColor,
          })

          return { success: true, shape, x, y, width, height, color: fillColor }
        },
      }),
      moveShape: tool({
        description: "Move an existing shape to a new position",
        inputSchema: z.object({
          shapeIndex: z
            .number()
            .describe(
              "Index of the shape to move (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
            ),
          x: z.number().optional().describe("New X coordinate (absolute position)"),
          y: z.number().optional().describe("New Y coordinate (absolute position)"),
          deltaX: z.number().optional().describe("Relative X movement (alternative to absolute x)"),
          deltaY: z.number().optional().describe("Relative Y movement (alternative to absolute y)"),
        }),
        execute: async ({ shapeIndex, x, y, deltaX, deltaY }) => {
          const validation = validateMoveShape({ shapeIndex, x, y, deltaX, deltaY }, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`moveShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "move",
            shapeIndex: shapeIndex === -1 ? currentObjects.length - 1 : shapeIndex,
            x,
            y,
            deltaX,
            deltaY,
          })

          return { success: true, shapeIndex, x, y, deltaX, deltaY }
        },
      }),
      resizeShape: tool({
        description: "Resize an existing shape",
        inputSchema: z.object({
          shapeIndex: z
            .number()
            .describe(
              "Index of the shape to resize (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
            ),
          width: z.number().optional().describe("New width in pixels (absolute size)"),
          height: z.number().optional().describe("New height in pixels (absolute size)"),
          scale: z.number().optional().describe("Scale factor (e.g., 2 for twice as big, 0.5 for half size)"),
        }),
        execute: async ({ shapeIndex, width, height, scale }) => {
          const validation = validateResizeShape({ shapeIndex, width, height, scale }, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`resizeShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "resize",
            shapeIndex: shapeIndex === -1 ? currentObjects.length - 1 : shapeIndex,
            width,
            height,
            scale,
          })

          return { success: true, shapeIndex, width, height, scale }
        },
      }),
      rotateShape: tool({
        description: "Rotate an existing shape",
        inputSchema: z.object({
          shapeIndex: z
            .number()
            .describe(
              "Index of the shape to rotate (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
            ),
          degrees: z.number().describe("Rotation amount in degrees"),
          absolute: z
            .boolean()
            .optional()
            .describe("If true, set absolute rotation; if false, rotate relative to current rotation"),
        }),
        execute: async ({ shapeIndex, degrees, absolute }) => {
          const validation = validateRotateShape({ shapeIndex, degrees, absolute }, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`rotateShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "rotate",
            shapeIndex: shapeIndex === -1 ? currentObjects.length - 1 : shapeIndex,
            degrees: degrees ?? 0,
            absolute: absolute ?? false,
          })

          return { success: true, shapeIndex, degrees, absolute }
        },
      }),
      deleteShape: tool({
        description: "Delete one or more shapes from the canvas",
        inputSchema: z.object({
          shapeIndex: z
            .number()
            .optional()
            .describe("Index of the shape to delete (0-based, or 'selected' for currently selected shape)"),
          all: z.boolean().optional().describe("If true, delete all shapes from the canvas"),
        }),
        execute: async ({ shapeIndex, all }) => {
          const validation = validateDeleteShape({ shapeIndex, all }, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`deleteShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "delete",
            shapeIndex:
              shapeIndex === undefined ? undefined : shapeIndex === -1 ? currentObjects.length - 1 : shapeIndex,
            all: all ?? false,
          })

          return { success: true, shapeIndex, all }
        },
      }),
      arrangeShapes: tool({
        description: "Arrange multiple shapes in a pattern (grid, row, column, circle)",
        inputSchema: z.object({
          pattern: z.enum(["grid", "row", "column", "circle"]).describe("The arrangement pattern"),
          shapeIndices: z
            .array(z.number())
            .optional()
            .describe("Indices of shapes to arrange (empty array means all shapes)"),
          spacing: z.number().optional().describe("Spacing between shapes in pixels"),
          columns: z.number().optional().describe("Number of columns (for grid pattern)"),
        }),
        execute: async ({ pattern, shapeIndices, spacing, columns }) => {
          const validation = validateArrangeShapes({ pattern, shapeIndices, spacing, columns }, currentObjects)
          if (!validation.valid) {
            validationErrors.push(`arrangeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "arrange",
            pattern,
            shapeIndices: shapeIndices || [],
            spacing: spacing || 50,
            columns,
          })

          return { success: true, pattern, shapeIndices, spacing, columns }
        },
      }),
      createLoginForm: tool({
        description:
          "Create a complete login form layout with container, input fields, labels, and a call-to-action button.",
        inputSchema: z.object({
          title: z.string().optional().describe("Heading text for the form (default: 'Sign In')"),
          subtitle: z.string().optional().describe("Supportive subtitle text"),
          buttonText: z.string().optional().describe("Text for the submit button"),
          width: z
            .number()
            .optional()
            .describe("Overall form width (240-640px, default 360)"),
          accentColor: z.string().optional().describe("Accent color for the primary button"),
          includeRememberMe: z.boolean().optional().describe("Whether to include a 'Remember me' helper row"),
        }),
        execute: async ({ title, subtitle, buttonText, width, accentColor, includeRememberMe }) => {
          const resolvedAccent = normalizeColorInput(accentColor, "#2563eb")
          const formWidth = clampValue(width ?? 360, 240, 640)
          const baseHeight = subtitle ? 360 : 320
          const formHeight = baseHeight + (includeRememberMe === false ? -24 : 0)
          const formPosition = getCenteredPosition(formWidth, formHeight)

          pushShapeOperation({
            shape: "rectangle",
            x: formPosition.x,
            y: formPosition.y,
            width: formWidth,
            height: formHeight,
            fill: "white",
            stroke: "#e5e7eb",
          })

          const headingY = formPosition.y + 32
          pushTextOperation({
            text: title || "Sign In",
            x: formPosition.x + 24,
            y: headingY,
            fontSize: 26,
            color: "#111827",
          })

          const subtitleText = subtitle ?? "Access your account to continue"
          if (subtitleText) {
            pushTextOperation({
              text: subtitleText,
              x: formPosition.x + 24,
              y: headingY + 32,
              fontSize: 16,
              color: "#6b7280",
            })
          }

          const fieldWidth = formWidth - 48
          const fieldHeight = 48
          const fieldX = formPosition.x + 24
          const firstFieldTop = headingY + (subtitleText ? 72 : 56)

          pushTextOperation({
            text: "Email",
            x: fieldX,
            y: firstFieldTop,
            fontSize: 14,
            color: "#4b5563",
          })

          pushShapeOperation({
            shape: "rectangle",
            x: fieldX,
            y: firstFieldTop + 20,
            width: fieldWidth,
            height: fieldHeight,
            fill: "#f9fafb",
            stroke: "#d1d5db",
          })

          pushTextOperation({
            text: "Password",
            x: fieldX,
            y: firstFieldTop + fieldHeight + 52,
            fontSize: 14,
            color: "#4b5563",
          })

          const passwordFieldTop = firstFieldTop + fieldHeight + 72
          pushShapeOperation({
            shape: "rectangle",
            x: fieldX,
            y: passwordFieldTop,
            width: fieldWidth,
            height: fieldHeight,
            fill: "#f9fafb",
            stroke: "#d1d5db",
          })

          if (includeRememberMe !== false) {
            pushTextOperation({
              text: "Remember me",
              x: fieldX,
              y: passwordFieldTop + fieldHeight + 20,
              fontSize: 14,
              color: "#6b7280",
            })

            pushTextOperation({
              text: "Forgot password?",
              x: fieldX + fieldWidth - 140,
              y: passwordFieldTop + fieldHeight + 20,
              fontSize: 14,
              color: resolvedAccent,
            })
          }

          const buttonHeight = 52
          const buttonY = formPosition.y + formHeight - buttonHeight - 24
          pushShapeOperation({
            shape: "rectangle",
            x: fieldX,
            y: buttonY,
            width: fieldWidth,
            height: buttonHeight,
            fill: resolvedAccent,
            stroke: resolvedAccent,
          })

          pushTextOperation({
            text: buttonText || "Sign In",
            x: fieldX + fieldWidth / 2 - 36,
            y: buttonY + 16,
            fontSize: 18,
            color: "white",
          })

          return {
            success: true,
            components: ["container", "email field", "password field", "cta button"],
            width: formWidth,
            height: formHeight,
          }
        },
      }),
      createNavigationBar: tool({
        description:
          "Create a responsive navigation bar with brand text, menu items, and optional call-to-action button.",
        inputSchema: z.object({
          brand: z.string().optional().describe("Brand or logo text (default: 'CanvasCollab')"),
          menuItems: z.array(z.string()).optional().describe("List of navigation menu items"),
          ctaText: z.string().optional().describe("Optional call-to-action button text"),
          width: z
            .number()
            .optional()
            .describe("Navigation width (480-1400px, default 920)"),
          backgroundColor: z.string().optional().describe("Background color for the navigation bar"),
          accentColor: z.string().optional().describe("Accent color for the CTA button"),
        }),
        execute: async ({ brand, menuItems, ctaText, width, backgroundColor, accentColor }) => {
          const navWidth = clampValue(width ?? 920, 480, 1400)
          const navHeight = 84
          const navX = clampValue(
            visibleArea.centerX - navWidth / 2,
            visibleArea.left,
            Math.max(visibleArea.right - navWidth, visibleArea.left),
          )
          const navY = clampValue(visibleArea.top + 40, visibleArea.top, Math.max(visibleArea.bottom - navHeight, visibleArea.top))
          const resolvedBackground = normalizeColorInput(backgroundColor, "white")
          const resolvedAccent = normalizeColorInput(accentColor, "#2563eb")

          pushShapeOperation({
            shape: "rectangle",
            x: navX,
            y: navY,
            width: navWidth,
            height: navHeight,
            fill: resolvedBackground,
            stroke: "#e5e7eb",
          })

          pushTextOperation({
            text: brand || "CanvasCollab",
            x: navX + 32,
            y: navY + 30,
            fontSize: 22,
            color: "#111827",
          })

          const items = (menuItems && menuItems.length > 0 ? menuItems : ["Home", "About", "Features", "Contact"]).slice(0, 6)
          const menuAreaStart = navX + 200
          const menuAreaEnd = ctaText ? navX + navWidth - 180 : navX + navWidth - 80
          const itemCount = items.length
          const verticalCenter = navY + navHeight / 2 - 10

          if (itemCount === 1) {
            pushTextOperation({
              text: items[0],
              x: menuAreaStart,
              y: verticalCenter,
              fontSize: 16,
              color: "#374151",
            })
          } else {
            const spacing = itemCount > 1 ? (menuAreaEnd - menuAreaStart) / (itemCount - 1) : 0
            items.forEach((item, index) => {
              pushTextOperation({
                text: item,
                x: menuAreaStart + spacing * index,
                y: verticalCenter,
                fontSize: 16,
                color: "#374151",
              })
            })
          }

          if (ctaText) {
            const buttonWidth = 144
            const buttonHeight = 48
            const buttonX = navX + navWidth - buttonWidth - 24
            const buttonY = navY + (navHeight - buttonHeight) / 2

            pushShapeOperation({
              shape: "rectangle",
              x: buttonX,
              y: buttonY,
              width: buttonWidth,
              height: buttonHeight,
              fill: resolvedAccent,
              stroke: resolvedAccent,
            })

            pushTextOperation({
              text: ctaText,
              x: buttonX + 20,
              y: buttonY + 16,
              fontSize: 16,
              color: "white",
            })
          }

          return {
            success: true,
            menuItems: items,
            hasCta: Boolean(ctaText),
            width: navWidth,
          }
        },
      }),
      createCardLayout: tool({
        description:
          "Generate a grid of cards with image placeholders, titles, descriptions, and supporting layout spacing.",
        inputSchema: z.object({
          cards: z
            .number()
            .optional()
            .describe("Number of cards to create (1-6, default 3)"),
          columns: z
            .number()
            .optional()
            .describe("Number of columns in the grid (1-3)"),
          cardWidth: z
            .number()
            .optional()
            .describe("Card width in pixels (160-320, default 220)"),
          cardHeight: z
            .number()
            .optional()
            .describe("Card height in pixels (200-400, default 260)"),
          accentColor: z.string().optional().describe("Accent color for highlight elements"),
        }),
        execute: async ({ cards, columns, cardWidth, cardHeight, accentColor }) => {
          const totalCards = Math.max(1, Math.min(6, Math.round(cards ?? 3)))
          const gridColumns = Math.max(1, Math.min(3, Math.round(columns ?? Math.min(3, totalCards))))
          const resolvedCardWidth = clampValue(cardWidth ?? 220, 160, 320)
          const resolvedCardHeight = clampValue(cardHeight ?? 260, 200, 400)
          const gap = 24
          const rows = Math.ceil(totalCards / gridColumns)
          const gridWidth = gridColumns * resolvedCardWidth + (gridColumns - 1) * gap
          const gridHeight = rows * resolvedCardHeight + (rows - 1) * gap
          const gridPosition = getCenteredPosition(gridWidth, gridHeight, 0, 40)
          const accent = normalizeColorInput(accentColor, "#2563eb")

          for (let index = 0; index < totalCards; index++) {
            const row = Math.floor(index / gridColumns)
            const column = index % gridColumns
            const cardX = gridPosition.x + column * (resolvedCardWidth + gap)
            const cardY = gridPosition.y + row * (resolvedCardHeight + gap)

            pushShapeOperation({
              shape: "rectangle",
              x: cardX,
              y: cardY,
              width: resolvedCardWidth,
              height: resolvedCardHeight,
              fill: "white",
              stroke: "#e5e7eb",
            })

            const mediaHeight = Math.min(140, resolvedCardHeight * 0.45)
            pushShapeOperation({
              shape: "rectangle",
              x: cardX,
              y: cardY,
              width: resolvedCardWidth,
              height: mediaHeight,
              fill: "#f3f4f6",
              stroke: "#e5e7eb",
            })

            pushShapeOperation({
              shape: "rectangle",
              x: cardX,
              y: cardY + mediaHeight,
              width: resolvedCardWidth,
              height: 6,
              fill: accent,
              stroke: accent,
            })

            pushTextOperation({
              text: `Card Title ${index + 1}`,
              x: cardX + 16,
              y: cardY + mediaHeight + 24,
              fontSize: 18,
              color: "#111827",
            })

            pushTextOperation({
              text: "Short supporting description goes here.",
              x: cardX + 16,
              y: cardY + mediaHeight + 52,
              fontSize: 14,
              color: "#6b7280",
            })

            pushTextOperation({
              text: "Learn more",
              x: cardX + 16,
              y: cardY + resolvedCardHeight - 36,
              fontSize: 14,
              color: accent,
            })
          }

          return {
            success: true,
            cards: totalCards,
            columns: gridColumns,
            width: resolvedCardWidth,
            height: resolvedCardHeight,
          }
        },
      }),
    }

    const canvasWidth = typeof window !== "undefined" ? window.innerWidth : 1920
    const canvasHeight = typeof window !== "undefined" ? window.innerHeight : 1080

    // Calculate the actual accessible area considering zoom constraints
    // Users start at viewport (0, 0) with zoom 1, and can zoom in up to 3x
    // The accessible area is roughly the top-right quadrant of the 2000x2000 canvas
    const visibleArea = viewport
      ? {
          left: Math.max(0, Math.round(-viewport.x / viewport.zoom)),
          top: Math.max(0, Math.round(-viewport.y / viewport.zoom)),
          right: Math.min(2000, Math.round((-viewport.x + canvasWidth) / viewport.zoom)),
          bottom: Math.min(2000, Math.round((-viewport.y + canvasHeight) / viewport.zoom)),
          // Place objects in the top center of visible area, with some padding from the top
          centerX: Math.round((-viewport.x + canvasWidth / 2) / viewport.zoom),
          centerY: Math.round((-viewport.y + 150) / viewport.zoom), // 150px from top for better visibility
        }
      : {
          // Default to top-right accessible area when no viewport info
          left: 0,
          top: 0,
          right: 1920,
          bottom: 1080,
          centerX: 960,
          centerY: 150,
        }

    const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

    const clampShapePosition = (x: number, y: number, width: number, height: number) => {
      const maxX = Math.max(0, 2000 - width)
      const maxY = Math.max(0, 2000 - height)
      return {
        x: clampValue(x, 0, maxX),
        y: clampValue(y, 0, maxY),
      }
    }

    const clampTextPosition = (x: number, y: number) => ({
      x: clampValue(x, 0, 2000),
      y: clampValue(y, 0, 2000),
    })

    const getCenteredPosition = (width: number, height: number, offsetX = 0, offsetY = 0) => {
      const centerX = clampValue(visibleArea.centerX, visibleArea.left, visibleArea.right)
      const centerY = clampValue(visibleArea.centerY, visibleArea.top, visibleArea.bottom)
      const minX = visibleArea.left
      const maxX = Math.max(visibleArea.left, visibleArea.right - width)
      const minY = visibleArea.top
      const maxY = Math.max(visibleArea.top, visibleArea.bottom - height)
      return {
        x: clampValue(centerX - width / 2 + offsetX, minX, maxX),
        y: clampValue(centerY - height / 2 + offsetY, minY, maxY),
      }
    }

    const pushShapeOperation = ({
      shape,
      x,
      y,
      width,
      height,
      fill,
      stroke,
      strokeWidth = 2,
      rotation = 0,
    }: {
      shape: "rectangle" | "circle" | "triangle" | "line"
      x: number
      y: number
      width: number
      height: number
      fill?: string
      stroke?: string
      strokeWidth?: number
      rotation?: number
    }) => {
      const { x: clampedX, y: clampedY } = clampShapePosition(x, y, width, height)
      const fillColor = normalizeColorInput(fill, "#3b82f6")
      const strokeColor = normalizeColorInput(stroke ?? fillColor, stroke ?? fillColor)

      operations.push({
        type: "create",
        object: {
          id: crypto.randomUUID(),
          type: shape,
          x: clampedX,
          y: clampedY,
          width,
          height,
          rotation,
          fill_color: fillColor,
          stroke_color: strokeColor,
          stroke_width: strokeWidth,
        },
      })
    }

    const pushTextOperation = ({
      text,
      x,
      y,
      fontSize = 16,
      color,
    }: {
      text: string
      x: number
      y: number
      fontSize?: number
      color?: string
    }) => {
      const { x: clampedX, y: clampedY } = clampTextPosition(x, y)
      const resolvedColor = normalizeColorInput(color, "#000000")

      operations.push({
        type: "createText",
        text,
        x: clampedX,
        y: clampedY,
        fontSize,
        color: resolvedColor,
      })
    }

    const systemPrompt = `You are a canvas assistant that helps users create and manipulate shapes on a collaborative canvas.

CANVAS DIMENSIONS: 2000x2000 pixels
CANVAS CENTER: (1000, 1000)
VIEWPORT: Users can pan and zoom (100% to 300%)

${
  viewport
    ? `
CURRENT VIEWPORT (User's visible area):
- Zoom: ${Math.round(viewport.zoom * 100)}%
- Visible area: (${visibleArea.left}, ${visibleArea.top}) to (${visibleArea.right}, ${visibleArea.bottom})
- Recommended position for new objects: (${visibleArea.centerX}, ${visibleArea.centerY})

⭐ CRITICAL: Always create new objects at (${visibleArea.centerX}, ${visibleArea.centerY}) to ensure they appear in the user's accessible viewport area.
`
    : `
⭐ CRITICAL: Create new objects in the top-right accessible area (default: x=960, y=150) since users have zoom constraints.
`
}

CURRENT CANVAS STATE:
Total shapes: ${canvasStats.totalShapes}
${canvasStats.totalShapes > 0 ? `Shape types: ${JSON.stringify(canvasStats.shapeTypes)}` : ""}
${canvasStats.totalShapes > 0 ? `Colors used: ${JSON.stringify(canvasStats.colorGroups)}` : ""}

${
  selectedObjects.length > 0
    ? `
⭐ CURRENTLY SELECTED SHAPES (${selectedObjects.length}):
${JSON.stringify(selectedObjects, null, 2)}
Selected indices: ${JSON.stringify(selectedIndices)}

IMPORTANT: When the user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
`
    : "No shapes are currently selected.\n"
}

OBJECTS ON CANVAS (${currentObjects?.length || 0} total):
${JSON.stringify(canvasContext, null, 2)}

AVAILABLE FUNCTIONS:
1. getCanvasState - Query canvas information (use for questions like "how many shapes?")
2. createShape - Create new shapes (rectangle, circle, triangle, line)
3. moveShape - Move existing shapes by index
4. resizeShape - Resize existing shapes
5. rotateShape - Rotate existing shapes
6. deleteShape - Delete specific shapes or clear all
7. arrangeShapes - Arrange multiple shapes in patterns (grid, row, column, circle)
8. createText - Create a text layer on the canvas
9. createLoginForm - Build a complete login form with fields and button
10. createNavigationBar - Add a navigation header with menu links and optional CTA
11. createCardLayout - Generate a grid of rich content cards

SHAPE IDENTIFICATION RULES:
- **SELECTED SHAPES**: When user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
- Use index numbers: 0 = first shape, 1 = second, -1 = last shape
- When user says "the blue rectangle", find the shape by matching type AND color
- When user says "the circle", find the first shape of that type
- When user says "the last shape" or "the latest", use index -1
- If multiple shapes match, operate on the first match or ask for clarification

TEXT LAYER RULES:
- Use createText to add text layers
- Provide text content, position (x, y), font size, and color
- Font size defaults to 16 pixels if not specified
- Text color defaults to black (#000000) if not specified

COLOR REFERENCE (use hex codes):
- red: #ef4444, blue: #3b82f6, green: #22c55e, yellow: #eab308
- purple: #a855f7, pink: #ec4899, orange: #f97316, cyan: #06b6d4
- teal: #14b8a6, indigo: #6366f1, gray: #6b7280
- black: #000000, white: #ffffff

POSITION REFERENCE:
${
  viewport
    ? `
- **REQUIRED position for new objects**: (${visibleArea.centerX}, ${visibleArea.centerY}) - This is in the user's visible area
- Visible top-left: (${visibleArea.left}, ${visibleArea.top})
- Visible top-right: (${visibleArea.right}, ${visibleArea.top})
- Visible bottom-left: (${visibleArea.left}, ${visibleArea.bottom})
- Visible bottom-right: (${visibleArea.right}, ${visibleArea.bottom})
`
    : `
- **REQUIRED position for new objects**: (960, 150) - Top-right accessible area
- Accessible area: (0, 0) to (1920, 1080)
`
}

DEFAULT VALUES:
- Shape size: 100x100 pixels
- Spacing: 50 pixels
- Grid columns: 3
- Font size: 16 pixels
- **REQUIRED default position: (${visibleArea.centerX}, ${visibleArea.centerY}) - Always use this for new objects**

BEST PRACTICES:
1. For questions about the canvas, use getCanvasState first
2. For complex operations, call multiple functions in sequence
3. When moving/resizing shapes, verify the shape exists first
4. Be conversational and explain what you're doing
5. If a request is ambiguous, make a reasonable assumption and explain it
6. **ALWAYS check if there's a selected shape before assuming which shape to operate on**
7. **CRITICAL: ALWAYS create new objects at (${visibleArea.centerX}, ${visibleArea.centerY}) - this is within the user's accessible viewport**

Examples:
- "Create a blue square" → createShape(rectangle, x: ${visibleArea.centerX}, y: ${visibleArea.centerY}, 100x100, blue)
- "Move the circle left" → moveShape(find circle index, deltaX: -100)
- "Make it bigger" (with selection) → resizeShape(selected index, scale: 2)
- "How many shapes?" → getCanvasState(query: "count")
- "Delete all red shapes" → Find all red shapes and delete each one
- "Add text 'Hello World'" → createText(text: 'Hello World', x: ${visibleArea.centerX}, y: ${visibleArea.centerY}, fontSize: 24, color: '#000000')
- "Build a login form" → createLoginForm(title: 'Sign in', buttonText: 'Continue')
- "Create a product card layout" → createCardLayout(cards: 3, columns: 3)`

    const result = await generateText({
      model: "openai/gpt-4o-mini",
      system: systemPrompt,
      prompt: message,
      tools,
      maxSteps: 5,
    })

    console.log("[v0] AI SDK response received")
    console.log("[v0] Operations collected:", operations.length)

    let aiMessage = result.text || "I've processed your request!"

    if (validationErrors.length > 0) {
      aiMessage += `\n\nNote: Some operations couldn't be completed:\n${validationErrors.map((e) => `• ${e}`).join("\n")}`
    }

    if (queueItemId && canvasId) {
      try {
        const supabase = await createServerClient()
        await supabase
          .from("ai_operations_queue")
          .update({
            status: "completed",
            operations: operations,
            completed_at: new Date().toISOString(),
          })
          .eq("id", queueItemId)
      } catch (err) {
        console.warn("[v0] Failed to update queue status:", err)
      }
    }

    console.log("[v0] Returning", operations.length, "operations")
    return NextResponse.json({
      message: aiMessage,
      operations,
      queueItemId,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    })
  } catch (error) {
    console.error("[v0] ===== API ERROR =====")
    console.error("[v0] Error type:", error?.constructor?.name)
    console.error("[v0] Error message:", error instanceof Error ? error.message : String(error))
    console.error("[v0] Error stack:", error instanceof Error ? error.stack : "No stack trace")

    return NextResponse.json(
      {
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error),
        type: error?.constructor?.name || "Unknown",
      },
      { status: 500 },
    )
  }
}

function validateCreateShape(args: any): { valid: boolean; error?: string } {
  if (!args.shape || !["rectangle", "circle", "triangle", "line"].includes(args.shape)) {
    return { valid: false, error: "Invalid shape type. Must be rectangle, circle, triangle, or line." }
  }

  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Position (x, y) must be numbers." }
  }

  if (typeof args.width !== "number" || typeof args.height !== "number") {
    return { valid: false, error: "Dimensions (width, height) must be numbers." }
  }

  if (args.width <= 0 || args.height <= 0) {
    return { valid: false, error: "Dimensions must be positive numbers." }
  }

  if (args.width > 2000 || args.height > 2000) {
    return { valid: false, error: "Dimensions cannot exceed 2000 pixels." }
  }

  if (args.x < 0 || args.x > 2000 || args.y < 0 || args.y > 2000) {
    return { valid: false, error: "Position must be within canvas bounds (0-2000)." }
  }

  if (!isValidColorInput(args.color)) {
    return {
      valid: false,
      error: "Color must be a valid hex code (e.g., #ff0000) or supported color name (e.g., red).",
    }
  }

  return { valid: true }
}

function validateMoveShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes (indices 0-${currentObjects.length - 1}).`,
    }
  }

  if (args.x !== undefined && (typeof args.x !== "number" || args.x < 0 || args.x > 2000)) {
    return { valid: false, error: "X position must be a number between 0 and 2000." }
  }

  if (args.y !== undefined && (typeof args.y !== "number" || args.y < 0 || args.y > 2000)) {
    return { valid: false, error: "Y position must be a number between 0 and 2000." }
  }

  if (args.deltaX !== undefined && typeof args.deltaX !== "number") {
    return { valid: false, error: "deltaX must be a number." }
  }

  if (args.deltaY !== undefined && typeof args.deltaY !== "number") {
    return { valid: false, error: "deltaY must be a number." }
  }

  if (args.x === undefined && args.y === undefined && args.deltaX === undefined && args.deltaY === undefined) {
    return {
      valid: false,
      error: "Must provide either absolute position (x, y) or relative movement (deltaX, deltaY).",
    }
  }

  return { valid: true }
}

function validateResizeShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes (indices 0-${currentObjects.length - 1}).`,
    }
  }

  if (args.width !== undefined && (typeof args.width !== "number" || args.width <= 0 || args.width > 2000)) {
    return { valid: false, error: "Width must be a positive number not exceeding 2000." }
  }

  if (args.height !== undefined && (typeof args.height !== "number" || args.height <= 0 || args.height > 2000)) {
    return { valid: false, error: "Height must be a positive number not exceeding 2000." }
  }

  if (args.scale !== undefined && (typeof args.scale !== "number" || args.scale <= 0 || args.scale > 10)) {
    return { valid: false, error: "Scale must be a positive number between 0 and 10." }
  }

  if (args.width === undefined && args.height === undefined && args.scale === undefined) {
    return { valid: false, error: "Must provide either dimensions (width, height) or scale factor." }
  }

  return { valid: true }
}

function validateRotateShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes.`,
    }
  }

  if (typeof args.degrees !== "number") {
    return { valid: false, error: "Rotation degrees must be a number." }
  }

  return { valid: true }
}

function validateDeleteShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.all === true) {
    return { valid: true }
  }

  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number, or set all: true to delete all shapes." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes.`,
    }
  }

  return { valid: true }
}

function validateArrangeShapes(args: any, currentObjects: any[]): { valid: boolean; error?: string } {
  if (!args.pattern || !["grid", "row", "column", "circle"].includes(args.pattern)) {
    return { valid: false, error: "Pattern must be one of: grid, row, column, circle." }
  }

  if (args.shapeIndices && !Array.isArray(args.shapeIndices)) {
    return { valid: false, error: "shapeIndices must be an array." }
  }

  if (args.shapeIndices && args.shapeIndices.length > 0) {
    for (const index of args.shapeIndices) {
      if (typeof index !== "number" || index < 0 || index >= currentObjects.length) {
        return {
          valid: false,
          error: `Invalid shape index ${index} in shapeIndices. Canvas has ${currentObjects.length} shapes.`,
        }
      }
    }
  }

  if (args.spacing !== undefined && (typeof args.spacing !== "number" || args.spacing < 0)) {
    return { valid: false, error: "Spacing must be a non-negative number." }
  }

  if (args.columns !== undefined && (typeof args.columns !== "number" || args.columns < 1)) {
    return { valid: false, error: "Columns must be a positive number." }
  }

  return { valid: true }
}

function validateCreateText(args: any): { valid: boolean; error?: string } {
  if (!args.text) {
    return { valid: false, error: "Text content is required." }
  }

  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Position (x, y) must be numbers." }
  }

  if (args.fontSize !== undefined && (typeof args.fontSize !== "number" || args.fontSize <= 0)) {
    return { valid: false, error: "Font size must be a positive number." }
  }

  if (!isValidColorInput(args.color)) {
    return {
      valid: false,
      error: "Invalid color format. Provide a hex code (e.g., #000000) or known color name (e.g., blue).",
    }
  }

  return { valid: true }
}
