import { NextResponse } from "next/server"

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
    const { message, currentObjects } = body

    console.log("[v0] Message:", message)
    console.log("[v0] Current objects count:", currentObjects?.length || 0)

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    console.log("[v0] Calling OpenAI API directly...")

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

    const systemPrompt = `You are a canvas assistant that helps users create and manipulate shapes on a collaborative canvas.

Current canvas state (${currentObjects?.length || 0} objects):
${JSON.stringify(
  currentObjects?.map((obj: any, idx: number) => ({
    index: idx,
    type: obj.type,
    color: obj.color || obj.fill_color,
    x: Math.round(obj.x),
    y: Math.round(obj.y),
    width: Math.round(obj.width),
    height: Math.round(obj.height),
    rotation: obj.rotation,
  })) || [],
  null,
  2,
)}

You can perform the following actions:

1. CREATE - Create new shapes
2. MOVE - Move existing shapes by index or description
3. RESIZE - Resize existing shapes by index or description
4. ROTATE - Rotate existing shapes by index or description
5. DELETE - Delete shapes by index or all shapes

Respond with JSON commands in this format:
{
  "message": "Your friendly response to the user",
  "commands": [
    // CREATE command
    {
      "action": "create",
      "shape": "circle|rectangle|triangle|line",
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "color": "#hexcolor"
    },
    // MOVE command (use shapeIndex to reference existing shapes)
    {
      "action": "move",
      "shapeIndex": number, // 0-based index, or -1 for last shape
      "x": number, // absolute position
      "y": number  // absolute position
      // OR use deltaX/deltaY for relative movement
      "deltaX": number,
      "deltaY": number
    },
    // RESIZE command
    {
      "action": "resize",
      "shapeIndex": number,
      "width": number, // absolute size
      "height": number
      // OR use scale for proportional resize
      "scale": number // e.g., 2 for twice as big, 0.5 for half
    },
    // ROTATE command
    {
      "action": "rotate",
      "shapeIndex": number,
      "degrees": number, // rotation amount
      "absolute": boolean // true for absolute rotation, false for relative
    },
    // DELETE command
    {
      "action": "delete",
      "shapeIndex": number, // specific shape to delete
      "all": boolean // true to delete all shapes
    }
  ]
}

IMPORTANT COLOR RULES:
- Always use hex color codes (e.g., #ff0000 for red, #0000ff for blue)
- Common colors: red: #ef4444, blue: #3b82f6, green: #22c55e, yellow: #eab308, purple: #a855f7, pink: #ec4899, orange: #f97316, cyan: #06b6d4, black: #000000, white: #ffffff

SHAPE REFERENCING:
- Use shapeIndex to reference shapes (0 = first shape, 1 = second, etc.)
- Use -1 to reference the last/most recent shape
- You can identify shapes by their properties (e.g., "the blue rectangle" = find shape with type=rectangle and color=#3b82f6)
- When user says "the circle" or "the rectangle", find the matching shape by type

EXAMPLES:

User: "create a red circle"
Response: {"message": "I've created a red circle for you!", "commands": [{"action": "create", "shape": "circle", "x": 400, "y": 300, "width": 100, "height": 100, "color": "#ef4444"}]}

User: "move it to the center"
Response: {"message": "Moving the shape to the center!", "commands": [{"action": "move", "shapeIndex": -1, "x": 1000, "y": 1000}]}

User: "make it twice as big"
Response: {"message": "Resizing the shape to be twice as big!", "commands": [{"action": "resize", "shapeIndex": -1, "scale": 2}]}

User: "rotate it 45 degrees"
Response: {"message": "Rotating the shape 45 degrees!", "commands": [{"action": "rotate", "shapeIndex": -1, "degrees": 45, "absolute": false}]}

User: "move the blue rectangle to 500, 600"
Response: {"message": "Moving the blue rectangle to position 500, 600!", "commands": [{"action": "move", "shapeIndex": 0, "x": 500, "y": 600}]}

User: "delete the first shape"
Response: {"message": "Deleting the first shape!", "commands": [{"action": "delete", "shapeIndex": 0}]}

User: "clear the canvas"
Response: {"message": "Clearing all shapes from the canvas!", "commands": [{"action": "delete", "all": true}]}

Always respond with valid JSON only, no additional text.`

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
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    })

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json()
      console.error("[v0] OpenAI API error:", errorData)
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

    const aiText = openaiData.choices?.[0]?.message?.content
    if (!aiText) {
      console.error("[v0] No content in OpenAI response")
      return NextResponse.json(
        {
          error: "No response from AI",
          details: "OpenAI returned an empty response",
        },
        { status: 500 },
      )
    }

    console.log("[v0] AI response text:", aiText)

    // Parse the AI response
    let parsedResponse
    try {
      parsedResponse = JSON.parse(aiText)
    } catch (e) {
      console.error("[v0] Failed to parse AI response as JSON:", e)
      return NextResponse.json({
        message: aiText || "I've processed your request!",
        operations: [],
      })
    }

    const operations = []
    if (parsedResponse.commands && Array.isArray(parsedResponse.commands)) {
      for (const cmd of parsedResponse.commands) {
        if (cmd.action === "create") {
          let color = cmd.color || "#3b82f6"

          // If color is not a hex code, try to map it from color name
          if (!color.startsWith("#")) {
            const normalizedColor = color.toLowerCase().trim()
            color = colorMap[normalizedColor] || "#3b82f6"
          }

          // Validate hex color format
          if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            console.warn("[v0] Invalid color format:", color, "- using default blue")
            color = "#3b82f6"
          }

          operations.push({
            type: "create",
            object: {
              id: crypto.randomUUID(),
              type: cmd.shape,
              x: cmd.x,
              y: cmd.y,
              width: cmd.width,
              height: cmd.height,
              rotation: 0,
              color: color,
            },
          })
        } else if (cmd.action === "move") {
          operations.push({
            type: "move",
            shapeIndex: cmd.shapeIndex ?? -1,
            x: cmd.x,
            y: cmd.y,
            deltaX: cmd.deltaX,
            deltaY: cmd.deltaY,
          })
        } else if (cmd.action === "resize") {
          operations.push({
            type: "resize",
            shapeIndex: cmd.shapeIndex ?? -1,
            width: cmd.width,
            height: cmd.height,
            scale: cmd.scale,
          })
        } else if (cmd.action === "rotate") {
          operations.push({
            type: "rotate",
            shapeIndex: cmd.shapeIndex ?? -1,
            degrees: cmd.degrees ?? 0,
            absolute: cmd.absolute ?? false,
          })
        } else if (cmd.action === "delete") {
          operations.push({
            type: "delete",
            shapeIndex: cmd.shapeIndex,
            all: cmd.all ?? false,
          })
        }
      }
    }

    console.log("[v0] Returning", operations.length, "operations")
    return NextResponse.json({
      message: parsedResponse.message || "I've processed your request!",
      operations,
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
