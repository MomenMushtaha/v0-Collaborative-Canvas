import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { generateText, tool } from "ai"
import { z } from "zod"

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

          const colorMap: Record<string, string> = {
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
          }

          let finalColor = color || "#000000"
          if (!finalColor.startsWith("#")) {
            const normalizedColor = finalColor.toLowerCase().trim()
            finalColor = colorMap[normalizedColor] || "#000000"
          }

          if (!/^#[0-9A-Fa-f]{6}$/.test(finalColor)) {
            finalColor = "#000000"
          }

          operations.push({
            type: "createText",
            text,
            x,
            y,
            fontSize: fontSize || 16,
            color: finalColor,
          })

          return { success: true, text, x, y, fontSize: fontSize || 16, color: finalColor }
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

          const colorMap: Record<string, string> = {
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
            black: "#000000",
            white: "#ffffff",
          }

          let finalColor = color || "#3b82f6"
          if (!finalColor.startsWith("#")) {
            const normalizedColor = finalColor.toLowerCase().trim()
            finalColor = colorMap[normalizedColor] || "#3b82f6"
          }

          if (!/^#[0-9A-Fa-f]{6}$/.test(finalColor)) {
            finalColor = "#3b82f6"
          }

          operations.push({
            type: "create",
            object: {
              id: crypto.randomUUID(),
              type: shape,
              x,
              y,
              width,
              height,
              rotation: 0,
              fill_color: finalColor,
              stroke_color: finalColor,
              stroke_width: 2,
            },
          })

          return { success: true, shape, x, y, width, height, color: finalColor }
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
      createLayoutPreset: tool({
        description:
          "Create multi-element UI layouts like login forms, nav bars, dashboards, hero sections, pricing tables, and button rows.",
        inputSchema: z.object({
          preset: z
            .enum([
              "login_form",
              "dashboard",
              "nav_bar",
              "card",
              "form",
              "hero_section",
              "pricing_table",
              "button_row",
            ])
            .describe("The layout preset to generate"),
          x: z.number().optional().describe("Optional X coordinate for the layout center"),
          y: z.number().optional().describe("Optional Y coordinate for the layout center"),
          theme: z.enum(["light", "dark"]).optional().describe("Visual theme variant"),
          items: z
            .number()
            .optional()
            .describe("Number of navigation items (nav_bar)"),
          fields: z
            .number()
            .optional()
            .describe("Number of fields (form presets)"),
          tiers: z
            .number()
            .optional()
            .describe("Number of pricing tiers (pricing_table)"),
          buttons: z
            .number()
            .optional()
            .describe("Number of buttons (button_row)"),
          title: z.string().optional().describe("Optional title text override"),
          subtitle: z.string().optional().describe("Optional subtitle text override"),
          brand: z.string().optional().describe("Brand label for nav_bar"),
        }),
        execute: async (args) => {
          const validation = validateCreateLayoutPreset(args, visibleArea)
          if (!validation.valid) {
            validationErrors.push(`createLayoutPreset: ${validation.error}`)
            return { error: validation.error }
          }

          const { preset, x, y, theme, items, fields, tiers, buttons, title, subtitle, brand } = validation

          switch (preset) {
            case "login_form":
              operations.push({ type: "createLoginForm", x, y, theme, title, subtitle })
              break
            case "dashboard":
              operations.push({ type: "createDashboard", x, y, theme })
              break
            case "nav_bar":
              operations.push({ type: "createNavBar", x, y, theme, items, brand })
              break
            case "card":
              operations.push({ type: "createCard", x, y, theme })
              break
            case "form":
              operations.push({ type: "createForm", x, y, theme, fields, title, subtitle })
              break
            case "hero_section":
              operations.push({ type: "createHeroSection", x, y, theme })
              break
            case "pricing_table":
              operations.push({ type: "createPricingTable", x, y, theme, tiers })
              break
            case "button_row":
              operations.push({ type: "createButtonRow", x, y, theme, buttons })
              break
            default:
              return { error: `Unsupported preset ${preset}` }
          }

          return { success: true, preset, x, y }
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
9. createLayoutPreset - Build complex, multi-element UI sections (login forms, dashboards, hero sections, pricing tables, nav bars, button rows)

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
2. For complex operations, prefer createLayoutPreset for ready-made layouts, then refine with other tools as needed
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
- "Create a login form" → createLayoutPreset(preset: "login_form", theme: "light")
- "Build a pricing table with 3 tiers" → createLayoutPreset(preset: "pricing_table", tiers: 3)`

    const result = await generateText({
      model: "openai/gpt-4o-mini",
      system: systemPrompt,
      prompt: message,
      tools,
      maxSteps: 8,
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

function validateCreateLayoutPreset(
  args: any,
  visibleArea: { centerX: number; centerY: number },
): {
  valid: boolean
  error?: string
  preset?: string
  x?: number
  y?: number
  theme?: "light" | "dark"
  items?: number
  fields?: number
  tiers?: number
  buttons?: number
  title?: string
  subtitle?: string
  brand?: string
} {
  const allowedPresets = [
    "login_form",
    "dashboard",
    "nav_bar",
    "card",
    "form",
    "hero_section",
    "pricing_table",
    "button_row",
  ]

  if (!args || !args.preset || !allowedPresets.includes(args.preset)) {
    return {
      valid: false,
      error: `preset must be one of: ${allowedPresets.join(", ")}.`,
    }
  }

  const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

  const resolvePosition = (value: any, fallback: number) => {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback
    return clampValue(numeric, 0, 2000)
  }

  const x = resolvePosition(args.x, visibleArea.centerX)
  const y = resolvePosition(args.y, visibleArea.centerY)

  const toPositiveInt = (value: any, fallback: number, min: number, max: number) => {
    const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback
    return clampValue(numeric, min, max)
  }

  const theme: "light" | "dark" = args.theme === "dark" ? "dark" : "light"
  const items = toPositiveInt(args.items, 4, 2, 7)
  const fields = toPositiveInt(args.fields, 3, 2, 5)
  const tiers = toPositiveInt(args.tiers, 3, 2, 4)
  const buttons = toPositiveInt(args.buttons, 3, 2, 5)

  const sanitizeText = (value: any, maxLength: number) => {
    if (typeof value !== "string") return undefined
    return value.trim().slice(0, maxLength)
  }

  return {
    valid: true,
    preset: args.preset,
    x,
    y,
    theme,
    items,
    fields,
    tiers,
    buttons,
    title: sanitizeText(args.title, 80),
    subtitle: sanitizeText(args.subtitle, 120),
    brand: sanitizeText(args.brand, 48),
  }
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

  if (args.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(args.color)) {
    return { valid: false, error: "Invalid color format. Must be a hex code." }
  }

  return { valid: true }
}
