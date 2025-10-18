import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { generateText, tool } from "ai"
import { z } from "zod"

export const maxDuration = 30

export async function POST(request: Request) {
  console.log("[v0] ===== AI Canvas API Route Called =====")

  try {
    const body = await request.json()
    const {
      message,
      currentObjects,
      selectedObjectIds,
      selectedObjects: selectedObjectsPayload,
      canvasId,
      userId,
      userName,
      viewport,
      usableCanvasDimensions,
    } = body

    console.log("[v0] Message:", message)
    const safeCurrentObjects = Array.isArray(currentObjects) ? currentObjects : []
    const safeSelectedIds = Array.isArray(selectedObjectIds) ? selectedObjectIds : []
    const safeSelectedObjects = Array.isArray(selectedObjectsPayload) ? selectedObjectsPayload : []

    console.log("[v0] Current objects count:", safeCurrentObjects.length)
    console.log("[v0] Selected objects count:", safeSelectedIds.length)
    console.log("[v0] Canvas ID:", canvasId)
    console.log("[v0] User:", userName)
    console.log("[v0] Usable canvas dimensions:", usableCanvasDimensions)

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
        const supabase = createServiceRoleClient()
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

    const canvasContext = safeCurrentObjects.map((obj: any, idx: number) => {
      const objectId = (() => {
        if (typeof obj.id === "string" && obj.id.length > 0) {
          return obj.id
        }
        if (obj.id !== undefined && obj.id !== null) {
          return String(obj.id)
        }
        return `object-${idx}`
      })()

      const isSelectedFromIds = safeSelectedIds.includes(objectId)
      const isSelectedFromPayload = safeSelectedObjects.some((selected: any) => {
        if (!selected) return false
        if (typeof selected === "string") {
          return selected === objectId
        }
        if (typeof selected?.id === "string" && selected.id.length > 0) {
          return selected.id === objectId
        }
        if (selected?.id !== undefined && selected?.id !== null) {
          return String(selected.id) === objectId
        }
        return false
      })

      const toRoundedNumber = (value: any, fallback = 0) =>
        typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback

      return {
        index: idx,
        id: objectId,
        type: obj.type,
        color: obj.fill_color,
        strokeColor: obj.stroke_color,
        strokeWidth: typeof obj.stroke_width === "number" ? obj.stroke_width : undefined,
        x: toRoundedNumber(obj.x),
        y: toRoundedNumber(obj.y),
        width: toRoundedNumber(obj.width),
        height: toRoundedNumber(obj.height),
        rotation: typeof obj.rotation === "number" ? obj.rotation : 0,
        text: obj.text_content || obj.content || "",
        locked: Boolean(obj.locked),
        visible: obj.visible !== false,
        isSelected: isSelectedFromIds || isSelectedFromPayload,
      }
    })

    const selectedContext = canvasContext.filter((obj: any) => obj.isSelected)
    const selectedIndices = selectedContext.map((obj: any) => obj.index)

    const canvasStats = {
      totalShapes: safeCurrentObjects.length,
      shapeTypes: safeCurrentObjects.reduce(
        (acc: any, obj: any) => {
          acc[obj.type] = (acc[obj.type] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
      colorGroups: safeCurrentObjects.reduce(
        (acc: any, obj: any) => {
          const color = obj.fill_color
          acc[color] = (acc[color] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
    }

    const canvasWidth = typeof window !== "undefined" ? window.innerWidth : 1920
    const canvasHeight = typeof window !== "undefined" ? window.innerHeight : 1080

    const visibleArea = viewport
      ? {
          left: Math.max(0, Math.round(-viewport.x / viewport.zoom)),
          top: Math.max(0, Math.round(-viewport.y / viewport.zoom)),
          right: Math.min(2000, Math.round((-viewport.x + canvasWidth) / viewport.zoom)),
          bottom: Math.min(2000, Math.round((-viewport.y + canvasHeight) / viewport.zoom)),
          width: Math.round(canvasWidth / viewport.zoom),
          height: Math.round(canvasHeight / viewport.zoom),
          centerX: Math.round((-viewport.x + canvasWidth / 2) / viewport.zoom),
          centerY: Math.round((-viewport.y + canvasHeight / 2) / viewport.zoom),
        }
      : {
          left: 0,
          top: 0,
          right: 1920,
          bottom: 1080,
          width: 1920,
          height: 1080,
          centerX: 960,
          centerY: 540,
        }

    const usableArea =
      usableCanvasDimensions && viewport
        ? {
            // Convert panel offsets from screen pixels to canvas coordinates
            leftOffset: Math.round(usableCanvasDimensions.leftOffset / viewport.zoom),
            rightOffset: Math.round(usableCanvasDimensions.rightOffset / viewport.zoom),
            topOffset: Math.round(usableCanvasDimensions.topOffset / viewport.zoom),
            bottomOffset: Math.round(usableCanvasDimensions.bottomOffset / viewport.zoom),
            // Calculate usable bounds
            left: visibleArea.left + Math.round(usableCanvasDimensions.leftOffset / viewport.zoom),
            top: visibleArea.top + Math.round(usableCanvasDimensions.topOffset / viewport.zoom),
            right: visibleArea.right - Math.round(usableCanvasDimensions.rightOffset / viewport.zoom),
            bottom: visibleArea.bottom - Math.round(usableCanvasDimensions.bottomOffset / viewport.zoom),
            // Calculate usable dimensions
            width: Math.round(
              (canvasWidth - usableCanvasDimensions.leftOffset - usableCanvasDimensions.rightOffset) / viewport.zoom,
            ),
            height: Math.round(
              (canvasHeight - usableCanvasDimensions.topOffset - usableCanvasDimensions.bottomOffset) / viewport.zoom,
            ),
            // Calculate center of usable area
            centerX: Math.round(
              (-viewport.x +
                (canvasWidth - usableCanvasDimensions.rightOffset + usableCanvasDimensions.leftOffset) / 2) /
                viewport.zoom,
            ),
            centerY: Math.round(
              (-viewport.y +
                (canvasHeight - usableCanvasDimensions.bottomOffset + usableCanvasDimensions.topOffset) / 2) /
                viewport.zoom,
            ),
          }
        : {
            leftOffset: 0,
            rightOffset: 0,
            topOffset: 0,
            bottomOffset: 0,
            left: visibleArea.left,
            top: visibleArea.top,
            right: visibleArea.right,
            bottom: visibleArea.bottom,
            width: visibleArea.width,
            height: visibleArea.height,
            centerX: visibleArea.centerX,
            centerY: visibleArea.centerY,
          }

    console.log("[v0] Visible area:", visibleArea)
    console.log("[v0] Usable area:", usableArea)

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

    const NAMED_COLORS: Record<string, string> = {
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
      slate: "#1f2937",
      navy: "#1d4ed8",
    }

    const normalizeColorInput = (input: string | undefined, fallback: string) => {
      if (!input) {
        return fallback
      }

      if (/^#[0-9A-Fa-f]{6}$/.test(input)) {
        return input
      }

      const normalized = input.toLowerCase().trim()
      return NAMED_COLORS[normalized] || fallback
    }

    const operations: any[] = []
    const validationErrors: string[] = []
    const shapeIndexSchema = z.union([z.number(), z.literal("selected")])

    const tools = {
      getCanvasState: tool({
        description:
          "Query information about the current canvas state. Use this to answer questions about shapes, count objects, or get information before making making changes.",
        inputSchema: z.object({
          query: z.string().describe("What information to retrieve (e.g., 'count', 'list all', 'find blue shapes')"),
        }),
        execute: async ({ query }) => {
          return {
            query,
            canvasContext,
            canvasStats,
            selectedObjects: selectedContext,
            availableOperations: Object.keys(tools),
          }
        },
      }),
      createText: tool({
        description: "Create a text layer on the canvas with customizable content, position, size, and color",
        inputSchema: z.object({
          text: z.string().describe("The text content to display"),
          x: z.number().optional().describe("X coordinate position on the canvas"),
          y: z.number().optional().describe("Y coordinate position on the canvas"),
          fontSize: z.number().optional().describe("Font size in pixels (default: 16)"),
          color: z.string().optional().describe("Text color as hex code (e.g., #000000 for black)"),
        }),
        execute: async ({ text, x, y, fontSize, color }) => {
          const validation = validateCreateText({ text, x, y, fontSize, color })
          if (!validation.valid) {
            validationErrors.push(`createText: ${validation.error}`)
            return { error: validation.error }
          }

          const finalColor = normalizeColorInput(color, "#000000")
          const finalX = x !== undefined ? x : usableArea.centerX
          const finalY = y !== undefined ? y : usableArea.centerY

          operations.push({
            type: "createText",
            text,
            x: finalX,
            y: finalY,
            fontSize: fontSize || 16,
            color: finalColor,
          })

          return {
            success: true,
            text,
            x: finalX,
            y: finalY,
            fontSize: fontSize || 16,
            color: finalColor,
          }
        },
      }),
      createShape: tool({
        description: "Create a new shape on the canvas",
        inputSchema: z.object({
          shape: z.enum(["rectangle", "circle", "triangle", "line"]).describe("The type of shape to create"),
          x: z.number().optional().describe("X coordinate position on the canvas"),
          y: z.number().optional().describe("Y coordinate position on the canvas"),
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

          const finalColor = normalizeColorInput(color, "#3b82f6")
          const finalX = x !== undefined ? x : usableArea.centerX
          const finalY = y !== undefined ? y : usableArea.centerY

          operations.push({
            type: "create",
            object: {
              id: crypto.randomUUID(),
              type: shape,
              x: finalX,
              y: finalY,
              width,
              height,
              rotation: 0,
              fill_color: finalColor,
              stroke_color: finalColor,
              stroke_width: 2,
            },
          })

          return {
            success: true,
            shape,
            x: finalX,
            y: finalY,
            width,
            height,
            color: finalColor,
          }
        },
      }),
      moveShape: tool({
        description: "Move an existing shape to a new position",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to move (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          x: z.number().optional().describe("New X coordinate (absolute position)"),
          y: z.number().optional().describe("New Y coordinate (absolute position)"),
          deltaX: z.number().optional().describe("Relative X movement (alternative to absolute x)"),
          deltaY: z.number().optional().describe("Relative Y movement (alternative to absolute y)"),
        }),
        execute: async ({ shapeIndex, x, y, deltaX, deltaY }) => {
          const validation = validateMoveShape(
            { shapeIndex, x, y, deltaX, deltaY },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`moveShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "move",
            shapeIndex: validation.shapeIndex,
            x,
            y,
            deltaX,
            deltaY,
          })

          return { success: true, shapeIndex: validation.shapeIndex, x, y, deltaX, deltaY }
        },
      }),
      resizeShape: tool({
        description: "Resize an existing shape",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to resize (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          width: z.number().optional().describe("New width in pixels (absolute size)"),
          height: z.number().optional().describe("New height in pixels (absolute size)"),
          scale: z.number().optional().describe("Scale factor (e.g., 2 for twice as big, 0.5 for half size)"),
        }),
        execute: async ({ shapeIndex, width, height, scale }) => {
          const validation = validateResizeShape(
            { shapeIndex, width, height, scale },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`resizeShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "resize",
            shapeIndex: validation.shapeIndex,
            width,
            height,
            scale,
          })

          return { success: true, shapeIndex: validation.shapeIndex, width, height, scale }
        },
      }),
      rotateShape: tool({
        description: "Rotate an existing shape",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to rotate (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          degrees: z.number().describe("Rotation amount in degrees"),
          absolute: z
            .boolean()
            .optional()
            .describe("If true, set absolute rotation; if false, rotate relative to current rotation"),
        }),
        execute: async ({ shapeIndex, degrees, absolute }) => {
          const validation = validateRotateShape({ shapeIndex, degrees, absolute }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`rotateShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "rotate",
            shapeIndex: validation.shapeIndex,
            degrees: degrees ?? 0,
            absolute: absolute ?? false,
          })

          return { success: true, shapeIndex: validation.shapeIndex, degrees, absolute }
        },
      }),
      deleteShape: tool({
        description: "Delete one or more shapes from the canvas",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema
            .optional()
            .describe("Index of the shape to delete (0-based, or 'selected' for currently selected shape)"),
          all: z.boolean().optional().describe("If true, delete all shapes from the canvas"),
        }),
        execute: async ({ shapeIndex, all }) => {
          const validation = validateDeleteShape({ shapeIndex, all }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`deleteShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "delete",
            shapeIndex: validation.shapeIndex,
            all: all ?? false,
          })

          return { success: true, shapeIndex: validation.shapeIndex, all }
        },
      }),
      deleteShapesByType: tool({
        description:
          "Delete all shapes of a specific type (e.g., all rectangles, all circles). Use this when user asks to delete shapes by type.",
        inputSchema: z.object({
          shapeType: z
            .enum(["rectangle", "circle", "triangle", "line", "text"])
            .describe("The type of shapes to delete"),
        }),
        execute: async ({ shapeType }) => {
          const matchingIndices = canvasContext
            .filter((obj: any) => obj.type === shapeType)
            .map((obj: any) => obj.index)

          if (matchingIndices.length === 0) {
            return {
              success: false,
              error: `No ${shapeType} shapes found on the canvas.`,
              deletedCount: 0,
            }
          }

          matchingIndices.reverse().forEach((index: number) => {
            operations.push({
              type: "delete",
              shapeIndex: index,
              all: false,
            })
          })

          return {
            success: true,
            shapeType,
            deletedCount: matchingIndices.length,
            message: `Deleted ${matchingIndices.length} ${shapeType}${matchingIndices.length > 1 ? "s" : ""}`,
          }
        },
      }),
      deleteShapesByColor: tool({
        description: "Delete all shapes of a specific color. Use this when user asks to delete shapes by color.",
        inputSchema: z.object({
          color: z.string().describe("The color to match (hex code like #ff0000 or color name like 'red')"),
        }),
        execute: async ({ color }) => {
          const normalizedColor = normalizeColorInput(color, "")

          const matchingIndices = canvasContext
            .filter((obj: any) => obj.color === normalizedColor || obj.strokeColor === normalizedColor)
            .map((obj: any) => obj.index)

          if (matchingIndices.length === 0) {
            return {
              success: false,
              error: `No shapes with color ${color} found on the canvas.`,
              deletedCount: 0,
            }
          }

          matchingIndices.reverse().forEach((index: number) => {
            operations.push({
              type: "delete",
              shapeIndex: index,
              all: false,
            })
          })

          return {
            success: true,
            color: normalizedColor,
            deletedCount: matchingIndices.length,
            message: `Deleted ${matchingIndices.length} shape${matchingIndices.length > 1 ? "s" : ""} with color ${color}`,
          }
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
          const validation = validateArrangeShapes({ pattern, shapeIndices, spacing, columns }, safeCurrentObjects)
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
          "Create a polished login form with title, username/password fields, and a primary action button arranged vertically.",
        inputSchema: z.object({
          x: z.number().optional().describe("Center X coordinate for the form"),
          y: z.number().optional().describe("Center Y coordinate for the form"),
          title: z.string().optional().describe("Heading text to display above the form"),
          subtitle: z.string().optional().describe("Optional supporting text shown below the title"),
          primaryColor: z.string().optional().describe("Accent color for the button (hex code or common color name)"),
        }),
        execute: async ({ x, y, title, subtitle, primaryColor }) => {
          const formWidth = 360
          const formHeight = 320

          const finalX = x !== undefined ? x : usableArea.centerX
          const finalY = y !== undefined ? y : usableArea.centerY

          const buttonColor = normalizeColorInput(primaryColor, "#3b82f6")

          operations.push({
            type: "createLoginForm",
            x: finalX,
            y: finalY,
            width: formWidth,
            height: formHeight,
            titleText: title || "Welcome back",
            subtitleText: subtitle || "Please sign in to continue",
            usernameLabel: "Email",
            passwordLabel: "Password",
            buttonText: "Sign In",
            backgroundColor: "#ffffff",
            fieldColor: "#f3f4f6",
            buttonColor,
            buttonTextColor: "#ffffff",
            textColor: "#111827",
            mutedTextColor: "#6b7280",
            helpText: "Forgot password?",
          })

          return { success: true, x: finalX, y: finalY, width: formWidth, height: formHeight }
        },
      }),

      createNavigationBar: tool({
        description:
          "Create a horizontal navigation bar with a brand label and evenly spaced menu items across the top of the canvas.",
        inputSchema: z.object({
          items: z.number().int().min(2).max(8).optional().describe("How many navigation items to include (2-8)"),
          x: z.number().optional().describe("Center X coordinate for the navigation bar"),
          y: z.number().optional().describe("Top Y coordinate for the navigation bar (defaults to top of view)"),
          brand: z.string().optional().describe("Brand or product name to show on the left"),
          accentColor: z.string().optional().describe("Highlight color for the active navigation item"),
        }),
        execute: async ({ items, x, y, brand, accentColor }) => {
          const navItems = clamp(items ?? 4, 2, 8)
          const navWidth = Math.max(420, Math.min(960, navItems * 140))
          const navHeight = 64

          const finalX = x !== undefined ? x : usableArea.centerX
          const finalY = y !== undefined ? y : usableArea.top + navHeight / 2 + 20

          const leftX = finalX - navWidth / 2
          const topY = finalY - navHeight / 2
          const highlightColor = normalizeColorInput(accentColor, "#3b82f6")

          operations.push({
            type: "createNavBar",
            x: leftX,
            y: topY,
            width: navWidth,
            height: navHeight,
            items: navItems,
            brandText: brand || "Product",
            menuItems: Array.from({ length: navItems }, (_, index) => (index === 0 ? "Home" : `Item ${index + 1}`)),
            backgroundColor: "#111827",
            itemColor: "#1f2937",
            activeItemColor: highlightColor,
            textColor: "#f9fafb",
          })

          return { success: true, x: leftX, y: topY, width: navWidth, height: navHeight, items: navItems }
        },
      }),
      createCardLayout: tool({
        description:
          "Create a content card with an image placeholder, title, description text, and call-to-action button.",
        inputSchema: z.object({
          x: z.number().optional().describe("Center X coordinate for the card"),
          y: z.number().optional().describe("Center Y coordinate for the card"),
          title: z.string().optional().describe("Title text inside the card"),
          description: z.string().optional().describe("Supporting description text for the card"),
          buttonText: z.string().optional().describe("Call-to-action label for the card button"),
          accentColor: z.string().optional().describe("Accent color for the media area and button"),
        }),
        execute: async ({ x, y, title, description, buttonText, accentColor }) => {
          const cardWidth = 320
          const cardHeight = 220

          const finalX = x !== undefined ? x : usableArea.centerX
          const finalY = y !== undefined ? y : usableArea.centerY

          const accent = normalizeColorInput(accentColor, "#3b82f6")

          operations.push({
            type: "createCard",
            x: finalX,
            y: finalY,
            width: cardWidth,
            height: cardHeight,
            titleText: title || "Card title",
            descriptionText: description || "Add supporting details here.",
            buttonText: buttonText || "Learn more",
            accentColor: accent,
            backgroundColor: "#ffffff",
            textColor: "#111827",
            mutedTextColor: "#6b7280",
            buttonTextColor: "#ffffff",
          })

          return { success: true, x: finalX, y: finalY, width: cardWidth, height: cardHeight }
        },
      }),
    }

    const systemPrompt = `You are a canvas assistant that helps users create and manipulate shapes on a collaborative canvas.

CANVAS DIMENSIONS: 2000x2000 pixels
CANVAS CENTER: (1000, 1000)
VIEWPORT: Users can pan and zoom (100% to 300%)

${
  viewport && usableCanvasDimensions
    ? `
CURRENT VIEWPORT (User's visible area):
- Zoom: ${Math.round(viewport.zoom * 100)}%
- Full visible bounds: Left=${visibleArea.left}, Top=${visibleArea.top}, Right=${visibleArea.right}, Bottom=${visibleArea.bottom}
- Full visible size: ${visibleArea.width}x${visibleArea.height} pixels

⭐ USABLE CANVAS AREA (excluding UI panels):
- **Usable bounds: Left=${usableArea.left}, Top=${usableArea.top}, Right=${usableArea.right}, Bottom=${usableArea.bottom}**
- **Usable size: ${usableArea.width}x${usableArea.height} pixels**
- **Center of usable area: (${usableArea.centerX}, ${usableArea.centerY})** ← USE THIS FOR NEW OBJECTS
- UI panel offsets: Left=${usableArea.leftOffset}px, Right=${usableArea.rightOffset}px, Top=${usableArea.topOffset}px, Bottom=${usableArea.bottomOffset}px

⭐ CRITICAL POSITIONING RULES: 
1. **ALWAYS create new objects at (${usableArea.centerX}, ${usableArea.centerY})** - the center of the usable area
2. The user has panels open that cover parts of the canvas:
   - Left side (toolbar): ~${usableArea.leftOffset}px
   - Right side (panels): ~${usableArea.rightOffset}px
   - Top (toolbar): ~${usableArea.topOffset}px
   - Bottom (comments): ~${usableArea.bottomOffset}px
3. **NEVER create objects in areas covered by panels** - they won't be visible to the user
4. When user requests relative positioning (e.g., "5cm down", "below X"), calculate from existing objects but ensure result is within usable area
5. For navigation bars, position near top of usable area: y ≈ ${usableArea.top + 50}
6. For forms/cards, use center of usable area: (${usableArea.centerX}, ${usableArea.centerY})
7. The usable area is where the user can actually see and interact with objects
`
    : viewport
      ? `
CURRENT VIEWPORT (User's visible area):
- Zoom: ${Math.round(viewport.zoom * 100)}%
- Visible bounds: Left=${visibleArea.left}, Top=${visibleArea.top}, Right=${visibleArea.right}, Bottom=${visibleArea.bottom}
- Visible size: ${visibleArea.width}x${visibleArea.height} pixels
- **Center of visible area: (${visibleArea.centerX}, ${visibleArea.centerY})**

⭐ POSITIONING GUIDELINES: 
1. Default position for new objects: (${visibleArea.centerX}, ${visibleArea.centerY}) - center of user's view
2. When user requests relative positioning (e.g., "5cm down", "below X"), calculate from existing objects
3. Ensure objects are positioned within or near the visible viewport for best user experience
4. For navigation bars, position near top of viewport: y ≈ ${visibleArea.top + 50}
5. For forms/cards, use center of viewport: (${visibleArea.centerX}, ${visibleArea.centerY})
`
      : `
⭐ DEFAULT POSITIONING: Create new objects at (960, 540) - center of default view.
`
}

CURRENT CANVAS STATE:
Total shapes: ${canvasStats.totalShapes}
${canvasStats.totalShapes > 0 ? `Shape types: ${JSON.stringify(canvasStats.shapeTypes)}` : ""}
${canvasStats.totalShapes > 0 ? `Colors used: ${JSON.stringify(canvasStats.colorGroups)}` : ""}

${
  selectedContext.length > 0
    ? `
⭐ CURRENTLY SELECTED SHAPES (${selectedContext.length}):
${JSON.stringify(selectedContext, null, 2)}
Selected indices: ${JSON.stringify(selectedIndices)}

IMPORTANT: When the user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
`
    : "No shapes are currently selected.\n"
}

OBJECTS ON CANVAS (${safeCurrentObjects.length} total):
${JSON.stringify(canvasContext, null, 2)}

AVAILABLE FUNCTIONS:
1. getCanvasState - Query canvas information (use for questions like "how many shapes?")
2. createShape - Create new shapes (rectangle, circle, triangle, line)
3. moveShape - Move existing shapes by index
4. resizeShape - Resize existing shapes
5. rotateShape - Rotate existing shapes
6. deleteShape - Delete specific shapes or clear all
7. deleteShapesByType - Delete all shapes of a specific type (e.g., all rectangles)
8. deleteShapesByColor - Delete all shapes of a specific color
9. arrangeShapes - Arrange multiple shapes in patterns (grid, row, column, circle)
10. createText - Create a text layer on the canvas
11. createLoginForm - Build a multi-element login form layout with labels and button
12. createNavigationBar - Create a navigation bar with menu items
13. createCardLayout - Create a card with media area, text, and button

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
  usableCanvasDimensions && viewport
    ? `
- **DEFAULT position**: (${usableArea.centerX}, ${usableArea.centerY}) - Center of USABLE area (visible to user)
- Usable top-left: (${usableArea.left}, ${usableArea.top})
- Usable top-right: (${usableArea.right}, ${usableArea.top})
- Usable bottom-left: (${usableArea.left}, ${usableArea.bottom})
- Usable bottom-right: (${usableArea.right}, ${usableArea.bottom})
- **AVOID areas covered by panels** (outside usable bounds)
`
    : viewport
      ? `
- **DEFAULT position**: (${visibleArea.centerX}, ${visibleArea.centerY}) - Center of user's visible area
- Visible top-left: (${visibleArea.left}, ${visibleArea.top})
- Visible top-right: (${visibleArea.right}, ${visibleArea.top})
- Visible bottom-left: (${visibleArea.left}, ${visibleArea.bottom})
- Visible bottom-right: (${visibleArea.right}, ${visibleArea.bottom})
`
      : `
- **DEFAULT position**: (960, 540) - Center of default view
- Accessible area: (0, 0) to (1920, 1080)
`
}

RELATIVE POSITIONING:
- When user says "5cm down" or "below X", calculate relative to existing objects or viewport center
- 1cm ≈ 37.8 pixels (standard screen DPI)
- "above" = negative Y, "below" = positive Y
- "left of" = negative X, "right of" = positive X
- Calculate positions to keep objects visible and well-positioned in the usable area
- **Ensure calculated positions stay within usable bounds to remain visible**

DEFAULT VALUES:
- Shape size: 100x100 pixels
- Spacing: 50 pixels
- Grid columns: 3
- Font size: 16 pixels
- **DEFAULT position: (${usableArea.centerX}, ${usableArea.centerY}) - Center of usable area**

BEST PRACTICES:
1. For questions about the canvas, use getCanvasState first
2. For complex operations, call multiple functions in sequence
3. When moving/resizing shapes, verify the shape exists first
4. Be conversational and explain what you're doing
5. If a request is ambiguous, make a reasonable assumption and explain it
6. **ALWAYS check if there's a selected shape before assuming which shape to operate on**
7. **Position objects in the usable area (${usableArea.centerX}, ${usableArea.centerY}) so they're visible to the user**
8. **When user requests relative positioning, calculate from existing objects but ensure result is within usable bounds**
9. **When deleting by type or color, use deleteShapesByType or deleteShapesByColor**
10. **The usable area excludes UI panels - objects created there will be visible and accessible**

Examples:
- "Create a blue square" → createShape(rectangle, x: ${usableArea.centerX}, y: ${usableArea.centerY}, 100x100, blue)
- "Add text 5cm below the header" → Find header Y position, add ~189 pixels (5cm), createText at that position (ensure within usable area)
- "Move the circle left" → moveShape(find circle index, deltaX: -100)
- "Make it bigger" (with selection) → resizeShape(selected index, scale: 2)
- "How many shapes?" → getCanvasState(query: "count")
- "Delete all rectangles" → deleteShapesByType(shapeType: "rectangle")
- "Create a login form" → createLoginForm at usable area center (${usableArea.centerX}, ${usableArea.centerY})`

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
        const supabase = createServiceRoleClient()
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

type ValidationFailure = { valid: false; error: string }
type ValidationSuccess<T extends Record<string, unknown> = Record<string, never>> = { valid: true } & T
type ValidationResult<T extends Record<string, unknown> = Record<string, never>> =
  | ValidationFailure
  | ValidationSuccess<T>

function resolveShapeIndex(
  shapeIndex: number | "selected" | undefined,
  selectedIndices: number[],
  totalShapes: number,
): ValidationResult<{ shapeIndex: number }> {
  if (shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    return resolveShapeIndex(selectedIndices[0], selectedIndices, totalShapes)
  }

  if (typeof shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number or 'selected'." }
  }

  if (!Number.isFinite(shapeIndex)) {
    return { valid: false, error: "shapeIndex must be a finite number." }
  }

  const resolvedIndex = shapeIndex === -1 ? totalShapes - 1 : shapeIndex

  if (totalShapes === 0) {
    return { valid: false, error: "There are no shapes on the canvas." }
  }

  if (resolvedIndex < 0 || resolvedIndex >= totalShapes) {
    return {
      valid: false,
      error: `Invalid shape index ${shapeIndex}. Canvas has ${totalShapes} shapes (indices 0-${Math.max(0, totalShapes - 1)}).`,
    }
  }

  return { valid: true, shapeIndex: resolvedIndex }
}

function validateCreateShape(args: any): { valid: boolean; error?: string } {
  if (!args.shape || !["rectangle", "circle", "triangle", "line"].includes(args.shape)) {
    return { valid: false, error: "Invalid shape type. Must be rectangle, circle, triangle, or line." }
  }

  if (args.x !== undefined && (typeof args.x !== "number" || args.x < 0 || args.x > 2000)) {
    return { valid: false, error: "X position must be a number between 0 and 2000." }
  }

  if (args.y !== undefined && (typeof args.y !== "number" || args.y < 0 || args.y > 2000)) {
    return { valid: false, error: "Y position must be a number between 0 and 2000." }
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

  return { valid: true }
}

function validateMoveShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): ValidationResult<{ shapeIndex: number }> {
  const indexResult = resolveShapeIndex(args.shapeIndex, selectedIndices, currentObjects.length)
  if (!indexResult.valid) {
    return indexResult
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

  return { valid: true, shapeIndex: indexResult.shapeIndex }
}

function validateResizeShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): ValidationResult<{ shapeIndex: number }> {
  const indexResult = resolveShapeIndex(args.shapeIndex, selectedIndices, currentObjects.length)
  if (!indexResult.valid) {
    return indexResult
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

  return { valid: true, shapeIndex: indexResult.shapeIndex }
}

function validateRotateShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): ValidationResult<{ shapeIndex: number }> {
  const indexResult = resolveShapeIndex(args.shapeIndex, selectedIndices, currentObjects.length)
  if (!indexResult.valid) {
    return indexResult
  }

  if (args.degrees === undefined) {
    return { valid: false, error: "Rotation degrees are required." }
  }

  if (typeof args.degrees !== "number") {
    return { valid: false, error: "Rotation degrees must be a number." }
  }

  return { valid: true, shapeIndex: indexResult.shapeIndex }
}

function validateDeleteShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): ValidationResult<{ shapeIndex?: number }> {
  if (args.all === true) {
    return { valid: true }
  }

  const indexResult = resolveShapeIndex(args.shapeIndex, selectedIndices, currentObjects.length)
  if (!indexResult.valid) {
    return indexResult
  }

  return { valid: true, shapeIndex: indexResult.shapeIndex }
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

  if (args.x !== undefined && (typeof args.x !== "number" || args.x < 0 || args.x > 2000)) {
    return { valid: false, error: "X position must be a number between 0 and 2000." }
  }

  if (args.y !== undefined && (typeof args.y !== "number" || args.y < 0 || args.y > 2000)) {
    return { valid: false, error: "Y position must be a number between 0 and 2000." }
  }

  if (args.fontSize !== undefined && (typeof args.fontSize !== "number" || args.fontSize <= 0)) {
    return { valid: false, error: "Font size must be a positive number." }
  }

  if (args.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(args.color)) {
    return { valid: false, error: "Invalid color format. Must be a hex code." }
  }

  return { valid: true }
}
