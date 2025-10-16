import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  console.log("[v0] ===== AI Canvas API Route Called =====")

  try {
    const apiKey = process.env.OPENAI_API_KEY
    console.log("[v0] API Key present:", !!apiKey)

    if (!apiKey) {
      console.error("[v0] OPENAI_API_KEY environment variable is not set")
      return NextResponse.json(
        {
          error: "OpenAI API key is not configured",
          details: "Please add your OPENAI_API_KEY environment variable in the project settings",
        },
        { status: 500 },
      )
    }

    const body = await request.json()
    const { message, currentObjects, selectedObjectIds, canvasId, userId, userName } = body

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

    console.log("[v0] Calling OpenAI API with function calling...")

    const tools = [
      {
        type: "function",
        function: {
          name: "getCanvasState",
          description:
            "Query information about the current canvas state. Use this to answer questions about shapes, count objects, or get information before making changes.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "What information to retrieve (e.g., 'count', 'list all', 'find blue shapes')",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "createText",
          description: "Create a text layer on the canvas with customizable content, position, size, and color",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The text content to display",
              },
              x: {
                type: "number",
                description: "X coordinate position on the canvas",
              },
              y: {
                type: "number",
                description: "Y coordinate position on the canvas",
              },
              fontSize: {
                type: "number",
                description: "Font size in pixels (default: 16)",
              },
              color: {
                type: "string",
                description: "Text color as hex code (e.g., #000000 for black)",
              },
            },
            required: ["text", "x", "y"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "createShape",
          description: "Create a new shape on the canvas",
          parameters: {
            type: "object",
            properties: {
              shape: {
                type: "string",
                enum: ["rectangle", "circle", "triangle", "line"],
                description: "The type of shape to create",
              },
              x: {
                type: "number",
                description: "X coordinate position on the canvas",
              },
              y: {
                type: "number",
                description: "Y coordinate position on the canvas",
              },
              width: {
                type: "number",
                description: "Width of the shape in pixels",
              },
              height: {
                type: "number",
                description: "Height of the shape in pixels",
              },
              color: {
                type: "string",
                description: "Hex color code (e.g., #ff0000 for red, #3b82f6 for blue)",
              },
            },
            required: ["shape", "x", "y", "width", "height", "color"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "moveShape",
          description: "Move an existing shape to a new position",
          parameters: {
            type: "object",
            properties: {
              shapeIndex: {
                type: "number",
                description:
                  "Index of the shape to move (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
              },
              x: {
                type: "number",
                description: "New X coordinate (absolute position)",
              },
              y: {
                type: "number",
                description: "New Y coordinate (absolute position)",
              },
              deltaX: {
                type: "number",
                description: "Relative X movement (alternative to absolute x)",
              },
              deltaY: {
                type: "number",
                description: "Relative Y movement (alternative to absolute y)",
              },
            },
            required: ["shapeIndex"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "resizeShape",
          description: "Resize an existing shape",
          parameters: {
            type: "object",
            properties: {
              shapeIndex: {
                type: "number",
                description:
                  "Index of the shape to resize (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
              },
              width: {
                type: "number",
                description: "New width in pixels (absolute size)",
              },
              height: {
                type: "number",
                description: "New height in pixels (absolute size)",
              },
              scale: {
                type: "number",
                description: "Scale factor (e.g., 2 for twice as big, 0.5 for half size)",
              },
            },
            required: ["shapeIndex"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "rotateShape",
          description: "Rotate an existing shape",
          parameters: {
            type: "object",
            properties: {
              shapeIndex: {
                type: "number",
                description:
                  "Index of the shape to rotate (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
              },
              degrees: {
                type: "number",
                description: "Rotation amount in degrees",
              },
              absolute: {
                type: "boolean",
                description: "If true, set absolute rotation; if false, rotate relative to current rotation",
              },
            },
            required: ["shapeIndex", "degrees"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "deleteShape",
          description: "Delete one or more shapes from the canvas",
          parameters: {
            type: "object",
            properties: {
              shapeIndex: {
                type: "number",
                description: "Index of the shape to delete (0-based, or 'selected' for currently selected shape)",
              },
              all: {
                type: "boolean",
                description: "If true, delete all shapes from the canvas",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "arrangeShapes",
          description: "Arrange multiple shapes in a pattern (grid, row, column, circle)",
          parameters: {
            type: "object",
            properties: {
              pattern: {
                type: "string",
                enum: ["grid", "row", "column", "circle"],
                description: "The arrangement pattern",
              },
              shapeIndices: {
                type: "array",
                items: { type: "number" },
                description: "Indices of shapes to arrange (empty array means all shapes)",
              },
              spacing: {
                type: "number",
                description: "Spacing between shapes in pixels",
              },
              columns: {
                type: "number",
                description: "Number of columns (for grid pattern)",
              },
            },
            required: ["pattern"],
          },
        },
      },
    ]

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

    const systemPrompt = `You are a canvas assistant that helps users create and manipulate shapes on a collaborative canvas.

CANVAS DIMENSIONS: 2000x2000 pixels
CANVAS CENTER: (1000, 1000)
VIEWPORT: Users can pan and zoom (100% to 300%)

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
- Center: (1000, 1000)
- Top-left: (200, 200)
- Top-right: (1800, 200)
- Bottom-left: (200, 1800)
- Bottom-right: (1800, 1800)

DEFAULT VALUES:
- Shape size: 100x100 pixels
- Spacing: 50 pixels
- Grid columns: 3
- Font size: 16 pixels

BEST PRACTICES:
1. For questions about the canvas, use getCanvasState first
2. For complex operations, call multiple functions in sequence
3. When moving/resizing shapes, verify the shape exists first
4. Be conversational and explain what you're doing
5. If a request is ambiguous, make a reasonable assumption and explain it
6. **ALWAYS check if there's a selected shape before assuming which shape to operate on**

Examples:
- "Create a blue square" → createShape(rectangle, center position, 100x100, blue)
- "Move the circle left" → moveShape(find circle index, deltaX: -100)
- "Make it bigger" (with selection) → resizeShape(selected index, scale: 2)
- "How many shapes?" → getCanvasState(query: "count")
- "Delete all red shapes" → Find all red shapes and delete each one
- "Add text 'Hello World' at the center" → createText(text: 'Hello World', x: 1000, y: 1000, fontSize: 24, color: '#000000')`

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: message,
          },
        ],
        tools: tools,
        tool_choice: "auto",
        temperature: 0.7,
      }),
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json()
      console.error("[v0] OpenAI API error:", errorData)

      if (queueItemId && canvasId) {
        try {
          const supabase = await createServerClient()
          await supabase
            .from("ai_operations_queue")
            .update({
              status: "failed",
              error_message: errorData.error?.message || "OpenAI API error",
              completed_at: new Date().toISOString(),
            })
            .eq("id", queueItemId)
        } catch (err) {
          console.warn("[v0] Failed to update queue status:", err)
        }
      }

      return NextResponse.json(
        {
          error: "OpenAI API error",
          details: errorData.error?.message || "Unknown error",
        },
        { status: openaiResponse.status },
      )
    }

    const openaiData = await openaiResponse.json()
    console.log("[v0] OpenAI response received")

    const responseMessage = openaiData.choices?.[0]?.message
    if (!responseMessage) {
      console.error("[v0] No message in OpenAI response")

      if (queueItemId && canvasId) {
        try {
          const supabase = await createServerClient()
          await supabase
            .from("ai_operations_queue")
            .update({
              status: "failed",
              error_message: "No response from AI",
              completed_at: new Date().toISOString(),
            })
            .eq("id", queueItemId)
        } catch (err) {
          console.warn("[v0] Failed to update queue status:", err)
        }
      }

      return NextResponse.json(
        {
          error: "No response from AI",
          details: "OpenAI returned an empty response",
        },
        { status: 500 },
      )
    }

    const operations = []
    const toolCalls = responseMessage.tool_calls
    const validationErrors: string[] = []

    if (toolCalls && Array.isArray(toolCalls)) {
      console.log("[v0] Processing", toolCalls.length, "tool calls")

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const args = JSON.parse(toolCall.function.arguments)

        console.log("[v0] Tool call:", functionName, "with args:", args)

        if (functionName === "getCanvasState") {
          console.log("[v0] Canvas state query:", args.query)
        } else if (functionName === "createShape") {
          const validation = validateCreateShape(args)
          if (!validation.valid) {
            validationErrors.push(`createShape: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
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

          let color = args.color || "#3b82f6"

          if (!color.startsWith("#")) {
            const normalizedColor = color.toLowerCase().trim()
            color = colorMap[normalizedColor] || "#3b82f6"
          }

          if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            console.warn("[v0] Invalid color format:", color, "- using default blue")
            color = "#3b82f6"
          }

          operations.push({
            type: "create",
            object: {
              id: crypto.randomUUID(),
              type: args.shape,
              x: args.x,
              y: args.y,
              width: args.width,
              height: args.height,
              rotation: 0,
              fill_color: color,
              stroke_color: color,
              stroke_width: 2,
            },
          })
        } else if (functionName === "moveShape") {
          const validation = validateMoveShape(args, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`moveShape: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
          }

          operations.push({
            type: "move",
            shapeIndex: args.shapeIndex === "selected" ? selectedIndices[0] : (args.shapeIndex ?? -1),
            x: args.x,
            y: args.y,
            deltaX: args.deltaX,
            deltaY: args.deltaY,
          })
        } else if (functionName === "resizeShape") {
          const validation = validateResizeShape(args, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`resizeShape: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
          }

          operations.push({
            type: "resize",
            shapeIndex: args.shapeIndex === "selected" ? selectedIndices[0] : (args.shapeIndex ?? -1),
            width: args.width,
            height: args.height,
            scale: args.scale,
          })
        } else if (functionName === "rotateShape") {
          const validation = validateRotateShape(args, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`rotateShape: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
          }

          operations.push({
            type: "rotate",
            shapeIndex: args.shapeIndex === "selected" ? selectedIndices[0] : (args.shapeIndex ?? -1),
            degrees: args.degrees ?? 0,
            absolute: args.absolute ?? false,
          })
        } else if (functionName === "deleteShape") {
          const validation = validateDeleteShape(args, currentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`deleteShape: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
          }

          operations.push({
            type: "delete",
            shapeIndex: args.shapeIndex === "selected" ? selectedIndices[0] : args.shapeIndex,
            all: args.all ?? false,
          })
        } else if (functionName === "arrangeShapes") {
          const validation = validateArrangeShapes(args, currentObjects)
          if (!validation.valid) {
            validationErrors.push(`arrangeShapes: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
          }

          operations.push({
            type: "arrange",
            pattern: args.pattern,
            shapeIndices: args.shapeIndices || [],
            spacing: args.spacing || 50,
            columns: args.columns,
          })
        } else if (functionName === "createText") {
          const validation = validateCreateText(args)
          if (!validation.valid) {
            validationErrors.push(`createText: ${validation.error}`)
            console.warn("[v0] Validation error:", validation.error)
            continue
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

          let color = args.color || "#000000"

          if (!color.startsWith("#")) {
            const normalizedColor = color.toLowerCase().trim()
            color = colorMap[normalizedColor] || "#000000"
          }

          if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            console.warn("[v0] Invalid color format:", color, "- using default black")
            color = "#000000"
          }

          operations.push({
            type: "createText",
            text: args.text,
            x: args.x,
            y: args.y,
            fontSize: args.fontSize || 16,
            color: color,
          })
        }
      }
    }

    let aiMessage = responseMessage.content || "I've processed your request!"

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
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes (indices 0-${currentObjects.length - 1}).`,
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

  if (args.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(args.color)) {
    return { valid: false, error: "Invalid color format. Must be a hex code." }
  }

  return { valid: true }
}
